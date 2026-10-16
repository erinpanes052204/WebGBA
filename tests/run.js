'use strict';
/* WebGBA regression tests: real headless Chrome against the real app. No fixtures: ROMs and zips are generated here.
 *   cd tests && npm install && node run.js
 * Env: TEST_FILTER (regex: only run matching tests), WEB_DIR (folder with index.html), BASE_URL (test an already running server, e.g. the Rust one, instead of a
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
let skipped = 0;
async function test(name, fn) {
  if (process.env.TEST_FILTER && !new RegExp(process.env.TEST_FILTER, 'i').test(name)) { skipped++; return; }   // e.g. TEST_FILTER='desktop|phone'
  const t0 = Date.now();
  try { await fn(); results.push([name, true]); console.log(`  PASS  ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`); }
  catch (e) { results.push([name, false]); console.log(`  FAIL  ${name}\n        ${e.message}`); }
}
const until = async (fn, ms = 25000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await sleep(250); } };
async function openPage(browser, url, vp = {}, ua = null) {
  const ctx = await (browser.createBrowserContext || browser.createIncognitoBrowserContext).call(browser);   // fresh storage per test
  const page = await ctx.newPage(); await page.setViewport({ width: 1280, height: 800, ...vp });
  page.on('pageerror', (e) => pageProblems.push('page error: ' + e.message));
  await page.evaluateOnNewDocument(() => { window.__csp = []; addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
  if (ua) await page.setUserAgent(ua);
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

  /* ---------- phones ---------- */
  const PHONE = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  let mobile = null;
  const getMobile = async () => {
    if (mobile) return mobile;
    mobile = await openPage(browser, base, { width: 414, height: 715, ...PHONE });
    await mobile.evaluate(() => GBA.updateConfig((c) => { c.settings.touch = 'on'; }));
    await importRom(mobile, 'phon.gba', rom({ code: 'PHON', kind: 'draw' })); await play(mobile, 'phon.gba'); await sleep(800); return mobile;
  };
  const measure = (p) => p.evaluate(() => {
    const R = (sel) => [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((q) => q.width > 0);
    const sc = R('.screen')[0], vw = innerWidth, vh = innerHeight, all = R('.touch .L,.touch .R,.dpad,.sel,.sta,.face button,.tbb,.gamesbtn,.corner');
    return { w: sc.width, h: sc.height, b: sc.bottom, vw, vh,
      off: all.filter((q) => q.left < -1 || q.right > vw + 1 || q.top < -1 || q.bottom > vh + 1).length,
      hit: R('.touch .L,.touch .R,.dpad,.sel,.sta,.face button').filter((q) => !(q.right <= sc.left || q.left >= sc.right || q.bottom <= sc.top || q.top >= sc.bottom)).length,
      tbTop: Math.min(...R('.tbb').map((q) => q.top)), tbBottom: Math.max(...R('.tbb').map((q) => q.bottom)) };
  });
  const fits = (m, tag) => { assert(m.off === 0, `${tag}: ${m.off} controls run off the screen`); assert(m.hit === 0, `${tag}: controls overlap the game screen`); assert(Math.abs(m.w / m.h - 1.5) < 0.02 || tag.includes('stretch'), `${tag}: picture is ${m.w.toFixed(0)}x${m.h.toFixed(0)}`); };

  await test('portrait: the picture runs edge to edge and nothing is cut off or overlapping', async () => {
    const p = await getMobile();
    for (const [w, h] of [[414, 715], [390, 664], [360, 640], [320, 568]]) {
      await p.setViewport({ width: w, height: h, ...PHONE }); await sleep(500); const m = await measure(p); const tag = `${w}x${h}`;
      fits(m, tag); assert(m.w >= w * 0.97, `${tag}: picture only ${m.w.toFixed(0)}px wide`); assert(m.tbTop >= m.b - 1, `${tag}: toolbar is not under the screen`);
      if (w === 414 && process.env.SHOT_DIR) await p.screenshot({ path: path.join(process.env.SHOT_DIR, 'portrait.png') });
    }
  });
  await test('landscape: screen and controls all fit, with no overlap, from small phones to large', async () => {
    const p = await getMobile();
    for (const [w, h] of [[844, 390], [740, 360], [667, 375], [896, 414], [568, 320]]) {
      await p.setViewport({ width: w, height: h, ...PHONE }); await sleep(500); const m = await measure(p); const tag = `${w}x${h}`;
      fits(m, tag); assert(m.tbBottom <= h + 1, `${tag}: toolbar runs off the bottom`);
      if (w === 844 && process.env.SHOT_DIR) await p.screenshot({ path: path.join(process.env.SHOT_DIR, 'landscape.png') });
    }
  });
  await test('large buttons and stretch-to-fill still fit', async () => {
    const p = await getMobile(); await p.evaluate(() => GBA.updateConfig((c) => { c.settings.btnSize = 'large'; c.settings.screenFit = 'stretch'; }));
    for (const [w, h] of [[414, 715], [360, 640], [844, 390], [667, 375]]) { await p.setViewport({ width: w, height: h, ...PHONE }); await sleep(500); fits(await measure(p), `${w}x${h} stretch`); }
    await p.evaluate(() => GBA.updateConfig((c) => { c.settings.btnSize = 'normal'; c.settings.screenFit = 'fit'; })); await p.setViewport({ width: 414, height: 715, ...PHONE });
  });
  await test('the D-pad is one surface: sliding changes direction, and diagonals work', async () => {
    const p = await getMobile(); await p.setViewport({ width: 414, height: 715, ...PHONE }); await sleep(400);
    const r = await p.evaluate(() => { const q = document.querySelector('.dpad').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2, w: q.width }; });
    const bits = () => p.evaluate(() => GBA._debug().touch), RIGHT = 16, LEFT = 32, UP = 64;
    const t = await p.touchscreen.touchStart(r.x + r.w * 0.36, r.y), mv = (x, y) => (t && t.move ? t.move(x, y) : p.touchscreen.touchMove(x, y));
    await sleep(200); assert((await bits()) === RIGHT, 'straight right gave ' + (await bits()));
    await mv(r.x + r.w * 0.28, r.y - r.w * 0.28); await sleep(200); assert((await bits()) === (RIGHT | UP), 'sliding to the up-right diagonal gave ' + (await bits()));
    await mv(r.x, r.y - r.w * 0.36); await sleep(200); assert((await bits()) === UP, 'sliding to straight up gave ' + (await bits()));
    await mv(r.x - r.w * 0.28, r.y - r.w * 0.28); await sleep(200); assert((await bits()) === (LEFT | UP), 'sliding to the up-left diagonal gave ' + (await bits()));
    await mv(r.x, r.y); await sleep(200); assert((await bits()) === 0, 'the dead zone in the middle should press nothing, got ' + (await bits()));
    await (t && t.end ? t.end() : p.touchscreen.touchEnd()); await sleep(200); assert((await bits()) === 0, 'lifting the thumb left a direction held');
  });

  /* ---------- quick slot, undo, install ---------- */
  await test('Load can be undone, and so can a Save that overwrites a slot', async () => {
    const p = await openPage(browser, base); await importRom(p, 'undo.gba', rom({ code: 'UNDO' })); await play(p, 'undo.gba'); await sleep(2500);
    await p.evaluate(() => GBA.saveState(1)); await sleep(1500);
    await p.evaluate(() => GBA.togglePause()); await sleep(300);      // frozen: states are now exactly comparable
    const r = await p.evaluate(async () => {
      const wait = (ms) => new Promise((x) => setTimeout(x, ms));
      const a = GBA._core.stateSave(), b = GBA._core.stateSave(), vol = new Set(); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) vol.add(i);   // ignore the save-time stamp inside a state
      const hash = (u, mask) => { let x = 0; for (let i = 0; i < u.length; i++) if (!(mask && vol.has(i))) x = (x * 31 + u[i]) >>> 0; return x; };
      const before = hash(GBA._core.stateSave(), true); await GBA.loadState(1); await wait(300);
      const loaded = hash(GBA._core.stateSave(), true); const btn = document.querySelector('.toast .tact'); if (!btn) return { err: 'no Undo button after Load' }; btn.click(); await wait(300);
      const after = hash(GBA._core.stateSave(), true);
      const key = GBA.getState().id + '/1', old = hash(await GBA._store.get('state', key), false);
      await GBA.saveState(1); await wait(300); const now = hash(await GBA._store.get('state', key), false);
      const btn2 = document.querySelector('.toast .tact'); if (!btn2) return { err: 'no Undo button after Save' }; btn2.click(); await wait(500);
      const back = hash(await GBA._store.get('state', key), false);
      return { before, loaded, after, old, now, back };
    });
    assert(!r.err, r.err); assert(r.loaded !== r.before, 'Load did not change the game'); assert(r.after === r.before, 'Undo did not return to where the game was before Load');
    assert(r.now !== r.old && r.back === r.old, 'Undo did not restore the slot to its previous contents'); await closePage(p);
  });
  await test("saving to a slot from Settings never changes the quick slot", async () => {
    const p = await openPage(browser, base); await importRom(p, 'qs.gba', rom({ code: 'QSLT' })); await play(p, 'qs.gba'); await sleep(1500);
    await p.evaluate(async () => { await GBA.saveState(3); await new Promise((x) => setTimeout(x, 300)); await GBA.loadState(3); });
    const slot = await p.evaluate(() => GBA.getState().config.settings.slot); assert(slot === 1, 'quick slot became ' + slot); await closePage(p);
  });
  await test('the web app manifest and icons are served (Add to Home Screen)', async () => {
    const p = await openPage(browser, base);
    const r = await p.evaluate(async () => { const m = await (await fetch('manifest.webmanifest')).json(); const ok = await Promise.all(m.icons.map(async (i) => (await fetch(i.src)).ok)); const apple = (await fetch('apple-touch-icon.png')).ok; return { display: m.display, start: m.start_url, ok, apple, linked: !!document.querySelector('link[rel=manifest]') }; });
    assert(r.display === 'standalone' && r.ok.length >= 2 && r.ok.every(Boolean) && r.apple && r.linked, JSON.stringify(r)); await closePage(p);
  });
  await test('iPhone Safari gets the Add-to-Home-Screen tip once, and dismissing it sticks', async () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const p = await openPage(browser, base, { width: 414, height: 715, ...PHONE }, ua); await p.waitForSelector('.ioshint', { timeout: 8000 });
    await p.click('.ioshint button'); await sleep(300); assert(!(await p.$('.ioshint')), 'tip did not go away');
    await p.reload({ waitUntil: 'networkidle0' }); await sleep(1500); assert(!(await p.$('.ioshint')), 'tip came back after reload'); await closePage(p);
  });


  /* ---------- desktop: window size and Settings ---------- */
  await test('desktop: the picture fills the window, and the Screen size options really resize it', async () => {
    for (const [w, h] of [[1366, 650], [1920, 1080]]) {
      const p = await openPage(browser, base, { width: w, height: h }); await p.evaluate(() => GBA.updateConfig((c) => { c.settings.touch = 'auto'; c.settings.scale = 'fit'; c.settings.btnSize = 'normal'; c.settings.screenFit = 'fit'; })); await sleep(300); await importRom(p, `dsk${w}.gba`, rom({ code: 'DSKT', kind: 'draw', title: 'DESK' + w })); await play(p, `dsk${w}.gba`); await sleep(800);
      const exp = await p.evaluate(() => { const st = document.querySelector('.stage').getBoundingClientRect().width; return { fit: Math.min(0.94 * st, (innerHeight - 130) * 1.5), x2: Math.min(0.94 * st, 480), x3: Math.min(0.94 * st, 720) }; });
      const width = () => p.evaluate(() => document.querySelector('.screen').getBoundingClientRect().width);
      const near = async (want, tag) => { const got = await width(); assert(Math.abs(got - want) < 4, `${w}x${h} ${tag}: picture is ${got.toFixed(0)}px wide, expected about ${want.toFixed(0)}px`); };
      await near(exp.fit, 'Fit');
      for (const [k, want] of [['2', exp.x2], ['3', exp.x3]]) { await p.evaluate((k) => GBA.updateConfig((c) => { c.settings.scale = k; }), k); await sleep(500); await near(want, k + 'x'); }
      await p.evaluate(() => { GBA.updateConfig((c) => { c.settings.scale = 'fit'; }); document.querySelector('.gear').click(); }); await sleep(900);   // the drawer opens: the picture shrinks to stay visible beside it
      const open = await p.evaluate(() => { const d = document.querySelector('.drawer').getBoundingClientRect(), s = document.querySelector('.screen').getBoundingClientRect(); return { drawerLeft: d.left, screenRight: s.right, w: s.width }; });
      assert(open.screenRight <= open.drawerLeft + 1 && open.w > 300, `with Settings open the picture is ${open.w.toFixed(0)}px and ends at ${open.screenRight.toFixed(0)} (drawer starts at ${open.drawerLeft.toFixed(0)})`);
      if (w === 1366 && process.env.SHOT_DIR) await p.screenshot({ path: path.join(process.env.SHOT_DIR, 'desktop_settings.png') });
      await closePage(p);
    }
  });
  await test('desktop: every Settings tab opens and its controls really change the settings', async () => {
    const p = await openPage(browser, base, { width: 1366, height: 700 }); await p.evaluate(() => GBA.updateConfig((c) => { c.settings.touch = 'auto'; c.settings.scale = 'fit'; c.settings.filter = 'sharp'; c.settings.glow = true; })); await sleep(300); await importRom(p, 'set.gba', rom({ code: 'SETT', kind: 'draw' })); await play(p, 'set.gba'); await sleep(800);
    const cfg = () => p.evaluate(() => GBA.getState().config), st = () => p.evaluate(() => { const s = GBA.getState(); return { paused: s.paused, turbo: s.turbo, listening: s.padListening }; });
    const tab = (i) => p.evaluate((i) => document.querySelectorAll('.tabs button')[i].click(), i);
    const press = (text, scope = '.drawer') => p.evaluate((t, sc) => { const b = [...document.querySelectorAll(sc + ' button')].find((x) => x.textContent.trim() === t && !x.disabled); if (!b) throw new Error('no button "' + t + '"'); b.click(); }, text, scope);
    const range = (i, v) => p.evaluate((i, v) => { const el = document.querySelectorAll('.drawer input[type=range]')[i]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, i, v);
    await p.evaluate(() => document.querySelector('.gear').click()); await p.waitForSelector('.drawer.open'); await sleep(400);
    // Game
    await press('3'); assert((await cfg()).settings.slot === 3, 'quick slot seg did nothing');
    await press('Pause'); assert((await st()).paused, 'Pause button did nothing'); await press('Resume'); assert(!(await st()).paused, 'Resume button did nothing');
    await press('Turbo lock'); await sleep(200); assert((await st()).turbo, 'Turbo lock did nothing'); await press('Turbo lock'); await sleep(200);
    // Display
    await tab(2); await sleep(300);   // tabs are numbered from 0: Game, Controls, Display, Backup
    await press('Smooth'); assert((await cfg()).settings.filter === 'smooth' && (await p.evaluate(() => document.querySelector('.stage').dataset.filter)) === 'smooth', 'filter did nothing');
    await press('LCD'); await press('Sharp');
    await press('3x'); await sleep(400); const w3 = await p.evaluate(() => document.querySelector('.screen').getBoundingClientRect().width); assert(w3 > 350 && (await cfg()).settings.scale === '3', 'screen size 3x gave ' + w3.toFixed(0) + 'px'); await press('Fit');
    await range(0, '20'); assert((await cfg()).settings.vol === 20, 'volume slider did nothing');
    await range(1, '12'); assert((await cfg()).settings.turboSpeed === 12, 'turbo speed slider did nothing');
    await press('Muted'); assert((await cfg()).settings.turboAudio === 'mute', 'turbo sound did nothing');
    await p.evaluate(() => document.querySelectorAll('.drawer [role=switch]')[0].click()); await sleep(200); assert((await cfg()).settings.glow === false, 'ambient glow switch did nothing');
    // Controls
    await tab(1); await sleep(300);
    await p.evaluate(() => { const row = [...document.querySelectorAll('.drawer .krow')].find((r) => r.querySelector('span').textContent === 'A' && !r.querySelector('button').hasAttribute('data-nav')); row.querySelector('button').click(); });
    await sleep(200); await p.keyboard.press('KeyQ'); await sleep(200); assert((await cfg()).keys.A === 'KeyQ', 'keyboard rebinding did nothing');
    await p.evaluate(() => { const row = [...document.querySelectorAll('.drawer .krow')].find((r) => r.querySelector('span').textContent === 'Hold turbo' && r.querySelector('button').hasAttribute('data-nav')); row.querySelector('button').click(); });
    await sleep(200); assert((await st()).listening === 'TURBO', 'controller rebinding did not start listening'); await p.evaluate(() => GBA.cancelListenPad());
    await press('Reset keyboard'); await sleep(200); assert((await cfg()).keys.A === 'KeyX', 'Reset keyboard did nothing');
    // Backup
    await tab(3); await sleep(300); await press('Export backup'); await until(() => p.evaluate(() => !GBA.getState().busy), 15000, 'the backup export to finish');
    await press('Close settings', '.drawer').catch(() => {}); await p.evaluate(() => document.querySelector('.drawer button[aria-label="Close settings"]').click()); await sleep(700);
    assert(!(await p.$('.drawer.open')), 'the Close button did not close Settings'); await closePage(p);
  });

  if (mobile) { await mobile.evaluate(() => GBA.updateConfig((c) => { c.settings.touch = 'auto'; c.settings.btnSize = 'normal'; c.settings.screenFit = 'fit'; })); await sleep(900); await closePage(mobile); }
  await test('no page errors or CSP violations occurred during any test', async () => { assert(pageProblems.length === 0, [...new Set(pageProblems)].join(' | ')); });

  await browser.close(); if (server) server.s.close();
  const failed = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - failed}/${results.length} passed${skipped ? ` (${skipped} skipped by TEST_FILTER)` : ''}`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('TEST RUN CRASHED:', e); process.exit(2); });
