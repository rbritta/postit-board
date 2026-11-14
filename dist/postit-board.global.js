/*! postit-board v0.4.1 | MIT | https://github.com/rbritta/postit-board */
(function (global) {
'use strict';
/**
 * Pure helpers shared by the browser board and the server store. No DOM, no I/O,
 * so every rule here is covered by plain `node --test`.
 */

/** The built-in palette. Any other key works too: pass it in `colors`. */
const DEFAULT_COLORS = Object.freeze({
  yellow: '#fde68a',
  pink: '#fbcfe8',
  green: '#bbf7d0',
  blue: '#bfdbfe',
  orange: '#fed7aa',
  purple: '#ddd6fe',
  teal: '#99f6e4',
  gray: '#e5e7eb',
});

const LIMITS = Object.freeze({ title: 120, text: 2000, url: 2048, linkLabel: 80, color: 32, label: 40, description: 160, legend: 24 });

const COLOR_KEY = /^[a-z][a-z0-9-]{0,31}$/;

const isColorKey = (value) => typeof value === 'string' && COLOR_KEY.test(value);
const isHex = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

/**
 * A legend as the board and the stores keep it: `[{ color, label, description?, hex?, locked? }]`.
 * `color` is the key notes carry; `hex` repaints that key; `locked` marks a type the app owns
 * (its color can't change and it can't be removed, only renamed). Bad entries are dropped.
 */
/** Board size limits: the width is a share of the space the board has, the height is in pixels. */
const SIZE = Object.freeze({ width: 0.8, minWidth: 480, minHeight: 320, maxHeight: 6000 });

/**
 * The board size people chose by dragging its bottom corners: `{ width, height, locked }`.
 * `width` is a share of the available width (0.2 to 1), `height` pixels (null = grow with the notes),
 * `locked` hides the handles. Anything else falls back to the default.
 */
function normalizeSize(size) {
  const s = size && typeof size === 'object' ? size : {};
  const w = Number(s.width);
  const h = Number(s.height);
  return {
    width: s.width != null && Number.isFinite(w) ? Math.min(1, Math.max(0.2, Math.round(w * 1000) / 1000)) : null,
    height: s.height != null && Number.isFinite(h) ? Math.min(SIZE.maxHeight, Math.max(SIZE.minHeight, Math.round(h))) : null,
    locked: s.locked === true,
  };
}

/** How a note with cut text shows the rest: opened big in the center, grown in place on hover, or a "more" link. */
const EXPAND = Object.freeze(['center', 'inplace', 'more']);

/** The board view people chose in the gear: `{ expand }`. Unknown values become null (the app default). */
function normalizeView(view) {
  const v = view && typeof view === 'object' ? view : {};
  return { expand: EXPAND.includes(v.expand) ? v.expand : null };
}

function normalizeLegend(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || !isColorKey(item.color) || seen.has(item.color)) continue;
    seen.add(item.color);
    const entry = { color: item.color, label: text(item.label, LIMITS.label).trim() || item.color };
    const description = text(item.description, LIMITS.description).trim();
    if (description) entry.description = description;
    if (isHex(item.hex)) entry.hex = item.hex.toLowerCase();
    if (item.locked === true) entry.locked = true;
    out.push(entry);
    if (out.length >= LIMITS.legend) break;
  }
  return out;
}

/**
 * The legend people saved, on top of the one the app ships. Saved order, names and colors
 * win; the app's locked types always stay (renamed if they were), and keep their color.
 */
function mergeLegend(appLegend, saved) {
  const app = normalizeLegend(appLegend);
  if (!Array.isArray(saved)) return app;
  const locked = new Map(app.filter((i) => i.locked).map((i) => [i.color, i]));
  const out = normalizeLegend(saved).map(({ locked: _ignored, hex, ...item }) => {
    const own = locked.get(item.color);
    if (!own) return hex ? { ...item, hex } : item;
    locked.delete(item.color);
    return own.hex ? { ...item, hex: own.hex, locked: true } : { ...item, locked: true };
  });
  return [...out, ...locked.values()];
}

/** Hex overrides from a legend, as a `colors` map: `{ yellow: '#ffcc00' }`. */
const legendColors = (legend) => Object.fromEntries(normalizeLegend(legend).filter((i) => i.hex).map((i) => [i.color, i.hex]));

/** Only http(s), relative (`/x`, `./x`, `../x`) and in-page links: never `javascript:` or `data:`. */
function safeUrl(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || url.length > LIMITS.url) return null;
  if (/^(\/(?!\/)|\.{1,2}\/|#|\?)/.test(url)) return url;
  return /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Escaped text with bare http(s) URLs turned into links that open in a new tab. */
function linkify(text) {
  const out = [];
  let last = 0;
  const raw = String(text ?? '');
  for (const match of raw.matchAll(/https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi)) {
    out.push(escapeHtml(raw.slice(last, match.index)));
    const href = escapeHtml(match[0]);
    out.push(`<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>`);
    last = match.index + match[0].length;
  }
  out.push(escapeHtml(raw.slice(last)));
  return out.join('');
}

/** A stable small tilt (in degrees, -2.1 to 2.1) so each note keeps its angle between renders. */
function tilt(seed) {
  let hash = 0;
  for (const ch of String(seed)) hash = (hash * 31 + ch.codePointAt(0)) | 0;
  return ((Math.abs(hash) % 7) - 3) * 0.7;
}

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const text = (v, max) => (v === null || v === undefined ? '' : String(v).slice(0, max));

/** A due date as an ISO string, or null when absent or unreadable. */
function normalizeDue(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * The note shape every part of the library agrees on. `ref` is what the store is called
 * with: `{ id }` for a note someone wrote, `{ key }` for an automatic one.
 */
function normalizeNote(note, { auto = false } = {}) {
  const n = note || {};
  const out = {
    id: auto ? null : num(n.id),
    key: auto ? String(n.key || '') : null,
    auto,
    title: text(n.title, LIMITS.title),
    text: text(n.text, LIMITS.text),
    color: isColorKey(n.color) ? n.color : 'yellow',
    x: num(n.x) === null ? null : clamp(num(n.x), 0, 1),
    y: num(n.y) === null ? null : Math.max(0, Math.round(num(n.y))),
    z: num(n.z) ?? 0,
    due: normalizeDue(n.due),
    link: safeUrl(n.link),
    linkLabel: text(n.linkLabel, LIMITS.linkLabel),
    image: safeUrl(n.image),
  };
  if (auto && !out.key) throw new Error('an automatic note needs a key');
  return out;
}

const refOf = (note) => (note.auto ? { key: note.key } : { id: note.id });
const refId = (ref) => (ref.key != null ? `key:${ref.key}` : `id:${ref.id}`);

/** Notes without a saved position flow into a grid, left to right, top to bottom. */
function autoPlace(notes, { columns = 4, rowHeight = 235, top = 26, gap = 0.012 } = {}) {
  let k = 0;
  return notes.map((note) => {
    if (note.x !== null && note.y !== null) return note;
    const placed = { ...note, x: (k % columns) / columns + gap, y: Math.floor(k / columns) * rowHeight + top };
    k += 1;
    return placed;
  });
}

/** Automatic notes come from the app on every render; only their position is stored, by key. */
function withPositions(autoNotes, positions = {}) {
  return autoNotes.map((n) => {
    const saved = positions[n.key];
    return saved ? { ...n, x: num(saved.x), y: num(saved.y), z: num(saved.z) ?? 0 } : n;
  });
}

const boardHeight = (notes, { min = 560, noteHeight = 250 } = {}) =>
  Math.max(min, ...notes.map((n) => (n.y ?? 0) + noteHeight));

const DAY = 86_400_000;

/** 'overdue' | 'today' | 'soon' (next 7 days) | 'later' | null, compared in local time. */
function dueStatus(due, now = new Date()) {
  if (!due) return null;
  const at = new Date(due);
  if (Number.isNaN(at.getTime())) return null;
  if (at <= now) return 'overdue';
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.floor((at - startOfToday) / DAY);
  if (days === 0) return 'today';
  return days < 7 ? 'soon' : 'later';
}

/** "Today 18:00", "Tomorrow 09:30", "Fri 14:00" or "Nov 20, 14:00", in the given locale. */
function formatDue(due, { locale = 'en', now = new Date(), words = {} } = {}) {
  if (!due) return '';
  const at = new Date(due);
  if (Number.isNaN(at.getTime())) return '';
  const time = at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.floor((at - startOfToday) / DAY);
  if (days === 0) return `${words.today ?? 'Today'} ${time}`;
  if (days === 1) return `${words.tomorrow ?? 'Tomorrow'} ${time}`;
  if (days === -1) return `${words.yesterday ?? 'Yesterday'} ${time}`;
  if (days > 1 && days < 7) return `${at.toLocaleDateString(locale, { weekday: 'short' })} ${time}`;
  const sameYear = at.getFullYear() === now.getFullYear();
  const date = at.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  return `${date}, ${time}`;
}

/** `<input type="datetime-local">` speaks local time without a zone; these convert both ways. */
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fromLocalInput = (value) => (value ? normalizeDue(new Date(value)) : null);

/**
 * postit-board: a glass board of sticky notes with a color legend.
 *
 *   const board = createBoard(element, { legend, notes, auto, store });
 *   board.update({ notes, auto });   // after your data changes
 *   board.destroy();
 *
 * Right-click the glass for a menu of note types: the new note starts where you clicked.
 * Right-click a note to change its type. The gear at the start of the legend edits the types
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
 *
 * The board never talks to a server by itself: every change goes through `store`
 * (see `restStore` for the matching HTTP client, and `server/` for the Node side).
 */


const DEFAULT_STRINGS = Object.freeze({
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

let uid = 0;

/** A fetch-based store for the routes in `server/http-handler.js`. */
function restStore(base, { headers = {}, fetch: doFetch = globalThis.fetch.bind(globalThis) } = {}) {
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
      ref.key != null ? call('PUT', `/key/${encodeURIComponent(ref.key)}`, patch) : call('PATCH', `/${ref.id}`, patch),
    saveLegend: (legend) => call('PUT', '/legend', { legend }),
    saveSize: (size) => call('PUT', '/size', { size }),
    saveView: (view) => call('PUT', '/view', { view }),
  };
}

/** A store in localStorage: for demos, prototypes and boards that live in one browser. */
function localStore(name = 'postit-board', storage = globalThis.localStorage) {
  const read = () => {
    try { return { notes: [], positions: {}, next: 1, ...JSON.parse(storage.getItem(name) || '{}') }; } catch { return { notes: [], positions: {}, next: 1 }; }
  };
  const write = (data) => storage.setItem(name, JSON.stringify(data));
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
    create(draft) {
      const d = read();
      const note = { ...normalizeNote({ ...draft, id: d.next }), createdAt: new Date().toISOString() };
      d.notes.push(note);
      d.next += 1;
      write(d);
      return note;
    },
    update(ref, patch) {
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
      d.notes[i] = { ...normalizeNote({ ...d.notes[i], ...fields }), doneAt: done ? new Date().toISOString() : d.notes[i].doneAt };
      write(d);
      return d.notes[i];
    },
  };
}

function createBoard(root, options = {}) {
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
  let notes = [];
  let auto = [];
  let rawAuto = [];
  let positions = { ...opts.positions };
  let size = normalizeSize(opts.size);
  let view = normalizeView(opts.view);
  const expand = () => view.expand || (EXPAND.includes(opts.expand) ? opts.expand : 'center');
  const opened = new Set(); // notes opened in place (touch, or the "more" link)
  let readerNote = null;
  let dragged = false;
  const hidden = new Set();
  let drag = null;

  root.classList.add('pb');
  root.innerHTML = `
    <div class="pb-bar">
      <span class="pb-hint">${escapeHtml(t.hint)}</span>
      ${opts.addButton ? `<button type="button" class="pb-btn" data-pb="add">${escapeHtml(t.add)}</button>` : ''}
    </div>
    <div class="pb-stage">
      <div class="pb-glass" role="list"></div>
      <span class="pb-resize pb-resize--left" data-side="-1" title="${escapeHtml(t.resize)}" aria-hidden="true"></span>
      <span class="pb-resize pb-resize--right" data-side="1" title="${escapeHtml(t.resize)}" aria-hidden="true"></span>
    </div>
    <footer class="pb-legend" aria-label="${escapeHtml(t.legend)}"></footer>
    <div class="pb-menu" role="menu" hidden></div>
    <dialog class="pb-dialog" aria-labelledby="${id}-h"></dialog>`;
  const glass = root.querySelector('.pb-glass');
  const stage = root.querySelector('.pb-stage');
  const legendEl = root.querySelector('.pb-legend');
  const menu = root.querySelector('.pb-menu');
  const dialog = root.querySelector('.pb-dialog');
  let menuAt = null; // { x, y } on the glass, or null in the phone grid
  let menuNote = null;

  const isGrid = () => root.clientWidth > 0 && root.clientWidth < opts.gridBelow;
  const all = () => [...auto, ...notes];
  const find = (ref) => all().find((n) => refId(refOf(n)) === ref);
  const fail = (err) => { opts.onError(err); root.dispatchEvent(new CustomEvent('postit-error', { detail: err })); };

  function setData({ notes: n = notes, auto: a, positions: p } = {}) {
    if (p) positions = { ...positions, ...p };
    if (n !== notes) notes = (n || []).map((x) => normalizeNote(x));
    if (a !== undefined) rawAuto = a || [];
    // automatic notes are rebuilt from what the app sent plus the saved positions, never from a past layout
    auto = withPositions(rawAuto.map((x) => normalizeNote(x, { auto: true })), positions);
  }

  function noteHtml(n) {
    const ref = refId(refOf(n));
    const status = dueStatus(n.due, opts.now());
    const due = n.due
      ? `<time class="pb-due pb-due--${status}" datetime="${escapeHtml(n.due)}">${escapeHtml(formatDue(n.due, { locale: opts.locale, now: opts.now(), words: t }))}</time>`
      : '';
    const link = n.link
      ? `<a class="pb-link" href="${escapeHtml(n.link)}"${/^https?:/i.test(n.link) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(n.linkLabel || (n.auto ? t.open : n.link))}</a>`
      : '';
    const actions = n.auto
      ? ''
      : `<button type="button" class="pb-icon" data-pb="edit" title="${escapeHtml(t.edit)}" aria-label="${escapeHtml(t.edit)}">✎</button>
         <button type="button" class="pb-icon" data-pb="done" title="${escapeHtml(t.done)}" aria-label="${escapeHtml(t.done)}">✓</button>`;
    const swatch = colors[n.color] || colors.yellow;
    return `<article class="pb-note${n.auto ? ' pb-note--auto' : ''}${hidden.has(n.color) ? ' pb-note--hidden' : ''}" role="listitem" tabindex="0"
        data-ref="${escapeHtml(ref)}" data-color="${escapeHtml(n.color)}"
        style="--pb-x:${n.x};--pb-y:${n.y}px;--pb-z:${n.z || 0};--pb-r:${tilt(ref)}deg;--pb-note:${escapeHtml(swatch)}">
      <span class="pb-tape" aria-hidden="true"></span>
      ${n.title ? `<h3 class="pb-title" title="${escapeHtml(n.title)}">${escapeHtml(n.title)}</h3>` : ''}
      ${n.image ? `<img class="pb-img" src="${escapeHtml(n.image)}" alt="" loading="lazy" draggable="false">` : ''}
      ${n.text ? `<p class="pb-text" title="${escapeHtml(n.text)}">${linkify(n.text)}</p>` : ''}
      ${link && !n.auto ? `<p class="pb-linkrow">${link}</p>` : ''}
      <div class="pb-foot">${due}<span class="pb-spacer"></span>${n.auto ? link : ''}${actions}</div>
    </article>`;
  }

  function render() {
    // placed in the same objects: callbacks keep references to them
    const list = all();
    const flowing = list.filter((n) => n.x === null || n.y === null);
    autoPlace(list).forEach((p, i) => { list[i].x = p.x; list[i].y = p.y; });
    glass.style.setProperty('--pb-height', `${boardHeight(list)}px`);
    glass.innerHTML = list.length ? list.map(noteHtml).join('') : `<p class="pb-empty">${escapeHtml(t.empty)}</p>`;
    if (flowing.length && !isGrid()) flow(flowing);
    markCut();
    fitHeight();
    renderLegend();
  }

  /** Notes whose title or text is cut get the class pb-note--cut, and a "more" link in that mode. */
  function markCut() {
    root.dataset.expand = expand();
    for (const el of glass.querySelectorAll('.pb-note')) {
      const ref = el.dataset.ref;
      if (opened.has(ref)) el.classList.add('pb-note--open');
      // half a line of slack: handwriting fonts draw a few pixels past their line box
      const cut = [...el.querySelectorAll('.pb-title, .pb-text')].some((x) => x.scrollHeight - x.clientHeight > (parseFloat(getComputedStyle(x).lineHeight) || 20) / 2);
      el.classList.toggle('pb-note--cut', cut || opened.has(ref));
      if (expand() === 'more' && (cut || opened.has(ref))) {
        el.querySelector('.pb-foot').insertAdjacentHTML('beforebegin',
          `<button type="button" class="pb-more" data-pb="more" aria-expanded="${opened.has(ref)}">${escapeHtml(opened.has(ref) ? t.less : t.more)}</button>`);
      }
    }
  }

  /** The note read whole, big, in the center of the screen. */
  function openReader(note) {
    closeMenu();
    readerNote = note;
    const swatch = colors[note.color] || colors.yellow;
    const link = note.link
      ? `<a class="pb-link" href="${escapeHtml(note.link)}"${/^https?:/i.test(note.link) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(note.linkLabel || (note.auto ? t.open : note.link))}</a>`
      : '';
    const due = note.due ? `<time class="pb-due pb-due--${dueStatus(note.due, opts.now())}" datetime="${escapeHtml(note.due)}">${escapeHtml(formatDue(note.due, { locale: opts.locale, now: opts.now(), words: t }))}</time>` : '';
    dialog.classList.add('pb-dialog--reader');
    dialog.innerHTML = `<article class="pb-reader" style="--pb-note:${escapeHtml(swatch)}">
      <button type="button" class="pb-reader-close" data-pb="reader-close" aria-label="${escapeHtml(t.close)}">×</button>
      ${note.title ? `<h2 id="${id}-h" class="pb-reader-title">${escapeHtml(note.title)}</h2>` : ''}
      ${note.image ? `<img class="pb-reader-img" src="${escapeHtml(note.image)}" alt="">` : ''}
      ${note.text ? `<p class="pb-reader-text">${linkify(note.text)}</p>` : ''}
      <div class="pb-reader-foot">${due}<span class="pb-spacer"></span>${link}
        ${note.auto ? '' : `<button type="button" class="pb-btn" data-pb="reader-edit">${escapeHtml(t.edit)}</button><button type="button" class="pb-btn" data-pb="reader-done">${escapeHtml(t.done)}</button>`}</div>
    </article>`;
    dialog.addEventListener('close', () => { dialog.classList.remove('pb-dialog--reader'); readerNote = null; }, { once: true });
    dialog.showModal();
    dialog.querySelector('.pb-reader-close').focus();
  }

  function toggleOpen(el) {
    const ref = el.dataset.ref;
    if (opened.has(ref)) opened.delete(ref); else opened.add(ref);
    const note = find(ref);
    if (note && opened.has(ref)) { note.z = topZ() + 1; el.style.setProperty('--pb-z', note.z); }
    el.classList.toggle('pb-note--open', opened.has(ref));
    const more = el.querySelector('.pb-more');
    if (more) { more.textContent = opened.has(ref) ? t.less : t.more; more.setAttribute('aria-expanded', String(opened.has(ref))); }
    fitHeight();
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
    flowing.forEach((n, k) => {
      const el = glass.querySelector(`[data-ref="${CSS.escape(refId(refOf(n)))}"]`);
      if (!el) return;
      const col = k % columns;
      n.x = (12 + col * step) / width;
      n.y = bottoms[col];
      flowed.set(refId(refOf(n)), `${n.x},${n.y}`);
      el.style.setProperty('--pb-x', n.x);
      el.style.setProperty('--pb-y', `${n.y}px`);
      bottoms[col] += el.offsetHeight + 34;
    });
  }

  function fitHeight() {
    if (isGrid()) return;
    if (size.height) { glass.style.setProperty('--pb-height', `${size.height}px`); return; }
    const bottom = Math.max(0, ...[...glass.querySelectorAll('.pb-note')].map((el) => el.offsetTop + el.offsetHeight));
    glass.style.setProperty('--pb-height', `${Math.max(560, bottom + 40)}px`);
  }

  /* ---------- the board size: both bottom corners resize it, always centered ---------- */
  const canResize = () => opts.resizable && !size.locked;
  function applySize() {
    root.style.setProperty('--pb-frame', `${(size.width ?? opts.width) * 100}%`);
    glass.classList.toggle('pb-glass--fixed', Boolean(size.height));
    root.classList.toggle('pb--resizable', canResize());
  }
  let sizing = null;
  function onResizeDown(ev) {
    const handle = ev.target.closest('.pb-resize');
    if (!handle || ev.button !== 0 || !canResize() || isGrid()) return;
    ev.preventDefault();
    handle.setPointerCapture?.(ev.pointerId);
    sizing = { side: Number(handle.dataset.side), x: ev.clientX, y: ev.clientY, w: stage.offsetWidth, h: glass.offsetHeight, handle, moved: false };
    root.classList.add('pb--sizing');
  }
  function onResizeMove(ev) {
    if (!sizing) return;
    const avail = root.clientWidth || 1;
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
    const moved = sizing.moved;
    sizing = null;
    root.classList.remove('pb--sizing');
    if (!moved) return;
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
    const count = (c) => all().filter((n) => n.color === c).length;
    legendEl.innerHTML = opts.legend.map((item) => {
      const on = !hidden.has(item.color);
      return `<button type="button" class="pb-key" data-pb="filter" data-color="${escapeHtml(item.color)}" aria-pressed="${on}"
          title="${escapeHtml(item.description || t.filter)}">
        <span class="pb-swatch" style="--pb-note:${escapeHtml(colors[item.color] || item.color)}"></span>
        <span class="pb-key-label">${escapeHtml(item.label)}</span><span class="pb-count">${count(item.color)}</span>
      </button>`;
    }).join('') + gear;
  }

  /** The types offered when creating or recoloring: the legend, or every color without one. */
  const choices = () => (opts.legend.length ? opts.legend : Object.keys(colors).map((c) => ({ color: c, label: c })));
  const swatchOf = (c) => escapeHtml(colors[c] || c);

  /** Where a click lands on the glass, as a note position: its top-left corner, kept inside. */
  function pointOnGlass(ev) {
    if (isGrid()) return null;
    const box = glass.getBoundingClientRect();
    const noteWidth = Math.min(220, box.width * 0.23);
    return {
      x: Math.min(Math.max(0, (ev.clientX - box.left) / box.width), Math.max(0, 1 - noteWidth / box.width)),
      y: Math.max(0, Math.round(ev.clientY - box.top)),
    };
  }

  /* ---------- the right-click menu ---------- */
  function openMenu(ev, note) {
    menuNote = note || null;
    menuAt = note ? null : pointOnGlass(ev);
    const action = note ? 'menu-color' : 'menu-new';
    const items = choices().map((c) => `<button type="button" role="menuitem" class="pb-menu-item" data-pb="${action}" data-color="${escapeHtml(c.color)}"${note && note.color === c.color ? ' aria-current="true"' : ''}>
        <span class="pb-swatch" style="--pb-note:${swatchOf(c.color)}"></span><span class="pb-menu-label">${escapeHtml(c.label)}</span>
        ${c.description ? `<small>${escapeHtml(c.description)}</small>` : ''}</button>`).join('');
    const extra = note
      ? `<hr><button type="button" role="menuitem" class="pb-menu-item" data-pb="menu-edit"><span class="pb-menu-label">✎ ${escapeHtml(t.edit)}</span></button>
         <button type="button" role="menuitem" class="pb-menu-item" data-pb="menu-done"><span class="pb-menu-label">✓ ${escapeHtml(t.done)}</span></button>`
      : '';
    menu.innerHTML = `<p class="pb-menu-h">${escapeHtml(note ? t.menuColor : t.menuNew)}</p>${items}${extra}`;
    menu.hidden = false;
    // fixed to the viewport, flipped when it would leave the screen
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    menu.style.left = `${Math.max(4, ev.clientX + w > innerWidth ? ev.clientX - w : ev.clientX)}px`;
    menu.style.top = `${Math.max(4, ev.clientY + h > innerHeight ? ev.clientY - h : ev.clientY)}px`;
    (menu.querySelector('[aria-current]') || menu.querySelector('.pb-menu-item'))?.focus();
  }

  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    menu.innerHTML = '';
    menuNote = null;
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
    if (ev.key === 'Escape') { ev.preventDefault(); closeMenu(); return; }
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const items = [...menu.querySelectorAll('.pb-menu-item')];
    const i = items.indexOf(document.activeElement);
    items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
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
    closeMenu();
    dialog.innerHTML = `<form method="dialog" class="pb-form pb-settings">
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
      </div></form>`;
    const form = dialog.querySelector('form');
    const list = form.querySelector('.pb-types');
    form.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-pb]');
      if (!btn) return;
      const row = btn.closest('.pb-type');
      const action = btn.dataset.pb;
      if (action === 'cancel') dialog.close();
      if (action === 'type-remove') row.remove();
      if (action === 'type-up' && row.previousElementSibling) row.previousElementSibling.before(row);
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
      dialog.close();
      savedLegend = legend;
      applyLegend();
      const lock = form.querySelector('[name=lockSize]');
      const sizeChanged = lock && lock.checked !== size.locked;
      if (sizeChanged) { size = { ...size, locked: lock.checked }; applySize(); }
      const ex = form.querySelector('[name=expand]:checked')?.value;
      const viewChanged = ex && ex !== expand();
      if (viewChanged) { view = normalizeView({ ...view, expand: ex }); opened.clear(); }
      render();
      try { await opts.store?.saveLegend?.(legend); } catch (err) { fail(err); }
      if (sizeChanged) await saveSize();
      if (viewChanged) { try { await opts.store?.saveView?.(view); } catch (err) { fail(err); } }
    });
    dialog.showModal();
    form.querySelector('[name=label]')?.focus();
  }

  async function save(note, patch) {
    if (note.auto) positions[note.key] = { x: note.x, y: note.y, z: note.z };
    if (!opts.store) return;
    try {
      return await opts.store.update(refOf(note), patch);
    } catch (err) { fail(err); }
  }

  /* ---------- the edit dialog ---------- */
  function openEditor(note, at) {
    closeMenu();
    const types = choices();
    const current = note?.color || at?.color || opts.defaultColor || (types.some((c) => c.color === 'yellow') ? 'yellow' : types[0]?.color) || 'yellow';
    dialog.innerHTML = `<form method="dialog" class="pb-form">
      <h2 id="${id}-h">${escapeHtml(note ? t.editNote : t.newNote)}</h2>
      <label>${escapeHtml(t.title)}<input name="title" maxlength="120" value="${escapeHtml(note?.title)}"></label>
      <label>${escapeHtml(t.text)}<textarea name="text" rows="4" maxlength="2000">${escapeHtml(note?.text)}</textarea></label>
      <fieldset class="pb-colors"><legend>${escapeHtml(t.color)}</legend>${types.map((c) => `
        <label class="pb-choice" title="${escapeHtml(c.description || c.label)}"><input type="radio" name="color" value="${escapeHtml(c.color)}"${c.color === current ? ' checked' : ''}>
          <span class="pb-swatch" style="--pb-note:${swatchOf(c.color)}"></span>${escapeHtml(c.label)}</label>`).join('')}
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
      </div></form>`;
    const form = dialog.querySelector('form');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(form);
      const draft = {
        title: f.get('title').trim(), text: f.get('text').trim(), color: f.get('color') || current,
        due: fromLocalInput(f.get('due')), link: safeUrl(f.get('link')), linkLabel: f.get('linkLabel').trim(),
        image: safeUrl(f.get('image')),
      };
      if (!draft.title && !draft.text && !draft.image) return dialog.close();
      dialog.close();
      if (note) {
        Object.assign(note, draft);
        render();
        await save(note, draft);
      } else {
        const local = normalizeNote({ ...draft, id: -Date.now(), x: at?.x ?? null, y: at?.y ?? null, z: topZ() + 1 });
        notes.push(local);
        render();
        if (!opts.store) return;
        try {
          const saved = await opts.store.create({ ...draft, x: local.x, y: local.y, z: local.z });
          Object.assign(local, normalizeNote(saved));
          render();
        } catch (err) { notes = notes.filter((n) => n !== local); render(); fail(err); }
      }
    });
    dialog.querySelector('[data-pb=cancel]').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-pb=remove]')?.addEventListener('click', async () => {
      dialog.close();
      notes = notes.filter((n) => n !== note);
      render();
      await save(note, { removed: true });
    });
    dialog.showModal();
    form.elements.text.focus();
  }

  const topZ = () => Math.max(0, ...all().map((n) => n.z || 0));

  /* ---------- events ---------- */
  function onClick(ev) {
    const btn = ev.target.closest('[data-pb]');
    if (!btn) return onNoteClick(ev);
    if (!root.contains(btn)) return;
    const action = btn.dataset.pb;
    if (action.startsWith('reader-')) {
      const target = readerNote;
      dialog.close();
      if (target && action === 'reader-edit') return openEditor(target);
      if (target && action === 'reader-done') return finish(target);
      return;
    }
    if (action === 'more') return toggleOpen(btn.closest('.pb-note'));
    if (action === 'add') return openEditor(null);
    if (action === 'settings') return openSettings();
    if (action === 'menu-new') {
      const at = { ...menuAt, color: btn.dataset.color };
      closeMenu();
      return openEditor(null, at);
    }
    if (action.startsWith('menu-')) {
      const target = menuNote;
      closeMenu();
      if (!target) return;
      if (action === 'menu-edit') return openEditor(target);
      if (action === 'menu-done') return finish(target);
      if (action === 'menu-color' && target.color !== btn.dataset.color) {
        target.color = btn.dataset.color;
        target.z = topZ() + 1;
        render();
        save(target, { color: target.color, z: target.z });
      }
      return;
    }
    if (action === 'filter') {
      const c = btn.dataset.color;
      if (hidden.has(c)) hidden.delete(c); else hidden.add(c);
      return render();
    }
    const el = btn.closest('.pb-note');
    const note = el && find(el.dataset.ref);
    if (!note) return;
    if (action === 'edit') return openEditor(note);
    if (action === 'done') finish(note);
  }

  /** A click on the note itself (not a link, a button or the end of a drag). */
  function onNoteClick(ev) {
    if (ev.target === dialog && dialog.classList.contains('pb-dialog--reader')) return dialog.close(); // the backdrop
    const el = ev.target.closest('.pb-note');
    if (!el || !glass.contains(el) || ev.target.closest('a,button,input,textarea') || dragged) return;
    const note = find(el.dataset.ref);
    if (!note) return;
    if (expand() === 'center') return openReader(note);
    if (expand() === 'inplace' && (lastPointer === 'touch' || lastPointer === 'pen')) toggleOpen(el);
  }

  function finish(note) {
    glass.querySelector(`[data-ref="${CSS.escape(refId(refOf(note)))}"]`)?.classList.add('pb-note--leaving');
    notes = notes.filter((n) => n !== note);
    setTimeout(render, 180);
    save(note, { done: true });
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
    const r = el.getBoundingClientRect();
    note.z = topZ() + 1;
    el.style.setProperty('--pb-z', note.z);
    el.classList.add('pb-note--dragging');
    el.setPointerCapture?.(ev.pointerId);
    drag = { el, note, dx: ev.clientX - r.left, dy: ev.clientY - r.top, x0: ev.clientX, y0: ev.clientY, moved: false };
  }

  function onPointerMove(ev) {
    if (!drag) return;
    const box = glass.getBoundingClientRect();
    const w = drag.el.offsetWidth;
    if (!drag.moved && Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < 4) return;
    drag.moved = true;
    drag.note.x = Math.min(Math.max(0, (ev.clientX - box.left - drag.dx) / box.width), Math.max(0, 1 - w / box.width));
    drag.note.y = Math.max(0, Math.round(ev.clientY - box.top - drag.dy));
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
    fitHeight();
    // the note touched last stays on top, also after a reload
    save(note, moved || note.auto ? { x: note.x, y: note.y, z: note.z } : { z: note.z });
  }

  let keyTimer = null;
  function onKeyDown(ev) {
    const el = ev.target.closest?.('.pb-note');
    if (!el || ev.target !== el) return;
    const note = find(el.dataset.ref);
    if (!note) return;
    if (ev.key === 'Enter') { ev.preventDefault(); return expand() === 'center' ? openReader(note) : note.auto ? toggleOpen(el) : openEditor(note); }
    const step = ev.shiftKey ? 5 : 1;
    const moves = { ArrowLeft: [-0.01, 0], ArrowRight: [0.01, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
    const m = moves[ev.key];
    if (!m || isGrid()) return;
    ev.preventDefault();
    note.x = Math.min(Math.max(0, note.x + m[0] * step), 0.95);
    note.y = Math.max(0, note.y + m[1] * step);
    el.style.setProperty('--pb-x', note.x);
    el.style.setProperty('--pb-y', `${note.y}px`);
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => save(note, { x: note.x, y: note.y }), 400);
  }

  let lastPointer = 'mouse';
  root.addEventListener('pointerdown', (ev) => { lastPointer = ev.pointerType || 'mouse'; }, true);
  root.addEventListener('click', onClick);
  glass.addEventListener('dblclick', onDblClick);
  glass.addEventListener('pointerdown', onPointerDown);
  glass.addEventListener('pointermove', onPointerMove);
  glass.addEventListener('pointerup', onPointerUp);
  glass.addEventListener('pointercancel', onPointerUp);
  root.addEventListener('keydown', onKeyDown);
  glass.addEventListener('contextmenu', onContextMenu);
  menu.addEventListener('keydown', onMenuKey);
  document.addEventListener('pointerdown', onOutside, true);
  addEventListener('scroll', closeMenu, true);
  addEventListener('resize', closeMenu);
  addEventListener('blur', closeMenu);
  // a wider or narrower window reflows the notes nobody placed
  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (drag || !flowColumns || columnsFor(glass.clientWidth || 1) === flowColumns) return;
      for (const n of all()) {
        const k = refId(refOf(n));
        if (flowed.get(k) === `${n.x},${n.y}`) { n.x = null; n.y = null; }
        flowed.delete(k);
      }
      render();
    }, 150);
  };
  addEventListener('resize', onResize);
  stage.addEventListener('pointerdown', onResizeDown);
  stage.addEventListener('pointermove', onResizeMove);
  stage.addEventListener('pointerup', onResizeUp);
  stage.addEventListener('pointercancel', onResizeUp);
  stage.addEventListener('dblclick', resetSize);
  // due chips move from "Tomorrow" to "Today" to overdue without a reload
  const ticker = setInterval(() => { if (!drag && !dialog.open && all().some((n) => n.due)) render(); }, 60_000);

  setData({ notes: opts.notes, auto: opts.auto, positions: opts.positions });
  applySize();
  render();

  return {
    /** Replace the data (any of notes, auto, positions) and redraw. */
    update(data = {}) { setData(data); if (!drag) render(); },
    /** Load everything from `store.load()` (shape `{ notes, positions, legend? }`). */
    async reload() {
      if (!opts.store?.load) return;
      try {
        const data = await opts.store.load();
        if (data.legend) { savedLegend = data.legend; applyLegend(); }
        if (data.size) { size = normalizeSize(data.size); applySize(); }
        if (data.view) view = normalizeView(data.view);
        setData({ notes: data.notes, positions: data.positions });
        render();
      } catch (err) { fail(err); }
    },
    /** Change options (legend, strings, colors…) after mounting. */
    configure(next = {}) {
      if (next.legend) appLegend = next.legend;
      opts = { ...opts, ...next };
      t = { ...DEFAULT_STRINGS, ...opts.strings };
      applyLegend();
      render();
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
    destroy() {
      clearInterval(ticker);
      clearTimeout(keyTimer);
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onOutside, true);
      removeEventListener('scroll', closeMenu, true);
      removeEventListener('resize', closeMenu);
      removeEventListener('resize', onResize);
      clearTimeout(resizeTimer);
      removeEventListener('blur', closeMenu);
      root.classList.remove('pb');
      root.innerHTML = '';
    },
  };
}


global.PostitBoard = { DEFAULT_STRINGS, restStore, localStore, createBoard, DEFAULT_COLORS, LIMITS, isColorKey, isHex, SIZE, normalizeSize, EXPAND, normalizeView, normalizeLegend, mergeLegend, legendColors, safeUrl, escapeHtml, linkify, tilt, normalizeDue, normalizeNote, refOf, refId, autoPlace, withPositions, boardHeight, dueStatus, formatDue, toLocalInput, fromLocalInput };
})(typeof globalThis !== 'undefined' ? globalThis : window);
