'use strict';
/* WebGBA regression tests: real headless Chrome against the real app. No fixtures: ROMs and zips are generated here.
 *   cd tests && npm install && node run.js
 * Env: WEB_DIR (folder with index.html), BASE_URL (test an already running server, e.g. the Rust one, instead of a
 * built-in static server; use a scratch --data AND --roms folder, because the server keeps files between tests), CHROME_PATH, CHROME_ARGS_JSON, SHOT_DIR (save a phone screenshot). */
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
let puppeteer; try { puppeteer = require('puppeteer'); } catch (e) { puppeteer = require('puppeteer-core'); }
const WEB = path.resolve(__dirname, process.env.WEB_DIR || (fs.existsSync(path.join(__dirname, '..', 'index.html')) ? '..' : '../server/web'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

/* ---------- generated fixtures ---------- */
function rom({ code = 'TEST', title = 'TESTROM', kind = 'sram', tweak = false } = {}) {
  const b = Buffer.alloc(0x400);
  b.writeUInt32LE(0xEA00002E, 0); b.write(title.padEnd(12, '\0'), 0xA0, 'latin1'); b.write(code, 0xAC, 'latin1'); b[0xB2] = 0x96;
  const prog = kind === 'draw'
    ? [0xE3A00301, 0xE3A01C04, 0xE2811003, 0xE5801000, 0xE3A02406, 0xE3A03000, 0xE3A04406, 0xE2844B96, 0xE0C230B2, 0xE2833001, 0xE1520004, 0x1AFFFFFB, 0xEAFFFFFE]   // fills the screen
    : [0xE3A0040E, 0xE3A01042, 0xE5C01000, 0xEAFFFFFE];                                                                                                           // writes 0x42 to SRAM
  prog.forEach((w, i) => b.writeUInt32LE(w, 0xC0 + 4 * i));
  b.write('SRAM_V113\0', 0x100, 'latin1'); if (tweak) b[0x200] = 1;
  return b;
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (buf) => { let c = 0xFFFFFFFF; for (const x of buf) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(entries) {   // [{name, data, store?, badCrc?}]
  const parts = [], cd = []; let off = 0;
  for (const e of entries) {
    const nb = Buffer.from(e.name), method = e.store ? 0 : 8, comp = method ? zlib.deflateRawSync(e.data) : e.data, c = e.badCrc ? 0x12345678 : crc(e.data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(c, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(c, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nb, comp); cd.push(ch, nb); off += 30 + nb.length + comp.length;
  }
  const cdb = Buffer.concat(cd), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cdb.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdb, end]);
}
function serve(dir) {
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
      const f = path.join(dir, p);
      if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('not found'); }
      r.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
    });
    s.listen(0, '127.0.0.1', () => res({ s, url: `http://127.0.0.1:${s.address().port}/` }));
  });
}

/* ---------- harness ---------- */
const results = [], pageProblems = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([name, true]); console.log(`  PASS  ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`); }
  catch (e) { results.push([name, false]); console.log(`  FAIL  ${name}\n        ${e.message}`); }
}
const until = async (fn, ms = 25000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await sleep(250); } };
async function openPage(browser, url, vp = {}) {
  const ctx = await (browser.createBrowserContext || browser.createIncognitoBrowserContext).call(browser);   // fresh storage per test
  const page = await ctx.newPage(); await page.setViewport({ width: 1280, height: 800, ...vp });
  page.on('pageerror', (e) => pageProblems.push('page error: ' + e.message));
  await page.evaluateOnNewDocument(() => { window.__csp = []; addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.GBA && GBA.getState().ready, { timeout: 30000 });
  page.__ctx = ctx; return page;
}
const closePage = async (page) => { const csp = await page.evaluate(() => window.__csp).catch(() => []); csp.forEach((c) => pageProblems.push('CSP violation: ' + c)); await page.__ctx.close(); };
const b64 = (b) => b.toString('base64');
const importRom = (page, name, buf) => page.evaluate(async (n, b) => { const u = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)); await GBA._import([{ name: n, get: async () => new File([u], n) }]); }, name, b64(buf));
const play = async (page, name) => { await page.evaluate((n) => GBA.openLibrary(n), name); await page.waitForFunction((n) => GBA.getState().running && GBA.getState().romName === n, { timeout: 30000 }, name); };
const readSave = (page, id) => page.evaluate(async (id) => { const b = await GBA._store.get('save', id); return b ? { len: b.length, b0: b[0], b1: b[1] } : null; }, id);
const stateOf = (page) => page.evaluate(() => { const s = GBA.getState(); return { running: s.running, id: s.id, rom: s.romName, server: s.serverMode, lib: s.library.map((g) => g.name), cfg: s.config }; });

(async () => {
  let server = null, base = process.env.BASE_URL;
  if (!base) { server = await serve(WEB); base = server.url; }
  const extra = process.env.CHROME_ARGS_JSON ? JSON.parse(process.env.CHROME_ARGS_JSON) : [];
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required', ...extra], headless: process.env.CHROME_ARGS_JSON ? 'shell' : true, executablePath: process.env.CHROME_PATH || undefined });
  console.log(`WebGBA tests against ${base} (web dir ${WEB})\n`);

  await test('boots, and the page makes no errors', async () => { const p = await openPage(browser, base); await sleep(600); await closePage(p); });

  await test('scanning a folder skips files that are not GBA games', async () => {
    const p = await openPage(browser, base);
    await p.evaluate(async (g) => { const u = Uint8Array.from(atob(g), (c) => c.charCodeAt(0)); const junk = crypto.getRandomValues(new Uint8Array(5000));
      await GBA._import([{ name: 'good.gba', get: async () => new File([u], 'good.gba') }, { name: 'junk.gba', get: async () => new File([junk], 'junk.gba') }, { name: 'junk.bin', get: async () => new File([junk], 'junk.bin') }]); }, b64(rom({ code: 'SCAN' })));
    const s = await stateOf(p); assert(s.lib.length === 1 && s.lib[0] === 'good.gba', 'library was ' + JSON.stringify(s.lib)); await closePage(p);
  });

  await test('two different ROMs with the same header get different save ids', async () => {
    const p = await openPage(browser, base);
    const ids = await p.evaluate(async (a, b) => { const mk = (x, n) => new File([Uint8Array.from(atob(x), (c) => c.charCodeAt(0))], n); await GBA.openFile(mk(a, 'a.gba')); const i1 = GBA.getState().id; await GBA.openFile(mk(b, 'b.gba')); return [i1, GBA.getState().id]; },
      b64(rom({ code: 'COLL' })), b64(rom({ code: 'COLL', tweak: true })));
    assert(ids[0] !== ids[1], 'both ids were ' + ids[0]); await closePage(p);
  });

  await test('a battery save is written and loaded back', async () => {
    const p = await openPage(browser, base); await importRom(p, 'save.gba', rom({ code: 'SAVE' })); await play(p, 'save.gba');
    const id = (await stateOf(p)).id, sv = await until(async () => { const r = await readSave(p, id); return r && r.b0 === 0x42 ? r : null; }, 30000, 'the save to be written');
    assert(sv.len === 32768, 'save length ' + sv.len); await closePage(p);
  });

  await test('a failed save write is retried (no silent data loss)', async () => {
    const p = await openPage(browser, base); await importRom(p, 'retr.gba', rom({ code: 'RETR' }));
    const server2 = (await stateOf(p)).server;
    await p.evaluate((srv) => { window.__failed = 0;
      if (srv) { const of = window.fetch; window.fetch = (u, o) => { if (String(u).includes('/api/save/') && o && o.method === 'PUT' && !window.__failed) { window.__failed = 1; return Promise.reject(new Error('simulated disk error')); } return of(u, o); }; }
      else { const op = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (v, k) { if (String(k).startsWith('save:') && !window.__failed) { window.__failed = 1; throw new Error('simulated disk error'); } return op.call(this, v, k); }; } }, server2);
    await play(p, 'retr.gba'); const id = (await stateOf(p)).id;
    await until(async () => (await readSave(p, id)), 40000, 'the save to be retried and written');
    assert(await p.evaluate(() => window.__failed === 1), 'the failure was never triggered'); await closePage(p);
  });

  await test('an imported .sav is not overwritten by the running game', async () => {
    const p = await openPage(browser, base); await importRom(p, 'impt.gba', rom({ code: 'IMPT' })); await play(p, 'impt.gba');
    const id = (await stateOf(p)).id; await until(async () => { const r = await readSave(p, id); return r && r.b0 === 0x42; }, 30000, 'the first save');
    await p.evaluate(async () => { await GBA.importSav(new File([new Uint8Array(32768).fill(0x77)], 'import.sav')); });
    await sleep(6000); const sv = await readSave(p, id); assert(sv && sv.b1 === 0x77, 'save byte 1 is ' + (sv && sv.b1) + ', expected 0x77 from the imported file'); await closePage(p);
  });

  await test('saves from the old id scheme are found and migrated', async () => {
    const p = await openPage(browser, base); await importRom(p, 'old.gba', rom({ code: 'MIGR', title: 'MIGTEST' }));
    await p.evaluate(async () => { await GBA._store.put('save', 'MIGR_MIGTEST', new Uint8Array(32768).fill(0x55)); });
    await play(p, 'old.gba'); const id = (await stateOf(p)).id; assert(id !== 'MIGR_MIGTEST', 'id was not upgraded');
    const sv = await until(async () => { const r = await readSave(p, id); return r && r.b1 === 0x55 ? r : null; }, 30000, 'the old save to be copied to the new id'); assert(sv, 'not migrated'); await closePage(p);
  });

  await test('a failed ROM load leaves the running game untouched', async () => {
    const p = await openPage(browser, base); await importRom(p, 'draw.gba', rom({ code: 'DRAW', kind: 'draw' })); await play(p, 'draw.gba');
    await until(() => p.evaluate(() => { const d = document.querySelector('canvas').getContext('2d').getImageData(0, 0, 240, 160).data; const s = new Set(); for (let i = 0; i < d.length; i += 4) s.add(d[i] + ',' + d[i + 1]); return s.size > 100; }), 40000, 'the game to draw');
    const r = await p.evaluate(() => { const ok = GBA._core.load(new Uint8Array(10), null, null); return { ok, video: GBA._core.m._wg_video_ptr() !== 0, running: GBA.getState().running }; });
    assert(r.ok === false && r.video && r.running, JSON.stringify(r)); await sleep(800);
    assert(await p.evaluate(() => GBA._core.m._wg_video_ptr() !== 0 && GBA.getState().running), 'the game died after the failed load'); await closePage(p);
  });

  await test('a file without a GBA header needs confirmation to run', async () => {
    const p = await openPage(browser, base); let asked = 0; p.on('dialog', async (d) => { asked++; await d.dismiss(); });
    await p.evaluate(async () => { await GBA.openFile(new File([crypto.getRandomValues(new Uint8Array(5000))], 'random.gba')); });
    const s = await stateOf(p); assert(asked === 1 && !s.running, `dialogs ${asked}, running ${s.running}`); await closePage(p);
  });

  await test('backup export then import restores settings and games', async () => {
    const p = await openPage(browser, base); await importRom(p, 'bk.gba', rom({ code: 'BKUP' }));
    const keyA = await p.evaluate(async () => { GBA.updateConfig((c) => { c.keys.A = 'KeyQ'; c.settings.turboSpeed = 9; }); const blob = await GBA.exportBackup({ roms: true });
      GBA.resetKeys(); GBA.updateConfig((c) => { c.settings.turboSpeed = 4; }); await GBA.importBackup(new File([blob], 'b.zip')); const c = GBA.getState().config; return [c.keys.A, c.settings.turboSpeed, GBA.getState().library.length]; });
    assert(keyA[0] === 'KeyQ' && keyA[1] === 9 && keyA[2] >= 1, JSON.stringify(keyA)); await closePage(p);
  });

  await test('a doctored backup is sanitized and a zip bomb is skipped', async () => {
    const evil = zip([
      { name: 'settings.json', data: Buffer.from(JSON.stringify({ settings: { turboSpeed: 99999, vol: -5, filter: '<script>' }, covers: { 'x.gba': 'https://evil.example/t.png' }, meta: { X: { 1: { t: 1, thumb: 'https://evil.example/x.png' } } }, keys: { A: 'KeyQ', B: { x: 1 } }, pad: { A: 9999 } })) },
      { name: 'roms/bomb.gba', data: Buffer.alloc(100 * 1024 * 1024) }, { name: 'roms/ok.gba', data: rom({ code: 'OKAY' }) }]);
    const p = await openPage(browser, base);
    const r = await p.evaluate(async (z) => { await GBA.importBackup(new File([Uint8Array.from(atob(z), (c) => c.charCodeAt(0))], 'evil.zip')); const s = GBA.getState(), c = s.config;
      return { speed: c.settings.turboSpeed, vol: c.settings.vol, filter: c.settings.filter, covers: Object.keys(c.covers).length, keyB: c.keys.B, padA: c.pad.A, lib: s.library.map((g) => g.name), alive: s.ready }; }, b64(evil));
    assert(r.speed === 16 && r.vol === 0 && r.filter === 'sharp' && r.covers === 0 && r.keyB === 'KeyZ' && r.padA === 1, JSON.stringify(r));
    assert(r.lib.includes('ok.gba') && !r.lib.includes('bomb.gba') && r.alive, 'library ' + JSON.stringify(r.lib)); await closePage(p);
  });

  await test('zip entries with a wrong checksum are rejected', async () => {
    const bad = zip([{ name: 'saves/BADCRC_X.sav', data: Buffer.alloc(32768, 7), badCrc: true }, { name: 'saves/GOODCRC_X.sav', data: Buffer.alloc(32768, 9) }]);
    const p = await openPage(browser, base);
    const r = await p.evaluate(async (z) => { await GBA.importBackup(new File([Uint8Array.from(atob(z), (c) => c.charCodeAt(0))], 'bad.zip')); return [!!(await GBA._store.get('save', 'BADCRC_X')), !!(await GBA._store.get('save', 'GOODCRC_X'))]; }, b64(bad));
    assert(r[0] === false, 'a corrupted entry was accepted'); await closePage(p);   // (the import aborts at the first bad entry; the point is the bad data is never stored)
  });

  await test('touch controls fit phone screens from 320 to 430 px wide', async () => {
    const p = await openPage(browser, base, { width: 375, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await p.evaluate(() => GBA.updateConfig((c) => { c.settings.touch = 'on'; })); await importRom(p, 'phon.gba', rom({ code: 'PHON', kind: 'draw' })); await play(p, 'phon.gba'); await sleep(1000);
    for (const w of [320, 360, 375, 390, 430]) {
      await p.setViewport({ width: w, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); await sleep(400);
      const m = await p.evaluate(() => { const bs = [...document.querySelectorAll('.touch button')].map((b) => b.getBoundingClientRect()); return { vw: innerWidth, l: Math.min(...bs.map((b) => b.left)), r: Math.max(...bs.map((b) => b.right)) }; });
      assert(m.l >= -1 && m.r <= m.vw + 1, `at ${w}px the buttons span ${Math.round(m.l)}..${Math.round(m.r)} of ${m.vw}`);
      if (w === 375 && process.env.SHOT_DIR) await p.screenshot({ path: path.join(process.env.SHOT_DIR, 'phone375.png') });
    } await closePage(p);
  });

  await test('no page errors or CSP violations occurred during any test', async () => { assert(pageProblems.length === 0, [...new Set(pageProblems)].join(' | ')); });

  await browser.close(); if (server) server.s.close();
  const failed = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('TEST RUN CRASHED:', e); process.exit(2); });
