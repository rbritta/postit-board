/**
 * postit-board: a glass board of sticky notes with a color legend.
 *
 *   const board = createBoard(element, { legend, notes, auto, store });
 *   board.update({ notes, auto });   // after your data changes
 *   board.destroy();
 *
 * Right-click the glass for a menu of note types: the new note starts where you clicked.
 * Right-click a note to change its type. The gear at the end of the legend edits the types
 * (name, meaning, color) and saves them through `store.saveLegend`.
 *
 * Two kinds of notes live together:
 *   - notes people write (`notes`): editable, a ✓ marks them done;
 *   - automatic notes your app computes (`auto`): folded corner, read-only, they go away
 *     when your app stops sending them. Only their position is stored, by `key`.
 *
 * Drag either bottom corner of the glass to resize the board: it stays centered and the size is
 * saved through `store.saveSize` (the gear can lock it). By default it takes 80% of the width.
 *
 * Long text ends in "…". Click a note to read it whole in the center of the screen (option
 * `expand`: 'center', 'inplace' grows it on hover, 'more' adds a link); people pick in the gear.
 * Every way animates (`--pb-motion-in`, `--pb-motion-out`), and none does with reduced motion.
 *
 * Works under a strict Content-Security-Policy: no inline style attributes or handlers, no eval.
 * Colors and positions are custom properties set through the CSSOM.
 *
 * The board never talks to a server by itself: every change goes through `store`
 * (see `restStore` for the matching HTTP client, and `server/` for the Node side).
 */
import {
  DEFAULT_COLORS, SIZE, EXPAND, normalizeSize, normalizeView, autoPlace, boardHeight, dueStatus, escapeHtml, formatDue, fromLocalInput, legendColors,
  linkify, mergeLegend, normalizeLegend, normalizeNote, refId, refOf, safeUrl, tilt, toLocalInput, withPositions,
} from './core.js';

export * from './core.js';

export const DEFAULT_STRINGS = Object.freeze({
  add: '+ Note',
  empty: 'Nothing on the board.',
  hint: 'Drag notes around · folded corners are added and removed by the app',
  open: 'Open →',
  edit: 'Edit',
  done: 'Done',
  newNote: 'New note',
  editNote: 'Note',
  title: 'Title',
  text: 'Text',
  color: 'Color',
  due: 'Due',
  link: 'Link',
  linkLabel: 'Link label',
  image: 'Image URL',
  save: 'Save',
  cancel: 'Cancel',
  remove: 'Delete',
  legend: 'Legend',
  filter: 'Show only this color',
  today: 'Today',
  tomorrow: 'Tomorrow',
  yesterday: 'Yesterday',
  failed: 'Could not save',
  menuNew: 'New note here',
  menuColor: 'Change type',
  settings: 'Note types',
  settingsHint: 'Each color is a type of note. Rename it, say what it means or pick another color. Notes keep their type.',
  addType: '+ Type',
  typeName: 'Name',
  typeMeaning: 'Meaning',
  typeColor: 'Color',
  moveUp: 'Move up',
  removeType: 'Remove type',
  locked: 'Set by the app: rename only',
  resize: 'Drag to resize the board · double-click to reset',
  lockSize: 'Lock the board size',
  expand: 'Long text',
  expandCenter: 'Click opens the note in the center of the screen',
  expandInplace: 'The note grows in place on hover',
  expandMore: 'A "more" link on notes with cut text',
  more: 'more ▾',
  less: 'less ▴',
  close: 'Close',
});

const DEFAULTS = {
  legend: [],
  notes: [],
  auto: [],
  positions: {},
  colors: {},
  strings: {},
  locale: undefined,
  store: null,
  addButton: true,
  contextMenu: true,
  editLegend: null,
  defaultColor: null,
  gridBelow: 700,
  resizable: true,
  width: SIZE.width,
  size: null,
  expand: 'center',
  view: null,
  onError: (err) => console.error('[postit-board]', err),
  now: () => new Date(),
};

/** How long a transition takes (ms) when the stylesheet does not say (--pb-motion-in, --pb-motion-out). */
const MOTION = Object.freeze({ in: 240, out: 180 });
/** What arrives slows down at the end; what leaves goes a little faster and eases at both ends. */
const EASE = Object.freeze({ in: 'cubic-bezier(0.2, 0, 0, 1)', out: 'cubic-bezier(0.4, 0, 0.2, 1)' });
/** What `save` returns when the store failed (it already reported the error). */
const FAILED = Symbol('failed');

let uid = 0;

/** A fetch-based store for the routes in `server/http-handler.js`. */
export function restStore(base, { headers = {}, fetch: doFetch = globalThis.fetch.bind(globalThis) } = {}) {
  const root = base.replace(/\/$/, '');
  const call = async (method, path, body) => {
    const res = await doFetch(root + path, {
      method,
      headers: { 'content-type': 'application/json', ...(typeof headers === 'function' ? headers() : headers) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${method} ${path}: ${res.status}`);
    return data;
  };
  return {
    load: () => call('GET', ''),
    create: (draft) => call('POST', '', draft),
    update: (ref, patch) =>
      ref.key != null ? call('PUT', `/key/${encodeURIComponent(ref.key)}`, patch) : call('PATCH', `/${encodeURIComponent(ref.id)}`, patch),
    saveLegend: (legend) => call('PUT', '/legend', { legend }),
    saveSize: (size) => call('PUT', '/size', { size }),
    saveView: (view) => call('PUT', '/view', { view }),
  };
}

/** A store in localStorage: for demos, prototypes and boards that live in one browser. */
export function localStore(name = 'postit-board', storage = globalThis.localStorage) {
  const read = () => {
    try { return { notes: [], positions: {}, next: 1, ...JSON.parse(storage.getItem(name) || '{}') }; } catch { return { notes: [], positions: {}, next: 1 }; }
  };
  const write = (data) => storage.setItem(name, JSON.stringify(data));
  const stamp = () => new Date().toISOString();
  return {
    load: () => {
      const d = read();
      return { notes: d.notes.filter((n) => !n.doneAt), positions: d.positions, ...(d.legend ? { legend: d.legend } : {}), ...(d.size ? { size: d.size } : {}), ...(d.view ? { view: d.view } : {}) };
    },
    saveSize(size) {
      const d = read();
      d.size = normalizeSize(size);
      write(d);
      return { size: d.size };
    },
    saveView(view) {
      const d = read();
      d.view = normalizeView(view);
      write(d);
      return { view: d.view };
    },
    saveLegend(legend) {
      const d = read();
      d.legend = normalizeLegend(legend);
      write(d);
      return { legend: d.legend };
    },
    create(draft = {}) {
      const d = read();
      const at = stamp();
      const note = { ...normalizeNote({ ...draft, id: d.next }), meta: draft.meta ?? null, createdAt: at, updatedAt: at, doneAt: null };
      d.notes.push(note);
      d.next += 1;
      write(d);
      return note;
    },
    update(ref, patch = {}) {
      const d = read();
      if (ref.key != null) {
        const pos = { ...d.positions[ref.key] };
        for (const k of ['x', 'y', 'z']) if (patch[k] !== undefined) pos[k] = patch[k];
        d.positions[ref.key] = pos;
        write(d);
        return { key: ref.key, ...d.positions[ref.key] };
      }
      const i = d.notes.findIndex((n) => n.id === ref.id);
      if (i < 0) throw new Error('note not found');
      if (patch.removed) { d.notes.splice(i, 1); write(d); return null; }
      const { done, removed: _removed, ...fields } = patch;
      const before = d.notes[i];
      const at = stamp();
      // the fields the board knows are normalized; createdAt and meta stay as they were unless the patch has them
      d.notes[i] = {
        ...before,
        ...normalizeNote({ ...before, ...fields }),
        ...(fields.meta !== undefined ? { meta: fields.meta } : {}),
        updatedAt: at,
        doneAt: done === true ? at : done === false ? null : before.doneAt ?? null,
      };
      write(d);
      return d.notes[i];
    },
  };
}

export function createBoard(root, options = {}) {
  if (!root) throw new Error('createBoard needs an element');
  const id = `pb${++uid}`;
  let opts = { ...DEFAULTS, ...options };
  let t = { ...DEFAULT_STRINGS, ...opts.strings };
  let appLegend = opts.legend; // what the app ships; opts.legend is that plus what people saved
  let savedLegend = null;
  let colors;
  const baseColors = () => ({ ...DEFAULT_COLORS, ...opts.colors });
  function applyLegend() {
    opts.legend = mergeLegend(appLegend, savedLegend);
    colors = { ...baseColors(), ...legendColors(opts.legend) };
  }
  applyLegend();
  const canEditLegend = () => opts.editLegend ?? Boolean(opts.store?.saveLegend);
  const locale = () => opts.locale || globalThis.navigator?.language || 'en';
  let notes = [];
  let auto = [];
  let rawAuto = [];
  let positions = { ...opts.positions };
  let size = normalizeSize(opts.size);
  let view = normalizeView(opts.view);
  const expand = () => view.expand || (EXPAND.includes(opts.expand) ? opts.expand : 'center');
  const opened = new Set(); // notes opened in place by a tap or the "more" link: they stay open across renders
  let hoverRef = null; // the note under the mouse, which grows in place in the 'inplace' mode
  const hidden = new Set();
  let drag = null;
  let dragged = false;
  let sizing = null;
  let pendingRender = false; // data that came in during a drag or a resize, drawn when it ends
  let destroyed = false;
  let shown = null; // the open dialog: { kind, ref, note, returnTo, anims, closing }
  let downOnBackdrop = false;
  let lastGrid = null;

  root.classList.add('pb');
  root.innerHTML = `
    <div class="pb-bar"></div>
    <div class="pb-stage">
      <div class="pb-glass" role="list"></div>
      <span class="pb-resize pb-resize--left" data-side="-1" aria-hidden="true"></span>
      <span class="pb-resize pb-resize--right" data-side="1" aria-hidden="true"></span>
    </div>
    <footer class="pb-legend" role="group"></footer>
    <div class="pb-menu" role="menu" hidden></div>
    <dialog class="pb-dialog" aria-labelledby="${id}-h"></dialog>`;
  const bar = root.querySelector('.pb-bar');
  const glass = root.querySelector('.pb-glass');
  const stage = root.querySelector('.pb-stage');
  const legendEl = root.querySelector('.pb-legend');
  const menu = root.querySelector('.pb-menu');
  const dialog = root.querySelector('.pb-dialog');
  let menuAt = null; // { x, y } on the glass, or null in the phone grid
  let menuNote = null;
  let menuReturn = null;

  const isGrid = () => root.clientWidth > 0 && root.clientWidth < opts.gridBelow;
  const all = () => [...auto, ...notes];
  const find = (ref) => all().find((n) => refId(refOf(n)) === ref);
  const noteEl = (ref) => (ref ? glass.querySelector(`.pb-note[data-ref="${CSS.escape(ref)}"]`) : null);
  const fail = (err) => { opts.onError(err); root.dispatchEvent(new CustomEvent('postit-error', { detail: err })); };
  const topZ = () => Math.max(0, ...all().map((n) => n.z || 0));

  /* ---------- motion ---------- */
  const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  /** How long a transition takes, in ms: 0 with reduced motion (or without the Web Animations API). */
  function duration(kind) {
    if (reduceMotion?.matches || typeof root.animate !== 'function') return 0;
    const raw = getComputedStyle(root).getPropertyValue(`--pb-motion-${kind}`).trim();
    const ms = /ms$/i.test(raw) ? parseFloat(raw) : /s$/i.test(raw) ? parseFloat(raw) * 1000 : NaN;
    return Number.isFinite(ms) ? Math.max(0, ms) : MOTION[kind];
  }

  function setData({ notes: n = notes, auto: a, positions: p } = {}) {
    if (p) positions = { ...positions, ...p };
    if (n !== notes) notes = (n || []).map((x) => normalizeNote(x));
    if (a !== undefined) rawAuto = a || [];
    // automatic notes are rebuilt from what the app sent plus the saved positions, never from a past layout
    auto = withPositions(rawAuto.map((x) => normalizeNote(x, { auto: true })), positions);
  }

  /* ---------- drawing ---------- */
  const linkHtml = (n) => (n.link
    ? `<a class="pb-link" href="${escapeHtml(n.link)}"${/^https?:/i.test(n.link) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(n.linkLabel || (n.auto ? t.open : n.link))}</a>`
    : '');
  const dueHtml = (n, now = opts.now()) => (n.due
    ? `<time class="pb-due pb-due--${dueStatus(n.due, now)}" datetime="${escapeHtml(n.due)}">${escapeHtml(formatDue(n.due, { locale: locale(), now, words: t }))}</time>`
    : '');
  const swatchHtml = (color) => `<span class="pb-swatch" data-swatch="${escapeHtml(color)}"></span>`;

  function noteHtml(n) {
    const link = linkHtml(n);
    const tools = n.auto
      ? ''
      : `<span class="pb-tools"><button type="button" class="pb-icon" data-pb="edit" title="${escapeHtml(t.edit)}" aria-label="${escapeHtml(t.edit)}">✎</button><button type="button" class="pb-icon" data-pb="done" title="${escapeHtml(t.done)}" aria-label="${escapeHtml(t.done)}">✓</button></span>`;
    return `<article class="pb-note${n.auto ? ' pb-note--auto' : ''}${hidden.has(n.color) ? ' pb-note--hidden' : ''}" role="listitem" tabindex="0"
        data-ref="${escapeHtml(refId(refOf(n)))}" data-color="${escapeHtml(n.color)}">
      <span class="pb-tape" aria-hidden="true"></span>
      ${n.title ? `<h3 class="pb-title" title="${escapeHtml(n.title)}">${escapeHtml(n.title)}</h3>` : ''}
      ${n.image ? `<img class="pb-img" src="${escapeHtml(n.image)}" alt="" loading="lazy" draggable="false">` : ''}
      ${n.text ? `<p class="pb-text" title="${escapeHtml(n.text)}">${linkify(n.text)}</p>` : ''}
      ${link && !n.auto ? `<p class="pb-linkrow">${link}</p>` : ''}
      <div class="pb-foot">${dueHtml(n)}<span class="pb-spacer"></span>${n.auto ? link : ''}${tools}</div>
    </article>`;
  }

  /** Position, layer, tilt and color, through the CSSOM: a strict CSP drops style attributes in markup. */
  function paintNote(el, n) {
    el.style.setProperty('--pb-x', n.x ?? 0);
    el.style.setProperty('--pb-y', `${n.y ?? 0}px`);
    el.style.setProperty('--pb-z', n.z || 0);
    el.style.setProperty('--pb-r', `${tilt(refId(refOf(n)))}deg`);
    el.style.setProperty('--pb-note', colors[n.color] || colors.yellow);
  }
  function paintSwatches(container) {
    for (const el of container.querySelectorAll('[data-swatch]')) el.style.setProperty('--pb-note', colors[el.dataset.swatch] || el.dataset.swatch);
  }

  function render() {
    if (destroyed) return;
    pendingRender = false;
    // a redraw replaces the notes and the legend: the focus moves to their new copies
    const active = document.activeElement;
    const refocus = active && root.contains(active) && !dialog.contains(active) && !menu.contains(active) ? focusTarget(active) : null;
    const grid = isGrid();
    lastGrid = grid;
    // placed in the same objects: callbacks keep references to them. In the phone grid nothing is
    // placed, so the notes nobody moved still flow into columns when the window gets wider.
    const list = all();
    const flowing = list.filter((n) => n.x === null || n.y === null);
    if (!grid) autoPlace(list).forEach((p, i) => { list[i].x = p.x; list[i].y = p.y; });
    glass.style.setProperty('--pb-height', `${boardHeight(list)}px`);
    glass.innerHTML = list.length ? list.map(noteHtml).join('') : `<p class="pb-empty">${escapeHtml(t.empty)}</p>`;
    // a list holds list items only: the empty message is not one
    if (list.length) glass.setAttribute('role', 'list'); else glass.removeAttribute('role');
    const els = glass.querySelectorAll('.pb-note');
    list.forEach((n, i) => paintNote(els[i], n));
    markCut();
    if (flowing.length && !grid) flow(flowing);
    fitHeight();
    renderLegend();
    if (shown?.kind === 'reader') noteEl(shown.ref)?.classList.add('pb-note--reading');
    if (refocus && !active.isConnected) refocus()?.focus({ preventScroll: true });
  }
  /** Draws now, or when the drag or resize going on ends (redrawing would drop the note under the pointer). */
  function requestRender() {
    if (drag || sizing) pendingRender = true; else render();
  }

  /** The bar, the corner titles and the legend label: what changes with `strings` and `addButton`. */
  function renderChrome() {
    bar.innerHTML = `<span class="pb-hint">${escapeHtml(t.hint)}</span>${opts.addButton ? `<button type="button" class="pb-btn" data-pb="add">${escapeHtml(t.add)}</button>` : ''}`;
    for (const handle of stage.querySelectorAll('.pb-resize')) handle.title = t.resize;
    legendEl.setAttribute('aria-label', t.legend);
  }

  /* ---------- long text: cut, and the three ways to read the rest ---------- */
  /** Half a line of slack: handwriting fonts draw a few pixels past their line box. */
  const isCut = (el) => [...el.querySelectorAll('.pb-title, .pb-text')]
    .some((x) => x.scrollHeight - x.clientHeight > (parseFloat(getComputedStyle(x).lineHeight) || 20) / 2);

  /**
   * Notes whose title or text is cut get pb-note--cut, and a "more" link in that mode. Every note is
   * measured first and changed after, so a board of many notes costs one layout, not one per note.
   */
  function markCut() {
    const mode = expand();
    root.dataset.expand = mode;
    const els = [...glass.querySelectorAll('.pb-note')];
    // an open note shows everything, so it keeps what it was measured as before it opened
    const cut = els.map((el) => (el.matches('.pb-note--open, .pb-note--closing') ? el.classList.contains('pb-note--cut') : isCut(el)));
    els.forEach((el, i) => {
      const ref = el.dataset.ref;
      el.classList.toggle('pb-note--cut', cut[i] || opened.has(ref));
      let more = el.querySelector('.pb-more');
      if (mode === 'more' && el.classList.contains('pb-note--cut')) {
        if (!more) {
          el.querySelector('.pb-foot').insertAdjacentHTML('beforebegin', '<button type="button" class="pb-more" data-pb="more"></button>');
          more = el.querySelector('.pb-more');
        }
        more.textContent = opened.has(ref) ? t.less : t.more;
        more.setAttribute('aria-expanded', String(opened.has(ref)));
      } else {
        more?.remove();
      }
      if (wantsOpen(el)) el.classList.add('pb-note--open');
    });
  }

  /** Should this note show its whole text: opened by a tap or "more", or hovered or keyboard-focused in place. */
  function wantsOpen(el, focused) {
    const ref = el.dataset.ref;
    if (opened.has(ref)) return true;
    if (expand() !== 'inplace' || !el.classList.contains('pb-note--cut')) return false;
    return hoverRef === ref || (focused ?? (el.matches(':focus-visible') || Boolean(el.querySelector(':focus-visible'))));
  }

  /**
   * Shows a cut note whole, or cuts it again. Line clamping can't be animated, so each part is
   * measured cut and whole and its height animated between the two. While it shrinks the text
   * stays whole (pb-note--closing) and slides under the edge; the "…" comes back at the end.
   */
  function setOpen(el, open) {
    if (!el?.isConnected || el.classList.contains('pb-note--open') === open) return;
    const parts = [...el.querySelectorAll('.pb-title, .pb-text')];
    const from = parts.map((p) => p.offsetHeight); // also halfway through a running animation
    for (const p of parts) for (const a of p.getAnimations()) a.cancel();
    el.classList.remove('pb-note--closing');
    el.classList.toggle('pb-note--open', open);
    const kind = open ? 'in' : 'out';
    const ms = duration(kind);
    const to = ms ? parts.map((p) => p.offsetHeight) : [];
    fitHeight({ ms, easing: EASE[kind] });
    if (!ms) return;
    if (!open) el.classList.add('pb-note--closing');
    const anims = parts.flatMap((p, i) => (from[i] === to[i] ? []
      : [p.animate({ height: [`${from[i]}px`, `${to[i]}px`] }, { duration: ms, easing: EASE[kind] })]));
    if (!open) Promise.all(anims.map((a) => a.finished)).then(() => el.classList.remove('pb-note--closing'), () => {});
  }

  /** The "more" link, a tap in the 'inplace' mode, or Enter on an app note: open or close it for good. */
  function toggleOpen(el) {
    const ref = el.dataset.ref;
    if (opened.has(ref)) opened.delete(ref); else opened.add(ref);
    const note = find(ref);
    if (note && opened.has(ref)) { note.z = topZ() + 1; el.style.setProperty('--pb-z', note.z); }
    const more = el.querySelector('.pb-more');
    if (more) { more.textContent = opened.has(ref) ? t.less : t.more; more.setAttribute('aria-expanded', String(opened.has(ref))); }
    setOpen(el, wantsOpen(el));
  }

  /** In the 'inplace' mode a cut note grows while the mouse is on it (touch screens tap instead). */
  function onHover(ev) {
    if (ev.pointerType !== 'mouse' || drag) return;
    const el = ev.target.closest?.('.pb-note');
    if (!el || !glass.contains(el)) return;
    const over = ev.type === 'pointerover';
    if (!over && el.contains(ev.relatedTarget)) return; // moving between the note's own parts
    const ref = el.dataset.ref;
    if (over === (hoverRef === ref)) return;
    hoverRef = over ? ref : null;
    if (expand() === 'inplace') setOpen(el, wantsOpen(el));
  }
  /** ...and while it has the keyboard focus. */
  function onFocusMove(ev) {
    if (expand() !== 'inplace') return;
    const el = ev.target.closest?.('.pb-note');
    if (!el || !glass.contains(el)) return;
    if (ev.type === 'focusout' && el.contains(ev.relatedTarget)) return;
    setOpen(el, wantsOpen(el, ev.type === 'focusin' && ev.target.matches(':focus-visible')));
  }

  /* ---------- the reader: a note read whole, big, in the center of the screen ---------- */
  function readerHtml(note) {
    return `<article class="pb-reader" tabindex="-1">
      <button type="button" class="pb-reader-close" data-pb="reader-close" aria-label="${escapeHtml(t.close)}">×</button>
      ${note.title ? `<h2 id="${id}-h" class="pb-reader-title">${escapeHtml(note.title)}</h2>` : ''}
      ${note.image ? `<img class="pb-reader-img" src="${escapeHtml(note.image)}" alt="">` : ''}
      ${note.text ? `<p class="pb-reader-text">${linkify(note.text)}</p>` : ''}
      <div class="pb-reader-foot">${dueHtml(note)}<span class="pb-spacer"></span>${linkHtml(note)}
        ${note.auto ? '' : `<span class="pb-tools"><button type="button" class="pb-btn" data-pb="reader-edit">${escapeHtml(t.edit)}</button><button type="button" class="pb-btn" data-pb="reader-done">${escapeHtml(t.done)}</button></span>`}</div>
    </article>`;
  }

  function openReader(note) {
    const ref = refId(refOf(note));
    const source = noteEl(ref);
    const from = shapeOf(source);
    showDialog('reader', readerHtml(note), { ref, label: note.title ? null : t.editNote, returnTo: () => noteEl(ref) });
    shown.note = note;
    const article = dialog.querySelector('.pb-reader');
    article.style.setProperty('--pb-note', colors[note.color] || colors.yellow);
    // the note itself takes the focus: a screen reader reads it from the top, Tab reaches × first
    article.focus({ preventScroll: true });
    source?.classList.add('pb-note--reading'); // the note itself is what flies to the center
    shown.anims = animateReader(true, from);
  }

  /** Where a note is on screen (center, size, tilt), or null when it is hidden or scrolled out of sight. */
  function shapeOf(el) {
    if (!el?.isConnected) return null;
    const r = el.getBoundingClientRect();
    const g = glass.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const seen = cx > Math.max(0, g.left) && cx < Math.min(innerWidth, g.right) && cy > Math.max(0, g.top) && cy < Math.min(innerHeight, g.bottom);
    if (!r.width || !r.height || !seen) return null;
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { cx, cy, w: el.offsetWidth * Math.hypot(m.a, m.b), h: el.offsetHeight * Math.hypot(m.c, m.d), angle: (Math.atan2(m.b, m.a) * 180) / Math.PI };
  }

  /**
   * The reader grows out of its note (a FLIP: it starts with the note's place, size and tilt) and
   * its words fade in once it is almost there, so the stretch never shows. Without the note on
   * screen it fades and scales in. Closing plays the same backwards. Returns the animations.
   */
  function animateReader(opening, from) {
    const kind = opening ? 'in' : 'out';
    const ms = duration(kind);
    const article = dialog.querySelector('.pb-reader');
    if (!ms || !article) return [];
    const timing = { duration: ms, easing: EASE[kind], fill: opening ? 'none' : 'forwards' };
    const box = article.getBoundingClientRect();
    const flip = from && box.width && box.height;
    const frames = flip
      ? [{ transform: `translate(${from.cx - (box.left + box.width / 2)}px, ${from.cy - (box.top + box.height / 2)}px) rotate(${from.angle}deg) scale(${from.w / box.width}, ${from.h / box.height})` }, { transform: 'none' }]
      : [{ opacity: 0, transform: 'scale(0.94)' }, { opacity: 1, transform: 'none' }];
    if (!opening) frames.reverse();
    const anims = [article.animate(frames, timing)];
    if (flip) {
      const words = opening ? { opacity: [0, 0, 1], offset: [0, 0.4, 1] } : { opacity: [1, 0, 0], offset: [0, 0.5, 1] };
      for (const child of article.children) anims.push(child.animate(words, { ...timing, easing: 'linear' }));
    }
    return anims;
  }

  /** Plays the reader back into its note (Esc, a click outside, ×, Done), then closes it. */
  function closeReader() {
    if (shown?.kind !== 'reader') return Promise.resolve();
    if (shown.closing) return shown.closing;
    const s = shown;
    const running = (s.anims || []).filter((a) => a.playState === 'running');
    let anims = running;
    if (running.length) {
      // still opening: go back from wherever it is
      for (const a of running) { a.effect.updateTiming({ fill: 'both' }); a.reverse(); }
    } else {
      anims = animateReader(false, shapeOf(noteEl(s.ref)));
    }
    if (!anims.length) { closeDialog(); return Promise.resolve(); }
    dialog.classList.add('pb-dialog--closing');
    s.closing = Promise.all(anims.map((a) => a.finished)).catch(() => {}).then(() => { if (shown === s) closeDialog(); });
    return s.closing;
  }

  /* ---------- dialogs: the reader, the editor and the note types share one <dialog> ---------- */
  /** Where focus goes back when a dialog or the menu closes: the note it came from, or the same button. */
  function focusTarget(el) {
    if (!el || el === document.body) return null;
    const note = el.closest?.('.pb-note');
    if (note && glass.contains(note)) { const ref = note.dataset.ref; return () => noteEl(ref); }
    const btn = root.contains(el) ? el.closest('[data-pb]') : null;
    const same = btn && `[data-pb="${CSS.escape(btn.dataset.pb)}"]${btn.dataset.color ? `[data-color="${CSS.escape(btn.dataset.color)}"]` : ''}`;
    return () => (el.isConnected ? el : same ? root.querySelector(same) : null);
  }

  function showDialog(kind, html, { ref = null, label = null, returnTo } = {}) {
    closeMenu();
    // from the reader to the editor, focus still goes back to the note in the end
    const back = shown?.returnTo ?? returnTo ?? focusTarget(document.activeElement);
    if (dialog.open) dialog.close();
    endDialog({ restoreFocus: false });
    dialog.classList.toggle('pb-dialog--reader', kind === 'reader');
    if (label) { dialog.removeAttribute('aria-labelledby'); dialog.setAttribute('aria-label', label); } else { dialog.removeAttribute('aria-label'); dialog.setAttribute('aria-labelledby', `${id}-h`); }
    dialog.innerHTML = html;
    paintSwatches(dialog);
    shown = { kind, ref, returnTo: back };
    dialog.showModal();
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
    endDialog();
  }

  /** Runs once per dialog, however it closed (our code, Esc, a form): clears the state, gives focus back. */
  function endDialog({ restoreFocus = true } = {}) {
    if (!shown) return;
    const { returnTo } = shown;
    shown = null;
    for (const a of dialog.getAnimations({ subtree: true })) a.cancel();
    dialog.classList.remove('pb-dialog--reader', 'pb-dialog--closing');
    for (const el of glass.querySelectorAll('.pb-note--reading')) el.classList.remove('pb-note--reading');
    if (restoreFocus) returnTo?.()?.focus({ preventScroll: true });
  }

  /** How many columns of notes fit: a wide screen gets more of them, never fewer than four. */
  function columnsFor(width) {
    const noteWidth = Math.min(220, width * 0.23);
    return Math.max(4, Math.floor((width - 24) / (noteWidth + 28)));
  }
  let flowColumns = 0;
  /** where flow() put each note: a note still there was never moved, and reflows with the window */
  const flowed = new Map();

  /** Notes without a position stack in as many columns as fit, by their real height, so none covers another. */
  function flow(flowing) {
    const width = glass.clientWidth || 1;
    const columns = columnsFor(width);
    flowColumns = columns;
    const step = (width - 24) / columns;
    const bottoms = Array(columns).fill(26);
    // heights first, positions after: one layout instead of one per note
    const els = flowing.map((n) => noteEl(refId(refOf(n))));
    const heights = els.map((el) => el?.offsetHeight ?? 0);
    flowing.forEach((n, k) => {
      const el = els[k];
      if (!el) return;
      const col = k % columns;
      n.x = (12 + col * step) / width;
      n.y = bottoms[col];
      flowed.set(refId(refOf(n)), `${n.x},${n.y}`);
      el.style.setProperty('--pb-x', n.x);
      el.style.setProperty('--pb-y', `${n.y}px`);
      bottoms[col] += heights[k] + 34;
    });
  }

  /** The glass grows with its notes (unless people gave it a height); `ms` animates the change. */
  function fitHeight({ ms = 0, easing = EASE.in } = {}) {
    if (isGrid()) return;
    if (size.height) { glass.style.setProperty('--pb-height', `${size.height}px`); return; }
    const before = ms ? glass.clientHeight : 0;
    const bottom = Math.max(0, ...[...glass.querySelectorAll('.pb-note')].map((el) => el.offsetTop + el.offsetHeight));
    glass.style.setProperty('--pb-height', `${Math.max(560, bottom + 40)}px`);
    if (!ms) return;
    for (const a of glass.getAnimations()) a.cancel();
    const after = glass.clientHeight;
    if (after !== before) glass.animate({ minHeight: [`${before}px`, `${after}px`] }, { duration: ms, easing });
  }

  /* ---------- the board size: both bottom corners resize it, always centered ---------- */
  const canResize = () => opts.resizable && !size.locked;
  function applySize() {
    root.style.setProperty('--pb-frame', `${(size.width ?? opts.width) * 100}%`);
    glass.classList.toggle('pb-glass--fixed', Boolean(size.height));
    root.classList.toggle('pb--resizable', canResize());
  }
  function onResizeDown(ev) {
    const handle = ev.target.closest('.pb-resize');
    if (!handle || ev.button !== 0 || !canResize() || isGrid()) return;
    ev.preventDefault();
    handle.setPointerCapture?.(ev.pointerId);
    sizing = { side: Number(handle.dataset.side), x: ev.clientX, y: ev.clientY, w: stage.offsetWidth, h: glass.offsetHeight, avail: root.clientWidth || 1, moved: false };
    root.classList.add('pb--sizing');
  }
  function onResizeMove(ev) {
    if (!sizing) return;
    const { avail } = sizing;
    // centered: the corner you drag moves, and the other side follows the same way
    const w = Math.min(avail, Math.max(Math.min(avail, SIZE.minWidth), sizing.w + 2 * sizing.side * (ev.clientX - sizing.x)));
    const h = Math.min(SIZE.maxHeight, Math.max(SIZE.minHeight, sizing.h + ev.clientY - sizing.y));
    sizing.moved = true;
    size = { ...size, width: w / avail, height: Math.round(h) };
    root.style.setProperty('--pb-frame', `${w}px`);
    glass.classList.add('pb-glass--fixed');
    glass.style.setProperty('--pb-height', `${size.height}px`);
  }
  async function onResizeUp() {
    if (!sizing) return;
    const { moved } = sizing;
    sizing = null;
    root.classList.remove('pb--sizing');
    if (!moved) { if (pendingRender) render(); return; }
    size = normalizeSize(size);
    applySize();
    render();
    await saveSize();
  }
  async function resetSize(ev) {
    if (!ev.target.closest('.pb-resize') || !canResize()) return;
    size = { width: null, height: null, locked: size.locked };
    applySize();
    render();
    await saveSize();
  }
  async function saveSize() {
    try { await opts.store?.saveSize?.(size); } catch (err) { fail(err); }
  }

  function renderLegend() {
    const gear = canEditLegend()
      ? `<button type="button" class="pb-gear" data-pb="settings" title="${escapeHtml(t.settings)}" aria-label="${escapeHtml(t.settings)}">⚙</button>`
      : '';
    if (!opts.legend.length && !gear) { legendEl.hidden = true; return; }
    legendEl.hidden = false;
    const counts = new Map();
    for (const n of all()) counts.set(n.color, (counts.get(n.color) || 0) + 1);
    legendEl.innerHTML = opts.legend.map((item) => `<button type="button" class="pb-key" data-pb="filter" data-color="${escapeHtml(item.color)}" aria-pressed="${!hidden.has(item.color)}"
          title="${escapeHtml(item.description || t.filter)}">
        ${swatchHtml(item.color)}<span class="pb-key-label">${escapeHtml(item.label)}</span><span class="pb-count">${counts.get(item.color) || 0}</span>
      </button>`).join('') + gear;
    paintSwatches(legendEl);
  }

  /** The types offered when creating or recoloring: the legend, or every color without one. */
  const choices = () => (opts.legend.length ? opts.legend : Object.keys(colors).map((c) => ({ color: c, label: c })));

  /** Where a pointer is on the glass, as a note position (its top-left corner, kept inside), also when the glass is scrolled. */
  function pointOnGlass(ev) {
    if (isGrid()) return null;
    const box = glass.getBoundingClientRect();
    const width = glass.clientWidth || 1;
    const noteWidth = Math.min(220, width * 0.23);
    return {
      x: Math.min(Math.max(0, (ev.clientX - box.left - glass.clientLeft) / width), Math.max(0, 1 - noteWidth / width)),
      y: Math.max(0, Math.round(ev.clientY - box.top - glass.clientTop + glass.scrollTop)),
    };
  }

  /* ---------- the right-click menu ---------- */
  function openMenu(ev, note) {
    menuReturn = focusTarget(document.activeElement);
    menuNote = note || null;
    menuAt = note ? null : pointOnGlass(ev);
    const action = note ? 'menu-color' : 'menu-new';
    const heading = note ? t.menuColor : t.menuNew;
    const items = choices().map((c) => {
      const current = Boolean(note && note.color === c.color);
      const role = note ? `role="menuitemradio" aria-checked="${current}"` : 'role="menuitem"';
      return `<button type="button" ${role} class="pb-menu-item" data-pb="${action}" data-color="${escapeHtml(c.color)}"${current ? ' aria-current="true"' : ''}>
        ${swatchHtml(c.color)}<span class="pb-menu-label">${escapeHtml(c.label)}</span>
        ${c.description ? `<small>${escapeHtml(c.description)}</small>` : ''}</button>`;
    }).join('');
    const extra = note
      ? `<hr><button type="button" role="menuitem" class="pb-menu-item" data-pb="menu-edit"><span class="pb-menu-label">✎ ${escapeHtml(t.edit)}</span></button>
         <button type="button" role="menuitem" class="pb-menu-item" data-pb="menu-done"><span class="pb-menu-label">✓ ${escapeHtml(t.done)}</span></button>`
      : '';
    menu.setAttribute('aria-label', heading);
    menu.innerHTML = `<p class="pb-menu-h" aria-hidden="true">${escapeHtml(heading)}</p>${items}${extra}`;
    paintSwatches(menu);
    menu.hidden = false;
    // fixed to the viewport, flipped when it would leave the screen
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    menu.style.left = `${Math.max(4, ev.clientX + w > innerWidth ? ev.clientX - w : ev.clientX)}px`;
    menu.style.top = `${Math.max(4, ev.clientY + h > innerHeight ? ev.clientY - h : ev.clientY)}px`;
    (menu.querySelector('[aria-current]') || menu.querySelector('.pb-menu-item'))?.focus();
  }

  function closeMenu({ restoreFocus = false } = {}) {
    if (menu.hidden) return;
    menu.hidden = true;
    menu.innerHTML = '';
    menuNote = null;
    if (restoreFocus) menuReturn?.()?.focus({ preventScroll: true });
    menuReturn = null;
  }

  function onContextMenu(ev) {
    if (!opts.contextMenu || ev.shiftKey) return; // Shift + right-click keeps the browser's own menu
    if (ev.target.closest('a,input,textarea')) return;
    const el = ev.target.closest('.pb-note');
    const note = el && find(el.dataset.ref);
    if (note?.auto) return;
    ev.preventDefault();
    openMenu(ev, note);
  }

  function onMenuKey(ev) {
    if (ev.key === 'Escape' || ev.key === 'Tab') { ev.preventDefault(); closeMenu({ restoreFocus: true }); return; }
    const items = [...menu.querySelectorAll('.pb-menu-item')];
    const i = items.indexOf(document.activeElement);
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[ev.key];
    if (next === undefined) return;
    ev.preventDefault();
    items[(next + items.length) % items.length]?.focus();
  }

  const onOutside = (ev) => { if (!menu.hidden && !menu.contains(ev.target)) closeMenu(); };

  /* ---------- the note types (gear at the end of the legend) ---------- */
  function typeRow(item) {
    const hex = colors[item.color] || '#fde68a';
    const lock = item.locked ? ` disabled title="${escapeHtml(t.locked)}"` : '';
    return `<li class="pb-type" data-color="${escapeHtml(item.color)}"${item.locked ? ' data-locked' : ''}>
      <input type="color" name="hex" value="${escapeHtml(hex)}" aria-label="${escapeHtml(t.typeColor)}"${lock}>
      <input name="label" maxlength="40" value="${escapeHtml(item.label)}" aria-label="${escapeHtml(t.typeName)}" placeholder="${escapeHtml(t.typeName)}" required>
      <input name="description" maxlength="160" value="${escapeHtml(item.description)}" aria-label="${escapeHtml(t.typeMeaning)}" placeholder="${escapeHtml(t.typeMeaning)}">
      <button type="button" class="pb-icon" data-pb="type-up" title="${escapeHtml(t.moveUp)}" aria-label="${escapeHtml(t.moveUp)}">↑</button>
      ${item.locked
    ? `<span class="pb-lock" title="${escapeHtml(t.locked)}" aria-label="${escapeHtml(t.locked)}">🔒</span>`
    : `<button type="button" class="pb-icon" data-pb="type-remove" title="${escapeHtml(t.removeType)}" aria-label="${escapeHtml(t.removeType)}">✕</button>`}
    </li>`;
  }

  /** A color key for a new type: a built-in color nobody uses yet, else c-1, c-2… */
  function freeKey(used) {
    const free = Object.keys(DEFAULT_COLORS).find((c) => !used.has(c));
    if (free) return free;
    let n = 1;
    while (used.has(`c-${n}`)) n += 1;
    return `c-${n}`;
  }

  function openSettings() {
    showDialog('settings', `<form method="dialog" class="pb-form pb-settings">
      <h2 id="${id}-h">${escapeHtml(t.settings)}</h2>
      <p class="pb-settings-hint">${escapeHtml(t.settingsHint)}</p>
      <ol class="pb-types">${opts.legend.map(typeRow).join('')}</ol>
      <fieldset class="pb-expand"><legend>${escapeHtml(t.expand)}</legend>
        ${[['center', t.expandCenter], ['inplace', t.expandInplace], ['more', t.expandMore]].map(([v, label]) =>
          `<label><input type="radio" name="expand" value="${v}"${expand() === v ? ' checked' : ''}> ${escapeHtml(label)}</label>`).join('')}
      </fieldset>
      ${opts.resizable ? `<label class="pb-lock"><input type="checkbox" name="lockSize"${size.locked ? ' checked' : ''}> ${escapeHtml(t.lockSize)}</label>` : ''}
      <div class="pb-actions">
        <button type="button" class="pb-btn" data-pb="type-add">${escapeHtml(t.addType)}</button>
        <span class="pb-spacer"></span>
        <button type="button" class="pb-btn" data-pb="cancel">${escapeHtml(t.cancel)}</button>
        <button type="submit" class="pb-btn pb-btn--primary">${escapeHtml(t.save)}</button>
      </div></form>`);
    const form = dialog.querySelector('form');
    const list = form.querySelector('.pb-types');
    form.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-pb]');
      if (!btn) return;
      const row = btn.closest('.pb-type');
      const action = btn.dataset.pb;
      if (action === 'type-remove') row.remove();
      if (action === 'type-up' && row.previousElementSibling) { row.previousElementSibling.before(row); btn.focus(); }
      if (action === 'type-add') {
        const key = freeKey(new Set([...list.querySelectorAll('.pb-type')].map((r) => r.dataset.color)));
        list.insertAdjacentHTML('beforeend', typeRow({ color: key, label: '' }));
        list.lastElementChild.querySelector('[name=label]').focus();
      }
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const base = baseColors();
      const legend = normalizeLegend([...list.querySelectorAll('.pb-type')].map((row) => {
        const hex = row.querySelector('[name=hex]').value.toLowerCase();
        const own = (base[row.dataset.color] || '').toLowerCase();
        return {
          color: row.dataset.color,
          label: row.querySelector('[name=label]').value,
          description: row.querySelector('[name=description]').value,
          hex: hex && hex !== own ? hex : undefined,
          locked: row.hasAttribute('data-locked'),
        };
      }));
      closeDialog();
      // only what changed is saved: saving the legend untouched would freeze it over the app's own
      const legendChanged = JSON.stringify(legend) !== JSON.stringify(normalizeLegend(opts.legend));
      if (legendChanged) { savedLegend = legend; applyLegend(); }
      const lock = form.querySelector('[name=lockSize]');
      const sizeChanged = lock && lock.checked !== size.locked;
      if (sizeChanged) { size = { ...size, locked: lock.checked }; applySize(); }
      const ex = form.querySelector('[name=expand]:checked')?.value;
      const viewChanged = ex && ex !== expand();
      if (viewChanged) { view = normalizeView({ ...view, expand: ex }); opened.clear(); }
      render();
      if (legendChanged) { try { await opts.store?.saveLegend?.(legend); } catch (err) { fail(err); } }
      if (sizeChanged) await saveSize();
      if (viewChanged) { try { await opts.store?.saveView?.(view); } catch (err) { fail(err); } }
    });
    form.querySelector('[name=label]')?.focus();
  }

  /** A note created here and not answered by the store yet: its position goes with the create. */
  const pending = (note) => !note.auto && note.id < 0;

  async function save(note, patch) {
    if (note.auto) positions[note.key] = { x: note.x, y: note.y, z: note.z };
    if (!opts.store || pending(note)) return undefined;
    try {
      return await opts.store.update(refOf(note), patch);
    } catch (err) { fail(err); return FAILED; }
  }

  /* ---------- the edit dialog ---------- */
  function openEditor(note, at) {
    const types = choices();
    const current = note?.color || at?.color || opts.defaultColor || (types.some((c) => c.color === 'yellow') ? 'yellow' : types[0]?.color) || 'yellow';
    showDialog('editor', `<form method="dialog" class="pb-form">
      <h2 id="${id}-h">${escapeHtml(note ? t.editNote : t.newNote)}</h2>
      <label>${escapeHtml(t.title)}<input name="title" maxlength="120" value="${escapeHtml(note?.title)}"></label>
      <label>${escapeHtml(t.text)}<textarea name="text" rows="4" maxlength="2000">${escapeHtml(note?.text)}</textarea></label>
      <fieldset class="pb-colors"><legend>${escapeHtml(t.color)}</legend>${types.map((c) => `
        <label class="pb-choice" title="${escapeHtml(c.description || c.label)}"><input type="radio" name="color" value="${escapeHtml(c.color)}"${c.color === current ? ' checked' : ''}>
          ${swatchHtml(c.color)}${escapeHtml(c.label)}</label>`).join('')}
      </fieldset>
      <div class="pb-row">
        <label>${escapeHtml(t.due)}<input name="due" type="datetime-local" value="${escapeHtml(toLocalInput(note?.due))}"></label>
        <label>${escapeHtml(t.image)}<input name="image" type="url" inputmode="url" value="${escapeHtml(note?.image)}" placeholder="https://"></label>
      </div>
      <div class="pb-row">
        <label>${escapeHtml(t.link)}<input name="link" inputmode="url" value="${escapeHtml(note?.link)}" placeholder="https://"></label>
        <label>${escapeHtml(t.linkLabel)}<input name="linkLabel" maxlength="80" value="${escapeHtml(note?.linkLabel)}"></label>
      </div>
      <div class="pb-actions">
        ${note ? `<button type="button" class="pb-btn pb-btn--danger" data-pb="remove">${escapeHtml(t.remove)}</button>` : ''}
        <span class="pb-spacer"></span>
        <button type="button" class="pb-btn" data-pb="cancel">${escapeHtml(t.cancel)}</button>
        <button type="submit" class="pb-btn pb-btn--primary">${escapeHtml(t.save)}</button>
      </div></form>`);
    const form = dialog.querySelector('form');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(form);
      const draft = {
        title: f.get('title').trim(), text: f.get('text').trim(), color: f.get('color') || current,
        due: fromLocalInput(f.get('due')), link: safeUrl(f.get('link')), linkLabel: f.get('linkLabel').trim(),
        image: safeUrl(f.get('image')),
      };
      closeDialog();
      if (!draft.title && !draft.text && !draft.image) return;
      if (note) {
        Object.assign(note, draft);
        requestRender();
        await save(note, draft);
        return;
      }
      const local = normalizeNote({ ...draft, id: -Date.now(), x: at?.x ?? null, y: at?.y ?? null, z: topZ() + 1 });
      notes.push(local);
      render();
      if (!opts.store) return;
      const sent = { x: local.x, y: local.y, z: local.z };
      // a note made on a narrow screen has no place yet: leave x and y out instead of sending null
      const placed = Object.fromEntries(Object.entries(sent).filter(([, v]) => v !== null && v !== undefined));
      try {
        const saved = await opts.store.create({ ...draft, ...placed });
        // dragged while the store was answering: keep where it is now, and save that too
        const moved = local.x !== sent.x || local.y !== sent.y || local.z !== sent.z;
        Object.assign(local, normalizeNote(saved), moved ? { x: local.x, y: local.y, z: local.z } : {});
        if (moved) save(local, { x: local.x, y: local.y, z: local.z });
        requestRender();
      } catch (err) { notes = notes.filter((n) => n !== local); requestRender(); fail(err); }
    });
    dialog.querySelector('[data-pb=remove]')?.addEventListener('click', async () => {
      closeDialog();
      notes = notes.filter((n) => n !== note);
      render();
      if ((await save(note, { removed: true })) === FAILED) { if (!notes.includes(note)) notes.push(note); requestRender(); }
    });
    form.elements.text.focus();
  }

  /* ---------- events ---------- */
  function onClick(ev) {
    if (ev.target === dialog) {
      // the backdrop; a text selection that ends outside the reader does not close it
      if (shown?.kind === 'reader' && downOnBackdrop) closeReader();
      return;
    }
    const btn = ev.target.closest('[data-pb]');
    if (!btn || !root.contains(btn)) return onNoteClick(ev);
    const action = btn.dataset.pb;
    if (action === 'cancel') return closeDialog();
    if (action.startsWith('reader-')) {
      const target = shown?.note;
      if (action === 'reader-edit' && target) return openEditor(target); // the editor takes the reader's place at once
      return closeReader().then(() => { if (action === 'reader-done' && target) finish(target); });
    }
    if (action === 'more') return toggleOpen(btn.closest('.pb-note'));
    if (action === 'add') return openEditor(null);
    if (action === 'settings') return openSettings();
    if (action === 'menu-new') {
      const at = { ...menuAt, color: btn.dataset.color };
      closeMenu({ restoreFocus: true });
      return openEditor(null, at);
    }
    if (action.startsWith('menu-')) {
      const target = menuNote;
      closeMenu({ restoreFocus: true });
      if (!target) return;
      if (action === 'menu-edit') return openEditor(target);
      if (action === 'menu-done') return finish(target);
      if (action === 'menu-color' && target.color !== btn.dataset.color) {
        target.color = btn.dataset.color;
        target.z = topZ() + 1;
        requestRender();
        save(target, { color: target.color, z: target.z });
      }
      return;
    }
    if (action === 'filter') {
      const c = btn.dataset.color;
      if (hidden.has(c)) hidden.delete(c); else hidden.add(c);
      return requestRender();
    }
    const el = btn.closest('.pb-note');
    const note = el && find(el.dataset.ref);
    if (!note) return;
    if (action === 'edit') return openEditor(note);
    if (action === 'done') finish(note);
  }

  /** A click on the note itself (not a link, a button or the end of a drag). */
  function onNoteClick(ev) {
    const el = ev.target.closest('.pb-note');
    if (!el || !glass.contains(el) || ev.target.closest('a,button,input,textarea') || dragged) return;
    const note = find(el.dataset.ref);
    if (!note) return;
    if (expand() === 'center') return openReader(note);
    // a mouse already opened it by hovering; a finger or a pen taps it open and closed
    if (expand() === 'inplace' && lastPointer !== 'mouse' && el.classList.contains('pb-note--cut')) toggleOpen(el);
  }

  /** Done: the note fades out, then leaves the board. It comes back if the store fails. */
  async function finish(note) {
    const el = noteEl(refId(refOf(note)));
    el?.classList.add('pb-note--leaving');
    notes = notes.filter((n) => n !== note);
    // redrawn when the fade ends (at once without one): no timer to keep in step with the stylesheet
    const fade = el?.getAnimations().find((a) => a.transitionProperty === 'opacity');
    (fade ? fade.finished.catch(() => {}) : Promise.resolve()).then(requestRender);
    if ((await save(note, { done: true })) === FAILED) {
      if (!notes.includes(note)) notes.push(note);
      requestRender();
    }
  }

  function onDblClick(ev) {
    if (ev.target !== glass || isGrid()) return;
    openEditor(null, pointOnGlass(ev));
  }

  function onPointerDown(ev) {
    const el = ev.target.closest('.pb-note');
    if (!el || ev.button !== 0 || ev.target.closest('button,a,input,textarea') || isGrid()) return;
    const note = find(el.dataset.ref);
    if (!note) return;
    ev.preventDefault();
    note.z = topZ() + 1;
    el.style.setProperty('--pb-z', note.z);
    el.setPointerCapture?.(ev.pointerId);
    // measured once here: moving only writes, so a drag never forces a layout
    const width = glass.clientWidth || 1;
    drag = { el, note, x0: ev.clientX, y0: ev.clientY, left: el.offsetLeft, top: el.offsetTop, width, maxLeft: Math.max(0, width - el.offsetWidth), moved: false };
    el.classList.add('pb-note--dragging');
  }

  function onPointerMove(ev) {
    if (!drag) return;
    const dx = ev.clientX - drag.x0;
    const dy = ev.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    drag.note.x = Math.min(Math.max(0, drag.left + dx), drag.maxLeft) / drag.width;
    drag.note.y = Math.max(0, Math.round(drag.top + dy));
    drag.el.style.setProperty('--pb-x', drag.note.x);
    drag.el.style.setProperty('--pb-y', `${drag.note.y}px`);
  }

  function onPointerUp() {
    if (!drag) return;
    const { el, note, moved } = drag;
    drag = null;
    // the click that ends a drag does not open the note
    dragged = moved;
    if (moved) setTimeout(() => { dragged = false; }, 0);
    el.classList.remove('pb-note--dragging');
    // the note touched last stays on top, also after a reload
    save(note, moved || note.auto ? { x: note.x, y: note.y, z: note.z } : { z: note.z });
    if (!pendingRender) { fitHeight(); return; }
    // new data came in during the drag: the fresh copy of this note lands where it was dropped
    const current = find(refId(refOf(note)));
    if (current && current !== note) Object.assign(current, { x: note.x, y: note.y, z: note.z });
    render();
  }

  /** Arrow keys move the focused note; each note's move is saved a moment after its last key. */
  const keySaves = new Map();
  function flushKeySaves() {
    for (const { note, timer } of keySaves.values()) { clearTimeout(timer); save(note, { x: note.x, y: note.y }); }
    keySaves.clear();
  }
  function onKeyDown(ev) {
    const el = ev.target.closest?.('.pb-note');
    if (!el || ev.target !== el) return;
    const note = find(el.dataset.ref);
    if (!note) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (expand() === 'center') return openReader(note);
      if (!note.auto) return openEditor(note);
      if (el.classList.contains('pb-note--cut')) toggleOpen(el);
      return;
    }
    const step = ev.shiftKey ? 5 : 1;
    const moves = { ArrowLeft: [-0.01, 0], ArrowRight: [0.01, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
    const m = moves[ev.key];
    if (!m || isGrid()) return;
    ev.preventDefault();
    const maxX = Math.max(0, 1 - el.offsetWidth / (glass.clientWidth || 1));
    note.x = Math.min(Math.max(0, note.x + m[0] * step), maxX);
    note.y = Math.max(0, note.y + m[1] * step);
    el.style.setProperty('--pb-x', note.x);
    el.style.setProperty('--pb-y', `${note.y}px`);
    fitHeight();
    const ref = el.dataset.ref;
    clearTimeout(keySaves.get(ref)?.timer);
    keySaves.set(ref, { note, timer: setTimeout(() => { keySaves.delete(ref); save(note, { x: note.x, y: note.y }); }, 400) });
  }

  /** Due chips move from "Tomorrow" to "Today" to overdue without redrawing the board. */
  function refreshDue() {
    const now = opts.now();
    for (const el of root.querySelectorAll('time.pb-due')) {
      const due = el.getAttribute('datetime');
      el.className = `pb-due pb-due--${dueStatus(due, now)}`;
      el.textContent = formatDue(due, { locale: locale(), now, words: t });
    }
  }

  // every listener outside the board's own elements, so destroy() can take them all off
  const cleanups = [];
  const on = (target, type, fn, capture = false) => {
    target.addEventListener(type, fn, capture);
    cleanups.push(() => target.removeEventListener(type, fn, capture));
  };
  let lastPointer = 'mouse';
  on(root, 'pointerdown', (ev) => { lastPointer = ev.pointerType || 'mouse'; }, true);
  on(root, 'click', onClick);
  on(root, 'keydown', onKeyDown);
  glass.addEventListener('dblclick', onDblClick);
  glass.addEventListener('pointerdown', onPointerDown);
  glass.addEventListener('pointermove', onPointerMove);
  glass.addEventListener('pointerup', onPointerUp);
  glass.addEventListener('pointercancel', onPointerUp);
  glass.addEventListener('pointerover', onHover);
  glass.addEventListener('pointerout', onHover);
  glass.addEventListener('focusin', onFocusMove);
  glass.addEventListener('focusout', onFocusMove);
  glass.addEventListener('contextmenu', onContextMenu);
  menu.addEventListener('keydown', onMenuKey);
  dialog.addEventListener('pointerdown', (ev) => { downOnBackdrop = ev.target === dialog; });
  dialog.addEventListener('keydown', (ev) => {
    // Esc plays the reader back into its note instead of closing it at once
    if (ev.key === 'Escape' && shown?.kind === 'reader') { ev.preventDefault(); closeReader(); }
  });
  dialog.addEventListener('cancel', (ev) => { if (shown?.kind === 'reader') { ev.preventDefault(); closeReader(); } });
  dialog.addEventListener('close', () => { if (!dialog.open) endDialog(); });
  on(document, 'pointerdown', onOutside, true);
  on(globalThis, 'scroll', () => closeMenu(), true);
  on(globalThis, 'resize', () => closeMenu());
  on(globalThis, 'blur', () => closeMenu());
  // a wider or narrower window reflows the notes nobody placed, and may cut more or less text
  let resizeTimer = 0;
  on(globalThis, 'resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (drag || sizing || destroyed) return;
      const columnsChanged = flowColumns && columnsFor(glass.clientWidth || 1) !== flowColumns;
      if (isGrid() !== lastGrid || columnsChanged) {
        for (const n of all()) {
          const k = refId(refOf(n));
          if (flowed.get(k) === `${n.x},${n.y}`) { n.x = null; n.y = null; }
          flowed.delete(k);
        }
        return render();
      }
      markCut();
    }, 150);
  });
  stage.addEventListener('pointerdown', onResizeDown);
  stage.addEventListener('pointermove', onResizeMove);
  stage.addEventListener('pointerup', onResizeUp);
  stage.addEventListener('pointercancel', onResizeUp);
  stage.addEventListener('dblclick', resetSize);
  const ticker = setInterval(() => { if (all().some((n) => n.due)) refreshDue(); }, 60_000);

  setData({ notes: opts.notes, auto: opts.auto, positions: opts.positions });
  renderChrome();
  applySize();
  render();

  return {
    /** Replace the data (any of notes, auto, positions) and redraw. */
    update(data = {}) { setData(data); requestRender(); },
    /** Load everything from `store.load()` (shape `{ notes, positions, legend?, size?, view? }`). */
    async reload() {
      if (!opts.store?.load) return;
      try {
        const data = await opts.store.load();
        if (destroyed) return;
        if (data.legend) { savedLegend = data.legend; applyLegend(); }
        if (data.size) { size = normalizeSize(data.size); applySize(); }
        if (data.view) {
          const before = expand();
          view = normalizeView(data.view);
          if (expand() !== before) opened.clear();
        }
        setData({ notes: data.notes, positions: data.positions });
        requestRender();
      } catch (err) { fail(err); }
    },
    /** Change options after mounting: legend, strings, colors, locale, addButton, size, view, expand, width, resizable… */
    configure(next = {}) {
      const before = expand();
      if (next.legend) appLegend = next.legend;
      opts = { ...opts, ...next };
      t = { ...DEFAULT_STRINGS, ...opts.strings };
      if ('size' in next) size = normalizeSize(next.size);
      if ('view' in next) view = normalizeView(next.view);
      if (expand() !== before) opened.clear();
      applyLegend();
      applySize();
      renderChrome();
      requestRender();
    },
    openEditor: (draft) => openEditor(null, draft),
    openSettings: () => openSettings(),
    /** The view people chose in the gear: `{ expand }` (null = the app default). */
    get view() { return { ...view }; },
    /** Open a note big in the center of the screen, as a click does. */
    openNote: (ref) => { const n = find(typeof ref === 'string' ? ref : refId(ref)); if (n) openReader(n); },
    /** The board size people chose: `{ width, height, locked }` (null = the default). */
    get size() { return { ...size }; },
    /** The legend in use: what the app shipped plus what people changed with the gear. */
    get legend() { return opts.legend.map((i) => ({ ...i })); },
    get notes() { return notes.map((n) => ({ ...n })); },
    /** Takes the board off the element: listeners, timers and classes. Moves typed with the arrows are saved first. */
    destroy() {
      if (destroyed) return;
      flushKeySaves();
      destroyed = true;
      clearInterval(ticker);
      clearTimeout(resizeTimer);
      for (const off of cleanups) off();
      if (dialog.open) dialog.close();
      root.classList.remove('pb', 'pb--resizable', 'pb--sizing');
      delete root.dataset.expand;
      root.style.removeProperty('--pb-frame');
      root.innerHTML = '';
    },
  };
}

export default createBoard;
