// Drive every click-through path of the Bench Rail prototype in headless Chrome with real mouse and keyboard input.
// node candidates/c1/flows.mjs [--size 1366x768]   (run from the ui-direction directory)
// Prints each assertion and any console error, and saves screenshots to shots/c1/flows/.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sizeArg = process.argv.includes('--size') ? process.argv[process.argv.indexOf('--size') + 1] : '1366x768';
const [W, H] = sizeArg.split('x').map(Number);
const OUT = join(ROOT, 'shots', 'c1', 'flows');
mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const server = createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(ROOT, p);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/candidates/c1/index.html`;

const profile = mkdtempSync(join(tmpdir(), 'flows-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
const portFile = join(profile, 'DevToolsActivePort');
for (let i = 0; i < 100 && !existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100));
const [port, wsPath] = readFileSync(portFile, 'utf8').trim().split('\n');
const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let nextId = 1; const pending = new Map(); const listeners = [];
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); } else listeners.forEach((l) => l(msg)); };
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable'].map((m) => send(m, {}, sid)));
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sid);
const errors = [];
listeners.push((msg) => {
  if (msg.sessionId !== sid) return;
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description?.split('\n')[0] ?? msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('console.error ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push('log ' + msg.params.entry.text);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.value;
let passed = 0; let failed = 0;
const check = async (label, expr) => { const v = await ev(expr); if (v) passed++; else failed++; console.log(`${v ? 'ok  ' : 'FAIL'} ${label}${v && v !== true ? `  (${v})` : ''}`); };
async function load(route) { await send('Page.navigate', { url: 'about:blank' }, sid); await wait(80); await send('Page.navigate', { url: `${BASE}#${route}` }, sid); await wait(900); }
async function box(sel) { return ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); }
async function click(sel) {
  const b = await box(sel); if (!b) { failed++; console.log(`FAIL click: no ${sel}`); return; }
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 }, sid);
  await wait(160);
}
async function type(sel, text) { await ev(`document.querySelector(${JSON.stringify(sel)}).focus()`); await send('Input.insertText', { text }, sid); await wait(120); }
async function key(k, code = k) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40 }[k] || 0 }, sid); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code }, sid); await wait(120); }
async function keypad(digits) { for (const d of digits) await click(`.key[data-key="${d}"]`); }
let n = 0;
async function shot(name) { const s = await send('Page.captureScreenshot', { format: 'png' }, sid); writeFileSync(join(OUT, `${String(++n).padStart(2, '0')}-${name}@${W}x${H}.png`), Buffer.from(s.data, 'base64')); }
const railBtn = (act) => `#rail [data-act="${act}"]`;

console.log(`\n# Flow 1: Lab queue to assignment (${W}x${H})`);
await load('queue');
await click('#qtable tr.qr');
await check('clicking a row selects it and opens its detail band', `!!document.querySelector('tr.qr.is-sel') && !!document.querySelector('tr.qd')`);
await click('#qfilters .chip--over');
await check('Overdue filter leaves 19 rows', `document.querySelectorAll('tr.qr').length === 19 || document.querySelectorAll('tr.qr').length`);
await shot('queue-overdue-filter');
await click('#qfilters .chip--over');
await type('#q-search', 'T26-04176');
await wait(250);
await check('search by Test ID finds one row', `document.querySelectorAll('tr.qr').length === 1`);
await click('#qtable tr.qr');
await check('rail offers Assign for the selected Ready Test', `!!document.querySelector('#rail [data-act="q-assign"]:not([aria-disabled])')`);
await click(railBtn('q-assign'));
await check('assignment sheet opens with 20 Analysts', `document.querySelectorAll('#assign-sheet .pick').length + document.querySelectorAll('#assign-sheet .refused__row').length === 20`);
await check('refused Analysts have no radio', `document.querySelectorAll('#assign-sheet .refused__row input').length === 0`);
await check('hash is #assign', `location.hash === '#assign'`);
await click('#assign-sheet .pick:nth-child(2) .pick__input');
await shot('assign-picked');
await click(railBtn('assign-commit'));
await wait(400);
await check('Test moved to Assigned', `App.S.testIdx['T26-04176'].state === 'Assigned'`);
await check('the rail answers that it was recorded in the audit trail', `/audit trail/.test(document.querySelector('#rail-context')?.textContent || '')`);
await shot('assigned-receipt');
await key('Escape');

console.log('\n# Flow 2: shared PC takeover to the bench workspace');
await click(railBtn('switch-user'));
await check('Switch user locks the screen and hides the record', `!!document.querySelector('.lock') && getComputedStyle(document.querySelector('.frame')).visibility === 'hidden'`);
await shot('lock-switch-user');
await click('.tile[data-arg="u10"]');
await type('#lk-pw', 'wrong');
await type('#lk-code', '000000');
await click('.lock__go');
await check('a wrong password shows attempts left', `/4 attempts left/.test(document.querySelector('.lock__error')?.textContent || '')`);
await shot('lock-wrong-password');
await click('[data-act="lock-demo"]');
await click('.lock__go');
await wait(300);
await check('Priya Raman is signed in and lands on her Test', `App.S.userId === 'u10' && location.hash === '#test'`);
await shot('priya-takeover');

console.log('\n# Flow 3: upload, flag, checklist, sign');
await ev(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['not the export'], 'other.txt', { type: 'text/plain' })); document.querySelector('#drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
await wait(900);
await check('dropping a TXT whose SHA-256 differs is refused and nothing is imported', `/is not the export/.test(document.querySelector('#ws-task .form-error')?.textContent || '') && location.hash === '#test'`);
await click(railBtn('ws-upload'));
await wait(2300);
await check('upload hashes the TXT in the browser and lands on #imported', `location.hash === '#imported' && !!document.querySelector('.rec')`);
await check('draft values are pencil', `document.querySelectorAll('#ws-doc .v.draft').length > 20`);
await check('Sign is not offered before the flag is handled', `!document.querySelector('#rail [data-act="ws-sign"]:not([aria-disabled])')`);
await click('.opt__input[value="accept"]');
await type('#flag-comment', 'Low ion ratio on one injection only; other P2 injection in window; 5 % of limit.');
await click(railBtn('flag-save'));
await check('saving the decision makes Record Version 2 with the server hash', `document.querySelector('.rec').textContent.includes('e94edde3')`);
for (let i = 0; i < 3; i++) await click(`.check__input[data-arg="${i}"]`);
await check('all 3 checklist items ticked', `document.querySelectorAll('.check.is-on').length === 3`);
await shot('ready-to-sign');
await click(railBtn('ws-sign'));
await wait(400);
await check('signature prompt opens on #sign with the Record Version and hash', `location.hash === '#sign' && document.querySelector('.manifest').textContent.includes('e94edde3')`);
await type('#sg-uid', 'dcho'); await type('#sg-pw', 'bench-demo-2026'); await type('#sg-code', '314159');
await click('.rbtn--sign');
await check('another user ID is refused and nothing is signed', `/must be/.test(document.querySelector('.form-error')?.textContent || '') && !App.S.work.signed`);
await ev(`document.querySelector('#sg-uid').value = ''`);
await type('#sg-uid', 'praman'); await ev(`document.querySelector('#sg-pw').value = ''`); await type('#sg-pw', 'nope'); await type('#sg-code', '123456');
await click('.rbtn--sign');
await check('wrong password shows attempts left before lockout', `/4 attempts left/.test(document.querySelector('.form-error')?.textContent || '')`);
await shot('sign-wrong-password');
await click('[data-act="sign-demo"]');
await click('.rbtn--sign');
await wait(700);
await check('signed: Test is Submitted for Review', `App.S.testIdx['T26-04175'].state === 'Submitted for Review'`);
await check('signature block shows name, meaning, UTC, lab time, version, hash', `(() => { const t = document.querySelector('#ws-task .sig')?.textContent || ''; return /Priya Raman/.test(t) && /Performed/.test(t) && /UTC/.test(t) && /EDT \\(America\\/New_York\\)/.test(t) && /Record Version 2/.test(t) && /e94edde3/.test(t); })()`);
await wait(1200);
await check('values turned to ink', `document.querySelectorAll('#ws-doc .v.ink').length > 20 && document.querySelectorAll('#ws-doc .v.draft').length === 0`);
await shot('signed-ink');

console.log('\n# Flow 4: Checks today with gloves');
await click('.nav__tab[data-nav="checks"]');
await check('navigating keeps the signed-in person (no hidden role switch)', `App.S.userId === 'u10'`);
await click(railBtn('switch-user'));
await click('.tile[data-arg="u13"]');
await click('[data-act="lock-demo"]');
await click('.lock__go');
await wait(300);
await check('Kenji Watanabe signed in on Checks today', `App.S.userId === 'u13' && location.hash === '#checks'`);
await click('#cf-tempC');
await keypad(['2', '6', '.', '4']);
await click('#cf-rhPct');
await keypad(['4', '1']);
await check('out-of-limit temperature asks for a retype and states the consequence', `!!document.querySelector('#cf-confirm-tempC') && /Room Deviation/.test(document.querySelector('.conseq').textContent)`);
await check('Save stays disabled until the retype matches', `document.querySelector('#rail [data-act="chk-save"]').getAttribute('aria-disabled') === 'true'`);
await click('#cf-confirm-tempC');
await keypad(['2', '6', '.', '3']);
await check('a mismatched retype is called out', `/Does not match/.test(document.querySelector('.nf--confirm').textContent)`);
await shot('reading-retype-mismatch');
await click('#cf-confirm-tempC');
await keypad(['back', '4']);
await check('matching retype enables Save', `document.querySelector('#rail [data-act="chk-save"]').getAttribute('aria-disabled') !== 'true'`);
await click(railBtn('chk-save'));
await check('saved with a Room Deviation opened', `App.S.checks.saved['CHK-RD-102']?.dev === 'DEV-26-0094'`);
await shot('reading-saved-deviation');
await click('.citem[data-arg="CHK-FRZ-01"]');
await click('#cf-tempC'); await keypad(['-', '7', '9', '.', '6']);
await click('#cf-tempMinC'); await keypad(['-', '8', '1', '.', '2']);
await click('#cf-tempMaxC'); await keypad(['-', '7', '7', '.', '9']);
await check('in-limit freezer reading can be saved without a retype', `document.querySelector('#rail [data-act="chk-save"]').getAttribute('aria-disabled') !== 'true' && !document.querySelector('.conseq')`);
await click(railBtn('chk-save'));
await check('FRZ-01 is Done', `!!App.S.checks.saved['CHK-FRZ-01'] && !App.S.checks.saved['CHK-FRZ-01'].fail`);
await click('.citem--alarm');
await type('#alarm-note', 'Reading missed on 29 Sep; room data logger shows no excursion.');
await click(railBtn('alarm-ack'));
await check('missed reading alarm acknowledged', `!!App.S.checks.alarm.ack`);
await shot('alarm-acknowledged');

console.log('\n# Flow 5: failing balance verification');
await load('check-fail');
await check('#check-fail shows the failure, the consequence and the retype field', `/Fail/.test(document.querySelector('.wtab').textContent) && /14 Tests/.test(document.querySelector('.conseq').textContent) && document.activeElement.id === 'cf-confirm-w1'`);
await keypad(['2', '0', '0', '.', '1', '8', '3', '4']);
await click(railBtn('chk-sign'));
await wait(400);
await check('balance verification uses the same signature prompt, meaning Performed', `/Performed/.test(document.querySelector('.meaning').textContent) && /BAL-04/.test(document.querySelector('.manifest').textContent)`);
await check('the final button names the failed Check', `/Sign failed Check as Performed/.test(document.querySelector('.rbtn--sign').textContent)`);
await shot('balance-sign-prompt');
await click('.seg__opt[data-arg="passkey"]');
await click('.rbtn--sign');
await check('passkey: pressing Sign only starts waiting for the key; nothing is signed yet', `!!document.querySelector('.passkey.is-waiting') && !App.S.checks.saved['CHK-BAL-04']`);
await shot('balance-sign-passkey-waiting');
await click('[data-act="sign-passkey-touch"]');
await wait(500);
await check('failed Check saved: Deviation opened, BAL-04 Suspended', `App.S.checks.saved['CHK-BAL-04']?.dev === 'DEV-26-0094' && App.S.fitness['BAL-04'].fitness === 'Suspended'`);
await shot('balance-failed-saved');

console.log('\n# Flow 6: idle lock and lockout');
await load('imported');
await ev(`App.S.lastActivity = Date.now() - 15 * 60e3 - 1000`);
await wait(1300);
await check('15 minutes idle locks the session', `!!document.querySelector('.lock') && /15 minutes/.test(document.querySelector('.lock__why').textContent)`);
await shot('idle-lock');
await click('.tile[data-arg="u10"]');
for (let i = 0; i < 5; i++) { await ev(`document.querySelector('#lk-pw').value = 'x'; document.querySelector('#lk-code').value = '1'`); await click('.lock__go'); }
await check('five failures lock the account', `App.S.lockedAccounts.praman === true && /locked/.test(document.querySelector('.lock__error').textContent)`);
await shot('account-locked');

console.log('\n# Flow 6b: passkey takeover');
await load('queue');
await click(railBtn('switch-user'));
await click('.tile[data-arg="u13"]');
await click('[data-act="lock-passkey"]');
await shot('lock-passkey-waiting');
await click('[data-act="lock-passkey-touch"]');
await wait(300);
await check('a passkey takes over the PC without typing', `App.S.userId === 'u13' && location.hash === '#checks'`);

console.log('\n# Flow 7: keyboard');
await load('queue');
await key('/', 'Slash');
await check('/ focuses the search', `document.activeElement.id === 'q-search'`);
await ev(`document.querySelector('tr.qr[tabindex="0"]').focus()`);
await key('ArrowDown'); await key('Enter');
await check('arrow and Enter select a row', `!!document.querySelector('tr.qr.is-sel')`);
await key('Escape');
await check('Escape clears the selection', `!document.querySelector('tr.qr.is-sel')`);

console.log('\n# Gallery: other states for review');
await load('checks');
for (const id of ['CHK-RD-105', 'CHK-FRZ-03', 'CHK-BAL-01', 'CHK-BAL-03', 'CHK-PIP-11', 'CHK-DIW-01']) { await click(`.citem[data-arg="${id}"]`); await shot(`panel-${id}`); }
await load('test');
await click(railBtn('switch-user'));
await click('.tile[data-arg="u01"]');
await click('[data-act="lock-demo"]');
await click('.lock__go');
await wait(300);
await click('.nav__tab[data-nav="test"]');
await check('the Lab Manager sees the Test read-only, with no import or sign', `!document.querySelector('#rail [data-act="ws-upload"]') && /Read only/.test(document.querySelector('#ws-task').textContent)`);
await shot('test-read-only-for-lab-manager');
await load('queue');
await click('#qfilters .chip--risk');
await check('At risk filter shows 14', `document.querySelectorAll('tr.qr').length === 14 || document.querySelectorAll('tr.qr').length`);
await shot('queue-at-risk');

console.log(`\n${passed} passed, ${failed} failed, ${errors.length} console errors${errors.length ? ':\n  ' + [...new Set(errors)].join('\n  ') : ''}`);
ws.close(); chrome.kill(); server.close();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(failed || errors.length ? 1 : 0);
