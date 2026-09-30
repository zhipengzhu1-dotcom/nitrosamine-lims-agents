// Screenshot every deep link of one prototype in headless Chrome and report console errors.
// node shoot.mjs candidates/c1 [--routes queue,assign] [--sizes 1920x1080,1366x768] [--out shots/c1]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROUTES = ['queue', 'assign', 'test', 'imported', 'sign', 'checks', 'check-fail'];

const args = process.argv.slice(2);
const target = args[0];
if (!target) { console.error('usage: node shoot.mjs <dir under ui-direction> [--routes a,b] [--sizes 1920x1080,1366x768] [--out dir]'); process.exit(2); }
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const routes = opt('routes', ROUTES.join(',')).split(',');
const sizes = opt('sizes', '1920x1080,1366x768').split(',').map((s) => s.split('x').map(Number));
const outDir = join(ROOT, opt('out', join('shots', target.split('/').pop())));
mkdirSync(outDir, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };
const server = createServer((req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(ROOT, p);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/${target.replace(/\/$/, '')}/index.html`;

const profile = mkdtempSync(join(tmpdir(), 'shoot-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
const portFile = join(profile, 'DevToolsActivePort');
for (let i = 0; i < 100 && !existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100));
const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let nextId = 1; const pending = new Map(); const listeners = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
  else listeners.forEach((l) => l(msg));
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const once = (method, sessionId, ms = 15000) => new Promise((res) => { const t = setTimeout(() => res(null), ms); const l = (msg) => { if (msg.method === method && msg.sessionId === sessionId) { clearTimeout(t); listeners.splice(listeners.indexOf(l), 1); res(msg.params); } }; listeners.push(l); });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable'].map((m) => send(m, {}, sessionId)));
let errors = [];
listeners.push((msg) => {
  if (msg.sessionId !== sessionId) return;
  if (msg.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/favicon\.ico/.test(msg.params.entry.url ?? '')) errors.push('log: ' + msg.params.entry.text.slice(0, 200) + (msg.params.entry.url ? ' ' + msg.params.entry.url : ''));
});

const PROBE = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && r.bottom > 0 && r.top < innerHeight; };
  const els = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=option], [tabindex]:not([tabindex="-1"])')].filter(vis);
  const sizes = els.map((el) => { const r = el.getBoundingClientRect(); return Math.min(r.width, r.height); });
  return { overflowX: document.documentElement.scrollWidth > innerWidth + 1, targets: els.length, under40px: sizes.filter((s) => s < 40).length, under24px: sizes.filter((s) => s < 24).length, domNodes: document.getElementsByTagName('*').length, title: document.title };
})()`;

const report = [];
for (const [w, h] of sizes) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sessionId);
  for (const route of routes) {
    errors = [];
    await send('Page.navigate', { url: 'about:blank' }, sessionId);
    await new Promise((r) => setTimeout(r, 100));
    const loaded = once('Page.loadEventFired', sessionId);
    const t0 = Date.now();
    await send('Page.navigate', { url: `${base}#${route}` }, sessionId);
    await loaded;
    const loadMs = Date.now() - t0;
    await new Promise((r) => setTimeout(r, 1500));
    const probe = (await send('Runtime.evaluate', { expression: PROBE, returnByValue: true }, sessionId)).result.value;
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const file = join(outDir, `${route}@${w}x${h}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    report.push({ route, size: `${w}x${h}`, loadMs, ...probe, errors: [...new Set(errors)], file: file.slice(ROOT.length + 1) });
    console.log(`${route.padEnd(11)} ${`${w}x${h}`.padEnd(10)} load ${String(loadMs).padStart(5)}ms  overflowX=${probe.overflowX}  targets=${probe.targets} <40px=${probe.under40px}  errors=${errors.length}${errors.length ? '  ' + [...new Set(errors)].join(' | ') : ''}`);
  }
}
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 1));
ws.close(); chrome.kill(); server.close();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
