'use strict';
/* WebGBA UI: React 18 + htm (no build step). All state and logic live in engine.js. */
(() => {
const { createElement: h, useState, useEffect, useRef, useSyncExternalStore } = React;
const html = htm.bind(h);
const useG = () => useSyncExternalStore(GBA.subscribe, GBA.getState);
const N = { 'data-nav': '' };   // marks things the controller / arrow keys can focus

const ICON = {
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  gear: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  upload: '<path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19h14"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.8"/>',
  shot: '<path d="M4 8.5h3.2L9 6h6l1.8 2.5H20V19H4z"/><circle cx="12" cy="13.2" r="3.2"/>',
  turbo: '<path d="M5 6.5l6.5 5.5L5 17.5zM13 6.5l6.5 5.5-6.5 5.5z"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><path d="M8 20v-6h8v6"/>',
  load: '<path d="M12 4v10M7.5 10l4.5 4.5 4.5-4.5M5 19h14"/>',
};
const Icon = ({ n, size = 20 }) => html`<svg viewBox="0 0 24 24" width=${size} height=${size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICON[n] }} />`;

const keyLabel = (c) => ({ ArrowUp: '\u2191', ArrowDown: '\u2193', ArrowLeft: '\u2190', ArrowRight: '\u2192', ShiftLeft: 'Shift', ShiftRight: 'R-Shift', Escape: 'Esc' }[c]
  || String(c).replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num '));
const XBOX = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D-up', 'D-down', 'D-left', 'D-right', 'Guide'];
const PADN = {
  xbox: XBOX, generic: XBOX,
  ps: ['\u2715', '\u25CB', '\u25A1', '\u25B3', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', 'D-up', 'D-down', 'D-left', 'D-right', 'PS'],
  nintendo: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '\u2212', '+', 'LS', 'RS', 'D-up', 'D-down', 'D-left', 'D-right', 'Home'],
};
const padLabel = (i, fam) => (i < 0 ? 'Not set' : (PADN[fam] || XBOX)[i] || 'Button ' + i);
const hue = (s) => { let x = 7; for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) % 360; return x; };
const cleanName = (n) => n.replace(/\.[^.]+$/, '');
const initials = (n) => cleanName(n).replace(/\(.*?\)|\[.*?\]/g, '').split(/[\s_\-.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'GBA';
const setS = (k, v) => GBA.updateConfig((c) => { c.settings[k] = v; });

/* ------------------------------------------------------- controller / keyboard menu navigation */
const TABS = [['game', 'Game'], ['controls', 'Controls'], ['display', 'Display'], ['backup', 'Backup']];
function stepRange(el, dir) {
  const span = +el.max - +el.min, step = Math.max(+el.step || 1, span / 20);
  const v = Math.min(+el.max, Math.max(+el.min, +el.value + dir * step));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
const navItems = (root) => [...root.querySelectorAll('[data-nav]')].filter((e) => !e.disabled && e.offsetParent !== null);
function focusFirst(u) {
  const root = document.querySelector(u.tab ? '.drawer' : '.glass'); if (!root) return;
  const items = navItems(root);
  (items.find((e) => e.closest('.cur')) || items[0] || {}).focus?.();
}
function navEvent(type, u) {
  const root = document.querySelector(u.tab ? '.drawer' : '.glass'); if (!root) return;
  if (type === 'back') { if (u.tab) u.setTab(null); else if (u.running) u.setLib(false); return; }
  if (type === 'l' || type === 'r') {
    if (u.tab) { const i = TABS.findIndex((t) => t[0] === u.tab); u.setTab(TABS[(i + (type === 'r' ? 1 : TABS.length - 1)) % TABS.length][0]); }
    return;
  }
  const items = navItems(root), cur = items.includes(document.activeElement) ? document.activeElement : null;
  if (!cur) { focusFirst(u); return; }
  if (type === 'confirm') { cur.click(); return; }
  if (cur.type === 'range' && (type === 'left' || type === 'right')) { stepRange(cur, type === 'right' ? 1 : -1); return; }
  const r0 = cur.getBoundingClientRect(), cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
  let best = null, bs = Infinity;
  for (const e of items) {
    if (e === cur) continue;
    const r = e.getBoundingClientRect(), dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy;
    const along = type === 'right' ? dx : type === 'left' ? -dx : type === 'down' ? dy : -dy;
    const across = type === 'left' || type === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along < 4) continue;
    if ((type === 'left' || type === 'right') && across > Math.max(r.height, r0.height) * 0.7) continue;   // sideways moves stay in their row
    const score = along + across * 2.5;
    if (score < bs) { bs = score; best = e; }
  }
  if (best) { best.focus(); best.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
}

/* ------------------------------------------------------------------------- small controls */
const Seg = ({ value, options, onChange }) => html`
  <div className="seg" role="radiogroup">${options.map(([v, l]) => html`
    <button type="button" ...${N} key=${v} role="radio" aria-checked=${value === v} className=${value === v ? 'on' : ''} onClick=${() => onChange(v)}>${l}</button>`)}</div>`;
const Toggle = ({ on, onChange, label, hint }) => html`
  <div className="row"><div><div>${label}</div>${hint && html`<small>${hint}</small>`}</div>
    <button type="button" ...${N} role="switch" aria-checked=${on} aria-label=${label} className=${'sw' + (on ? ' on' : '')} onClick=${() => onChange(!on)}><i /></button></div>`;
const Field = ({ label, children, value }) => html`<div className="field"><div className="fl"><span>${label}</span>${value !== undefined && html`<b>${value}</b>`}</div>${children}</div>`;

function ControlsList({ s }) {
  const c = s.config, pad = s.pad.connected && s.input === 'pad', fam = s.pad.family;
  const L = (a) => (pad ? padLabel(c.pad[a], fam) : keyLabel(c.keys[a]));
  const rows = [
    ['Move', pad ? 'D-pad / stick' : ['UP', 'LEFT', 'DOWN', 'RIGHT'].map(L).join(' ')],
    ['A / B', `${L('A')} / ${L('B')}`],
    ['L / R', `${L('L')} / ${L('R')}`],
    ['Start / Select', `${L('START')} / ${L('SELECT')}`],
    [`Hold turbo (${c.settings.turboSpeed}x)`, L('TURBO')],
    [`Save state (slot ${c.settings.slot})`, L('SAVE')],
    ['Load state', L('LOAD')],
    ['Next slot', L('SLOT')],
    ['Game list', pad ? 'Select + Start' : 'Esc'],
  ];
  return html`<aside className="controls" aria-label="Controls">
    <div className="gtitle">${s.title}</div>
    <h2>Controls</h2>
    ${rows.map(([k, v]) => html`<div className="cr" key=${k}><span>${k}</span><b>${v}</b></div>`)}
  </aside>`;
}
const isTouchUI = (c) => c.settings.touch === 'on' || (c.settings.touch === 'auto' && matchMedia('(pointer: coarse)').matches);
const buzz = (ms = 8) => { try { if (GBA.getState().config.settings.vibrate && navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* not supported (iPhone) */ } };

/* One press button: pointer capture keeps a held button held even if the thumb drifts. */
function PBtn({ k, label, cls }) {
  const bit = GBA.BTN[k];
  const up = (e) => { e.currentTarget.classList.remove('down'); GBA.touchSet(bit, false); };
  return html`<button type="button" className=${cls} aria-label=${k}
    onPointerDown=${(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.classList.add('down'); GBA.touchSet(bit, true); buzz(); }}
    onPointerUp=${up} onPointerCancel=${up} onLostPointerCapture=${up} onContextMenu=${(e) => e.preventDefault()}>${label}</button>`;
}
/* The classic cross, but ONE touch surface: slide your thumb across it, or press between arms for a diagonal. */
function Dpad() {
  const ref = useRef(), bits = useRef(0), ptr = useRef(null), [dir, setDir] = useState(0);
  const B = GBA.BTN, DIRS = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
  const apply = (e) => {
    const r = ref.current.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), d = Math.hypot(dx, dy);
    let b = 0;
    if (d > r.width * 0.12) {                       // small dead zone in the middle
      const ax = Math.abs(dx) / d, ay = Math.abs(dy) / d;
      if (ax > 0.38) b |= dx > 0 ? B.RIGHT : B.LEFT;   // within ~22 degrees of an axis = straight, otherwise diagonal
      if (ay > 0.38) b |= dy > 0 ? B.DOWN : B.UP;
    }
    if (b === bits.current) return;
    for (const k of DIRS) if ((b & B[k]) !== (bits.current & B[k])) GBA.touchSet(B[k], !!(b & B[k]));
    if (b & ~bits.current) buzz(6);
    bits.current = b; setDir(b);
  };
  const end = (e) => { if (ptr.current !== null && e && e.pointerId !== undefined && e.pointerId !== ptr.current) return; ptr.current = null; for (const k of DIRS) GBA.touchSet(B[k], false); bits.current = 0; setDir(0); };
  const arm = (m) => (dir & m ? 'on' : '');
  return html`<div className="dpad" ref=${ref} aria-label="D-pad"
    onPointerDown=${(e) => { if (ptr.current !== null) return; e.preventDefault(); ptr.current = e.pointerId; ref.current.setPointerCapture(e.pointerId); apply(e); }}
    onPointerMove=${(e) => { if (e.pointerId === ptr.current) apply(e); }}
    onPointerUp=${end} onPointerCancel=${end} onLostPointerCapture=${end} onContextMenu=${(e) => e.preventDefault()}>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <polygon className="cross" points="33,1 67,1 67,33 99,33 99,67 67,67 67,99 33,99 33,67 1,67 1,33 33,33" />
      <path className=${'hl ' + arm(B.UP)} d="M33 1h34v32H33z" /><path className=${'hl ' + arm(B.DOWN)} d="M33 67h34v32H33z" />
      <path className=${'hl ' + arm(B.LEFT)} d="M1 33h32v34H1z" /><path className=${'hl ' + arm(B.RIGHT)} d="M67 33h32v34H67z" />
      <path className=${'tri ' + arm(B.UP)} d="M50 9l9 13H41z" /><path className=${'tri ' + arm(B.DOWN)} d="M50 91l9-13H41z" />
      <path className=${'tri ' + arm(B.LEFT)} d="M9 50l13-9v18z" /><path className=${'tri ' + arm(B.RIGHT)} d="M91 50l-13-9v18z" />
    </svg></div>`;
}
function TouchUI() {
  return html`<div className="touch">
    <${PBtn} k="L" label="L" cls="L" /><${PBtn} k="R" label="R" cls="R" />
    <div className="pad"><${Dpad} />
      <div className="mid"><${PBtn} k="SELECT" label="Select" cls="sel" /><${PBtn} k="START" label="Start" cls="sta" /></div>
      <div className="face"><${PBtn} k="B" label="B" cls="B" /><${PBtn} k="A" label="A" cls="A" /></div></div></div>`;
}
function TB({ icon, label, sub, onClick, on, cls = '', color }) {
  return html`<button type="button" className=${'tbb ' + cls + (on ? ' on' : '')} style=${{ '--c': color }} aria-label=${label} aria-pressed=${on === undefined ? undefined : !!on}
    onClick=${() => { buzz(12); onClick(); }}><${Icon} n=${icon} size=${22} /><span>${label}${sub ? html`<em>${sub}</em>` : ''}</span></button>`;
}
function Toolbar({ s, onSettings }) {
  const c = s.config.settings;
  return html`<div className="tb" role="toolbar" aria-label="Quick actions">
    <${TB} icon="shot" label="Screenshot" color="#ff9f43" onClick=${() => GBA.screenshot()} />
    <${TB} icon="turbo" label="Turbo" sub=${s.turbo ? ` ${c.turboSpeed}x` : ''} color="#ffd84a" on=${s.turbo} onClick=${() => GBA.setTurbo(!s.turbo)} />
    <${TB} icon="gear" label="Settings" cls="gearp" color="#d6d6e6" onClick=${onSettings} />
    <${TB} icon="save" label=${'Save ' + c.slot} color="#3ddc84" onClick=${() => GBA.saveState()} />
    <${TB} icon="load" label=${'Load ' + c.slot} color="#4aa8ff" onClick=${() => GBA.loadState()} />
  </div>`;
}
function Topbar({ s, onGames }) {
  const c = s.config.settings;
  return html`<div className="topbar"><button type="button" className="gamesbtn" onClick=${onGames} aria-label="Games"><${Icon} n="grid" size=${18} /> Games</button>
    <span className="stat">${s.paused ? 'Paused \u00B7 ' : ''}${s.fps} fps \u00B7 slot ${c.slot}${s.turbo ? ` \u00B7 turbo ${c.turboSpeed}x` : ''}</span><span className="sp" /></div>`;
}
function Stage({ s, touch, onGames, onSettings }) {
  const ref = useRef();
  useEffect(() => GBA.attachCanvas(ref.current), []);
  const { filter, scale, glow, turboSpeed, slot, toolbar } = s.config.settings;
  const w = scale === 'fit' ? 'min(94cqw, calc((100vh - 130px) * 1.5))' : `min(94cqw, ${240 * +scale}px)`;
  const bar = touch && html`<${Toolbar} s=${s} onSettings=${onSettings} />`;
  return html`
    <main className=${'stage' + (s.running ? ' live' : '') + (s.paused ? ' paused' : '')} data-filter=${filter}>
      <div className=${'glow' + (glow ? '' : ' off')} />
      <div className="col" style=${{ '--w': w }}>
        ${toolbar === 'top' && bar}
        <div className="screenwrap">
          <div className="screen">
            <canvas ref=${ref} width="240" height="160" aria-label="Game screen" />
            <div className="lcd" />
            <div className="flash" key=${s.flash} />
          </div>
          ${touch && html`<button type="button" className="corner l" aria-label="Games" onClick=${onGames}><${Icon} n="grid" size=${18} /></button>
            <button type="button" className="corner r" aria-label="Settings" onClick=${onSettings}><${Icon} n="gear" size=${18} /></button>`}
        </div>
        ${toolbar !== 'top' && bar}
        ${!touch && html`<div className="under">${s.running ? `${s.paused ? 'Paused \u00B7 ' : ''}${s.fps} fps${s.turbo ? ` \u00B7 turbo ${turboSpeed}x` : ''} \u00B7 slot ${slot}` : '\u00A0'}</div>`}
      </div>
    </main>`;
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => !!navigator.standalone || matchMedia('(display-mode: standalone)').matches;
function IosHint() {
  const [hide, setHide] = useState(() => { try { return !!localStorage.getItem('webgba.iosHint'); } catch (e) { return false; } });
  if (hide || !isIOS() || isStandalone()) return null;
  return html`<div className="ioshint"><span>iPhone tip: tap Share, then Add to Home Screen. It hides the address bar, and Safari can clear saved data from sites you haven't opened for a week, which Home Screen apps are exempt from.</span>
    <button type="button" className="btn ghost" onClick=${() => { try { localStorage.setItem('webgba.iosHint', '1'); } catch (e) { /* ignore */ } setHide(true); }}>Got it</button></div>`;
}

/* --------------------------------------------------------------------- games (frosted glass) */
function GamesLayer({ s, onClose, onSettings }) {
  const input = useRef();
  const pick = (name) => { onClose(); GBA.openLibrary(name); };
  const n = s.library.length;
  return html`
    <div className="lib" role="dialog" aria-label="Games">
      <div className="scrim" onClick=${s.running ? onClose : undefined} />
      <section className="glass">
        <header className="gh">
          <div><h2>Games</h2><small>${n ? `${n} game${n === 1 ? '' : 's'}` : 'WebGBA \u00B7 mGBA in your browser'}</small></div>
          <div className="gact">
            <button type="button" ...${N} className="btn" onClick=${() => input.current.click()}><${Icon} n="upload" size=${16} /> Open ROM</button>
            <button type="button" ...${N} className="btn primary" onClick=${GBA.scanFolder}><${Icon} n="folder" size=${16} /> Scan folder</button>
            <button type="button" ...${N} className="btn ghost icon" aria-label="Settings" onClick=${onSettings}><${Icon} n="gear" size=${18} /></button>
            ${s.running && html`<button type="button" ...${N} className="btn ghost icon" aria-label="Close games" onClick=${onClose}><${Icon} n="close" size=${18} /></button>`}
            <input ref=${input} type="file" accept=".gba,.agb,.bin,.mb,.zip" hidden onChange=${(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { onClose(); GBA.openFile(f); } }} />
          </div>
        </header>
        <${IosHint} />
        ${n > 0 && html`<div className="grid">${s.library.map((g, i) => {
          const cover = s.config.covers[g.name], cur = s.running && g.name === s.romName;
          return html`<div className=${'card' + (cur ? ' cur' : '')} key=${g.name} style=${{ '--h': hue(g.name), '--i': Math.min(i, 14) }}>
            <button type="button" ...${N} className="tile" aria-label=${'Play ' + cleanName(g.name)} onClick=${() => pick(g.name)}>
              <div className=${'art' + (cover ? ' has' : '')} style=${cover ? { backgroundImage: `url(${cover})` } : null}>${cover ? null : html`<span>${initials(g.name)}</span>`}${cur && html`<i className="nowp">Playing</i>`}</div>
              <div className="cn" title=${g.name}>${cleanName(g.name)}</div>
            </button>
            <button type="button" className="rm" aria-label=${'Remove ' + cleanName(g.name)} title="Remove from games" onClick=${() => { if (confirm(`Remove "${cleanName(g.name)}" from your games?\nYour save files are kept.`)) GBA.removeGame(g.name); }}>\u00D7</button>
          </div>`; })}</div>`}
        ${n === 0 && html`<div className="empty">
          <button type="button" ...${N} className="folderbtn" onClick=${GBA.scanFolder}><${Icon} n="folder" size=${64} /><div><b>Scan folder</b><span>Pick the folder where your .gba games live</span></div></button>
          <p>or <button type="button" className="link" onClick=${() => input.current.click()}>open a single ROM</button>, or just drop one here. Opened games are saved to this list.</p>
        </div>`}
        ${s.busy && html`<div className="busyv"><i /><span>${s.busy}</span></div>`}
      </section>
    </div>`;
}

/* ------------------------------------------------------------------------------- settings */
function SlotCard({ n, s }) {
  const m = (s.config.meta[s.id] || {})[n], cur = s.config.settings.slot === n;
  return html`<div className=${'slot' + (cur ? ' cur' : '')}><div className="thumb" style=${m ? { backgroundImage: `url(${m.thumb})` } : null}>${m ? '' : 'Empty'}</div>
    <div className="sm"><b>Slot ${n}${cur ? ' \u00B7 quick' : ''}</b><span>${m ? new Date(m.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span></div>
    <div className="sb"><button type="button" ...${N} disabled=${!s.running} onClick=${() => GBA.saveState(n)}>Save</button>
    <button type="button" ...${N} disabled=${!m || !s.running} onClick=${() => GBA.loadState(n)}>Load</button></div></div>`;
}
function GameTab({ s }) {
  const [txt, setTxt] = useState(''), sav = useRef();
  useEffect(() => setTxt(s.config.cheats[s.id] || ''), [s.id]);
  return html`<div>
    <div className="btnrow first">
      <button type="button" ...${N} className="btn" disabled=${!s.running} onClick=${GBA.togglePause}>${s.paused ? 'Resume' : 'Pause'}</button>
      <button type="button" ...${N} className="btn" disabled=${!s.running} onClick=${GBA.reset}>Reset</button>
      <button type="button" ...${N} className=${'btn' + (s.turbo ? ' primary' : '')} disabled=${!s.running} onClick=${() => GBA.setTurbo(!s.turbo)}>Turbo lock</button>
      <button type="button" ...${N} className="btn" disabled=${!s.running} onClick=${GBA.screenshot}>Screenshot</button>
      <button type="button" ...${N} className="btn" onClick=${GBA.fullscreen}>Fullscreen</button></div>
    <h3>Save states</h3>
    <div className="slots">${[1, 2, 3, 4].map((n) => html`<${SlotCard} key=${n} n=${n} s=${s} />`)}</div>
    <${Field} label="Quick slot (Save / Load buttons, hotkeys, controller)"><${Seg} value=${String(s.config.settings.slot)} options=${[['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]} onChange=${(v) => setS('slot', +v)} /><//>
    <p className="hint">Keys <kbd>1</kbd>-<kbd>4</kbd> load a specific slot and <kbd>Shift</kbd>+<kbd>1</kbd>-<kbd>4</kbd> save to it. Saving here never changes your quick slot.</p>
    <h3>Battery save</h3>
    <div className="btnrow"><button type="button" ...${N} className="btn" disabled=${!s.running} onClick=${GBA.exportSav}>Export .sav</button>
      <button type="button" ...${N} className="btn" disabled=${!s.running} onClick=${() => sav.current.click()}>Import .sav</button>
      <input ref=${sav} type="file" accept=".sav,.srm" hidden onChange=${(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) GBA.importSav(f); }} /></div>
    <p className="hint">Written automatically while you play. Files are compatible with mGBA desktop.</p>
    <h3>Cheats</h3>
    <textarea rows="4" spellcheck="false" value=${txt} onInput=${(e) => setTxt(e.target.value)} placeholder=${'One code per line, e.g.\n82003114 0063'} />
    <div className="btnrow"><button type="button" ...${N} className="btn" disabled=${!s.running} onClick=${() => GBA.applyCheats(txt)}>Apply codes</button></div>
  </div>`;
}

const KEYROWS = [['UP', 'Up'], ['DOWN', 'Down'], ['LEFT', 'Left'], ['RIGHT', 'Right'], ['A', 'A'], ['B', 'B'], ['L', 'L'], ['R', 'R'], ['START', 'Start'], ['SELECT', 'Select'],
  ['TURBO', 'Hold turbo'], ['SAVE', 'Quick save'], ['LOAD', 'Quick load'], ['SLOT', 'Next slot'], ['PAUSE', 'Pause']];
const PADROWS = [['A', 'A'], ['B', 'B'], ['L', 'L'], ['R', 'R'], ['START', 'Start'], ['SELECT', 'Select'], ['TURBO', 'Hold turbo'], ['SAVE', 'Quick save'], ['LOAD', 'Quick load'], ['SLOT', 'Next slot'], ['PAUSE', 'Pause']];
function KeyRow({ action, label, code }) {
  const [listen, setListen] = useState(false);
  useEffect(() => {
    if (!listen) return;
    const on = (e) => { e.preventDefault(); e.stopImmediatePropagation(); if (e.code !== 'Escape') GBA.bindKey(action, e.code); setListen(false); };
    addEventListener('keydown', on, true);
    return () => removeEventListener('keydown', on, true);
  }, [listen]);
  return html`<div className="krow"><span>${label}</span>
    <button type="button" className=${'key' + (listen ? ' listen' : '')} onClick=${() => setListen(true)} onBlur=${() => setListen(false)}>${listen ? 'Press a key...' : keyLabel(code)}</button></div>`;
}
function PadRow({ action, label, s }) {
  const on = s.padListening === action;
  return html`<div className="krow"><span>${label}</span>
    <button type="button" ...${N} className=${'key' + (on ? ' listen' : '')} onClick=${() => (on ? GBA.cancelListenPad() : GBA.listenPad(action))} onBlur=${() => on && GBA.cancelListenPad()}>${on ? 'Press a button...' : padLabel(s.config.pad[action], s.pad.family)}</button></div>`;
}
function ControlsTab({ s }) {
  const c = s.config;
  return html`<div>
    <h3>Controller</h3>
    <p className="hint first">${s.pad.connected ? html`<b>${s.pad.name.replace(/\s*\(.*\)/, '')}</b> connected.` : 'Press any button on your controller to connect it.'} The D-pad and left stick always move. Select + Start opens the game list.</p>
    <div className="keys">${PADROWS.map(([a, l]) => html`<${PadRow} key=${a} action=${a} label=${l} s=${s} />`)}</div>
    <div className="btnrow"><button type="button" ...${N} className="btn ghost" onClick=${GBA.resetPad}>Reset controller</button></div>
    <p className="hint">Pick a row, then press the button you want. A button that is already used swaps places.</p>
    <h3>Keyboard</h3>
    <div className="keys">${KEYROWS.map(([a, l]) => html`<${KeyRow} key=${a} action=${a} label=${l} code=${c.keys[a]} />`)}</div>
    <div className="btnrow"><button type="button" className="btn ghost" onClick=${GBA.resetKeys}>Reset keyboard</button></div>
    <p className="hint"><kbd>Esc</kbd> opens the game list. Press a key then the new one; Esc cancels.</p>
    <h3>Touch</h3>
    <${Field} label="On-screen controls"><${Seg} value=${c.settings.touch} options=${[['auto', 'Auto'], ['on', 'Always'], ['off', 'Never']]} onChange=${(v) => setS('touch', v)} /><//>
    ${isTouchUI(c) && html`<div>
      <${Field} label="Screenshot / Turbo / Save / Load row"><${Seg} value=${c.settings.toolbar} options=${[['middle', 'Under the screen'], ['top', 'Above the screen']]} onChange=${(v) => setS('toolbar', v)} /><//>
      <${Field} label="Button size"><${Seg} value=${c.settings.btnSize} options=${[['normal', 'Normal'], ['large', 'Large']]} onChange=${(v) => setS('btnSize', v)} /><//>
      <${Field} label="Game screen"><${Seg} value=${c.settings.screenFit} options=${[['fit', 'True shape'], ['stretch', 'Stretch to fill']]} onChange=${(v) => setS('screenFit', v)} /><//>
      ${navigator.vibrate && html`<${Toggle} label="Vibrate on tap" on=${c.settings.vibrate} onChange=${(v) => setS('vibrate', v)} />`}
    </div>`}
  </div>`;
}
function DisplayTab({ s }) {
  const c = s.config.settings, bios = useRef();
  return html`<div>
    <h3>Display</h3>
    <${Field} label="Screen filter"><${Seg} value=${c.filter} options=${[['sharp', 'Sharp'], ['smooth', 'Smooth'], ['lcd', 'LCD']]} onChange=${(v) => setS('filter', v)} /><//>
    <${Field} label="Screen size"><${Seg} value=${c.scale} options=${[['fit', 'Fit'], ['2', '2x'], ['3', '3x'], ['4', '4x'], ['5', '5x']]} onChange=${(v) => setS('scale', v)} /><//>
    <${Toggle} label="Ambient glow" hint="Soft light behind the screen that follows the game's colors" on=${c.glow} onChange=${(v) => setS('glow', v)} />
    <h3>Audio</h3>
    <${Field} label="Volume" value=${c.vol + '%'}><input ...${N} type="range" min="0" max="100" value=${c.vol} onInput=${(e) => setS('vol', +e.target.value)} /><//>
    <h3>Turbo</h3>
    <${Field} label="Turbo speed" value=${c.turboSpeed + 'x'}><input ...${N} type="range" min="2" max="16" step="1" value=${c.turboSpeed} onInput=${(e) => setS('turboSpeed', +e.target.value)} /><//>
    <${Field} label="Turbo sound"><${Seg} value=${c.turboAudio} options=${[['fast', 'Sped up'], ['mute', 'Muted']]} onChange=${(v) => setS('turboAudio', v)} /><//>
    <h3>Behavior</h3>
    <${Toggle} label="Pause when tab is hidden" on=${c.pauseHidden} onChange=${(v) => setS('pauseHidden', v)} />
    <${Field} label="BIOS (optional)"><div className="btnrow tight">
      <button type="button" ...${N} className="btn" onClick=${() => bios.current.click()}>${s.bios ? 'Replace BIOS' : 'Load BIOS'}</button>
      ${s.bios && html`<button type="button" ...${N} className="btn ghost" onClick=${GBA.clearBios}>Remove</button>`}
      <input ref=${bios} type="file" accept=".bin,.rom,.gba" hidden onChange=${(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) GBA.setBios(f); }} /></div>
      <small>${s.bios ? 'BIOS stored; used the next time a game loads.' : "Not needed: mGBA's built-in replacement is used."}</small><//>
  </div>`;
}
function BackupTab({ s }) {
  const [roms, setRoms] = useState(true), file = useRef();
  return html`<div>
    <h3>Where your stuff lives</h3>
    <p className="hint big first">${s.serverMode
      ? html`Settings, saves and states are files in the server's <code>data/</code> folder, and your games are in <code>roms/</code>. Copy those two folders to move everything to another PC.`
      : 'Settings, saves, states and your games are stored in this browser only. Clearing site data would delete them, so make a backup.'}</p>
    <h3>Backup file</h3>
    <p className="hint first">One zip with your settings, controller and key bindings, cheats, battery saves and save states, optionally with your games.</p>
    <${Toggle} label="Include games" hint=${`${s.library.length} game${s.library.length === 1 ? '' : 's'} (can be large)`} on=${roms} onChange=${setRoms} />
    <div className="btnrow">
      <button type="button" ...${N} className="btn primary" disabled=${!!s.busy} onClick=${() => GBA.exportBackup({ roms })}>Export backup</button>
      <button type="button" ...${N} className="btn" disabled=${!!s.busy} onClick=${() => file.current.click()}>Import backup</button>
      <input ref=${file} type="file" accept=".zip" hidden onChange=${(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) GBA.importBackup(f); }} /></div>
    ${s.busy && html`<div className="busy"><i /><span>${s.busy}</span></div>`}
    <p className="hint">Importing merges into what you have: matching saves and states are overwritten, settings are replaced.</p>
  </div>`;
}
function Drawer({ open, tab, setTab, onClose, s }) {
  const i = TABS.findIndex((t) => t[0] === tab);
  const Body = { game: GameTab, controls: ControlsTab, display: DisplayTab, backup: BackupTab }[tab];
  return html`
    <aside className=${'drawer' + (open ? ' open' : '')} aria-label="Settings" inert=${open ? undefined : ''}>
      <header><h2>Settings</h2><button type="button" className="iconbtn" aria-label="Close settings" onClick=${onClose}><${Icon} n="close" size=${18} /></button></header>
      <div className="tabs" role="tablist"><i className="ind" style=${{ transform: `translateX(${i * 100}%)` }} />
        ${TABS.map(([k, l]) => html`<button type="button" key=${k} role="tab" aria-selected=${k === tab} onClick=${() => setTab(k)}>${l}</button>`)}</div>
      <div className="dbody" key=${tab}><${Body} s=${s} /></div>
    </aside>`;
}

/* -------------------------------------------------------------------------------------- app */
function App() {
  const s = useG();
  const [tab, setTab] = useState(null), [lib, setLib] = useState(false), [idle, setIdle] = useState(false);
  const showLib = lib || !s.running;
  const ui = useRef({}); ui.current = { tab, setTab, setLib, running: s.running };

  useEffect(() => {   // text and gear fade back while you play
    let t; const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 5000); };
    wake(); const ev = ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'webgba-activity'];
    ev.forEach((e) => addEventListener(e, wake, { passive: true }));
    return () => { clearTimeout(t); ev.forEach((e) => removeEventListener(e, wake)); };
  }, []);
  useEffect(() => { if (s.running) GBA.setOverlay(showLib); }, [showLib, s.running]);
  useEffect(() => { if (s.running && lib) setLib(false); }, [s.id, s.romName]);

  // Select + Start (controller or Enter+Backspace) toggles the game list; Esc does too
  useEffect(() => {
    GBA.setMenu(() => { const u = ui.current; if (u.tab) u.setTab(null); else if (u.running) u.setLib((l) => !l); });
    return () => GBA.setMenu(null);
  }, []);
  useEffect(() => {
    GBA.setNav(showLib || !!tab, (type) => navEvent(type, ui.current));
    return () => GBA.setNav(false, null);
  }, [showLib, tab]);
  useEffect(() => {
    if (!(showLib || tab) || s.input === 'mouse') return;
    const t = setTimeout(() => focusFirst(ui.current), 90); return () => clearTimeout(t);
  }, [showLib, tab]);
  useEffect(() => {
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const on = (e) => {
      if (/^(TEXTAREA)$/.test(e.target.tagName)) return;
      const u = ui.current;
      if (e.code === 'Escape') { e.preventDefault(); if (u.tab) u.setTab(null); else if (u.running) u.setLib((l) => !l); return; }
      if ((u.tab || document.querySelector('.glass')) && map[e.code]) { e.preventDefault(); navEvent(map[e.code], u); }
    };
    addEventListener('keydown', on); return () => removeEventListener('keydown', on);
  }, []);

  const touchOn = isTouchUI(s.config);
  const openGames = () => { setTab(null); setLib(true); }, toggleSettings = () => setTab(tab ? null : 'game');
  const calm = idle && s.running && !showLib && !tab;
  return html`
    <div className=${'app' + (s.running ? ' playing' : '') + (calm ? ' calm' : '') + (touchOn ? ' touchon' : '') + (touchOn && s.config.settings.btnSize === 'large' ? ' large' : '') + (touchOn && s.config.settings.screenFit === 'stretch' ? ' stretch' : '') + (tab ? ' side' : '')} data-input=${s.input}>
      <${Stage} s=${s} touch=${touchOn} onGames=${openGames} onSettings=${toggleSettings} />
      ${s.running && !touchOn && html`<${ControlsList} s=${s} />`}
      ${touchOn && s.running && html`<${Topbar} s=${s} onGames=${openGames} />`}
      ${touchOn && s.running && !showLib && html`<${TouchUI} />`}
      <button type="button" className="gear" aria-label="Settings" title="Settings" onClick=${() => setTab(tab ? null : 'game')}><${Icon} n="gear" size=${20} /></button>
      <${Drawer} open=${!!tab} tab=${tab || 'game'} setTab=${setTab} onClose=${() => setTab(null)} s=${s} />
      ${showLib && html`<${GamesLayer} s=${s} onClose=${() => setLib(false)} onSettings=${() => setTab('game')} />`}
      ${s.dragging && html`<div className="dropveil"><p>Drop to play</p></div>`}
      ${!s.ready && html`<div className="loading">Starting emulator...</div>`}
      ${s.toast && html`<div className=${'toast' + (s.toast.action ? ' act' : '')} key=${s.toast.id} role="status" style=${s.toast.action ? { animationDuration: '6s' } : null}><span>${s.toast.msg}</span>${s.toast.action && html`<button type="button" className="tact" onClick=${() => { const a = s.toast.action; GBA.dismissToast(); a.fn(); }}>${s.toast.action.label}</button>`}</div>`}
    </div>`;
}
ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`);
})();
