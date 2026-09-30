// Drive every click-through path of Bench Rail (merged) in headless Chrome with real mouse, keyboard and keypad input.
// node candidates/chosen/flows.mjs [--size 1366x768]   (run from the ui-direction directory)
// Every expected value (hashes, limits, counts, IDs, credentials) is read from data.js at run time; nothing is hard-coded
// except the name of this shared PC, which is configuration of the prototype, not data.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sizeArg = process.argv.includes('--size') ? process.argv[process.argv.indexOf('--size') + 1] : '1366x768';
const [W, H] = sizeArg.split('x').map(Number);
const OUT = join(ROOT, 'shots', 'chosen', 'flows');
mkdirSync(OUT, { recursive: true });

/* ---------- expectations from data.js ---------- */
const D = (() => { const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(readFileSync(join(ROOT, 'data.js'), 'utf8'), ctx); return ctx.window.LIMS; })();
const F = D.focus.test; const CF = D.focus.checkFail; const P = D.personas;
const person = (id) => D.people.find((p) => p.id === id);
const credOf = (id) => D.demoCredentials.users[person(id).username];
const OPEN = ['Requested', 'Accepted', 'Ready', 'Assigned', 'In Progress', 'Submitted for Review', 'Reviewed'];
const PRE = OPEN.slice(0, 5);
const open = D.tests.filter((t) => OPEN.includes(t.state));
const isBD = (day) => { const wd = new Date(day + 'T12:00:00Z').getUTCDay(); return wd !== 0 && wd !== 6; };
const addBD = (day, n) => { let d = new Date(day + 'T12:00:00Z'); let left = n; while (left > 0) { d = new Date(d.getTime() + 864e5); if (isBD(d.toISOString().slice(0, 10))) left--; } return d.toISOString().slice(0, 10); };
const EXP = {
  overdue: open.filter((t) => t.dueDate && t.dueDate < D.meta.labDay).length,
  risk: open.filter((t) => t.dueDate && t.dueDate >= D.meta.labDay && t.dueDate <= addBD(D.meta.labDay, 2) && PRE.includes(t.state)).length,
  analysts: D.people.filter((p) => p.roles.includes('Analyst')).length,
  lockout: D.demoCredentials.lockoutAfterFailures,
  flagAnalyte: F.results.find((r) => r.flags.length).analyte,
  checklist: F.performedChecklist.length,
  heldOpen: open.filter((t) => t.holds.length).length,
  newlyHeld: CF.consequence.testIds.filter((id) => !D.tests.find((t) => t.id === id).holds.length).length,
  nextDev: (() => { const pre = D.deviations[0].id.replace(/\d+$/, ''); let n = 1 + Math.max(...D.deviations.map((d) => Number(d.id.match(/(\d+)$/)[1]))); let id; do { id = `${pre}${String(n++).padStart(4, '0')}`; } while (id === CF.consequence.deviationId); return id; })(),
};
const rd102 = D.checksToday.find((c) => c.target === 'RD-102' && c.type === 'Reading');
const rd104 = D.checksToday.find((c) => c.target === 'RD-104' && c.type === 'Reading');
const frz01 = D.checksToday.find((c) => c.target === 'FRZ-01');
const outOfLimit = (rd102.limits.tempC[1] + 1.4).toFixed(1);
const inRd102 = ((rd102.limits.tempC[0] + rd102.limits.tempC[1]) / 2).toFixed(1);
const midRh = String(Math.round((rd102.limits.rhPct[0] + rd102.limits.rhPct[1]) / 2));
const inTemp = ((rd104.limits.tempC[0] + rd104.limits.tempC[1]) / 2).toFixed(1);
const frzBad = { now: frz01.limits.tempC[1] + 5, min: frz01.limits.tempC[1] + 4, max: frz01.limits.tempC[1] + 6 }; // warmer than the upper limit
const balGram = (mg) => (mg / 1000).toFixed(4); // BAL-04 shows grams to 4 decimals
const PC = 'Bench PC RD-102-02';
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const heldSample = open.find((t) => t.holds.length && t.deviationIds.length);
const heldDev = D.deviations.find((d) => d.id === heldSample.deviationIds[0]);
const typedNum = (x) => (x < 0 ? ['-', ...String(Math.abs(x)).split('')] : String(x).split(''));

/* ---------- a tiny static server and Chrome over CDP ---------- */
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
const BASE = `http://127.0.0.1:${server.address().port}/candidates/chosen/index.html`;
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
const J = (v) => JSON.stringify(v);
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.value;
let passed = 0; let failed = 0;
const check = async (label, expr) => { const v = await ev(expr); if (v === true) passed++; else failed++; console.log(`${v === true ? 'ok  ' : 'FAIL'} ${label}${v === true ? '' : `  (got ${J(v)})`}`); };
const same = (label, got, want) => { const ok = J(got) === J(want); ok ? passed++ : failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (got ${J(got)}, want ${J(want)})`}`); };
async function load(route) { await send('Page.navigate', { url: 'about:blank' }, sid); await wait(80); await send('Page.navigate', { url: `${BASE}#${route}` }, sid); await wait(900); }
async function setHash(route) { await ev(`location.hash = ${J('#' + route)}`); await wait(350); }
async function box(sel) { return ev(`(() => { const el = document.querySelector(${J(sel)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); }
async function click(sel) {
  const b = await box(sel); if (!b) { failed++; console.log(`FAIL click: no ${sel}`); return; }
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 }, sid);
  await wait(160);
}
async function type(sel, text) { await ev(`document.querySelector(${J(sel)}).focus()`); await send('Input.insertText', { text }, sid); await wait(120); }
async function clear(sel) { await ev(`(() => { const el = document.querySelector(${J(sel)}); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); })()`); await wait(80); }
async function key(k, code = k) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40 }[k] || 0 }, sid); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code }, sid); await wait(120); }
async function keypad(scope, chars) { for (const d of chars) await click(`${scope} .key[data-key="${d}"]`); }
let n = 0;
async function shot(name) { const s = await send('Page.captureScreenshot', { format: 'png' }, sid); writeFileSync(join(OUT, `${String(++n).padStart(2, '0')}-${name}@${W}x${H}.png`), Buffer.from(s.data, 'base64')); }
const railBtn = (act) => `#rail [data-act="${act}"]`;
async function takeover(userId) { await click(railBtn('switch-user')); await click(`.tile[data-arg="${userId}"]`); await click('[data-act="lock-demo"]'); await click('.lock__go'); await wait(350); }
async function signTyped(userId) { await type('#sg-uid', person(userId).username); await click('[data-act="sign-demo"]'); await click('.rbtn--sign'); await wait(600); }

console.log(`\n# Merge 1: the workstation name (${W}x${H})`);
await load('queue');
await check(`top bar names the shared PC (${PC})`, `document.querySelector('.station').textContent.includes(${J(PC)})`);
await takeover(P.test);
await check('the PC name does not change on Switch user', `App.S.userId === ${J(P.test)} && document.querySelector('.station').textContent.includes(${J(PC)})`);

console.log('\n# Merge 3: Hold and Deviation kinds in queue rows');
await load('queue');
await type('#q-search', heldSample.id); await wait(250);
await check(`under the Hold chip: the Hold kinds of ${heldSample.id}`, `document.querySelector('tr.qr td:nth-child(7) .kindline').textContent === ${J(heldSample.holds.map((h) => h.kind).join(', '))}`);
await check(`under the Deviation chip: ${heldDev.id}'s Kind and Risk Level`, `(() => { const t = document.querySelector('tr.qr td:nth-child(8) .kindline').textContent; return t.includes(${J(heldDev.kind)}) && t.includes(${J(heldDev.risk)}); })()`);
await clear('#q-search'); await wait(250);
await check(`Overdue filter gives ${EXP.overdue} rows and At risk gives ${EXP.risk}`, `(() => { const chip = (c) => document.querySelector('#qfilters ' + c); chip('.chip--over').click(); const a = document.querySelectorAll('tr.qr').length; chip('.chip--over').click(); chip('.chip--risk').click(); const b = document.querySelectorAll('tr.qr').length; chip('.chip--risk').click(); return a === ${EXP.overdue} && b === ${EXP.risk}; })()`);
await shot('queue-kinds');

console.log('\n# Flow 1: Lab queue to assignment');
await type('#q-search', D.focus.assignTestId); await wait(250);
await click('#qtable tr.qr');
await click(railBtn('q-assign'));
await check(`assignment shows all ${EXP.analysts} Analysts`, `document.querySelectorAll('#assign-sheet .pick').length + document.querySelectorAll('#assign-sheet .refused__row').length === ${EXP.analysts}`);
await click('#assign-sheet .pick:nth-child(2) .pick__input');
await click(railBtn('assign-commit')); await wait(400);
await check('Test moved to Assigned and the rail says it was recorded in the audit trail', `App.S.testIdx[${J(D.focus.assignTestId)}].state === 'Assigned' && /audit trail/.test(document.querySelector('#rail-context').textContent)`);
await wait(9500);
await check('after the receipt fades, the selected row still names who assigned it and the audit trail', `/Assigned by .* Recorded in the audit trail/.test(document.querySelector('#rail-context').textContent)`);

console.log('\n# Merge 2 and fix 5: the step bar, one count, and the hash of what is signed');
await load('test');
await check('before the Import the bar marks Import current and Check drafts next', `(() => { const s = [...document.querySelectorAll('.stepbar__step')]; return s.length === 6 && s[2].classList.contains('is-now') && s[3].classList.contains('is-next'); })()`);
await click(railBtn('ws-upload')); await wait(2300);
const leftTxt = `${1 + EXP.checklist} left`;
await check(`after the Import, Check drafts is current with "${leftTxt}" in the bar, the task panel and the rail`, `(() => { const cur = document.querySelector('.stepbar__step.is-now'); const task = document.querySelector('#ws-task .step.is-now .step__sub'); const rail = document.querySelector('#rail-context').textContent; return cur.textContent.includes('Check drafts') && cur.textContent.includes(${J(leftTxt)}) && task.textContent.includes(${J(leftTxt)}) && (rail.includes('Imported as drafts') || (rail.includes('Check drafts') && rail.includes(${J(leftTxt)}))) && rail.includes(${J(leftTxt)}); })()`);
const COMMENT = `Reviewed ${EXP.flagAnalyte}: one Injection outside the window; value stands (typed in the flows run).`;
await click('.opt__input[value="accept"]');
await type('#flag-comment', COMMENT);
await click(railBtn('flag-save'));
await wait(7200); // let the receipt give the rail back to the step text
const leftAfter = `${EXP.checklist} left`;
await check(`after the flag decision the bar, the panel and the rail all say "${leftAfter}"`, `(() => { const t = ${J(leftAfter)}; return document.querySelector('.stepbar__step.is-now').textContent.includes(t) && document.querySelector('#ws-task .step.is-now .step__sub').textContent.includes(t) && document.querySelector('#rail-context').textContent.includes('Check drafts') && document.querySelector('#rail-context').textContent.includes(t); })()`);
await click(railBtn('ws-sign'));
await check('pressing a disabled Sign answers "Not yet" in the rail', `/Not yet/.test(document.querySelector('#rail-context').textContent)`);
for (let i = 0; i < EXP.checklist; i++) await click(`.check__input[data-arg="${i}"]`);
await check('with the checklist done, Sign Performed is the current step and the rail offers it', `document.querySelector('.stepbar__step.is-now').textContent.includes('Sign Performed') && !!document.querySelector('#rail [data-act="ws-sign"]:not([aria-disabled])')`);
await check('the stale "Not yet" answer is gone once Sign is enabled', `!/Not yet/.test(document.querySelector('#rail-context').textContent)`);
await click(railBtn('ws-sign')); await wait(400);

console.log('\n# Merge 4: the keypad beside the sign-in fields');
await check('the signature prompt has a keypad beside the three fields', `!!document.querySelector('#sign-sheet .keypad') && !!document.querySelector('#sg-uid') && !!document.querySelector('#sg-pw') && !!document.querySelector('#sg-code')`);
await check('the user ID starts empty; the demo button fills only password and code', `document.querySelector('#sg-uid').value === '' && /password and code/.test(document.querySelector('[data-act="sign-demo"]').textContent)`);
await click('#sg-code');
await keypad('#sign-sheet', credOf(P.test).totp.split(''));
await check('keypad digits go into the focused code field', `document.querySelector('#sg-code').value === ${J(credOf(P.test).totp)}`);
await click('#sg-uid'); await keypad('#sign-sheet', ['7']);
await check('the same keypad types into the user ID when it has focus', `document.querySelector('#sg-uid').value === '7'`);
await keypad('#sign-sheet', ['back']);
await type('#sg-uid', person(P.test).username);
const pw = credOf(P.test).password; const pwLetters = pw.replace(/\d+$/, ''); const pwDigits = pw.slice(pwLetters.length);
await type('#sg-pw', pwLetters); await click('#sg-pw'); await keypad('#sign-sheet', pwDigits.split(''));
await check('the password takes its letters from the keyboard and its digits from the keypad', `document.querySelector('#sg-pw').value === ${J(pw)}`);
await shot('sign-keypad');
await click('.rbtn--sign'); await wait(900);
const signedHash = await ev(`document.querySelector('#ws-task .sig').textContent.match(/SHA-256\\s*([0-9a-f]{8})/)[1]`);
const lastVersion = await ev(`App.debug.versions().slice(-1)[0]`);
same('the signed hash is the SHA-256 of the saved version, recomputed here', sha(canon(lastVersion.content)).slice(0, 8), signedHash);
same('the signed content holds the typed comment', lastVersion.content.flagDecision.comment, COMMENT);
same('the signed content holds the Performed checklist', lastVersion.content.performedChecklist.map((x) => x.confirmed), F.performedChecklist.map(() => true));
same('the signed version is Record Version 2', lastVersion.v, 2);
await check("the signature records the signer's own role", `/Role\\s*Analyst/.test(document.querySelector('#ws-task .sig').textContent) && ${J(person(P.test).roles)}.includes('Analyst')`);
await wait(1300);
await check('after signing, Sign Performed is done and Review is current', `(() => { const s = [...document.querySelectorAll('.stepbar__step')]; return s[4].classList.contains('is-done') && s[5].classList.contains('is-now'); })()`);
await shot('signed-steps');

console.log('\n# Check 2: signed stays signed through hash edits, Back and Forward');
for (const r of ['test', 'imported', 'sign']) await setHash(r);
await ev('history.back()'); await wait(350); await ev('history.back()'); await wait(350); await ev('history.forward()'); await wait(350);
await check('still signed, still Submitted for Review, and no Import on offer', `!!App.S.work.signed && App.S.testIdx[${J(F.testId)}].state === 'Submitted for Review' && !document.querySelector('#rail [data-act="ws-upload"]') && document.querySelectorAll('#ws-doc .v.draft').length === 0`);

console.log('\n# Check 1: later hash navigation never creates state');
await load('test');
await setHash('sign');
await check('#sign typed later on an un-imported Test opens no prompt and explains the gate', `!document.querySelector('#sign-sheet') && location.hash === '#test' && !App.S.work.imported && !App.S.work.flag.decided && /Sign Performed is not open/.test(document.querySelector('#rail-context').textContent)`);
await setHash('imported');
await check('#imported typed later imports nothing', `!App.S.work.imported && location.hash === '#test'`);

console.log('\n# Fix 3: the person only changes through Switch user');
await load('queue');
await setHash('checks');
await check("a hash edit onto another person's screen locks and asks for credentials; the person has not changed", `!!document.querySelector('.lock') && App.S.userId === ${J(P.queue)} && document.querySelector('.tile[aria-checked="true"]').dataset.arg === ${J(P.checks)}`);
await shot('hash-edit-locks');
await click('[data-act="lock-demo"]'); await click('.lock__go'); await wait(350);
await check("after that person signs in, the link's screen opens", `App.S.userId === ${J(P.checks)} && location.hash === '#checks'`);
await load('queue');
await setHash('test');
await click(`.tile[data-arg="${P.queue}"]`); await click('[data-act="lock-demo"]'); await click('.lock__go'); await wait(350);
await ev('history.back()'); await wait(400);
await check('Back and Forward never swap the person', `App.S.userId === ${J(P.queue)}`);

console.log('\n# Check 3: a lock and a lockout survive hash edits');
await load('imported');
await click(railBtn('lock'));
await setHash('queue'); await setHash('checks');
await check('the lock screen stays through hash edits', `!!document.querySelector('.lock') && App.S.userId === ${J(P.test)}`);
await load('sign');
for (let i = 0; i < EXP.lockout; i++) { if (!(await ev(`!!document.querySelector('#sg-uid')`))) break; await clear('#sg-uid'); await type('#sg-uid', person(P.test).username); await ev(`document.querySelector('#sg-pw').value = 'wrong'; document.querySelector('#sg-code').value = '000000'`); await click('.rbtn--sign'); }
await check(`the ${EXP.lockout}th failure locks the account and the PC`, `App.S.lockedAccounts[${J(person(P.test).username)}] === true && !!document.querySelector('.lock')`);
await shot('lockout');
await setHash('queue'); await setHash('imported'); await ev('history.back()'); await wait(350);
await check('the lockout survives hash edits and Back', `!!document.querySelector('.lock') && App.S.lockedAccounts[${J(person(P.test).username)}] === true`);
await click(`.tile[data-arg="${P.test}"]`);
await ev(`document.querySelector('#lk-pw').value = ${J(credOf(P.test).password)}; document.querySelector('#lk-code').value = ${J(credOf(P.test).totp)}`);
await click('.lock__go');
await check('the locked account cannot sign in again, even with the right password', `!!document.querySelector('.lock') && App.S.userId === ${J(P.test)} && App.S.lockedAccounts[${J(person(P.test).username)}] === true`);

console.log('\n# Fix 1: a draft never changes owner');
await load('checks');
await takeover(P.test);
await click('.nav__tab[data-nav="checks"]');
await click(`.citem[data-arg="${rd102.id}"]`);
await click('#cf-tempC'); await keypad('#chk-panel', outOfLimit.split(''));
await click(`.citem[data-arg="${rd104.id}"]`);
await click('#cf-tempC'); await keypad('#chk-panel', inTemp.split(''));
await takeover(P.checks);
await check("the receipt says the previous person's typing stays theirs", `/Kept as .*drafts, not yours/.test(document.querySelector('#rail-context').textContent)`);
await click(`.citem[data-arg="${rd102.id}"]`);
await check('the next person sees an empty field and a note that the draft stays with its author', `document.querySelector('#cf-tempC').value === '' && /left an unsaved draft/.test(document.querySelector('#chk-panel').textContent)`);
await shot('draft-stays-with-author');
await click('#cf-tempC'); await keypad('#chk-panel', inRd102.split(''));
await click('#cf-rhPct'); await keypad('#chk-panel', midRh.split(''));
await click(railBtn('chk-save'));
await check("the saved reading carries the saver's own values and name", `(() => { const s = App.S.checks.saved[${J(rd102.id)}]; return !!s && s.by === ${J(P.checks)} && s.fields[0].text.startsWith(${J(inRd102)}); })()`);
await takeover(P.test);
await check('the receipt tells the author their draft is back', `/Back as you left it/.test(document.querySelector('#rail-context').textContent)`);
await click('.nav__tab[data-nav="checks"]');
await click(`.citem[data-arg="${rd104.id}"]`);
await check('the author gets their own draft back', `document.querySelector('#cf-tempC').value === ${J(inTemp)}`);

console.log('\n# Fix 2: Performed on a Check needs the Check Plan training, and the role is real');
await load('queue');
await click('.nav__tab[data-nav="checks"]');
const balOther = D.checksToday.find((c) => c.type === 'Verification' && c.weights && c.status === 'Due' && c.id !== CF.checkId);
await click(`.citem[data-arg="${balOther.id}"]`);
await check(`the Lab Manager sees ${balOther.target} read only, with the reason, and no Sign or input`, `/Read only for you/.test(document.querySelector('#chk-panel').textContent) && /Training Record/.test(document.querySelector('#chk-panel').textContent) && !document.querySelector('#chk-panel .nf__input') && !document.querySelector('#rail [data-act="chk-sign"]')`);
await shot('checks-read-only-for-lab-manager');

console.log('\n# Fix 4: the failed BAL-04 Check opens its Deviation and places its Holds');
await load('check-fail');
await check('the failure, its consequence and the retype field are shown', `/Fail/.test(document.querySelector('.wtab').textContent) && document.querySelector('.conseq').textContent.includes(${J(`${CF.consequence.testIds.length} Tests`)}) && document.activeElement.id === 'cf-confirm-w1'`);
await keypad('#chk-panel', balGram(CF.typed.readingsMg[1]).split(''));
await click(railBtn('chk-sign')); await wait(400);
await check('the final button names the failed Check', `/Sign failed Check as Performed/.test(document.querySelector('.rbtn--sign').textContent)`);
await signTyped(P.checks);
await check(`${CF.consequence.deviationId} is opened and ${CF.consequence.suspends} is Suspended`, `App.S.checks.saved[${J(CF.checkId)}].dev === ${J(CF.consequence.deviationId)} && App.S.fitness[${J(CF.consequence.suspends)}].fitness === 'Suspended'`);
await check(`exactly the ${CF.consequence.testIds.length} listed Tests carry its Hold`, `(() => { const ids = ${J(CF.consequence.testIds)}; const held = App.S.tests.filter((t) => t.holds.some((h) => h.deviationId === ${J(CF.consequence.deviationId)})).map((t) => t.id).sort(); return JSON.stringify(held) === JSON.stringify([...ids].sort()); })()`);
await check("the signature block records Analyst, the signer's own role", `/Role\\s*Analyst/.test(document.querySelector('#chk-panel .sig').textContent)`);
await click('.nav__tab[data-nav="queue"]');
await check(`the queue's Holds filter now counts ${EXP.heldOpen + EXP.newlyHeld} open Tests with Holds`, `[...document.querySelectorAll('[data-fk="q-holds"] option')].some((o) => o.textContent.includes('With open Holds (${EXP.heldOpen + EXP.newlyHeld})'))`);
await check(`the Deviation filter lists ${CF.consequence.deviationId}`, `[...document.querySelectorAll('[data-fk="q-dev"] option')].some((o) => o.value === ${J(CF.consequence.deviationId)})`);
await ev(`(() => { const s = document.querySelector('[data-fk="q-dev"]'); s.value = ${J(CF.consequence.deviationId)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`); await wait(300);
await check(`filtering by ${CF.consequence.deviationId} lists exactly those ${CF.consequence.testIds.length} Tests`, `document.querySelectorAll('tr.qr').length === ${CF.consequence.testIds.length}`);
await shot('queue-after-bal04');
await load('checks');
await click(`.citem[data-arg="${frz01.id}"]`);
for (const [f, v] of [['tempC', frzBad.now], ['tempMinC', frzBad.min], ['tempMaxC', frzBad.max]]) { await click(`#cf-${f}`); await keypad('#chk-panel', typedNum(v)); }
for (const [f, v] of [['tempC', frzBad.now], ['tempMinC', frzBad.min], ['tempMaxC', frzBad.max]]) { await click(`#cf-confirm-${f}`); await keypad('#chk-panel', typedNum(v)); }
await click(railBtn('chk-save'));
same('another failing Check never takes the ID reserved for BAL-04', await ev(`App.S.checks.saved[${J(frz01.id)}] ? App.S.checks.saved[${J(frz01.id)}].dev : null`), EXP.nextDev);

console.log('\n# Fix 6: accessibility and wording');
await load('imported');
await check('the Test record region is keyboard-focusable', `document.querySelector('#ws-doc').tabIndex === 0`);
await check('no aria-label sits on a plain span or div', `document.querySelectorAll('span[aria-label]:not([role]), div[aria-label]:not([role])').length === 0`);
await check('glossary words: Import, Preparation and Injection columns, Run Checks', `/Import/.test(document.querySelector('#imp-h').textContent) && [...document.querySelectorAll('.inj thead th')].map((th) => th.textContent).join('|').includes('Preparation|Injection') && document.querySelector('#rc-h').textContent === 'Run Checks'`);
await ev('document.activeElement && document.activeElement.blur(); document.body.focus()');
await key('Tab');
await check('the first Tab reaches a skip link', `document.activeElement.classList.contains('skip')`);
await load('queue');
await ev(`document.querySelector('.skip').click()`); await wait(150);
await check('the skip link lands on the current queue row, not 45 Tabs away', `document.activeElement.matches('tr.qr')`);
await load('imported');
await click('.opt__input[value="accept"]'); await type('#flag-comment', 'A comment long enough to save it.'); await click(railBtn('flag-save'));
for (let i = 0; i < EXP.checklist; i++) await click(`.check__input[data-arg="${i}"]`);
await click(railBtn('ws-sign')); await wait(400); await key('Escape'); await wait(300);
await check('Escape closes the prompt and focus returns to the button that opened it', `!document.querySelector('#sign-sheet') && document.activeElement.dataset.fk === 'ws-sign'`);
await load('checks');
const bal2 = D.checksToday.find((c) => c.type === 'Verification' && c.weights && c.status === 'Due' && c.id !== CF.checkId);
await click(`.citem[data-arg="${bal2.id}"]`);
await click('#cf-w0'); await keypad('#chk-panel', (String(bal2.weights[0].certifiedMg / 1000) + '0002').split(''));
await check(`${bal2.target} readings stop at the balance's own decimals`, `(() => { const v = document.querySelector('#cf-w0').value; const dp = Number(document.querySelector('#cf-w0').dataset.dp); return (v.split('.')[1] || '').length <= dp; })()`);

console.log(`\n${passed} passed, ${failed} failed, ${errors.length} console errors${errors.length ? ':\n  ' + [...new Set(errors)].join('\n  ') : ''}`);
ws.close(); chrome.kill(); server.close();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(failed || errors.length ? 1 : 0);
