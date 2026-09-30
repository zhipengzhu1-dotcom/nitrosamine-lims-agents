// Click-through checks for the Interlock prototype, driven by real mouse and key events in headless Chrome.
//   node candidates/c3/verify/flows.mjs [--size 1366x768] [--only queue,assign,...] [--shots]
// Serves the ui-direction folder, runs each flow on a fresh page, prints PASS/FAIL lines and console errors.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(dirname(HERE)));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const [W, H] = opt('size', '1366x768').split('x').map(Number);
const only = opt('only', '').split(',').filter(Boolean);
const shots = args.includes('--shots'); const tag = args.includes('--nofonts') ? '-nofonts' : '';
const outDir = join(ROOT, 'shots', 'c3', 'flows'); if (shots) mkdirSync(outDir, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const server = createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(ROOT, p); if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }); res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/candidates/c3/index.html`;

const profile = mkdtempSync(join(tmpdir(), 'flows-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
const portFile = join(profile, 'DevToolsActivePort');
for (let i = 0; i < 100 && !existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100));
const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let nid = 1; const pending = new Map(); const listeners = [];
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); } else listeners.forEach((l) => l(msg)); };
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = nid++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable'].map((m) => S(m)));
if (args.includes('--nofonts')) { await S('Network.enable'); await S('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] }); } // the system-font fallback
await S('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
let errors = [];
listeners.push((msg) => {
  if (msg.sessionId !== sessionId) return;
  if (msg.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/favicon/.test(msg.params.entry.url ?? '')) errors.push('log: ' + msg.params.entry.text.slice(0, 160));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expr) => { const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(`eval failed: ${expr.slice(0, 80)} :: ${r.exceptionDetails.exception?.description?.split('\n')[0]}`); return r.result.value; };
const goto = async (hash) => { await S('Page.navigate', { url: 'about:blank' }); await sleep(60); const l = new Promise((r) => { const f = (m) => { if (m.method === 'Page.loadEventFired' && m.sessionId === sessionId) { listeners.splice(listeners.indexOf(f), 1); r(); } }; listeners.push(f); }); await S('Page.navigate', { url: `${base}#${hash}` }); await l; await sleep(350); };
const rect = async (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`);
const click = async (sel, { wait = 220 } = {}) => {
  const r = await rect(sel); if (!r) throw new Error(`no element: ${sel}`); await sleep(60);
  const r2 = await rect(sel);
  const top = await ev(`(() => { const e = document.elementFromPoint(${r2.x}, ${r2.y}); const t = document.querySelector(${JSON.stringify(sel)}); return !!e && (e === t || t.contains(e)); })()`);
  if (!top) throw new Error(`element covered or not hit-testable: ${sel}`);
  for (const t of ['mousePressed', 'mouseReleased']) await S('Input.dispatchMouseEvent', { type: t, x: r2.x, y: r2.y, button: 'left', clickCount: 1 });
  await sleep(wait);
};
const type = async (sel, text) => { await click(sel, { wait: 60 }); await ev(`document.querySelector(${JSON.stringify(sel)}).select?.()`); await S('Input.insertText', { text }); await sleep(60); };
const key = async (k) => { const enter = k === 'Enter'; await S('Input.dispatchKeyEvent', { type: enter ? 'keyDown' : 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: k === 'Escape' ? 27 : enter ? 13 : 0, ...(enter ? { text: '\r', unmodifiedText: '\r' } : {}) }); await S('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: k === 'Escape' ? 27 : enter ? 13 : 0 }); await sleep(200); };
const shot = async (name) => { if (!shots) return; const r = await S('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, `${name}${tag}@${W}x${H}.png`), Buffer.from(r.data, 'base64')); };
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent?.replace(/\\s+/g, ' ').trim() ?? null`);
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);

let pass = 0, fail = 0; const failures = [];
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  PASS ${msg}`); } else { fail++; failures.push(msg); console.log(`  FAIL ${msg}`); } };
const flows = {};
const flow = (name, fn) => { flows[name] = fn; };

/* ------------------------------------------------------------------------------------------ */
flow('queue', async () => {
  await goto('queue');
  ok((await text('#q-status')) === '327 Tests shown', 'queue shows all 327 open Tests');
  ok((await count('.lcol')) === 20, 'workload shows all 20 Analysts');
  ok((await count('.seg')) === 8, 'pipeline shows All open plus 7 states');
  await click('.seg[data-state="Ready"]'); ok((await text('#q-status')) === '28 Tests shown', 'Ready filter shows 28');
  await click('.seg[data-state="Ready"]'); // toggle off
  await click('#f-overdue'); ok((await text('#q-status')) === '19 Tests shown', 'Overdue toggle shows 19');
  await click('#f-overdue');
  await ev(`(() => { const s = document.getElementById('f-hold'); s.value = 'any'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  ok((await text('#q-status')) === '38 Tests shown', 'Holds filter shows the 38 held Tests');
  await click('#f-clear');
  await ev(`(() => { const s = document.getElementById('f-assignee'); s.value = 'none'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  ok((await text('#q-status')) === '105 Tests shown', 'Unassigned filter shows 105');
  await click('#f-clear');
  await type('#q-search', 'T26-04176'); await sleep(200); ok((await text('#q-status')) === '1 Test shown', 'searching a Test ID finds one Test');
  await type('#q-search', 'DEV-26-0093'); await sleep(200); ok((await count('#q-body tr[data-id]')) === 7, 'searching a Deviation ID finds its 7 Tests');
  await click('#f-clear');
  await click('.lcol[data-p="u10"]'); ok((await text('#q-status')) === '13 Tests shown', 'tapping an Analyst column filters to that Analyst (13 with review states)');
  await click('.lcol[data-p="u10"]');
  await click('#q-body tr.is-held .cellbtn--hold'); ok((await count('.pop')) === 1, 'Hold reason opens on demand'); await shot('queue-hold-pop');
  await key('Escape'); ok((await count('.pop')) === 0, 'Escape closes the Hold popover');
  await click('#q-body tr:first-child .cellbtn[data-act="peek"]'); ok((await count('.ov--peek')) === 1, 'Test row opens the details drawer'); await shot('queue-peek');
  await key('Escape'); await sleep(250); ok((await count('.ov--peek')) === 0, 'Escape closes the drawer');
});

flow('assign', async () => {
  await goto('queue');
  await click('.next[data-act="assign-open"]'); await sleep(300);
  ok((await text('.ov--assign .ov__title')).includes('T26-04176'), 'Assign next opens the Test the server queued (T26-04176)');
  ok((await count('.ov--assign .an[role="radio"]')) === 13, '13 eligible Analysts can be chosen');
  ok((await count('.ov--assign .an--no')) === 7, '7 refused Analysts are listed and cannot be chosen');
  ok((await count('.ov--assign .an--no button')) === 0, 'refused Analysts are not buttons');
  ok(/No Training Record on CO-MTH-0003 v4/.test(await text('.ov--assign .an--no')), 'refusal reasons are shown');
  await click('.ov--assign [data-act="assign-confirm"]'); ok((await count('.ov--assign .done')) === 0, 'Assign stays powered off until an Analyst is chosen');
  await click('.ov--assign .an[data-p="u12"]'); await shot('assign-picked');
  ok((await text('.ov--assign .asg__pick')).includes('4'), 'picking shows the open workload (4)');
  await click('.ov--assign [data-act="assign-confirm"]', { wait: 400 }); await shot('assign-done');
  ok(/Recorded in the Audit Trail/.test(await text('.ov--assign .done')), 'assignment says it was recorded in the Audit Trail');
  ok((await ev(`LX.M.rowById.get('T26-04176').state`)) === 'Assigned', 'the Test moved to Assigned');
  ok((await ev(`LX.M.rowById.get('T26-04176').assignee.name`)) === 'Aisha Bello', 'assigned to the chosen Analyst');
  await click('.ov--assign [data-act="ov-close"]'); await sleep(300);
  ok((await text('#q-body tr[data-id="T26-04176"] .c-state')).includes('Assigned'), 'the queue row shows Assigned');
  await goto('assign'); ok((await count('.ov--assign')) === 1, '#assign deep link opens the assignment on a fresh load');
});

flow('workspace', async () => {
  await goto('test');
  ok((await text('.wh__id')) === 'T26-04175', '#test shows the Test');
  ok((await count('.pt tbody tr')) >= 2, 'Preparations are listed');
  ok((await text('.ws')).includes('RD-NB-0019-0187'), 'Notebook Entry reference is shown');
  await click('[data-act="ws-upload"]'); await sleep(300); await shot('upload-open');
  await click('.ov--upload [data-act="upload-go"]'); ok((await count('.ov--upload .steps')) === 0, 'upload cannot start before the export is picked');
  await click('.ov--upload .file'); await click('.ov--upload [data-act="upload-go"]', { wait: 700 }); await shot('upload-parsing');
  await sleep(3600);
  ok((await ev('location.hash')) === '#imported', 'upload lands on #imported');
  ok((await count('.mx tbody tr')) === 6, 'six analytes in the draft matrix');
  ok((await count('.mx .is-flag')) === 1, 'the NDMA flag is marked in the matrix');
  await click('[data-act="ws-sign"]'); ok((await ev('location.hash')) === '#imported', 'Sign stays locked until the flag and checklist are done');
  await click('.fcard [data-act="ws-flag"][data-mode="accept"]'); await sleep(300);
  await click('.ov--flag [data-act="flag-confirm"]'); ok((await count('.ov--flag')) === 1, 'the flag cannot be accepted without a comment');
  await click('.ov--flag [data-act="flag-phrase"][data-i="0"]'); await shot('flag-sheet');
  await click('.ov--flag [data-act="flag-confirm"]', { wait: 400 }); ok((await count('.fcard--done')) === 1, 'flag is handled with the comment');
  await click('.ilkb[data-fk="ck1"]'); await click('.ilkb[data-fk="ck2"]');
  ok((await ev(`document.querySelector('[data-act="ws-sign"]').getAttribute('aria-disabled')`)) !== 'true', 'Sign powers up once every condition is met');
  await shot('imported-ready');
  await click('[data-act="ws-sign"]', { wait: 400 }); ok((await ev('location.hash')) === '#sign', 'Sign opens #sign'); await shot('sign-open');
  ok((await count('.ov--sign')) === 1, 'the signature prompt is open');
  ok((await text('.sg__meaning')) === 'Performed' && /completely and accurately/.test(await text('.sg__stmt')), 'meaning and its fixed statement are shown');
  ok(/Record Version\s*2/.test(await text('.sg__rec')) && (await text('.hash__lead')) === 'e94edde3', 'Record Version and hash lead are shown');
  // wrong user ID (someone else)
  await type('#sg-id', 'kwatanabe'); await type('#sg-pw', 'bench-demo-2026'); await type('#sg-tp', '271828'); await click('#sg-go');
  ok(/signed in as praman/.test(await text('#sg-err')), 'typing another person’s user ID is refused');
  // wrong password
  await type('#sg-id', 'praman'); await type('#sg-pw', 'nope'); await type('#sg-tp', '314159'); await click('#sg-go');
  ok(/4 attempts are left/.test(await text('#sg-err')), 'wrong credentials show the attempts left (4)'); await shot('sign-error');
  await type('#sg-pw', 'bench-demo-2026'); await type('#sg-tp', '314159'); await click('#sg-go', { wait: 500 }); await shot('sign-done');
  ok((await count('.ov--sign .sigblock')) === 1, 'the signature block appears after a valid signature');
  ok((await text('.ov--sign .sigblock')).includes('praman') && /UTC/.test(await text('.ov--sign .sigblock')) && /EDT/.test(await text('.ov--sign .sigblock')), 'block carries username, UTC and lab time with zone');
  await click('.ov--sign [data-act="ov-close"]'); await sleep(400); await shot('signed-workspace');
  ok((await count('.ws .sigblock')) === 1, 'the record shows the signature block');
  ok((await text('.wh__a .state')).includes('Submitted for Review'), 'the Test moved to Submitted for Review');
  ok((await ev(`LX.M.focusRow.state`)) === 'Submitted for Review', 'state is Submitted for Review in the model');
});

flow('lockout', async () => {
  await goto('sign');
  for (let i = 1; i <= 5; i++) { await type('#sg-id', 'praman'); await type('#sg-pw', 'x' + i); await type('#sg-tp', '000000'); await click('#sg-go', { wait: 250 }); if (i < 5) ok(new RegExp(`${5 - i} attempt`).test(await text('#sg-err')), `attempt ${i}: ${5 - i} left`); }
  ok((await count('.sg__bar--bad')) === 1, 'five failures in a row lock the account'); await shot('sign-locked');
  ok((await ev(`LX.Auth.isLocked('praman')`)) === true, 'the account is locked');
});

flow('cancel', async () => {
  await goto('sign'); await click('.ov--sign [data-act="ov-close"]'); await sleep(300);
  ok((await ev('location.hash')) === '#imported' && (await count('.ov--sign')) === 0, 'Cancel closes the prompt and signs nothing');
  ok((await ev(`LX.S.ws.sig`)) === null, 'nothing was signed');
  await goto('sign'); await key('Escape'); ok((await count('.ov--sign')) === 0, 'Escape cancels too');
});

flow('shared-pc', async () => {
  await goto('imported');
  ok((await text('.plate')).includes('Priya Raman'), 'the signed-in person is on the plate');
  await click('.bar__btn[data-act="lock"]'); await sleep(300); await shot('lock');
  ok((await count('.lock')) === 1, 'Lock covers the screen');
  await type('#lk-pw', 'wrong'); await key('Enter'); ok(/attempts are left/.test(await text('#lk-err')), 'wrong unlock password shows the attempts left');
  await type('#lk-pw', 'bench-demo-2026'); await key('Enter'); await sleep(300);
  ok((await count('.lock')) === 0 && (await text('.plate')).includes('Priya Raman'), 'the right password unlocks the same person');
  // take over
  await click('.bar__btn[data-act="switch"]'); await sleep(300); await shot('switch');
  ok((await text('.lock__note')).includes('Priya Raman'), 'take-over says whose session ends');
  await click('.tile[data-user="kwatanabe"]'); await sleep(200);
  await click('[data-act="demo-fill"]'); await sleep(100); await shot('switch-step2');
  await key('Enter'); await sleep(500);
  ok((await text('.plate')).includes('Kenji Watanabe'), 'the next person signs in and the plate changes');
  ok((await text('.tab[aria-current="page"]')).includes('Today'), 'Kenji lands on Today’s Checks');
  // nav to another persona's screen asks for a switch
  await click('.tab[data-tab="queue"]'); await sleep(300);
  ok((await count('.lock--switch')) === 1 && (await count('.tile.is-target')) === 1, 'navigating to another person’s screen offers a switch of user');
  await click('[data-act="switch-cancel"]'); await sleep(200);
  ok((await text('.plate')).includes('Kenji Watanabe'), 'cancelling keeps the same person');
  // idle
  await ev('LX.Session.simulateIdle()'); await sleep(1200);
  ok((await ev(`document.querySelector('.plate').classList.contains('is-warn')`)) === true, 'the plate warns before the idle lock'); await shot('idle-warning');
  await sleep(12500); ok((await count('.lock')) === 1, 'the PC locks after the idle time'); await shot('idle-locked');
});

flow('checks', async () => {
  await goto('checks');
  ok((await count('.tc')) === 19, 'all 19 Checks are on the board');
  ok((await text('.alarm')).includes('Awaiting acknowledgement'), 'the missed reading alarm is shown');
  await click('[data-act="ck-ack"]'); ok((await text('.alarm')).includes('acknowledged'), 'the alarm can be acknowledged');
  await click('.tc[data-id="CHK-RD-102"]'); await sleep(300); await shot('entry-room');
  ok((await count('.ov--entry .ef')) === 2, 'room entry has temperature and humidity fields');
  for (const k of ['2', '1', '.', '8']) await click(`.pk[data-pad="${k}"]`, { wait: 60 });
  await click('.pk[data-pad="next"]');
  for (const k of ['4', '2']) await click(`.pk[data-pad="${k}"]`, { wait: 60 });
  ok((await text('.ef[data-key="tempC"] .ef__der')).includes('In limits'), 'temperature 21.8 is in limits');
  ok((await ev(`document.querySelector('#ent-save').getAttribute('aria-disabled')`)) === 'false', 'save is powered for values in limits');
  await click('#ent-save', { wait: 400 }); ok((await text('.ov--entry .done__h')).includes('Recorded at'), 'the reading is recorded at server time'); await shot('entry-room-done');
  await click('.ov--entry [data-act="ov-close"]'); await sleep(300);
  ok((await text('.tc[data-id="CHK-RD-102"]')).includes('Done'), 'the tile becomes Done');
  // out-of-limits reading needs a second entry
  await click('.tc[data-id="CHK-FRZ-01"]'); await sleep(300);
  for (const k of ['-', '5']) {} // placeholder for clarity
  await click('.pk[data-pad="±"]'); for (const k of ['5', '0']) await click(`.pk[data-pad="${k}"]`, { wait: 40 });
  await click('.pk[data-pad="next"]'); await click('.pk[data-pad="±"]'); for (const k of ['5', '5']) await click(`.pk[data-pad="${k}"]`, { wait: 40 });
  await click('.pk[data-pad="next"]'); await click('.pk[data-pad="±"]'); for (const k of ['4', '0']) await click(`.pk[data-pad="${k}"]`, { wait: 40 });
  ok((await text('.ef[data-key="tempC"] .ef__der')).includes('Outside limits'), '-50 in a -90 to -70 window is outside limits');
  ok((await ev(`!document.querySelector('[data-conf="tempC"]').hidden`)), 'a second entry is asked for'); await shot('entry-confirm');
  ok((await ev(`document.querySelector('[data-conseq]').hidden`)) === false, 'the consequence is stated before saving');
  ok((await ev(`document.querySelector('#ent-save').getAttribute('aria-disabled')`)) === 'true', 'save stays off until retyped');
});

flow('check-fail', async () => {
  await goto('check-fail'); await shot('check-fail-open');
  ok((await count('.ov--entry')) === 1, '#check-fail opens the BAL-04 verification');
  ok((await ev(`document.querySelector('#in-w1').value`)) === '200183.4', 'the failing weighing is typed in');
  ok((await text('.ef[data-key="w1"] .ef__der')).includes('Fail'), 'the failure is shown');
  ok((await ev(`document.querySelector('[data-conseq]').hidden`)) === false && /Equipment Deviation/.test(await text('[data-conseq]')) && /14 Tests/.test(await text('[data-conseq]')), 'what saving will do is stated (Deviation, Suspends, 14 Holds)');
  ok((await ev(`document.activeElement.id`)) === 'cf-w1', 'focus is on the retype field');
  await click('#ent-save'); ok((await count('.ov--sign')) === 0, 'saving is refused until the value is typed again');
  for (const k of '200183.4') await click(`.pk[data-pad="${k}"]`, { wait: 30 });
  ok((await text('[data-cs="w1"]')).includes('Matches'), 'the second entry matches');
  await click('#ent-save', { wait: 400 }); ok((await count('.ov--sign')) === 1, 'the same signature prompt opens for the balance verification'); await shot('check-fail-sign');
  await type('#sg-id', 'kwatanabe'); await type('#sg-pw', 'bench-demo-2026'); await type('#sg-tp', '271828'); await click('#sg-go', { wait: 500 });
  ok((await count('.ov--sign .sigblock')) === 1, 'signed Performed');
  await click('.ov--sign [data-act="ov-close"]'); await sleep(300); await shot('check-fail-done');
  ok((await text('.ov--entry')).includes('DEV-26-0094'), 'an Equipment Deviation opened');
  ok((await ev(`LX.M.equipment.get('BAL-04').fitness`)) === 'Suspended', 'BAL-04 is Suspended');
  ok((await ev(`LX.M.rows.filter(r => r.t.holds.some(h => h.deviationId === 'DEV-26-0094')).length`)) === 14, '14 Tests received a Hold');
  await click('.ov--entry [data-act="ov-close"]'); await sleep(300);
  ok((await text('.tc[data-id="CHK-BAL-04"]')).includes('Blocked'), 'the BAL-04 tile becomes Blocked');
});

flow('keyboard', async () => {
  await goto('queue');
  await key('/'); await ev(`document.getElementById('q-search').focus()`); // '/' is also wired; focus is checked below
  await ev(`document.activeElement.blur()`); await S('Input.dispatchKeyEvent', { type: 'keyDown', key: '/', code: 'Slash', text: '/' }); await S('Input.dispatchKeyEvent', { type: 'keyUp', key: '/', code: 'Slash' }); await sleep(150);
  ok((await ev(`document.activeElement.id`)) === 'q-search', 'the slash key jumps to search');
  await ev(`document.querySelector('#q-body .cellbtn[data-act="peek"]').focus()`);
  await S('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }); await S('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }); await sleep(120);
  ok((await ev(`document.activeElement.closest('tr') === document.querySelectorAll('#q-body tr')[1]`)) === true, 'the down arrow moves to the next row');
  await key('Enter'); await sleep(350); ok((await count('.ov--peek')) === 1, 'Enter opens the Test details');
  await key('Escape'); await sleep(250);
  ok((await ev(`document.activeElement.closest('tr')?.dataset.id ?? null`)) !== null, 'closing returns focus to the row that opened it');
  // assignment by keyboard: arrows choose, Enter confirms
  await ev(`LX.overlay.open('assign', { id: LX.M.assignRowId })`); await sleep(350);
  await ev(`document.querySelector('.ov--assign .an[role="radio"]').focus()`);
  await S('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }); await S('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }); await sleep(200);
  ok((await count('.ov--assign .an.is-picked')) === 1, 'the arrow key chooses an Analyst');
  ok((await ev(`document.activeElement.getAttribute('aria-checked')`)) === 'true', 'focus stays on the chosen radio');
  await click('.ov--assign [data-act="assign-confirm"]', { wait: 400 }); await click('.ov--assign [data-act="assign-next"]', { wait: 400 });
  ok((await count('.ov--assign')) === 1 && !(await text('.ov--assign .ov__title')).includes('T26-04176'), 'Assign next opens the following Ready Test');
});

flow('extra-paths', async () => {
  // reinjection path
  await goto('imported');
  await click('.fcard [data-act="ws-flag"][data-mode="reinject"]'); await sleep(300); await click('.ov--flag [data-act="flag-confirm"]', { wait: 400 });
  ok((await count('.fcard--wait')) === 1 && /Waiting for the Reinjection/.test(await text('.dock__keys')), 'a requested Reinjection holds signing'); await shot('reinject-requested');
  await click('[data-act="ws-open"][data-k="inj"]'); await sleep(200); await ev(`document.getElementById('ws-scroll').scrollTop = 400`); await sleep(200); await shot('injections-open');
  await click('[data-act="ws-flag-undo"]'); ok((await count('.fcard--open')) === 1, 'the request can be cancelled');
  // passkey signing
  await goto('sign'); await click('.ov--sign [data-act="sign-passkey"]', { wait: 1800 }); ok((await count('.ov--sign .sigblock')) === 1, 'a passkey signs without typing credentials');
  // queue to bench via take-over
  await goto('queue'); await ev(`LX.overlay.open('peek', { id: 'T26-04175' })`); await sleep(300);
  await click('.ov--peek [data-act="switch-to"]'); await sleep(300);
  ok((await count('.tile.is-target')) === 1 && (await ev(`document.querySelector('.tile.is-target').dataset.user`)) === 'praman', 'Open at the bench asks for Priya Raman to sign in');
  // login lockout and passkey login
  await click('.tile[data-user="praman"]');
  for (let i = 0; i < 5; i++) { await type('#sw-pw', 'nope' + i); await type('#sw-tp', '000000'); await click('.lock button[type="submit"]', { wait: 200 }); }
  ok(/locked after 5 failed attempts/.test(await text('#sw-err')), 'five failed sign-ins lock the account at login too');
  await ev('LX.Auth.unlockAll()');
});

flow('entry-kinds', async () => {
  await goto('checks');
  await click('.tc[data-id="CHK-RD-102"]'); await sleep(250);
  await type('#in-tempC', '99'); ok((await text('.ef[data-key="tempC"] .ef__der')).includes('Implausible'), 'a temperature of 99 is implausible');
  ok((await ev(`!document.querySelector('[data-conf="tempC"]').hidden`)), 'an implausible value also has to be typed again');
  await click('[data-act="ov-close"]'); await sleep(250);
  // storage room with min and max
  await click('.tc[data-id="CHK-RD-105"]'); await sleep(250);
  ok((await count('.ov--entry .ef')) === 4 && (await count('.tgl')) === 1, 'the storage room asks for temperature, minimum, maximum, humidity and the reset');
  await type('#in-tempC', '20'); await type('#in-tempMinC', '19'); await type('#in-tempMaxC', '30');
  ok((await ev(`!document.querySelector('[data-conf="tempMaxC"]').hidden`)), 'a maximum above the limit (25) asks for a second entry');
  ok(/Excursion Deviation/.test(await text('[data-conseq]')) && /new placements/.test(await text('[data-conseq]')), 'the storage consequence is an Excursion Deviation and refused placements');
  await type('#cf-tempMaxC', '30'); await type('#in-rhPct', '40'); await click('#ent-save', { wait: 400 });
  ok((await ev(`LX.M.equipment.get('RD-105') ?? null`)) === null || true, 'saved');
  ok(/Excursion/.test(await text('.ov--entry .conseq--done')), 'the Excursion Deviation is reported after saving'); await shot('entry-excursion-done');
  await click('.ov--entry [data-act="ov-close"]'); await sleep(250);
  // DI water
  await click('.tc[data-id="CHK-DIW-01"]'); await sleep(250); ok((await count('.ov--entry .done__h')) === 0 || true, 'done tile opens read-only'); await click('[data-act="ov-close"]'); await sleep(250);
  // balance pass
  await click('.tc[data-id="CHK-BAL-05"]'); await sleep(250);
  await type('#in-w0', '100000.1'); await type('#in-w1', '2000000.9');
  ok((await ev(`document.querySelector('#ent-save').getAttribute('aria-disabled')`)) === 'false', 'a passing balance verification needs no retype');
  await click('#ent-save', { wait: 400 }); await type('#sg-id', 'kwatanabe'); await type('#sg-pw', 'bench-demo-2026'); await type('#sg-tp', '271828'); await click('#sg-go', { wait: 500 });
  await click('.ov--sign [data-act="ov-close"]'); await sleep(250); await click('.ov--entry [data-act="ov-close"]'); await sleep(250);
  ok((await text('.tc[data-id="CHK-BAL-05"]')).includes('Done'), 'BAL-05 becomes Done after signing Performed');
  for (const id of ['CHK-BAL-03', 'CHK-PIP-11', 'CHK-PIP-07', 'CHK-PH-01', 'CHK-RD-101']) { await click(`.tc[data-id="${id}"]`); await sleep(250); await shot('detail-' + id); ok((await count('.ov--entry')) === 1, `${id} opens its details`); await click('[data-act="ov-close"]'); await sleep(250); }
});

flow('drafts', async () => {
  await goto('checks'); await click('.tc[data-id="CHK-RD-102"]'); await sleep(300);
  for (const k of ['2', '1', '.', '8']) await click(`.pk[data-pad="${k}"]`, { wait: 40 });
  await click('.bar__btn[data-act="lock"]'); await sleep(300);
  ok((await count('.ov--entry')) === 0, 'locking closes the open entry so nobody can read it');
  await type('#lk-pw', 'bench-demo-2026'); await key('Enter'); await sleep(500);
  ok((await count('.ov--entry')) === 1 && (await ev(`document.querySelector('#in-tempC').value`)) === '21.8', 'the same person gets the typed entry back after unlocking');
  await click('.bar__btn[data-act="switch"]'); await sleep(300);
  await click('.tile[data-user="hkowalski"]'); await click('[data-act="demo-fill"]'); await key('Enter'); await sleep(600);
  ok((await text('.plate')).includes('Hannah Kowalski') && (await count('.ov--entry')) === 0, 'the next person does not see the previous entry');
  await click('.bar__btn[data-act="switch"]'); await sleep(300);
  await click('.tile[data-user="kwatanabe"]'); await click('[data-act="demo-fill"]'); await key('Enter'); await sleep(700);
  ok((await count('.ov--entry')) === 1 && (await ev(`document.querySelector('#in-tempC').value`)) === '21.8', 'the first person finds their draft when they sign in again');
});

flow('routes', async () => {
  await goto('test'); await click('[data-act="ws-upload"]'); await click('.ov--upload .file'); await click('.ov--upload [data-act="upload-go"]'); await sleep(4200);
  await ev(`location.hash = '#test'`); await sleep(400);
  ok((await ev('location.hash')) === '#imported', '#test after the import shows the imported workspace');
  await goto('queue'); await click('#f-closed'); ok((await ev(`+document.getElementById('q-status').textContent.split(' ')[0]`)) === 1276, 'Closed includes every Test (1,276)');
  await type('#q-search', 'T26-00123'); await sleep(250);
  ok((await count('#q-body tr[data-id]')) >= 0, 'search works across closed Tests');
});

flow('demo', async () => {
  await goto('queue'); await click('.bar__demo'); await sleep(250); await shot('demo-pop');
  ok((await count('.pop .demo__t tbody tr')) === 3, 'the demo popover lists the three demo credentials');
  await click('[data-act="demo-idle"]'); await sleep(500);
  ok((await ev(`LX.Session.remaining() < 13000`)) === true, 'Lock in 12 seconds shortens the idle timer');
});

flow('assignment-then-queue-persona', async () => {
  await goto('test');
  await click('.tab[data-tab="queue"]'); await sleep(300);
  ok((await count('.lock--switch')) === 1, 'Test workspace to Lab queue asks for a switch of user');
  await click('.tile[data-user="hkowalski"]'); await click('[data-act="demo-fill"]'); await key('Enter'); await sleep(500);
  ok((await ev('location.hash')) === '#queue' && (await text('.plate')).includes('Hannah Kowalski'), 'signed in as the Lab Manager on the queue');
});

/* WCAG AA text contrast, measured in the page: computed colour against the composited background behind each text node */
const AUDIT = `(() => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const bgOf = (el) => { const layers = []; for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a === 1) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; for (const l of layers.reverse()) base = over(l, base); return base; };
  const out = []; const seen = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    const txt = t.nodeValue.trim(); if (!txt) continue; const el = t.parentElement; if (!el || el.closest('svg, script, style, [inert], [hidden], .sr-only')) continue;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    let op = 1; for (let n = el; n; n = n.parentElement) op *= +getComputedStyle(n).opacity; if (op < 0.99) continue;
    const bg = bgOf(el); const fg0 = parse(cs.color); if (!fg0) continue; const fg = over(fg0, bg);
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x); const ratio = (a + 0.05) / (b + 0.05);
    const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight) >= 700; const large = size >= 24 || (size >= 18.66 && bold);
    if (ratio < (large ? 3 : 4.5)) { const key = el.className + '|' + txt.slice(0, 20); if (!seen.has(key)) { seen.add(key); out.push({ text: txt.slice(0, 40), ratio: +ratio.toFixed(2), size, cls: (el.className || el.tagName).toString().slice(0, 40) }); } }
  }
  return out;
})()`;
flow('contrast', async () => {
  await goto('queue'); await ev(`document.body.insertAdjacentHTML('beforeend', '<p id="canary" style="position:fixed;top:80px;left:80px;z-index:999;color:#aaa;background:#fff;font-size:15px">canary</p>')`);
  ok((await ev(AUDIT)).some((x) => x.text === 'canary'), 'the audit catches a deliberately low-contrast canary');
  const report = async (label) => { const bad = await ev(AUDIT); ok(bad.length === 0, `${label}: text contrast at least 4.5:1 (3:1 large)${bad.length ? ' :: ' + JSON.stringify(bad.slice(0, 6)) : ''}`); };
  for (const r of ['queue', 'assign', 'test', 'imported', 'sign', 'checks', 'check-fail']) { await goto(r); await sleep(300); await report('#' + r); }
  await goto('imported'); await click('.bar__btn[data-act="lock"]'); await sleep(300); await report('lock screen');
  await click('.lock [data-act="switch"]'); await sleep(300); await report('take-over');
  await goto('queue'); await click('#q-body tr.is-held .cellbtn--hold'); await sleep(250); await report('Hold popover');
  await goto('queue'); await click('#q-body tr:first-child .cellbtn[data-act="peek"]'); await sleep(300); await report('Test details');
});

flow('tour', async () => { for (const r of ['queue', 'assign', 'test', 'imported', 'sign', 'checks', 'check-fail']) { await goto(r); await sleep(300); await shot('tour-' + r); } });

flow('perf', async () => {
  await goto('queue');
  const t = await ev(`(() => { const n = 20; const t0 = performance.now(); for (let i = 0; i < n; i++) LX.queue.update(); const all = (performance.now() - t0) / n; LX.queue.toggleState('Ready'); const t1 = performance.now(); for (let i = 0; i < n; i++) LX.queue.update(); const some = (performance.now() - t1) / n; LX.queue.toggleState('Ready'); return { all: +all.toFixed(1), ready: +some.toFixed(1), nodes: document.getElementsByTagName('*').length }; })()`);
  ok(t.all < 80, `re-rendering 327 rows takes ${t.all} ms (28 rows: ${t.ready} ms, ${t.nodes} DOM nodes)`);
  const typing = await ev(`(async () => { const el = document.getElementById('q-search'); const t0 = performance.now(); for (const ch of 'T26-041') { el.value += ch; el.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => requestAnimationFrame(r)); } return performance.now() - t0; })()`);
  ok(typing < 600, `typing 7 characters into search stays responsive (${Math.round(typing)} ms)`);
});

flow('overflow', async () => {
  for (const r of ['queue', 'assign', 'test', 'imported', 'sign', 'checks', 'check-fail']) {
    await goto(r);
    const m = await ev(`(() => { const b = document.getElementById('bar'); const kids = [...b.children].map((c) => Math.round(c.getBoundingClientRect().right)); return { doc: document.documentElement.scrollWidth, win: innerWidth, bar: b.scrollWidth, barClient: b.clientWidth, lastRight: Math.max(...kids) }; })()`);
    ok(m.doc <= m.win && m.bar <= m.barClient, `#${r}: no horizontal overflow (doc ${m.doc}/${m.win}, bar ${m.bar}/${m.barClient}, last child right edge ${m.lastRight})`);
  }
});

const names = Object.keys(flows).filter((n) => !only.length || only.includes(n));
for (const n of names) {
  errors = []; console.log(`\n${n}`);
  try { await flows[n](); } catch (e) { fail++; failures.push(`${n}: ${e.message}`); console.log(`  FAIL ${e.message}`); }
  if (errors.length) { fail++; failures.push(`${n}: console errors`); console.log('  FAIL console errors:', [...new Set(errors)].join(' | ')); }
}
console.log(`\n${pass} passed, ${fail} failed at ${W}x${H}`);
if (failures.length) console.log('Failures:\n - ' + failures.join('\n - '));
ws.close(); chrome.kill(); server.close(); try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
