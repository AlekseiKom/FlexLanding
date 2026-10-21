// Минимальный CDP-тест без внешних зависимостей (raw WebSocket).
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9377;
const PAGE_URL = 'file:///C:/Users/Lep4i/Desktop/My%20GitHub/FlexLanding/index.html';
const SHOTS_DIR = path.join(process.env.TEMP || '.', 'flex-shots');

function httpReq(method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: urlPath }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.setTimeout(3000, () => { console.log('[httpReq] timeout:', method, urlPath); req.destroy(); reject(new Error('timeout')); });
    req.on('error', (e) => { console.log('[httpReq] error:', e.code || e.message); reject(e); });
    req.end();
  });
}

class MiniWS {
  constructor(wsUrl) {
    const u = new URL(wsUrl);
    this.handlers = new Map();
    this.socket = null;
    this.buf = Buffer.alloc(0);
    this.opened = new Promise((res) => { this._resolveOpen = res; });
    const key = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
    this.req = http.request({
      host: u.hostname, port: Number(u.port) || 80, path: u.pathname + u.search,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' }
    });
    this.req.on('upgrade', (res, socket) => {
      this.socket = socket;
      socket.setNoDelay(true);
      socket.on('data', (d) => this._onData(d));
      socket.on('close', () => { console.error('[ws] socket closed'); this.closed = true; });
      if (this._resolveOpen) this._resolveOpen();
    });
    this.req.on('error', (e) => { console.error('WS error:', e.message); process.exit(1); });
    this.req.end();
  }
  _frame(payloadBuf, opcode = 0x1) {
    const len = payloadBuf.length;
    let header;
    if (len < 126) { header = Buffer.alloc(2); header[0] = 0x80 | opcode; header[1] = 0x80 | len; }
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
    const mask = crypto.getRandomValues(new Uint8Array(4));
    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) masked[i] = payloadBuf[i] ^ mask[i % 4];
    return Buffer.concat([header, mask, masked]);
  }
  send(obj) { this.socket.write(this._frame(Buffer.from(JSON.stringify(obj)))); }
  on(event, fn) { if (!this.handlers.has(event)) this.handlers.set(event, []); this.handlers.get(event).push(fn); }
  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (true) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const opcode = b0 & 0x0f;
      const b1 = this.buf[1];
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      const masked = b1 & 0x80 ? true : false;
      let payloadOff = off;
      if (masked) { payloadOff += 4; if (this.buf.length < payloadOff + len) return; }
      if (this.buf.length < payloadOff + len) return;
      const payload = this.buf.subarray(payloadOff, payloadOff + len);
      this.buf = this.buf.subarray(payloadOff + len);
      if (opcode === 0x8) { console.error('WS closed by server'); process.exit(1); }
      if (opcode === 0x9 && this.socket) this.socket.write(this._frame(Buffer.alloc(0), 0xA));
      if (opcode === 0x1 || opcode === 0x2) {
        const msg = JSON.parse(payload.toString('utf8'));
        for (const fn of this.handlers.get(opcode === 0x1 ? 'message' : 'binary') || []) fn(msg);
      }
    }
  }
}

let seq = 1;
function cdp(ws, method, params = {}) {
  return new Promise((resolve) => {
    const id = seq++;
    const t = setTimeout(() => { console.error('CDP TIMEOUT: ' + method); process.exit(2); }, 15000);
    ws.on('message', (m) => { if (m.id === id) { clearTimeout(t); resolve(m.result || m.error); } });
    ws.send({ id, method, params });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const profileDir = path.join(process.env.TEMP || '.', 'flex-edge-profile');
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, '--user-data-dir=' + profileDir, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  setTimeout(() => { console.error('GLOBAL TIMEOUT (90s) — force exit'); proc.kill(); process.exit(3); }, 90000);

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(500);
    try {
      const r = await httpReq('PUT', '/json/new?' + PAGE_URL);
      if (r.status === 200) target = JSON.parse(r.body);
      else console.log('[poll] /json/new ->', r.status, r.body.slice(0, 120));
    } catch {}
  }
  console.log(target ? '[step] target created: ' + target.id : '[step] no target after 40 polls');
  if (!target) { proc.kill(); process.exit(1); }

  const ws = new MiniWS(target.webSocketDebuggerUrl);
  const openedInTime = await Promise.race([ws.opened.then(() => true), sleep(5000).then(() => false)]);
  console.log(openedInTime ? '[step] CDP WS connected' : '[step] CDP WS NOT open');
  if (!openedInTime) { proc.kill(); process.exit(1); }

  const problems = [];
  ws.on('message', (m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      problems.push('EXCEPTION: ' + JSON.stringify(m.params.exceptionDetails.text || m.params.exceptionDetails));
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      problems.push('LOG ERROR: ' + m.params.entry.message);
    } else if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map((a) => a.value || a.description || '').join(' ');
      if (m.params.type === 'error' || m.params.type === 'warning') problems.push(m.params.type.toUpperCase() + ': ' + text);
    }
  });

  await cdp(ws, 'Runtime.enable');
  await cdp(ws, 'Log.enable');
  await cdp(ws, 'Page.enable');
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: 1400, height: 950, deviceScaleFactor: 1, mobile: false });

  await sleep(6000);

  const evalJS = (expression) => cdp(ws, 'Runtime.evaluate', { expression, returnByValue: true }).then((r) => r.result.value);

  const desk = await evalJS(`({
    serviceCards: document.querySelectorAll('#services .card').length,
    stepCards: document.querySelectorAll('#process .card').length,
    sections: document.querySelectorAll('section').length,
    revealTotal: document.querySelectorAll('.reveal').length,
    revealVisible: document.querySelectorAll('.reveal.is-visible').length,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    pillRows: document.querySelectorAll('.pill-row').length,
    burgerVisible: getComputedStyle(document.querySelector('.burger')).display !== 'none'
  })`);

  const shotDesk = await cdp(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS_DIR, 'desktop-1400.png'), Buffer.from(shotDesk.data, 'base64'));

  await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(800);
  const burgerOpen = await evalJS(`(() => {
    document.querySelector('.burger').click();
    return document.body.classList.contains('nav-open');
  })()`);
  const shotMob = await cdp(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS_DIR, 'mobile-390-burger.png'), Buffer.from(shotMob.data, 'base64'));

  await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: 1400, height: 950, deviceScaleFactor: 1, mobile: false });
  await evalJS(`window.scrollTo(0, document.body.scrollHeight); true`);
  await sleep(2500);
  const afterScroll = await evalJS(`({
    headerScrolled: document.querySelector('.site-header').classList.contains('scrolled'),
    revealVisibleNow: document.querySelectorAll('.reveal.is-visible').length,
    countersText: Array.from(document.querySelectorAll('[data-count]')).map(e => e.textContent)
  })`);
  const shotBottom = await cdp(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS_DIR, 'desktop-bottom.png'), Buffer.from(shotBottom.data, 'base64'));

  console.log('DESKTOP:', JSON.stringify(desk));
  console.log('BURGER OPEN (mobile):', burgerOpen);
  console.log('AFTER SCROLL:', JSON.stringify(afterScroll));
  if (problems.length) { problems.forEach((p) => console.log('PROBLEM: ' + p)); }
  else console.log('NO CONSOLE ERRORS / EXCEPTIONS');

  const ok = desk.serviceCards === 4 && desk.stepCards === 3 && desk.sections === 6 && desk.pillRows === 2
    && !desk.overflowX && !desk.burgerVisible && burgerOpen === true && afterScroll.headerScrolled === true
    && afterScroll.countersText.includes('260+') && afterScroll.countersText.includes('99,98%')
    && problems.length === 0;
  console.log(ok ? 'TEST RESULT: PASS' : 'TEST RESULT: FAIL');
  ws.socket.destroy();
  proc.kill();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
