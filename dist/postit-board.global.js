/*! postit-board v0.7.0 | MIT | https://github.com/rbritta/postit-board */
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

const LIMITS = Object.freeze({ title: 120, text: 2000, url: 2048, linkLabel: 80, color: 32, label: 40, description: 160, legend: 24, lanes: 12, laneId: 64, laneName: 40, signature: 100 });

const COLOR_KEY = /^[a-z][a-z0-9-]{0,31}$/;

const isColorKey = (value) => typeof value === 'string' && COLOR_KEY.test(value);
const isHex = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

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

/**
 * The board view people chose in the gear: `{ expand, archiveBox }`. `archiveBox` says whether the Archive box
 * shows up while a note is dragged. Unknown values become null (the app default).
 */
function normalizeView(view) {
  const v = view && typeof view === 'object' ? view : {};
  return { expand: EXPAND.includes(v.expand) ? v.expand : null, archiveBox: typeof v.archiveBox === 'boolean' ? v.archiveBox : null };
}

/** Lanes split the board into columns: by state (a Kanban) or by category. Off by default. */
const LANE_MODES = Object.freeze(['states', 'categories']);
/** The lanes each mode starts with. The board names them from its strings (laneTodo, laneWork…). */
const LANE_PRESETS = Object.freeze({ states: Object.freeze(['todo', 'doing', 'waiting', 'done']), categories: Object.freeze(['work', 'home', 'ideas']) });

const laneKey = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, LIMITS.laneId) : '');

/** A list of lanes, left to right: `[{ id, name }]`, ids unique, at most LIMITS.lanes. Null when none is usable. */
function laneList(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const id = laneKey(item?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: text(item.name, LIMITS.laneName).trim() });
    if (out.length >= LIMITS.lanes) break;
  }
  return out.length ? out : null;
}

/**
 * The lanes of a board: `{ mode, states?, categories? }`. `mode` is 'off' (the default), 'states' or
 * 'categories'; each mode keeps its own list of `{ id, name }`, left to right. A list left out means the
 * preset one, and an empty name is filled by the board.
 */
function normalizeLanes(lanes) {
  const l = lanes && typeof lanes === 'object' ? lanes : {};
  const out = { mode: LANE_MODES.includes(l.mode) ? l.mode : 'off' };
  for (const m of LANE_MODES) {
    const list = laneList(l[m]);
    if (list) out[m] = list;
  }
  return out;
}

/**
 * A note's lane in each mode: `{ states?, categories? }` (lane ids). A string means the same lane in both
 * modes, which is handy for app notes. Null when it says nothing.
 */
function normalizeLaneOf(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    const id = laneKey(value);
    return id ? { states: id, categories: id } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const out = {};
  for (const m of LANE_MODES) {
    const id = laneKey(value[m]);
    if (id) out[m] = id;
  }
  return Object.keys(out).length ? out : null;
}

/** Where a note sits inside its lane, in each mode: `{ states?: { x, y } }`, x 0..1 of the lane's free width, y px. */
function normalizeLanePos(value) {
  if (!value || typeof value !== 'object') return null;
  const out = {};
  for (const m of LANE_MODES) {
    const p = value[m];
    if (!p || typeof p !== 'object') continue;
    const x = num(p.x);
    const y = num(p.y);
    if (x !== null && y !== null) out[m] = { x: clamp(x, 0, 1), y: Math.max(0, Math.round(y)) };
  }
  return Object.keys(out).length ? out : null;
}

/** `fillText('Moved to {lane}', { lane: 'Doing' })`: a string with its blanks filled. Escape the result before rendering it. */
const fillText = (template, values = {}) => String(template ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));

/**
 * A legend as the board and the stores keep it: `[{ color, label, description?, hex?, locked? }]`.
 * `color` is the key notes carry; `hex` repaints that key; `locked` marks a type the app owns
 * (its color can't change and it can't be removed, only renamed). Bad entries are dropped.
 */
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

/**
 * Only http(s), relative (`/x`, `./x`, `../x`) and in-page links: never `javascript:` or `data:`,
 * and never another site through a protocol-relative link (`//x`, which browsers also read in
 * `/\x` and in `/<tab>/x`, since they drop tabs and line breaks from URLs).
 */
function safeUrl(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || url.length > LIMITS.url || /[\u0000-\u001f\u007f]/.test(url)) return null;
  if (/^(\/(?![/\\])|\.{1,2}\/|#|\?)/.test(url)) return url;
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
    lane: normalizeLaneOf(n.lane),
    lanePos: normalizeLanePos(n.lanePos),
  };
  if (auto && !out.key) throw new Error('an automatic note needs a key');
  return out;
}

const refOf = (note) => (note.auto ? { key: note.key } : { id: note.id });
const refId = (ref) => (ref.key != null ? `key:${ref.key}` : `id:${ref.id}`);

/**
 * The signature of what the app sent for an app note: its title, text, due time, link and color, as a short
 * string (`s1:` and a hash). Dismissing an app note stores this with its key (`dismissed`); the note stays
 * hidden while the app sends the same content, and shows again when the content changes.
 */
function autoSignature(note) {
  const n = note || {};
  const raw = JSON.stringify([text(n.title, LIMITS.title).trim(), text(n.text, LIMITS.text).trim(), normalizeDue(n.due), safeUrl(n.link), isColorKey(n.color) ? n.color : 'yellow']);
  // cyrb53: small and stable, the same in Node and in every browser
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `s1:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/** A stored `dismissed` signature: text up to LIMITS.signature characters, or null. */
const normalizeSignature = (value) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, LIMITS.signature) : null);

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

/** Automatic notes come from the app on every render; only their position is stored, by key (in lanes too). */
function withPositions(autoNotes, positions = {}) {
  return autoNotes.map((n) => {
    const saved = positions[n.key];
    return saved ? { ...n, x: num(saved.x), y: num(saved.y), z: num(saved.z) ?? 0, lanePos: normalizeLanePos(saved.lanePos) } : n;
  });
}

const boardHeight = (notes, { min = 560, noteHeight = 250 } = {}) =>
  Math.max(min, ...notes.map((n) => (n.y ?? 0) + noteHeight));

const DAY = 86_400_000;

/**
 * Dates and times follow the browser (its language, its time zone, its 12 or 24 hours) unless the app
 * passes `locale`, `timeZone` or `hour12`. A locale or a zone the runtime does not know falls back to the
 * runtime's own, one at a time, instead of throwing.
 */
const FORMATTERS = new Map();
function formatter(locale, options) {
  const key = JSON.stringify([locale ?? null, options]);
  let f = FORMATTERS.get(key);
  if (!f) {
    const { timeZone: _zone, ...anyZone } = options;
    for (const [l, o] of [[locale, options], [undefined, options], [locale, anyZone], [undefined, anyZone]]) {
      try { f = new Intl.DateTimeFormat(l, o); break; } catch { /* try the next fallback */ }
    }
    FORMATTERS.set(key, f);
  }
  return f;
}

/** The calendar day of a time as a day number, in `timeZone` (default: the runtime's). */
function dayNumber(at, timeZone) {
  const parts = Object.fromEntries(formatter('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(at).map((p) => [p.type, p.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / DAY;
}

/** Whether the locale writes `5:30 PM` (12 hours) rather than `17:30`, as its own clock does. */
function usesTwelveHours(locale, timeZone) {
  const cycle = formatter(locale, { timeZone, hour: 'numeric' }).resolvedOptions().hourCycle;
  return cycle === 'h11' || cycle === 'h12';
}

/** 'overdue' | 'today' | 'soon' (next 7 days) | 'later' | null, the days counted in `timeZone`. */
function dueStatus(due, now = new Date(), { timeZone } = {}) {
  if (!due) return null;
  const at = new Date(due);
  if (Number.isNaN(at.getTime())) return null;
  if (at <= now) return 'overdue';
  const days = dayNumber(at, timeZone) - dayNumber(now, timeZone);
  if (days === 0) return 'today';
  return days < 7 ? 'soon' : 'later';
}

/**
 * "Today 18:00", "Tomorrow 9:30 AM", "Fri 14:00" or "Nov 20, 14:00". The locale picks the words of the
 * date and 12 or 24 hours; `hour12` forces one; `timeZone` says which day and hour it is.
 */
function formatDue(due, { locale, timeZone, hour12, now = new Date(), words = {} } = {}) {
  if (!due) return '';
  const at = new Date(due);
  if (Number.isNaN(at.getTime())) return '';
  const time = clockTime(at, { locale, timeZone, hour12 });
  const days = dayNumber(at, timeZone) - dayNumber(now, timeZone);
  if (days === 0) return `${words.today ?? 'Today'} ${time}`;
  if (days === 1) return `${words.tomorrow ?? 'Tomorrow'} ${time}`;
  if (days === -1) return `${words.yesterday ?? 'Yesterday'} ${time}`;
  if (days > 1 && days < 7) return `${formatter(locale, { timeZone, weekday: 'short' }).format(at)} ${time}`;
  const year = (d) => formatter('en-CA', { timeZone, year: 'numeric' }).format(d);
  const date = formatter(locale, { timeZone, day: 'numeric', month: 'short', ...(year(at) === year(now) ? {} : { year: 'numeric' }) }).format(at);
  return `${date}, ${time}`;
}

/** The hour of a time, in 12 or 24 hours as the locale writes it, unless `hour12` says. */
function clockTime(at, { locale, timeZone, hour12 }) {
  const twelve = typeof hour12 === 'boolean' ? hour12 : usesTwelveHours(locale, timeZone);
  return formatter(locale, twelve ? { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }
    : { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

/**
 * When something happened (a note archived): "Today 9:30 AM", "Yesterday 18:00", "Thu 21:33" within the
 * week, then the date alone ("Nov 4", with the year when it is another one). Same options as `formatDue`.
 */
function formatWhen(when, { locale, timeZone, hour12, now = new Date(), words = {} } = {}) {
  if (!when) return '';
  const at = new Date(when);
  if (Number.isNaN(at.getTime())) return '';
  const days = dayNumber(now, timeZone) - dayNumber(at, timeZone);
  if (days === 0) return `${words.today ?? 'Today'} ${clockTime(at, { locale, timeZone, hour12 })}`;
  if (days === 1) return `${words.yesterday ?? 'Yesterday'} ${clockTime(at, { locale, timeZone, hour12 })}`;
  if (days > 1 && days < 7) return `${formatter(locale, { timeZone, weekday: 'short' }).format(at)} ${clockTime(at, { locale, timeZone, hour12 })}`;
  const year = (d) => formatter('en-CA', { timeZone, year: 'numeric' }).format(d);
  return formatter(locale, { timeZone, day: 'numeric', month: 'short', ...(year(at) === year(now) ? {} : { year: 'numeric' }) }).format(at);
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
 * Right-click a note for its menu: State or Category (with lanes), Color, Edit and, last, Archive.
 * An app note's menu has Open → (its link) and Dismiss. A dragged note lifts off the glass and follows the pointer.
 * The gear at the end of the legend opens the board settings: Types, Lanes and View.
 *
 * Two kinds of notes live together:
 *   - notes people write (`notes`): editable; the ✓, the menu or a drop on the Archive box archives them;
 *   - automatic notes your app computes (`auto`): folded corner, read-only, never archived, they go away
 *     when your app stops sending them. Their menu has Open → (their link) and Dismiss, which hides one until
 *     the app sends something else for it. Only their position and that Dismiss are stored, by `key`.
 *
 * Archived notes (`done: true` in the store) leave the board and are listed by the Archived button next to
 * "+ Note", when the store has `archived()`: Restore puts one back, Delete for good removes it.
 *
 * Lanes are off by default. On, they split the glass into columns: by state (a Kanban) or by category.
 * Each note keeps its value in both modes (`lane`) and its place inside its lane (`lanePos`).
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


const DEFAULT_STRINGS = Object.freeze({
  add: '+ Note',
  empty: 'Nothing on the board.',
  hint: 'Drag notes around · folded corners are added and removed by the app',
  hintStates: 'Drag a note to another state',
  hintCategories: 'Drag a note to another category',
  hintArchived: 'Archived notes · Restore puts one back on the board',
  open: 'Open →',
  edit: 'Edit',
  archive: 'Archive',
  archiveHint: 'Leaves the board · stays in Archived',
  dismiss: 'Dismiss',
  dismissHint: 'Hides it until the app changes it',
  dismissedToast: 'Dismissed “{title}”',
  bringBack: 'Bring back',
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
  menuNewIn: 'New note here · {lane}',
  settings: 'Board settings',
  settingsHint: 'Each color is a type of note. Rename it, say what it means or pick another color. Notes keep their type, in every lane.',
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
  // Archive and Archived
  archived: 'Archived',
  archivedShow: 'Show the archived notes',
  archivedHide: 'Back to the board',
  dropArchive: 'Drop here to archive',
  releaseArchive: 'Release to archive',
  archiveBalloon: 'The note leaves the board. You can still see it in Archived.',
  dropDismiss: 'Drop here to dismiss',
  releaseDismiss: 'Release to dismiss',
  dismissBalloon: 'It leaves the board until the app changes it. You can bring it back from Archived.',
  archivedToast: 'Archived “{title}”',
  undo: 'Undo',
  restoredToast: '“{title}” is back on the board',
  restoredInToast: '“{title}” is back on the board in {lane}',
  show: 'Show',
  deletedToast: '“{title}” deleted for good',
  movedToast: 'Moved to {lane}',
  filterArchived: 'Filter archived notes',
  notesOne: '1 note',
  notesMany: '{n} notes',
  notesOf: '{n} of {total}',
  colNote: 'Note',
  colType: 'Type',
  colWhen: 'When',
  archivedChip: 'Archived',
  dismissedChip: 'Dismissed',
  dismissedTitle: 'From the app · it comes back when the app changes it',
  filterKind: 'Show',
  filterAll: 'All',
  filterArchivedOnly: 'Archived',
  filterDismissed: 'Dismissed',
  colActions: 'Actions',
  restore: 'Restore',
  deleteForGood: 'Delete for good',
  deleteConfirm: 'Delete for good?',
  deleteYes: 'Delete',
  keep: 'Keep',
  archivedEmpty: 'Nothing archived yet',
  archivedEmptyHint: 'Notes you archive land here, with the day they were archived. Restore brings one back to the board.',
  archivedNoMatch: 'No archived note matches “{q}”',
  clearFilter: 'Clear the filter',
  archivedHidden: 'Nothing to show',
  archivedHiddenHint: 'Every archived note has a hidden color. Turn the colors back on in the legend.',
  loading: 'Loading…',
  // Lanes
  state: 'State',
  states: 'States',
  category: 'Category',
  categories: 'Categories',
  addState: '+ State',
  addCategory: '+ Category',
  laneTodo: 'To do',
  laneDoing: 'Doing',
  laneWaiting: 'Waiting',
  laneDone: 'Done',
  laneWork: 'Work',
  laneHome: 'Home',
  laneIdeas: 'Ideas',
  laneEmpty: 'No notes · drag one here',
  laneEmptyPhone: 'No notes here. Hold a note to move it.',
  laneRemoved: 'removed',
  back: '‹ Back',
  // narrow screens
  showMore: 'Show {n} more',
  showLess: 'Show less',
  // Board settings
  tabTypes: 'Types',
  tabLanes: 'Lanes',
  tabView: 'View',
  typesTitle: 'Note types',
  lanesTitle: 'Split the board into lanes',
  modeOff: 'Off',
  modeOffHint: 'One free board. Notes go anywhere.',
  modeStates: 'States · Kanban',
  modeStatesHint: 'Each lane is a step: To do → Doing → Done. Drag a note to move it on.',
  modeCategories: 'Categories',
  modeCategoriesHint: 'Each lane is a group: Work, Home, Ideas. Drag a note to file it.',
  lanesOffHint: 'Lanes are off. Pick States or Categories to split the board into columns; each keeps its own list, and colors keep meaning the type.',
  lanesListHint: 'Left to right on the board. Rename, reorder, add or remove.',
  laneName: 'Name',
  moveLeft: 'Move left',
  moveRight: 'Move right',
  removeLane: 'Remove',
  laneGoneOne: 'its note goes to',
  laneGoneMany: 'its {n} notes go to',
  laneGoneNone: 'no notes in it',
  laneMoveTo: 'Move its notes to',
  lanesWarn: 'More than 5 lanes: the notes get narrow on a desktop board.',
  boardGroup: 'Board',
  archiveBoxOption: 'Show the Archive box while a note is dragged (Dismiss for app notes)',
});

const DEFAULTS = {
  legend: [],
  notes: [],
  auto: [],
  positions: {},
  colors: {},
  strings: {},
  locale: undefined,
  timeZone: undefined,
  hour12: undefined,
  store: null,
  addButton: true,
  archivedButton: null,
  archiveBox: true,
  contextMenu: true,
  editLegend: null,
  defaultColor: null,
  gridBelow: 700,
  resizable: true,
  width: SIZE.width,
  size: null,
  expand: 'center',
  view: null,
  lanes: null,
  narrowOrder: 'position',
  narrowLimit: null,
  onError: (err) => console.error('[postit-board]', err),
  now: () => new Date(),
};

/** How long a transition takes (ms) when the stylesheet does not say (--pb-motion-in, --pb-motion-out). */
const MOTION = Object.freeze({ in: 240, out: 180 });
/** What arrives slows down at the end; what leaves goes a little faster and eases at both ends. */
const EASE = Object.freeze({ in: 'cubic-bezier(0.2, 0, 0, 1)', out: 'cubic-bezier(0.4, 0, 0.2, 1)' });
/** What `save` returns when the store failed (it already reported the error). */
const FAILED = Symbol('failed');
/** With lanes, nothing sits over the header row (40 px): notes start, and land, this far down. */
const LANE_TOP = 56;
/** The room on each side of a note inside its lane. */
const LANE_GAP = 12;
/** How long "Archived · Undo" stays. */
const TOAST_MS = 6000;
/** How long a finger holds a note on a phone before its menu opens. */
const PRESS_MS = 480;
/** The Archive box: never narrower than this, and this far from the glass and from the window's edge. */
const BOX = Object.freeze({ min: 96, gap: 14, pad: 8, pill: { w: 150, h: 40 }, balloon: 214 });
const TABS = Object.freeze(['types', 'lanes', 'view']);

const svg = (viewBox, body, extra = '') => `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;
/** Icons are markup with presentation attributes only: nothing a strict CSP drops. */
const ICONS = Object.freeze({
  /** the box with a check: the drop target, the menu item and the toast */
  box: svg('0 0 64 64', '<rect x="7" y="11" width="50" height="13" rx="3"/><path d="M11 24v26a4 4 0 0 0 4 4h34a4 4 0 0 0 4-4V24"/><path d="M23 38l7 7 12-13"/>', ' stroke-width="3.2" class="pb-ico-box"'),
  archive: svg('0 0 24 24', '<rect x="2.5" y="4" width="19" height="5" rx="1.2"/><path d="M4.5 9v9.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/>', ' stroke-width="2"'),
  search: svg('0 0 24 24', '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.6-4.6"/>', ' stroke-width="2.4"'),
  lanes: svg('0 0 24 24', '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>', ' stroke-width="2"'),
  /** an eye struck through: Dismiss hides an app note */
  dismiss: svg('0 0 24 24', '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 20L20 4"/>', ' stroke-width="2"'),
  artOff: '<svg class="pb-mode-art" viewBox="0 0 150 40" fill="currentColor" aria-hidden="true" focusable="false"><rect x="0.5" y="0.5" width="149" height="39" rx="5" fill="none" stroke="currentColor" opacity=".5"/><rect x="12" y="7" width="24" height="18" rx="2" transform="rotate(-4 24 16)"/><rect x="52" y="14" width="24" height="18" rx="2" transform="rotate(3 64 23)"/><rect x="92" y="6" width="24" height="18" rx="2"/><rect x="118" y="17" width="20" height="16" rx="2" transform="rotate(-3 128 25)"/></svg>',
  artStates: '<svg class="pb-mode-art" viewBox="0 0 150 40" fill="currentColor" aria-hidden="true" focusable="false"><rect x="0.5" y="0.5" width="149" height="39" rx="5" fill="none" stroke="currentColor" opacity=".5"/><path d="M38 4v32M75 4v32M112 4v32" stroke="currentColor" opacity=".45"/><rect x="8" y="9" width="22" height="10" rx="2"/><rect x="8" y="23" width="22" height="10" rx="2"/><rect x="45" y="9" width="22" height="10" rx="2"/><rect x="120" y="9" width="22" height="10" rx="2" opacity=".55"/><path d="M80 24h22m-5-4 5 4-5 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  artCats: '<svg class="pb-mode-art" viewBox="0 0 150 40" fill="currentColor" aria-hidden="true" focusable="false"><rect x="0.5" y="0.5" width="149" height="39" rx="5" fill="none" stroke="currentColor" opacity=".5"/><path d="M50 4v32M100 4v32" stroke="currentColor" opacity=".45"/><circle cx="12" cy="10" r="3"/><rect x="18" y="7" width="22" height="6" rx="2" opacity=".6"/><circle cx="62" cy="10" r="3"/><rect x="68" y="7" width="22" height="6" rx="2" opacity=".6"/><circle cx="112" cy="10" r="3"/><rect x="118" y="7" width="22" height="6" rx="2" opacity=".6"/><rect x="10" y="18" width="30" height="14" rx="2"/><rect x="60" y="18" width="30" height="14" rx="2"/><rect x="110" y="18" width="30" height="14" rx="2"/></svg>',
});

let uid = 0;

const bound = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const copy = (value) => (value == null ? null : JSON.parse(JSON.stringify(value)));
const wait = (ms) => new Promise((resolve) => { if (ms > 0) setTimeout(resolve, ms); else resolve(); });

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
    archived: () => call('GET', '/archived'),
    create: (draft) => call('POST', '', draft),
    update: (ref, patch) =>
      ref.key != null ? call('PUT', `/key/${encodeURIComponent(ref.key)}`, patch) : call('PATCH', `/${encodeURIComponent(ref.id)}`, patch),
    saveLegend: (legend) => call('PUT', '/legend', { legend }),
    saveLanes: (lanes) => call('PUT', '/lanes', { lanes }),
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
  const stamp = () => new Date().toISOString();
  const setting = (key, clean) => {
    const d = read();
    d[key] = clean;
    write(d);
    return { [key]: d[key] };
  };
  return {
    load: () => {
      const d = read();
      const out = { notes: d.notes.filter((n) => !n.doneAt), positions: d.positions };
      for (const key of ['legend', 'size', 'view', 'lanes']) if (d[key]) out[key] = d[key];
      return out;
    },
    /** Archived notes, the last archived first. */
    archived: () => ({ notes: read().notes.filter((n) => n.doneAt).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)) || b.id - a.id) }),
    saveSize: (size) => setting('size', normalizeSize(size)),
    saveView: (view) => setting('view', normalizeView(view)),
    saveLegend: (legend) => setting('legend', normalizeLegend(legend)),
    saveLanes: (lanes) => setting('lanes', normalizeLanes(lanes)),
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
        if (patch.lanePos !== undefined) pos.lanePos = normalizeLanePos(patch.lanePos);
        if (!pos.lanePos) delete pos.lanePos;
        if (patch.dismissed !== undefined) {
          pos.dismissed = normalizeSignature(patch.dismissed);
          pos.dismissedAt = pos.dismissed ? stamp() : null;
        }
        if (!pos.dismissed) { delete pos.dismissed; delete pos.dismissedAt; }
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

function createBoard(root, options = {}) {
  if (!root) throw new Error('createBoard needs an element');
  const id = `pb${++uid}`;
  let opts = { ...DEFAULTS, ...options };
  let t;
  function applyStrings() {
    const s = opts.strings || {};
    t = { ...DEFAULT_STRINGS, ...s };
    // before 0.7.0 the ✓ said "Done": an app that translated `done` and not `archive` keeps its word
    if (s.archive === undefined && typeof s.done === 'string') t.archive = s.done;
  }
  applyStrings();
  let appLegend = opts.legend; // what the app ships; opts.legend is that plus what people saved
  let savedLegend = null;
  let colors;
  const baseColors = () => ({ ...DEFAULT_COLORS, ...opts.colors });
  function applyLegend() {
    opts.legend = mergeLegend(appLegend, savedLegend);
    colors = { ...baseColors(), ...legendColors(opts.legend) };
  }
  applyLegend();
  let appLanes = opts.lanes; // the lanes the app ships; people's choice in the gear wins
  let savedLanes = null;
  let lanes;
  const applyLanes = () => { lanes = normalizeLanes(savedLanes ?? appLanes); };
  applyLanes();
  const canEditLegend = () => opts.editLegend ?? Boolean(opts.store?.saveLegend);
  const locale = () => opts.locale || globalThis.navigator?.language || 'en';
  /** How due times read: the browser's language, zone and clock, unless the app set locale, timeZone or hour12. */
  const clock = () => ({ locale: locale(), timeZone: opts.timeZone || undefined, hour12: typeof opts.hour12 === 'boolean' ? opts.hour12 : undefined });
  let notes = [];
  let auto = [];
  let dismissedAuto = []; // app notes people dismissed, still sent with the same content: listed in Archived
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
  // Archive and Archived
  let archiveView = false; // the glass shows the table of archived notes
  let archivedList = null; // null until the store answered
  let archiveFilter = '';
  let archiveKind = 'all'; // Archived shows 'all', only 'archived' or only 'dismissed' (when some app note is dismissed)
  let confirming = null; // the archived note asking "Delete for good?"
  let bump = false; // the Archived count pulses on the next redraw
  const entering = new Set(); // notes that come back (Undo, Restore): they fade in on the next redraw
  const landing = new Set(); // dragged notes whose lifted copy is gliding back: hidden (also across a redraw) until it lands
  let toastNow = null;
  let press = null; // a finger holding a note on a phone
  // lanes
  let flashLane = null;
  const collapsed = new Set(); // lane sections folded on a phone
  const laneFlowed = new Map(); // where a note nobody placed was flowed in its lane: it reflows when the window changes
  // narrow screens: how many notes show before "Show N more", unfolded per lane ('' without lanes)
  const unfolded = new Set();

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
    <div class="pb-menu pb-menu--sub" role="menu" hidden></div>
    <dialog class="pb-dialog" aria-labelledby="${id}-h"></dialog>`;
  const bar = root.querySelector('.pb-bar');
  const glass = root.querySelector('.pb-glass');
  const stage = root.querySelector('.pb-stage');
  const legendEl = root.querySelector('.pb-legend');
  const [menu, sub] = root.querySelectorAll('.pb-menu');
  const dialog = root.querySelector('.pb-dialog');
  let menuAt = null; // { x, y, lane?, lanePos? } on the glass, or null in the phone grid
  let menuNote = null; // the note of the open menu or sheet
  let menuReturn = null;
  let subFrom = null; // the item whose submenu is open
  let subTimer = 0;

  const isGrid = () => root.clientWidth > 0 && root.clientWidth < opts.gridBelow;
  const all = () => [...auto, ...notes];
  const find = (ref) => all().find((n) => refId(refOf(n)) === ref);
  const noteEl = (ref) => (ref ? glass.querySelector(`.pb-note[data-ref="${CSS.escape(ref)}"]`) : null);
  const fail = (err) => { opts.onError(err); root.dispatchEvent(new CustomEvent('postit-error', { detail: err })); };
  const topZ = () => Math.max(0, ...all().map((n) => n.z || 0));
  const titleOf = (n) => n.title || t.editNote;
  const typeLabel = (color) => opts.legend.find((i) => i.color === color)?.label ?? color;
  /** The Archived button shows when the store can list archived notes (or the app says so). */
  const canListArchived = () => opts.archivedButton ?? Boolean(opts.store?.archived);
  /** The Archive box shows while a note is dragged, unless people turned it off in the gear (or the app did). */
  const boxOn = () => view.archiveBox ?? opts.archiveBox !== false;

  /* ---------- lanes ---------- */
  const lanesOn = () => lanes.mode !== 'off';
  /** The words of a mode: "State", "States", "+ State" and the bar's hint. */
  const words = (mode = lanes.mode) => (mode === 'categories'
    ? { one: t.category, many: t.categories, add: t.addCategory, hint: t.hintCategories }
    : { one: t.state, many: t.states, add: t.addState, hint: t.hintStates });
  const presetName = (key) => ({ todo: t.laneTodo, doing: t.laneDoing, waiting: t.laneWaiting, done: t.laneDone, work: t.laneWork, home: t.laneHome, ideas: t.laneIdeas })[key];
  /** The lanes of a mode, left to right, each with a name: people's, the app's, or the preset's in this language. */
  function laneList(mode = lanes.mode, source = lanes) {
    if (!LANE_MODES.includes(mode)) return [];
    const list = source[mode] || LANE_PRESETS[mode].map((key) => ({ id: key, name: '' }));
    return list.map((l, i) => ({ id: l.id, name: l.name || presetName(l.id) || `${words(mode).one} ${i + 1}` }));
  }
  /** The lane a note is in: its own in this mode (an app note may name it by id or by name), else the first. */
  function laneOf(n, mode = lanes.mode, list = laneList(mode)) {
    const v = n.lane?.[mode];
    if (v != null) {
      const hit = list.find((l) => l.id === v) || (n.auto ? list.find((l) => l.name.toLowerCase() === String(v).toLowerCase()) : null);
      if (hit) return hit.id;
    }
    return list[0]?.id ?? null;
  }
  const laneName = (laneId, list = laneList()) => list.find((l) => l.id === laneId)?.name ?? '';
  /** Puts a note in another lane of this mode: it flows to the bottom of that lane until someone places it. */
  function setLane(note, laneId) {
    const mode = lanes.mode;
    note.lane = { ...note.lane, [mode]: laneId };
    if (note.lanePos?.[mode]) {
      const { [mode]: _gone, ...rest } = note.lanePos;
      note.lanePos = Object.keys(rest).length ? rest : null;
    }
    laneFlowed.delete(refId(refOf(note)));
  }

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
    // automatic notes are rebuilt from what the app sent plus the saved positions, never from a past layout;
    // where one was flowed in its lane stays, so a new list from the app does not shuffle the lanes
    const flowedBefore = new Map(auto.filter((x) => laneFlowed.has(refId(refOf(x)))).map((x) => [x.key, x.lanePos]));
    const built = withPositions(rawAuto.map((x) => normalizeNote(x, { auto: true })), positions)
      .map((x) => (x.lanePos || !flowedBefore.get(x.key) ? x : { ...x, lanePos: flowedBefore.get(x.key) }));
    // a dismissed app note stays off the board while the app sends the same content; changed, it shows again
    const off = (x) => { const s = normalizeSignature(positions[x.key]?.dismissed); return Boolean(s) && s === autoSignature(x); };
    auto = built.filter((x) => !off(x));
    dismissedAuto = built.filter(off).map((x) => Object.assign(x, { dismissedAt: normalizeDue(positions[x.key]?.dismissedAt) }));
  }

  /* ---------- drawing ---------- */
  const linkHtml = (n) => (n.link
    ? `<a class="pb-link" href="${escapeHtml(n.link)}"${/^https?:/i.test(n.link) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(n.linkLabel || (n.auto ? t.open : n.link))}</a>`
    : '');
  const dueHtml = (n, now = opts.now()) => (n.due
    ? `<time class="pb-due pb-due--${dueStatus(n.due, now, clock())}" datetime="${escapeHtml(n.due)}">${escapeHtml(formatDue(n.due, { ...clock(), now, words: t }))}</time>`
    : '');
  const swatchHtml = (color) => `<span class="pb-swatch" data-swatch="${escapeHtml(color)}"></span>`;

  /** A note. `listItem` when its parent is a list; `lane`, the id of its lane header (it describes the note). */
  function noteHtml(n, { listItem = true, lane = null } = {}) {
    const link = linkHtml(n);
    const ref = refId(refOf(n));
    const tools = n.auto
      ? ''
      : `<span class="pb-tools"><button type="button" class="pb-icon" data-pb="edit" title="${escapeHtml(t.edit)}" aria-label="${escapeHtml(t.edit)}">✎</button><button type="button" class="pb-icon" data-pb="done" title="${escapeHtml(t.archive)}" aria-label="${escapeHtml(t.archive)}">✓</button></span>`;
    // a title alone (no text, no image) sits in the middle of the note and may take more lines
    const titleOnly = Boolean(n.title) && !n.text && !n.image;
    const cls = ['pb-note', n.auto && 'pb-note--auto', titleOnly && 'pb-note--title-only', hidden.has(n.color) && 'pb-note--hidden', entering.has(ref) && 'pb-note--enter'].filter(Boolean).join(' ');
    return `<article class="${cls}"${listItem ? ' role="listitem"' : ''} tabindex="0"
        data-ref="${escapeHtml(ref)}" data-color="${escapeHtml(n.color)}"${lane ? ` aria-describedby="${lane}"` : ''}>
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
    const refocus = active && root.contains(active) && !dialog.contains(active) && !menu.contains(active) && !sub.contains(active) ? focusTarget(active) : null;
    const grid = isGrid();
    lastGrid = grid;
    const kind = archiveView ? 'archive' : lanesOn() ? 'lanes' : 'free';
    glass.classList.toggle('pb-glass--archive', kind === 'archive');
    glass.classList.toggle('pb-glass--lanes', kind === 'lanes');
    if (kind !== 'lanes') glass.style.removeProperty('--pb-note-width');
    if (kind === 'archive') renderArchive();
    else if (kind === 'lanes' && grid) renderPhoneLanes();
    else if (kind === 'lanes') renderLanes();
    else renderFree(grid);
    entering.clear();
    renderLegend();
    syncBar();
    if (shown?.kind === 'reader') noteEl(shown.ref)?.classList.add('pb-note--reading');
    for (const ref of landing) noteEl(ref)?.classList.add('pb-note--gone');
    if (refocus && !active.isConnected) refocus()?.focus({ preventScroll: true });
  }
  /** Draws now, or when the drag or resize going on ends (redrawing would drop the note under the pointer). */
  function requestRender() {
    if (drag || sizing) pendingRender = true; else render();
  }

  /** The free board: notes go anywhere; the ones nobody placed flow into columns. */
  function renderFree(grid) {
    const list = all();
    const flowing = list.filter((n) => n.x === null || n.y === null);
    // placed in the same objects: callbacks keep references to them. In the phone grid nothing is
    // placed, so the notes nobody moved still flow into columns when the window gets wider.
    if (!grid) autoPlace(list).forEach((p, i) => { list[i].x = p.x; list[i].y = p.y; });
    glass.style.setProperty('--pb-height', `${boardHeight(list)}px`);
    const shownList = grid ? narrow(list, '') : { notes: list, fold: '' };
    glass.innerHTML = list.length ? shownList.notes.map((n) => noteHtml(n)).join('') + shownList.fold : `<p class="pb-empty">${escapeHtml(t.empty)}</p>`;
    // a list holds list items only: the empty message is not one, and neither is "Show N more"
    if (list.length && !shownList.fold) glass.setAttribute('role', 'list'); else glass.removeAttribute('role');
    for (const el of glass.querySelectorAll('.pb-note')) paintNote(el, find(el.dataset.ref));
    markCut();
    if (flowing.length && !grid) flow(flowing);
    fitHeight();
  }

  /* ---------- narrow screens: the most urgent first, and the rest folded ---------- */
  /**
   * The notes a phone shows, in order, and the "Show N more" or "Show less" row. `narrowOrder: 'priority'`
   * puts overdue notes first, then the ones due today, then the legend's order, then where they were.
   * `narrowLimit` shows that many before the fold. `key` is the lane ('' without lanes).
   */
  function narrow(list, key) {
    let ordered = list;
    if (opts.narrowOrder === 'priority') {
      const now = opts.now();
      const rank = { overdue: 0, today: 1 };
      const types = new Map(opts.legend.map((item, i) => [item.color, i]));
      const score = (n) => [rank[dueStatus(n.due, now, clock())] ?? 2, types.get(n.color) ?? types.size];
      ordered = list.map((n, i) => ({ n, i, s: score(n) }))
        .sort((a, b) => a.s[0] - b.s[0] || a.s[1] - b.s[1] || a.i - b.i).map((x) => x.n);
    }
    const limit = Number(opts.narrowLimit);
    if (!Number.isFinite(limit) || limit < 1) return { notes: ordered, fold: '' };
    const visible = ordered.filter((n) => !hidden.has(n.color));
    const extra = visible.length - Math.floor(limit);
    if (extra <= 0) return { notes: ordered, fold: '' };
    const open = unfolded.has(key);
    const keep = new Set(visible.slice(0, Math.floor(limit)));
    const lane = key ? ` data-lane="${escapeHtml(key)}"` : '';
    const fold = `<button type="button" class="pb-fold" data-pb="fold"${lane} aria-expanded="${open}">${escapeHtml(open ? t.showLess : fillText(t.showMore, { n: extra }))}</button>`;
    return { notes: open ? ordered : ordered.filter((n) => keep.has(n)), fold };
  }

  /** "Show N more" unfolds in place (the box grows, the notes fade in); "Show less" folds back. */
  function toggleFold(btn) {
    const key = btn.dataset.lane ?? '';
    const box = btn.parentElement;
    const before = box.offsetHeight;
    const opening = !unfolded.has(key);
    const shownBefore = new Set([...box.querySelectorAll('.pb-note')].map((el) => el.dataset.ref));
    if (opening) unfolded.add(key); else unfolded.delete(key);
    render();
    const again = key ? glass.querySelector(`.pb-sec[data-lane="${CSS.escape(key)}"] .pb-sec-grid`) : glass;
    if (!again) return;
    const fresh = [...again.querySelectorAll('.pb-note')].filter((el) => !shownBefore.has(el.dataset.ref));
    (opening ? fresh[0] : again.querySelector('.pb-fold'))?.focus({ preventScroll: true });
    const ms = duration(opening ? 'in' : 'out');
    const after = again.offsetHeight;
    if (!ms || before === after) return;
    again.classList.add('pb-folding');
    const grow = again.animate({ height: [`${before}px`, `${after}px`] }, { duration: ms, easing: EASE[opening ? 'in' : 'out'] });
    for (const el of fresh) el.animate({ opacity: [0, 1], transform: [`rotate(${tilt(el.dataset.ref)}deg) translateY(-8px)`, `rotate(${tilt(el.dataset.ref)}deg)`] }, { duration: ms, easing: EASE.in });
    grow.finished.catch(() => {}).then(() => again.classList.remove('pb-folding'));
  }

  /* ---------- lanes on a desktop: columns with a header row; notes stay free inside their lane ---------- */
  /** Every lane has the same width; a note fits in one with LANE_GAP on each side. */
  function laneGeom() {
    const list = laneList();
    const width = glass.clientWidth || 1;
    const laneW = width / Math.max(1, list.length);
    const noteW = Math.max(60, Math.min(220, laneW - 2 * LANE_GAP));
    return { list, width, laneW, noteW, free: Math.max(0, laneW - 2 * LANE_GAP - noteW) };
  }
  const laneLeft = (g, i, x) => i * g.laneW + LANE_GAP + bound(x, 0, 1) * g.free;
  /** The lane and the place in it for a note whose top-left corner is at (left, top) on the glass; never over the header. */
  function laneAt(g, note, left, top) {
    const own = note.auto ? g.list.findIndex((l) => l.id === laneOf(note, lanes.mode, g.list)) : -1;
    const i = own >= 0 ? own : bound(Math.floor((left + g.noteW / 2) / g.laneW), 0, g.list.length - 1);
    const x = g.free ? bound((left - i * g.laneW - LANE_GAP) / g.free, 0, 1) : 0.5;
    return { i, id: g.list[i].id, pos: { x: Math.round(x * 1000) / 1000, y: Math.max(LANE_TOP, Math.round(top)) } };
  }

  function renderLanes() {
    const g = laneGeom();
    const mode = lanes.mode;
    const list = all();
    glass.removeAttribute('role');
    glass.style.setProperty('--pb-note-width', `${g.noteW}px`);
    const index = new Map(g.list.map((l, i) => [l.id, i]));
    const where = list.map((n) => index.get(laneOf(n, mode, g.list)) ?? 0);
    const counts = g.list.map(() => 0);
    list.forEach((n, k) => { if (!hidden.has(n.color)) counts[where[k]] += 1; });
    const head = (i) => `${id}-lane-${i}`;
    // the header row is its own layer, above every note (the one being dragged slides under it), sticky on scroll
    glass.innerHTML = `<div class="pb-lane-heads">${g.list.map((l, i) => `<div class="pb-lane-h" id="${head(i)}" data-lane="${escapeHtml(l.id)}">${mode === 'states' ? `<span class="pb-step" aria-hidden="true">${i + 1}</span>` : ''}<span class="pb-lane-name">${escapeHtml(l.name)}</span><span class="pb-count">${counts[i]}</span></div>`).join('')}</div>
      <div class="pb-lanes" aria-hidden="true">${g.list.map((l, i) => `<div class="pb-lane" data-lane="${escapeHtml(l.id)}">${counts[i] ? '' : `<p class="pb-lane-empty">${escapeHtml(t.laneEmpty)}</p>`}</div>`).join('')}</div>`
      + list.map((n, k) => noteHtml(n, { listItem: false, lane: head(where[k]) })).join('');
    for (const el of glass.querySelectorAll('.pb-lane-heads, .pb-lanes')) el.style.setProperty('--pb-lanes', g.list.length);
    const els = [...glass.querySelectorAll('.pb-note')];
    list.forEach((n, k) => paintNote(els[k], n));
    markCut();
    // placed notes first; the others flow under them in their lane, by their real height (one layout for all)
    const heights = els.map((el) => el.offsetHeight);
    const bottoms = g.list.map(() => LANE_TOP);
    const flowing = [];
    list.forEach((n, k) => {
      if (hidden.has(n.color)) return;
      const pos = n.lanePos?.[mode];
      if (!pos) { flowing.push(k); return; }
      bottoms[where[k]] = Math.max(bottoms[where[k]], Math.max(LANE_TOP, pos.y) + heights[k] + 30);
    });
    for (const k of flowing) {
      const n = list[k];
      const pos = { x: bound(0.5 + tilt(`${refId(refOf(n))}x`) * 0.08, 0, 1), y: bottoms[where[k]] };
      bottoms[where[k]] += heights[k] + 30;
      n.lanePos = { ...n.lanePos, [mode]: pos };
      laneFlowed.set(refId(refOf(n)), `${mode}:${pos.x},${pos.y}`);
    }
    list.forEach((n, k) => {
      const pos = n.lanePos?.[mode] ?? { x: 0.5, y: LANE_TOP };
      els[k].style.setProperty('--pb-x', laneLeft(g, where[k], pos.x) / g.width);
      els[k].style.setProperty('--pb-y', `${Math.max(LANE_TOP, pos.y)}px`);
    });
    if (flashLane) glass.querySelector(`.pb-lane-h[data-lane="${CSS.escape(flashLane)}"]`)?.classList.add('pb-lane--flash');
    flashLane = null;
    fitHeight();
  }

  /** Lanes on a phone: stacked sections with sticky titles that fold; no horizontal scroll. */
  function renderPhoneLanes() {
    const mode = lanes.mode;
    const list = laneList();
    const notesNow = all();
    glass.removeAttribute('role');
    glass.innerHTML = list.map((l, i) => {
      const inLane = notesNow.filter((n) => laneOf(n, mode, list) === l.id);
      const count = inLane.filter((n) => !hidden.has(n.color)).length;
      const closed = collapsed.has(l.id);
      const shownList = narrow(inLane, l.id);
      return `<section class="pb-sec" data-lane="${escapeHtml(l.id)}"${closed ? ' data-collapsed' : ''}>
        <button type="button" class="pb-sec-h" id="${id}-lane-${i}" data-pb="lane-toggle" data-lane="${escapeHtml(l.id)}" aria-expanded="${!closed}"><span class="pb-lane-name">${escapeHtml(l.name)}</span><span class="pb-count">${count}</span><span class="pb-chev" aria-hidden="true">▾</span></button>
        <div class="pb-sec-grid"${inLane.length && !shownList.fold ? ' role="list"' : ''}>${inLane.length ? shownList.notes.map((n) => noteHtml(n)).join('') + shownList.fold : `<p class="pb-sec-empty">${escapeHtml(t.laneEmptyPhone)}</p>`}</div></section>`;
    }).join('');
    for (const el of glass.querySelectorAll('.pb-note')) paintNote(el, find(el.dataset.ref));
    markCut();
  }

  /* ---------- Archived: the table of archived notes, in place of the notes ---------- */
  const normalizeArchived = (x) => Object.assign(normalizeNote(x), { doneAt: normalizeDue(x.doneAt) });

  function renderArchive() {
    glass.removeAttribute('role');
    const laneCol = lanesOn();
    const kinds = [['all', t.filterAll], ['archived', t.filterArchivedOnly], ['dismissed', t.filterDismissed]];
    glass.innerHTML = `<div class="pb-arch-top"><label class="pb-search">${ICONS.search}<input type="search" name="archiveFilter" autocomplete="off" placeholder="${escapeHtml(t.filterArchived)}" aria-label="${escapeHtml(t.filterArchived)}" value="${escapeHtml(archiveFilter)}"></label>
      <div class="pb-seg" role="group" aria-label="${escapeHtml(t.filterKind)}" hidden>${kinds.map(([k, label]) => `<button type="button" class="pb-seg-btn" data-pb="arch-kind" data-kind="${k}" aria-pressed="${k === archiveKind}">${escapeHtml(label)}<span class="pb-count"></span></button>`).join('')}</div>
      <span class="pb-arch-count" aria-live="polite"></span></div>
      <table class="pb-table"><thead><tr><th scope="col">${escapeHtml(t.colNote)}</th><th scope="col">${escapeHtml(t.colType)}</th>${laneCol ? `<th scope="col">${escapeHtml(words().one)}</th>` : ''}<th scope="col">${escapeHtml(t.colWhen)}</th><th scope="col"><span class="pb-sr">${escapeHtml(t.colActions)}</span></th></tr></thead><tbody></tbody></table>
      <div class="pb-arch-none" hidden></div>`;
    renderRows();
    fitHeight();
  }

  /** When a row left the board: the time it was dismissed (app notes) or archived. */
  const leftAt = (n) => (n.auto ? n.dismissedAt : n.doneAt);
  /** The state of a row, as a chip, then when: Dismissed (the app's) or Archived. */
  function stateHtml(n, now) {
    const at = leftAt(n);
    const chip = n.auto
      ? `<span class="pb-state pb-state--dismissed" title="${escapeHtml(t.dismissedTitle)}">${ICONS.dismiss}${escapeHtml(t.dismissedChip)}</span>`
      : `<span class="pb-state pb-state--archived">${ICONS.box}${escapeHtml(t.archivedChip)}</span>`;
    return `${chip}${at ? `<time class="pb-arch-when" datetime="${escapeHtml(at)}">${escapeHtml(formatWhen(at, { ...clock(), now, words: t }))}</time>` : ''}`;
  }

  /** The rows that pass the filters (kind, text, legend); the table keeps its filter field while they change. */
  function renderRows() {
    const body = glass.querySelector('.pb-table tbody');
    if (!body) return;
    // dismissed app notes and archived notes together, the last to leave the board first
    const list = archivedRows();
    const laneCol = lanesOn();
    const lanesNow = laneList();
    const mode = lanes.mode;
    // no value means the first lane; an id that is not in the list any more means a removed lane
    const laneLabel = (n) => (n.auto ? laneName(laneOf(n, mode, lanesNow), lanesNow) : (n.lane?.[mode] == null ? lanesNow[0]?.name : laneName(n.lane[mode], lanesNow)) || null);
    const q = archiveFilter.trim().toLowerCase();
    // All · Archived · Dismissed shows only while some app note is dismissed
    const seg = glass.querySelector('.pb-seg');
    if (!dismissedAuto.length) archiveKind = 'all';
    seg.hidden = !dismissedAuto.length;
    const ofKind = (n, kind = archiveKind) => kind === 'all' || (kind === 'dismissed') === Boolean(n.auto);
    const passes = (n) => !hidden.has(n.color) && (!q || [n.title, n.text, typeLabel(n.color), laneCol ? laneLabel(n) || '' : ''].join(' ').toLowerCase().includes(q));
    const rows = list.filter((n) => ofKind(n) && passes(n));
    for (const b of seg.querySelectorAll('[data-kind]')) {
      b.setAttribute('aria-pressed', String(b.dataset.kind === archiveKind));
      b.querySelector('.pb-count').textContent = String(list.filter((n) => ofKind(n, b.dataset.kind) && passes(n)).length);
    }
    const now = opts.now();
    body.innerHTML = rows.map((n) => {
      // an app note's key can be any text: its row is named by its place in the list of app notes
      const nid = n.auto ? `k${dismissedAuto.indexOf(n)}` : escapeHtml(String(n.id));
      const lane = laneCol ? laneLabel(n) : null;
      const note = `<td class="pb-c-note"><div class="pb-arch-title" id="${id}-a-${nid}">${escapeHtml(titleOf(n))}</div>${n.text ? `<div class="pb-arch-text">${escapeHtml(n.text)}</div>` : ''}</td>
        <td class="pb-c-type"><span class="pb-type-chip">${swatchHtml(n.color)}${escapeHtml(typeLabel(n.color))}</span></td>`;
      const when = `<td class="pb-c-when">${stateHtml(n, now)}</td>`;
      if (n.auto) {
        return `<tr data-key="${escapeHtml(n.key)}" class="pb-row--app">${note}
        ${laneCol ? `<td class="pb-c-lane">${lane ? `<span class="pb-lane-chip">${escapeHtml(lane)}</span>` : ''}</td>` : ''}${when}
        <td class="pb-c-acts"><button type="button" class="pb-textbtn" data-pb="bring-back" aria-describedby="${id}-a-${nid}">${escapeHtml(t.bringBack)}</button></td></tr>`;
      }
      return `<tr data-id="${nid}">${note}
        ${laneCol ? `<td class="pb-c-lane">${lane ? `<span class="pb-lane-chip">${escapeHtml(lane)}</span>` : `<span class="pb-lane-chip pb-lane-chip--gone">${escapeHtml(t.laneRemoved)}</span>`}</td>` : ''}${when}
        <td class="pb-c-acts">${confirming === n.id
    ? `<span class="pb-confirm">${escapeHtml(t.deleteConfirm)}</span><button type="button" class="pb-textbtn pb-textbtn--danger" data-pb="purge-yes" aria-describedby="${id}-a-${nid}">${escapeHtml(t.deleteYes)}</button><button type="button" class="pb-textbtn" data-pb="purge-no" aria-describedby="${id}-a-${nid}">${escapeHtml(t.keep)}</button>`
    : `<button type="button" class="pb-textbtn" data-pb="restore" aria-describedby="${id}-a-${nid}">${escapeHtml(t.restore)}</button><button type="button" class="pb-textbtn pb-textbtn--danger" data-pb="purge" aria-describedby="${id}-a-${nid}">${escapeHtml(t.deleteForGood)}</button>`}</td></tr>`;
    }).join('');
    paintSwatches(body);
    // the count follows the kind picked: "3 notes", or "1 of 3" when the text or the legend narrows them
    const total = list.length;
    const kindTotal = list.filter((n) => ofKind(n)).length;
    glass.querySelector('.pb-arch-count').textContent = rows.length === kindTotal
      ? (kindTotal === 1 ? t.notesOne : fillText(t.notesMany, { n: kindTotal }))
      : fillText(t.notesOf, { n: rows.length, total: kindTotal });
    glass.querySelector('.pb-arch-top').hidden = !total;
    glass.querySelector('.pb-table').hidden = !rows.length;
    const none = glass.querySelector('.pb-arch-none');
    none.hidden = rows.length > 0;
    if (rows.length) return;
    if (archivedList === null && !total) none.innerHTML = `<b>${escapeHtml(t.loading)}</b>`;
    else if (!kindTotal) none.innerHTML = `${ICONS.archive}<b>${escapeHtml(t.archivedEmpty)}</b><p>${escapeHtml(t.archivedEmptyHint)}</p>`;
    else if (q) none.innerHTML = `${ICONS.search}<b>${escapeHtml(fillText(t.archivedNoMatch, { q: archiveFilter.trim() }))}</b><p><button type="button" class="pb-textbtn" data-pb="clear-filter">${escapeHtml(t.clearFilter)}</button></p>`;
    else none.innerHTML = `${ICONS.archive}<b>${escapeHtml(t.archivedHidden)}</b><p>${escapeHtml(t.archivedHiddenHint)}</p>`;
  }

  /** What Archived lists: the app notes people dismissed (while the app still sends them) and the archived notes, the last to leave first. */
  const archivedRows = () => [...dismissedAuto, ...(archivedList || [])]
    .sort((a, b) => (Date.parse(leftAt(b)) || 0) - (Date.parse(leftAt(a)) || 0));
  /** The Archived button shows when the store lists archived notes, or there are dismissed app notes to bring back. */
  const wantsArchived = () => canListArchived() || dismissedAuto.length > 0 || archiveView;

  /** The archived list changed: the count, and the table when it shows (without redrawing its filter field). */
  function archivedChanged() {
    syncBar();
    if (!archiveView) return;
    renderRows();
    renderLegend();
  }
  /** After a change of data: the table when it shows, else the board. */
  const changed = () => (archiveView ? archivedChanged() : requestRender());

  function setArchiveView(on) {
    if (Boolean(on) === archiveView) return;
    closeMenu();
    archiveView = Boolean(on);
    confirming = null;
    if (archiveView) { archiveFilter = ''; archiveKind = 'all'; refreshArchived(); }
    render();
  }

  async function refreshArchived() {
    if (!opts.store?.archived) {
      if (archivedList === null) { archivedList = []; archivedChanged(); }
      return;
    }
    const asked = Date.now();
    try {
      const data = await opts.store.archived();
      if (destroyed) return;
      const list = (Array.isArray(data) ? data : data?.notes || []).map(normalizeArchived);
      // archived here while the answer was on its way: keep it
      const ids = new Set(list.map((n) => n.id));
      const recent = (archivedList || []).filter((n) => n.archivedHere >= asked && !ids.has(n.id));
      archivedList = [...recent, ...list];
      archivedChanged();
    } catch (err) {
      fail(err);
      if (archivedList === null) { archivedList = []; archivedChanged(); }
    }
  }

  /** The bar: the hint, the Archived toggle (when the store lists archived notes) and "+ Note". */
  function renderChrome() {
    const toggle = wantsArchived()
      ? `<button type="button" class="pb-btn pb-btn--toggle" data-pb="archived" aria-pressed="false">${ICONS.archive}<span>${escapeHtml(t.archived)}</span><span class="pb-badge" hidden></span></button>`
      : '';
    bar.innerHTML = `<span class="pb-hint"></span>${toggle}${opts.addButton ? `<button type="button" class="pb-btn" data-pb="add">${escapeHtml(t.add)}</button>` : ''}`;
    for (const handle of stage.querySelectorAll('.pb-resize')) handle.title = t.resize;
    legendEl.setAttribute('aria-label', t.legend);
    syncBar();
  }
  /** What changes in the bar without redrawing it: the hint, the toggle's state and its count. */
  function syncBar() {
    bar.querySelector('.pb-hint').textContent = archiveView ? t.hintArchived : lanesOn() ? words().hint : t.hint;
    const btn = bar.querySelector('[data-pb=archived]');
    // the first app note dismissed (with a store that lists nothing) brings the button; the last one brought back takes it
    if (Boolean(btn) !== wantsArchived()) { renderChrome(); return; }
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(archiveView));
    btn.title = archiveView ? t.archivedHide : t.archivedShow;
    const badge = btn.querySelector('.pb-badge');
    badge.hidden = archivedList === null && !dismissedAuto.length;
    badge.textContent = String(archivedRows().length);
    if (bump) {
      bump = false;
      badge.classList.remove('pb-badge--bump');
      void badge.offsetWidth; // restarts the pulse
      badge.classList.add('pb-badge--bump');
    }
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
    const lane = lanesOn() ? `<span class="pb-lane-chip">${escapeHtml(words().one)}: ${escapeHtml(laneName(laneOf(note)))}</span>` : '';
    return `<article class="pb-reader" tabindex="-1">
      <button type="button" class="pb-reader-close" data-pb="reader-close" aria-label="${escapeHtml(t.close)}">×</button>
      ${note.title ? `<h2 id="${id}-h" class="pb-reader-title">${escapeHtml(note.title)}</h2>` : ''}
      ${note.image ? `<img class="pb-reader-img" src="${escapeHtml(note.image)}" alt="">` : ''}
      ${note.text ? `<p class="pb-reader-text">${linkify(note.text)}</p>` : ''}
      <div class="pb-reader-foot">${dueHtml(note)}${lane}<span class="pb-spacer"></span>${linkHtml(note)}
        ${note.auto ? '' : `<span class="pb-tools"><button type="button" class="pb-btn" data-pb="reader-edit">${escapeHtml(t.edit)}</button><button type="button" class="pb-btn" data-pb="reader-done">${escapeHtml(t.archive)}</button></span>`}</div>
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
      const fade = opening ? { opacity: [0, 0, 1], offset: [0, 0.4, 1] } : { opacity: [1, 0, 0], offset: [0, 0.5, 1] };
      for (const child of article.children) anims.push(child.animate(fade, { ...timing, easing: 'linear' }));
    }
    return anims;
  }

  /** Plays the reader back into its note (Esc, a click outside, ×, Archive), then closes it. */
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

  /* ---------- dialogs: the reader, the editor, the settings and the phone's sheet share one <dialog> ---------- */
  /** Where focus goes back when a dialog or the menu closes: the note it came from, or the same button. */
  function focusTarget(el) {
    if (!el || el === document.body) return null;
    const note = el.closest?.('.pb-note');
    if (note && glass.contains(note)) { const ref = note.dataset.ref; return () => noteEl(ref); }
    const btn = root.contains(el) ? el.closest('[data-pb]') : null;
    const extra = btn ? ['color', 'lane'].filter((k) => btn.dataset[k] != null).map((k) => `[data-${k}="${CSS.escape(btn.dataset[k])}"]`).join('') : '';
    const same = btn && `[data-pb="${CSS.escape(btn.dataset.pb)}"]${extra}`;
    return () => (el.isConnected ? el : same ? root.querySelector(same) : null);
  }

  const DIALOG_CLASS = { reader: 'pb-dialog--reader', settings: 'pb-dialog--settings', sheet: 'pb-dialog--sheet' };
  function showDialog(kind, html, { ref = null, label = null, returnTo } = {}) {
    closeMenu();
    // from the reader to the editor, focus still goes back to the note in the end
    const back = shown?.returnTo ?? returnTo ?? focusTarget(document.activeElement);
    if (dialog.open) dialog.close();
    endDialog({ restoreFocus: false });
    dialog.className = `pb-dialog${DIALOG_CLASS[kind] ? ` ${DIALOG_CLASS[kind]}` : ''}`;
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
    const { returnTo, kind } = shown;
    shown = null;
    if (kind === 'sheet') menuNote = null;
    if (kind === 'settings') settings = null;
    for (const a of dialog.getAnimations({ subtree: true })) a.cancel();
    dialog.className = 'pb-dialog';
    for (const el of glass.querySelectorAll('.pb-note--reading, .pb-note--pressed')) el.classList.remove('pb-note--reading', 'pb-note--pressed');
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

  /** The legend counts what the glass shows: the notes on the board, or the archived ones in Archived. */
  function renderLegend() {
    const gear = canEditLegend()
      ? `<button type="button" class="pb-gear" data-pb="settings" title="${escapeHtml(t.settings)}" aria-label="${escapeHtml(t.settings)}">⚙</button>`
      : '';
    if (!opts.legend.length && !gear) { legendEl.hidden = true; return; }
    legendEl.hidden = false;
    const counts = new Map();
    for (const n of archiveView ? archivedRows().filter((x) => archiveKind === 'all' || (archiveKind === 'dismissed') === Boolean(x.auto)) : all()) counts.set(n.color, (counts.get(n.color) || 0) + 1);
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
    const left = ev.clientX - box.left - glass.clientLeft;
    const noteWidth = Math.min(220, width * 0.23);
    const at = {
      x: Math.min(Math.max(0, left / width), Math.max(0, 1 - noteWidth / width)),
      y: Math.max(0, Math.round(ev.clientY - box.top - glass.clientTop + glass.scrollTop)),
    };
    if (lanesOn()) {
      // the lane under the pointer, and the note's place in it
      const g = laneGeom();
      const i = bound(Math.floor(left / g.laneW), 0, g.list.length - 1);
      at.lane = g.list[i].id;
      at.lanePos = { x: g.free ? bound((left - i * g.laneW - LANE_GAP) / g.free, 0, 1) : 0.5, y: Math.max(LANE_TOP, at.y) };
    }
    return at;
  }

  /* ---------- the right-click menu: State or Category ▸, Color ▸, Edit and, last, Archive ---------- */
  /** An item that opens a submenu, with the current value on its right. */
  const subItemHtml = (kind, icon, label, value) => `<button type="button" role="menuitem" aria-haspopup="menu" aria-expanded="false" class="pb-menu-item" data-pb="menu-sub" data-sub="${kind}"><span class="pb-mi-ico">${icon}</span><span class="pb-menu-label">${escapeHtml(label)}</span><span class="pb-mi-val">${escapeHtml(value)}</span><span class="pb-mi-chev" aria-hidden="true">▸</span></button>`;

  /** The items of a note's menu, in this order everywhere (the phone's sheet too); Archive is always last. */
  function noteMenuHtml(note) {
    // an app note: Open → (its link) and Dismiss; the app owns its color, lane and text
    if (note.auto) {
      return `${note.link ? `<button type="button" role="menuitem" class="pb-menu-item" data-pb="menu-open"><span class="pb-mi-ico" aria-hidden="true">↗</span><span class="pb-menu-label">${escapeHtml(t.open)}</span></button>
      <hr role="separator">` : ''}
      <button type="button" role="menuitem" class="pb-menu-item pb-menu-item--dismiss" data-pb="menu-dismiss"><span class="pb-mi-ico">${ICONS.dismiss}</span><span class="pb-menu-label">${escapeHtml(t.dismiss)}</span><small>${escapeHtml(t.dismissHint)}</small></button>`;
    }
    return `${lanesOn() ? subItemHtml('lane', ICONS.lanes, words().one, laneName(laneOf(note))) : ''}
      ${subItemHtml('color', swatchHtml(note.color), t.color, typeLabel(note.color))}
      <button type="button" role="menuitem" class="pb-menu-item" data-pb="menu-edit"><span class="pb-mi-ico" aria-hidden="true">✎</span><span class="pb-menu-label">${escapeHtml(t.edit)}</span></button>
      <hr role="separator">
      <button type="button" role="menuitem" class="pb-menu-item pb-menu-item--archive" data-pb="menu-archive"><span class="pb-mi-ico">${ICONS.box}</span><span class="pb-menu-label">${escapeHtml(t.archive)}</span><small>${escapeHtml(t.archiveHint)}</small></button>`;
  }

  /** The items of a submenu: the lanes (with their counts) or the types (with their meaning). */
  function subMenuHtml(kind, note) {
    if (kind === 'lane') {
      const list = laneList();
      const current = laneOf(note, lanes.mode, list);
      const counts = new Map();
      for (const n of all()) { const l = laneOf(n, lanes.mode, list); counts.set(l, (counts.get(l) || 0) + 1); }
      return list.map((l) => `<button type="button" role="menuitemradio" aria-checked="${l.id === current}" class="pb-menu-item" data-pb="menu-lane" data-lane="${escapeHtml(l.id)}"${l.id === current ? ' aria-current="true"' : ''}><span class="pb-mi-ico" aria-hidden="true">${l.id === current ? '●' : ''}</span><span class="pb-menu-label">${escapeHtml(l.name)}</span><span class="pb-mi-val">${counts.get(l.id) || 0}</span></button>`).join('');
    }
    return choices().map((c) => {
      const current = note.color === c.color;
      return `<button type="button" role="menuitemradio" aria-checked="${current}" class="pb-menu-item" data-pb="menu-color" data-color="${escapeHtml(c.color)}"${current ? ' aria-current="true"' : ''}>
        ${swatchHtml(c.color)}<span class="pb-menu-label">${escapeHtml(c.label)}</span>
        ${c.description ? `<small>${escapeHtml(c.description)}</small>` : ''}</button>`;
    }).join('');
  }

  /** Fixed to the viewport, flipped when it would leave the screen. */
  function placeMenu(el, x, y) {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = `${Math.max(4, x + w > innerWidth ? x - w : x)}px`;
    el.style.top = `${Math.max(4, y + h > innerHeight ? y - h : y)}px`;
  }

  function openMenu(ev, note) {
    closeMenu();
    menuReturn = focusTarget(document.activeElement);
    menuNote = note || null;
    menuAt = note ? null : pointOnGlass(ev);
    if (note) {
      menu.setAttribute('aria-label', titleOf(note));
      menu.innerHTML = `<p class="pb-menu-h" aria-hidden="true">${escapeHtml(titleOf(note))}</p>${noteMenuHtml(note)}`;
    } else {
      // with lanes, the menu says which lane the new note starts in
      const heading = menuAt?.lane ? fillText(t.menuNewIn, { lane: laneName(menuAt.lane) }) : t.menuNew;
      menu.setAttribute('aria-label', heading);
      menu.innerHTML = `<p class="pb-menu-h" aria-hidden="true">${escapeHtml(heading)}</p>${choices().map((c) => `<button type="button" role="menuitem" class="pb-menu-item" data-pb="menu-new" data-color="${escapeHtml(c.color)}">
        ${swatchHtml(c.color)}<span class="pb-menu-label">${escapeHtml(c.label)}</span>
        ${c.description ? `<small>${escapeHtml(c.description)}</small>` : ''}</button>`).join('')}`;
    }
    paintSwatches(menu);
    menu.hidden = false;
    // the menu key or Shift+F10 on a focused note has no pointer: the menu opens on the note
    const from = !ev.clientX && !ev.clientY && note ? noteEl(refId(refOf(note)))?.getBoundingClientRect() : null;
    placeMenu(menu, from ? from.left + 24 : ev.clientX, from ? from.top + 24 : ev.clientY);
    menu.querySelector('.pb-menu-item')?.focus({ preventScroll: true });
  }

  function openSub(item, focus) {
    if (subFrom === item && !sub.hidden) {
      if (focus) (sub.querySelector('[aria-current]') || sub.querySelector('.pb-menu-item'))?.focus({ preventScroll: true });
      return;
    }
    closeSub();
    const note = menuNote;
    if (!note) return;
    const kind = item.dataset.sub;
    const label = kind === 'lane' ? words().one : t.color;
    subFrom = item;
    item.setAttribute('aria-expanded', 'true');
    sub.setAttribute('aria-label', label);
    sub.innerHTML = `<p class="pb-menu-h" aria-hidden="true">${escapeHtml(label)}</p>${subMenuHtml(kind, note)}`;
    paintSwatches(sub);
    sub.hidden = false;
    // next to the menu, or on its other side when the window ends
    const m = menu.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    const w = sub.offsetWidth;
    const h = sub.offsetHeight;
    sub.style.left = `${m.right + 4 + w > innerWidth ? Math.max(4, m.left - w - 4) : m.right + 4}px`;
    sub.style.top = `${bound(r.top - 8, 4, Math.max(4, innerHeight - h - 4))}px`;
    if (focus) (sub.querySelector('[aria-current]') || sub.querySelector('.pb-menu-item'))?.focus({ preventScroll: true });
  }

  function closeSub() {
    clearTimeout(subTimer);
    subFrom?.setAttribute('aria-expanded', 'false');
    subFrom = null;
    if (sub.hidden) return;
    sub.hidden = true;
    sub.innerHTML = '';
  }

  function closeMenu({ restoreFocus = false } = {}) {
    closeSub();
    if (menu.hidden) return;
    menu.hidden = true;
    menu.innerHTML = '';
    menuNote = null;
    if (restoreFocus) menuReturn?.()?.focus({ preventScroll: true });
    menuReturn = null;
  }

  function onContextMenu(ev) {
    if (!opts.contextMenu || ev.shiftKey || archiveView) return; // Shift + right-click keeps the browser's own menu
    if (ev.target.closest('a,input,textarea,select')) return;
    const el = ev.target.closest('.pb-note');
    const note = el && find(el.dataset.ref);
    ev.preventDefault();
    // a finger on a phone: the note's menu is a sheet from the bottom
    if (note && isGrid() && lastPointer !== 'mouse') {
      if (shown?.kind !== 'sheet') { cancelPress(); openSheet(note); }
      return;
    }
    openMenu(ev, note);
  }

  /** Arrows move through the items, → opens a submenu and ← closes it, Esc and Tab give the focus back. */
  function onMenuKey(ev) {
    const inSub = sub.contains(ev.target);
    if (ev.key === 'Tab' || (ev.key === 'Escape' && !inSub)) { ev.preventDefault(); closeMenu({ restoreFocus: true }); return; }
    if (inSub && (ev.key === 'ArrowLeft' || ev.key === 'Escape')) { ev.preventDefault(); const from = subFrom; closeSub(); from?.focus({ preventScroll: true }); return; }
    if (!inSub && ev.key === 'ArrowRight' && ev.target.dataset?.pb === 'menu-sub') { ev.preventDefault(); openSub(ev.target, true); return; }
    const items = [...(inSub ? sub : menu).querySelectorAll('.pb-menu-item')];
    const i = items.indexOf(document.activeElement);
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[ev.key];
    if (next === undefined) return;
    ev.preventDefault();
    items[(next + items.length) % items.length]?.focus({ preventScroll: true });
  }

  /** A submenu opens when the mouse rests on its item, and closes on another item. */
  function onMenuHover(ev) {
    if (ev.pointerType !== 'mouse') return;
    const item = ev.target.closest?.('.pb-menu-item');
    clearTimeout(subTimer);
    if (!item || item === subFrom) return;
    subTimer = setTimeout(() => {
      if (menu.hidden || !item.isConnected) return;
      if (item.dataset.pb === 'menu-sub') openSub(item, false); else closeSub();
    }, 120);
  }

  const onOutside = (ev) => { if (!menu.hidden && !menu.contains(ev.target) && !sub.contains(ev.target)) closeMenu(); };

  /* ---------- the phone: the note's menu as a sheet from the bottom ---------- */
  function openSheet(note) {
    closeMenu();
    const ref = refId(refOf(note));
    showDialog('sheet', '', { label: titleOf(note), returnTo: () => noteEl(ref) });
    shown.note = note;
    // the finger that held the note is still down: the click it makes when it lifts is not a pick
    shown.openedAt = performance.now();
    menuNote = note;
    sheetView('main');
  }
  /** The sheet shows the menu, or a submenu with ‹ Back. */
  function sheetView(kind) {
    const note = menuNote;
    if (!note || shown?.kind !== 'sheet') return;
    const head = kind === 'main'
      ? `<p class="pb-sheet-h">${swatchHtml(note.color)}<span>${escapeHtml(titleOf(note))}</span></p>`
      : `<p class="pb-sheet-h"><button type="button" class="pb-sheet-back" data-pb="sheet-back">${escapeHtml(t.back)}</button><span>${escapeHtml(kind === 'lane' ? words().one : t.color)}</span></p>`;
    dialog.innerHTML = `<div class="pb-sheet" role="menu" aria-label="${escapeHtml(titleOf(note))}"><div class="pb-sheet-grip" aria-hidden="true"></div>${head}
      ${kind === 'main' ? noteMenuHtml(note) : subMenuHtml(kind, note)}
      <button type="button" class="pb-btn pb-sheet-cancel" data-pb="cancel">${escapeHtml(t.cancel)}</button></div>`;
    paintSwatches(dialog);
    (dialog.querySelector('.pb-menu-item[aria-current]') || dialog.querySelector('.pb-menu-item'))?.focus({ preventScroll: true });
  }

  function startPress(ev, el, note) {
    if (ev.pointerType === 'mouse' || !opts.contextMenu) return;
    cancelPress();
    press = {
      x: ev.clientX,
      y: ev.clientY,
      el,
      timer: setTimeout(() => {
        if (!press || destroyed) return;
        // held long enough: the press is over, the sheet takes it from here (and drops the pressed look)
        press = null;
        el.classList.add('pb-note--pressed');
        try { globalThis.navigator?.vibrate?.(12); } catch { /* not everywhere */ }
        openSheet(note);
      }, PRESS_MS),
    };
  }
  function cancelPress() {
    if (!press) return;
    clearTimeout(press.timer);
    press = null;
  }

  /* ---------- Board settings (the gear): Types · Lanes · View ---------- */
  let settings = null; // what the dialog edits, until Save or Cancel
  let laneSeq = 0;

  /** A color key for a new type: a built-in color nobody uses yet, else c-1, c-2… */
  function freeKey(used) {
    const free = Object.keys(DEFAULT_COLORS).find((c) => !used.has(c));
    if (free) return free;
    let n = 1;
    while (used.has(`c-${n}`)) n += 1;
    return `c-${n}`;
  }

  function openSettings(tab = 'types') {
    const lists = Object.fromEntries(LANE_MODES.map((m) => [m, laneList(m)]));
    settings = {
      tab: TABS.includes(tab) ? tab : 'types',
      legend: opts.legend.map((i) => ({ color: i.color, label: i.label, description: i.description || '', locked: Boolean(i.locked), hex: colors[i.color] || '#fde68a', known: true })),
      mode: lanes.mode,
      lists: copy(lists),
      before: lists,
      modeBefore: lanes.mode,
      gone: { states: [], categories: [] },
      expand: expand(),
      lock: size.locked,
      box: boxOn(),
    };
    showDialog('settings', '<form method="dialog" class="pb-form pb-settings" novalidate></form>');
    const form = dialog.querySelector('form');
    form.addEventListener('click', onSettingsClick);
    form.addEventListener('input', onSettingsInput);
    form.addEventListener('change', onSettingsInput);
    form.addEventListener('keydown', onSettingsKey);
    form.addEventListener('submit', onSettingsSave);
    renderSettings('.pb-tab[aria-selected="true"]');
  }

  /** Redraws the dialog from `settings`, where it was scrolled, and focuses `focus` (a selector) or `fallback`. */
  function renderSettings(focus, fallback) {
    const form = dialog.querySelector('form.pb-settings');
    if (!form || !settings) return;
    const scroll = dialog.scrollTop;
    form.innerHTML = settingsHtml();
    paintSwatches(form);
    dialog.scrollTop = scroll;
    const el = focus && form.querySelector(focus);
    ((el && !el.disabled ? el : null) || (fallback && form.querySelector(fallback)))?.focus({ preventScroll: true });
  }

  /** How many notes a lane of a mode has, as the board shows them now (a note with no lane is in the first). */
  const laneCount = (mode, laneId) => all().filter((n) => laneOf(n, mode, settings.before[mode]) === laneId).length;
  const notesText = (n) => (n === 1 ? t.notesOne : fillText(t.notesMany, { n }));

  function settingsHtml() {
    const s = settings;
    const tabs = [['types', t.tabTypes, String(s.legend.length)], ['lanes', t.tabLanes, s.mode === 'off' ? t.modeOff : words(s.mode).many], ['view', t.tabView, '']];
    const panel = (k, html) => `<section class="pb-panel" role="tabpanel" id="${id}-panel-${k}" aria-labelledby="${id}-tab-${k}" data-panel="${k}"${s.tab === k ? '' : ' hidden'}>${html}</section>`;
    return `<div class="pb-set-head"><h2 id="${id}-h">${escapeHtml(t.settings)}</h2><button type="button" class="pb-x" data-pb="cancel" aria-label="${escapeHtml(t.close)}">×</button></div>
      <div class="pb-tabs" role="tablist" aria-label="${escapeHtml(t.settings)}">${tabs.map(([k, label, extra]) => `<button type="button" role="tab" class="pb-tab" id="${id}-tab-${k}" data-pb="tab" data-tab="${k}" aria-selected="${s.tab === k}" aria-controls="${id}-panel-${k}" tabindex="${s.tab === k ? 0 : -1}">${escapeHtml(label)}${extra ? ` <small>${escapeHtml(extra)}</small>` : ''}</button>`).join('')}</div>
      ${panel('types', typesPanel())}${panel('lanes', lanesPanel())}${panel('view', viewPanel())}
      <div class="pb-actions"><span class="pb-spacer"></span>
        <button type="button" class="pb-btn" data-pb="cancel">${escapeHtml(t.cancel)}</button>
        <button type="submit" class="pb-btn pb-btn--primary">${escapeHtml(t.save)}</button></div>`;
  }

  function typeRow(item, i) {
    const lock = item.locked ? ` disabled title="${escapeHtml(t.locked)}"` : '';
    return `<li class="pb-type" data-i="${i}" data-color="${escapeHtml(item.color)}"${item.locked ? ' data-locked' : ''}>
      <input type="color" name="hex" value="${escapeHtml(item.hex)}" aria-label="${escapeHtml(t.typeColor)}"${lock}>
      <input name="label" maxlength="40" value="${escapeHtml(item.label)}" aria-label="${escapeHtml(t.typeName)}" placeholder="${escapeHtml(t.typeName)}">
      <input name="description" maxlength="160" value="${escapeHtml(item.description)}" aria-label="${escapeHtml(t.typeMeaning)}" placeholder="${escapeHtml(t.typeMeaning)}">
      <button type="button" class="pb-icon" data-pb="type-up" title="${escapeHtml(t.moveUp)}" aria-label="${escapeHtml(t.moveUp)}"${i ? '' : ' disabled'}>↑</button>
      ${item.locked
    ? `<span class="pb-lock" title="${escapeHtml(t.locked)}" aria-label="${escapeHtml(t.locked)}">🔒</span>`
    : `<button type="button" class="pb-icon" data-pb="type-remove" title="${escapeHtml(t.removeType)}" aria-label="${escapeHtml(t.removeType)}">✕</button>`}
    </li>`;
  }

  function typesPanel() {
    return `<div class="pb-group" role="group" aria-labelledby="${id}-g-types"><h3 class="pb-group-h" id="${id}-g-types">${escapeHtml(t.typesTitle)}</h3>
      <p class="pb-settings-hint">${escapeHtml(t.settingsHint)}</p>
      <ol class="pb-types">${settings.legend.map(typeRow).join('')}</ol>
      <div><button type="button" class="pb-btn" data-pb="type-add">${escapeHtml(t.addType)}</button></div></div>`;
  }

  function lanesPanel() {
    const s = settings;
    const mode = s.mode;
    const card = (v, title, hint, art) => `<label class="pb-mode"><input type="radio" name="mode" value="${v}"${mode === v ? ' checked' : ''}><b>${escapeHtml(title)}</b><span class="pb-mode-d">${escapeHtml(hint)}</span>${art}</label>`;
    const split = `<div class="pb-group" role="radiogroup" aria-labelledby="${id}-g-split"><h3 class="pb-group-h" id="${id}-g-split">${escapeHtml(t.lanesTitle)}</h3>
      <div class="pb-modes">${card('off', t.modeOff, t.modeOffHint, ICONS.artOff)}${card('states', t.modeStates, t.modeStatesHint, ICONS.artStates)}${card('categories', t.modeCategories, t.modeCategoriesHint, ICONS.artCats)}</div>
      ${mode === 'off' ? `<p class="pb-settings-hint">${escapeHtml(t.lanesOffHint)}</p>` : ''}</div>`;
    if (mode === 'off') return split;
    const w = words(mode);
    const list = s.lists[mode];
    const named = (l, i) => l.name.trim() || `${w.one} ${i + 1}`;
    const rows = list.map((l, i) => `<li class="pb-lanerow" data-i="${i}">
        <span class="pb-step" aria-hidden="true">${i + 1}</span>
        <input name="laneName" maxlength="40" value="${escapeHtml(l.name)}" aria-label="${escapeHtml(t.laneName)}" placeholder="${escapeHtml(`${w.one} ${i + 1}`)}">
        <span class="pb-lanecount">${escapeHtml(notesText(laneCount(mode, l.id)))}</span>
        <button type="button" class="pb-icon" data-pb="lane-up" title="${escapeHtml(t.moveLeft)}" aria-label="${escapeHtml(t.moveLeft)}"${i ? '' : ' disabled'}>↑</button>
        <button type="button" class="pb-icon" data-pb="lane-down" title="${escapeHtml(t.moveRight)}" aria-label="${escapeHtml(t.moveRight)}"${i < list.length - 1 ? '' : ' disabled'}>↓</button>
        <button type="button" class="pb-icon" data-pb="lane-remove" title="${escapeHtml(t.removeLane)}" aria-label="${escapeHtml(t.removeLane)}"${list.length > 2 ? '' : ' disabled'}>✕</button></li>`).join('');
    const gone = s.gone[mode].map((g, k) => `<div class="pb-gone" data-k="${k}"><s>${escapeHtml(g.name)}</s> ${escapeHtml(t.laneRemoved)} · ${g.count
      ? `${escapeHtml(g.count === 1 ? t.laneGoneOne : fillText(t.laneGoneMany, { n: g.count }))} <select name="moveTo" data-k="${k}" aria-label="${escapeHtml(t.laneMoveTo)}">${list.map((l, i) => `<option value="${escapeHtml(l.id)}"${l.id === g.to ? ' selected' : ''}>${escapeHtml(named(l, i))}</option>`).join('')}</select>`
      : escapeHtml(t.laneGoneNone)}<span class="pb-spacer"></span><button type="button" class="pb-textbtn" data-pb="lane-undo" data-k="${k}">${escapeHtml(t.undo)}</button></div>`).join('');
    return `${split}<div class="pb-group" role="group" aria-labelledby="${id}-g-list"><h3 class="pb-group-h" id="${id}-g-list">${escapeHtml(w.many)}</h3>
      <p class="pb-settings-hint">${escapeHtml(t.lanesListHint)}</p>
      <ol class="pb-lanelist">${rows}</ol>${gone}
      ${list.length > 5 ? `<p class="pb-warn">${escapeHtml(t.lanesWarn)}</p>` : ''}
      <div><button type="button" class="pb-btn" data-pb="lane-add"${list.length >= LIMITS.lanes ? ' disabled' : ''}>${escapeHtml(w.add)}</button></div></div>`;
  }

  function viewPanel() {
    const s = settings;
    return `<div class="pb-group pb-expand" role="radiogroup" aria-labelledby="${id}-g-long"><h3 class="pb-group-h" id="${id}-g-long">${escapeHtml(t.expand)}</h3>
        ${[['center', t.expandCenter], ['inplace', t.expandInplace], ['more', t.expandMore]].map(([v, label]) =>
    `<label><input type="radio" name="expand" value="${v}"${s.expand === v ? ' checked' : ''}> ${escapeHtml(label)}</label>`).join('')}</div>
      ${opts.resizable ? `<div class="pb-group pb-expand" role="group" aria-labelledby="${id}-g-board"><h3 class="pb-group-h" id="${id}-g-board">${escapeHtml(t.boardGroup)}</h3>
        <label class="pb-lock"><input type="checkbox" name="lockSize"${s.lock ? ' checked' : ''}> ${escapeHtml(t.lockSize)}</label></div>` : ''}
      <div class="pb-group pb-expand" role="group" aria-labelledby="${id}-g-archive"><h3 class="pb-group-h" id="${id}-g-archive">${escapeHtml(t.archive)}</h3>
        <label><input type="checkbox" name="archiveBox"${s.box ? ' checked' : ''}> ${escapeHtml(t.archiveBoxOption)}</label></div>`;
  }

  function showTab(tab, focus = false) {
    if (!settings || !TABS.includes(tab)) return;
    settings.tab = tab;
    for (const el of dialog.querySelectorAll('.pb-tab')) {
      const on = el.dataset.tab === tab;
      el.setAttribute('aria-selected', String(on));
      el.tabIndex = on ? 0 : -1;
      if (on && focus) el.focus({ preventScroll: true });
    }
    for (const el of dialog.querySelectorAll('.pb-panel')) el.hidden = el.dataset.panel !== tab;
  }

  function onSettingsKey(ev) {
    if (!ev.target.matches('.pb-tab')) return;
    const i = TABS.indexOf(ev.target.dataset.tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[ev.key];
    if (next === undefined) return;
    ev.preventDefault();
    showTab(TABS[(next + TABS.length) % TABS.length], true);
  }

  function onSettingsClick(ev) {
    const btn = ev.target.closest('[data-pb]');
    if (!btn || !settings) return;
    const s = settings;
    const action = btn.dataset.pb;
    if (action === 'tab') { showTab(btn.dataset.tab); return; }
    const i = Number(btn.closest('[data-i]')?.dataset.i);
    const list = s.lists[s.mode];
    const swap = (arr, a, b) => { [arr[a], arr[b]] = [arr[b], arr[a]]; };
    if (action === 'type-up' && i > 0) {
      swap(s.legend, i, i - 1);
      renderSettings(`.pb-type[data-i="${i - 1}"] [data-pb="type-up"]`, `.pb-type[data-i="${i - 1}"] [name="label"]`);
    } else if (action === 'type-remove') {
      s.legend.splice(i, 1);
      renderSettings('[data-pb="type-add"]');
    } else if (action === 'type-add') {
      const key = freeKey(new Set(s.legend.map((x) => x.color)));
      s.legend.push({ color: key, label: '', description: '', locked: false, hex: colors[key] || '#e5e7eb', known: false });
      renderSettings('.pb-type:last-child [name="label"]');
    } else if (action === 'lane-up' && i > 0) {
      swap(list, i, i - 1);
      renderSettings(`.pb-lanerow[data-i="${i - 1}"] [data-pb="lane-up"]`, `.pb-lanerow[data-i="${i - 1}"] [name="laneName"]`);
    } else if (action === 'lane-down' && i < list.length - 1) {
      swap(list, i, i + 1);
      renderSettings(`.pb-lanerow[data-i="${i + 1}"] [data-pb="lane-down"]`, `.pb-lanerow[data-i="${i + 1}"] [name="laneName"]`);
    } else if (action === 'lane-add' && list.length < LIMITS.lanes) {
      laneSeq += 1;
      list.push({ id: `l-${Date.now().toString(36)}-${laneSeq}`, name: '' });
      renderSettings('.pb-lanerow:last-child [name="laneName"]');
    } else if (action === 'lane-remove' && list.length > 2) {
      // the lane goes, and its notes go to the one picked here (the neighbor by default) when it is saved
      const [lane] = list.splice(i, 1);
      s.gone[s.mode].push({ id: lane.id, name: lane.name.trim() || `${words(s.mode).one} ${i + 1}`, at: i, count: laneCount(s.mode, lane.id), to: list[Math.max(0, i - 1)].id });
      renderSettings('.pb-gone:last-of-type [data-pb="lane-undo"]');
    } else if (action === 'lane-undo') {
      const [lane] = s.gone[s.mode].splice(Number(btn.dataset.k), 1);
      const at = Math.min(lane.at, list.length);
      list.splice(at, 0, { id: lane.id, name: s.before[s.mode].find((l) => l.id === lane.id)?.name ?? lane.name });
      renderSettings(`.pb-lanerow[data-i="${at}"] [name="laneName"]`);
    }
  }

  function onSettingsInput(ev) {
    const el = ev.target;
    const s = settings;
    if (!s || !el.name) return;
    const i = Number(el.closest('[data-i]')?.dataset.i);
    if (el.closest('.pb-type')) s.legend[i][el.name] = el.value;
    else if (el.name === 'laneName') s.lists[s.mode][i].name = el.value;
    else if (el.name === 'moveTo') s.gone[s.mode][Number(el.dataset.k)].to = el.value;
    else if (el.name === 'expand') s.expand = el.value;
    else if (el.name === 'lockSize') s.lock = el.checked;
    else if (el.name === 'archiveBox') s.box = el.checked;
    else if (el.name === 'mode' && ev.type === 'change' && el.checked) {
      s.mode = el.value;
      renderSettings(`[name="mode"][value="${el.value}"]`);
    }
  }

  /**
   * Where the notes go when lanes change: a removed lane's notes to the lane picked for them, and a note with
   * no lane of its own (it sat in the first lane) keeps its lane when another one becomes first.
   */
  function laneMoves(s, final) {
    const moved = new Set();
    for (const mode of LANE_MODES) {
      const ids = new Set(final[mode].map((l) => l.id));
      const goneTo = new Map(s.gone[mode].map((g) => [g.id, g.to]));
      const target = (laneId) => {
        let to = laneId;
        for (let hops = 0; to && !ids.has(to) && hops < 20; hops += 1) to = goneTo.get(to);
        return ids.has(to) ? to : final[mode][0].id;
      };
      for (const n of notes) {
        const was = laneOf(n, mode, s.before[mode]);
        const to = target(was);
        if (laneOf(n, mode, final[mode]) === to && n.lane?.[mode] !== undefined) continue;
        if (laneOf(n, mode, final[mode]) === to && was === to && final[mode][0].id === s.before[mode][0].id) continue;
        n.lane = { ...n.lane, [mode]: to };
        if (was !== to && n.lanePos?.[mode]) {
          const { [mode]: _gone, ...rest } = n.lanePos;
          n.lanePos = Object.keys(rest).length ? rest : null;
          laneFlowed.delete(refId(refOf(n)));
        }
        moved.add(n);
      }
    }
    return [...moved];
  }

  async function onSettingsSave(ev) {
    ev.preventDefault();
    const s = settings;
    if (!s) return;
    // the types: a new one left without a name is dropped
    const base = baseColors();
    const legend = normalizeLegend(s.legend.filter((i) => i.known || i.label.trim()).map((i) => {
      const hex = String(i.hex || '').toLowerCase();
      const own = (base[i.color] || '').toLowerCase();
      return { color: i.color, label: i.label, description: i.description, hex: hex && hex !== own ? hex : undefined, locked: i.locked };
    }));
    // only what changed is saved: saving the legend untouched would freeze it over the app's own
    const legendChanged = JSON.stringify(legend) !== JSON.stringify(normalizeLegend(opts.legend));
    // the lanes, every one named
    const final = Object.fromEntries(LANE_MODES.map((m) => [m, s.lists[m].map((l, i) => ({ id: l.id, name: l.name.trim() || `${words(m).one} ${i + 1}` }))]));
    const nextLanes = { mode: s.mode, ...final };
    const lanesChanged = JSON.stringify(nextLanes) !== JSON.stringify({ mode: s.modeBefore, ...s.before });
    const moved = lanesChanged ? laneMoves(s, final) : [];
    const expandChanged = s.expand !== expand();
    const boxChanged = s.box !== boxOn();
    const sizeChanged = opts.resizable && s.lock !== size.locked;
    closeDialog();
    if (legendChanged) { savedLegend = legend; applyLegend(); }
    if (lanesChanged) { savedLanes = nextLanes; applyLanes(); }
    if (sizeChanged) { size = { ...size, locked: s.lock }; applySize(); }
    if (expandChanged || boxChanged) {
      view = normalizeView({ ...view, ...(expandChanged ? { expand: s.expand } : {}), ...(boxChanged ? { archiveBox: s.box } : {}) });
      if (expandChanged) opened.clear();
    }
    render();
    if (legendChanged) { try { await opts.store?.saveLegend?.(legend); } catch (err) { fail(err); } }
    if (lanesChanged) { try { await opts.store?.saveLanes?.(normalizeLanes(nextLanes)); } catch (err) { fail(err); } }
    for (const n of moved) save(n, { lane: n.lane, lanePos: n.lanePos });
    if (sizeChanged) await saveSize();
    if (expandChanged || boxChanged) { try { await opts.store?.saveView?.(view); } catch (err) { fail(err); } }
  }

  /** A note created here and not answered by the store yet: its position goes with the create. */
  const pending = (note) => !note.auto && note.id < 0;

  async function save(note, patch) {
    if (note.auto) {
      // what else is kept for the key (a Dismiss) stays
      const { lanePos: _old, ...kept } = positions[note.key] || {};
      positions[note.key] = { ...kept, x: note.x, y: note.y, z: note.z, ...(note.lanePos ? { lanePos: note.lanePos } : {}) };
    }
    if (!opts.store || pending(note)) return undefined;
    try {
      return await opts.store.update(refOf(note), patch);
    } catch (err) { fail(err); return FAILED; }
  }

  /* ---------- the edit dialog ---------- */
  function openEditor(note, at) {
    if (archiveView && !note) setArchiveView(false);
    const types = choices();
    const current = note?.color || at?.color || opts.defaultColor || (types.some((c) => c.color === 'yellow') ? 'yellow' : types[0]?.color) || 'yellow';
    const laneNow = lanesOn() ? (note ? laneOf(note) : at?.lane || laneList()[0]?.id) : null;
    showDialog('editor', `<form method="dialog" class="pb-form">
      <h2 id="${id}-h">${escapeHtml(note ? t.editNote : t.newNote)}</h2>
      <label>${escapeHtml(t.title)}<input name="title" maxlength="120" value="${escapeHtml(note?.title)}"></label>
      <label>${escapeHtml(t.text)}<textarea name="text" rows="4" maxlength="2000">${escapeHtml(note?.text)}</textarea></label>
      <fieldset class="pb-colors"><legend>${escapeHtml(t.color)}</legend>${types.map((c) => `
        <label class="pb-choice" title="${escapeHtml(c.description || c.label)}"><input type="radio" name="color" value="${escapeHtml(c.color)}"${c.color === current ? ' checked' : ''}>
          ${swatchHtml(c.color)}${escapeHtml(c.label)}</label>`).join('')}
      </fieldset>
      ${laneNow ? `<label>${escapeHtml(words().one)}<select name="lane">${laneList().map((l) => `<option value="${escapeHtml(l.id)}"${l.id === laneNow ? ' selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}</select></label>` : ''}
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
      const laneValue = laneNow ? f.get('lane') : null;
      closeDialog();
      if (!draft.title && !draft.text && !draft.image) return;
      if (note) {
        Object.assign(note, draft);
        const patch = { ...draft };
        if (laneValue && laneValue !== laneOf(note)) {
          setLane(note, laneValue);
          flashLane = laneValue;
          Object.assign(patch, { lane: note.lane, lanePos: note.lanePos });
        }
        requestRender();
        await save(note, patch);
        return;
      }
      // with lanes the note starts in the lane picked, where the right-click was when it was that lane
      const mode = lanes.mode;
      const lane = laneValue ? { [mode]: laneValue } : null;
      const lanePos = laneValue && at?.lane === laneValue && at.lanePos ? { [mode]: at.lanePos } : null;
      const local = normalizeNote({ ...draft, id: -Date.now(), x: at?.x ?? null, y: at?.y ?? null, z: topZ() + 1, lane, lanePos });
      notes.push(local);
      render();
      if (!opts.store) return;
      const sent = { x: local.x, y: local.y, z: local.z };
      const sentLanes = JSON.stringify([local.lane, local.lanePos]);
      // a note made on a narrow screen has no place yet: leave x and y out instead of sending null
      const placed = Object.fromEntries(Object.entries(sent).filter(([, v]) => v !== null && v !== undefined));
      const inLanes = { ...(local.lane ? { lane: local.lane } : {}), ...(local.lanePos ? { lanePos: local.lanePos } : {}) };
      try {
        const saved = await opts.store.create({ ...draft, ...placed, ...inLanes });
        // dragged while the store was answering: keep where it is now, and save that too
        const moved = local.x !== sent.x || local.y !== sent.y || local.z !== sent.z || JSON.stringify([local.lane, local.lanePos]) !== sentLanes;
        const fresh = normalizeNote(saved);
        const now = { x: local.x, y: local.y, z: local.z, lane: local.lane, lanePos: local.lanePos };
        Object.assign(local, fresh, { lane: fresh.lane ?? now.lane, lanePos: fresh.lanePos ?? now.lanePos }, moved ? now : {});
        if (moved) save(local, now);
        requestRender();
      } catch (err) { notes = notes.filter((n) => n !== local); requestRender(); fail(err); }
    });
    dialog.querySelector('[data-pb=remove]')?.addEventListener('click', async () => {
      closeDialog();
      notes = notes.filter((n) => n !== note);
      render();
      if ((await save(note, { removed: true })) === FAILED) { if (!notes.includes(note)) notes.push(note); requestRender(); }
    });
    // the title first, new or not; an existing title gets the cursor at its end
    const title = form.elements.title;
    title.focus();
    title.setSelectionRange(title.value.length, title.value.length);
  }

  /* ---------- Archive: the note leaves the board, Undo for a few seconds ---------- */
  /** A copy of a note fixed to the window, where the note is: it can fly out of the glass, which clips the note. */
  function ghostOf(el) {
    const r = el.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const transform = getComputedStyle(el).transform;
    // built, not cloned: a clone would copy the style attribute, which a strict CSP drops
    const ghost = document.createElement('div');
    ghost.className = `${el.className} pb-ghost`;
    ghost.classList.remove('pb-note--dragging', 'pb-note--over', 'pb-note--enter', 'pb-note--open', 'pb-note--closing', 'pb-note--sinking');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.innerHTML = el.innerHTML;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    for (const [k, v] of [['--pb-note', el.style.getPropertyValue('--pb-note')], ['--pb-gx', `${cx - w / 2}px`], ['--pb-gy', `${cy - h / 2}px`], ['--pb-gw', `${w}px`], ['--pb-gh', `${h}px`]]) ghost.style.setProperty(k, v);
    root.append(ghost);
    el.classList.add('pb-note--gone');
    return { ghost, cx, cy, transform };
  }

  /** ✓ on a desktop: the note flies into the Archived button. Resolves when it got there. */
  function flyTo(el, to) {
    const ms = Math.round(duration('in') * 1.6);
    if (!ms) return Promise.resolve();
    const b = to.getBoundingClientRect();
    const { ghost, cx, cy, transform } = ghostOf(el);
    return ghost.animate([
      { transform, opacity: 1 },
      { transform: `translate(${b.left + b.width / 2 - cx}px, ${b.top + b.height / 2 - cy}px) scale(0.12)`, opacity: 0.1 },
    ], { duration: ms, easing: EASE.out, fill: 'forwards' }).finished.catch(() => {}).then(() => ghost.remove());
  }

  /** Without the Archived button: the note fades out where it is. */
  function fadeOut(el) {
    el.classList.add('pb-note--leaving');
    const fade = el.getAnimations().find((a) => a.transitionProperty === 'opacity');
    return fade ? fade.finished.catch(() => {}) : Promise.resolve();
  }

  /** On a phone (no drag): the box and its blur appear over the note, and it sinks into the box. */
  function sinkInPlace(el) {
    const ms = duration('in');
    if (!ms) return Promise.resolve();
    const g = glass.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const target = makeBox({ kind: 'over', left: r.left - g.left - glass.clientLeft + glass.scrollLeft, top: r.top - g.top - glass.clientTop + glass.scrollTop, w: r.width, h: r.height }, glass);
    for (const x of [target.box, target.halo]) x.style.setProperty('--pb-k', '1');
    target.box.style.setProperty('--pb-near', '1');
    target.box.classList.add('pb-target--armed');
    el.classList.add('pb-note--sinking');
    return wait(Math.round(ms * 0.9)).then(() => {
      target.box.classList.add('pb-target--gulp');
      return el.animate([
        { transform: getComputedStyle(el).transform, opacity: 1 },
        { transform: 'rotate(-10deg) scale(0.22)', opacity: 0 },
      ], { duration: Math.round(ms * 1.4), easing: EASE.out, fill: 'forwards' }).finished.catch(() => {});
    }).then(() => wait(Math.round(ms * 0.6))).then(() => dropBox(target));
  }

  /** ✓, the menu, the sheet and the reader archive a note: it goes somewhere you can see, then leaves. */
  function finish(note) {
    const el = noteEl(refId(refOf(note)));
    if (!el) return archive(note);
    if (isGrid()) return archive(note, { flight: sinkInPlace(el) });
    const to = bar.querySelector('[data-pb=archived]');
    return archive(note, { flight: to?.offsetParent ? flyTo(el, to) : fadeOut(el) });
  }

  /** Takes a note off the board into Archived; `orig` is where Undo puts it back. It comes back if the store fails. */
  async function archive(note, { orig = null, flight = null } = {}) {
    if (note.auto || !notes.includes(note)) return;
    notes = notes.filter((n) => n !== note);
    opened.delete(refId(refOf(note)));
    if (flight) await flight;
    if (destroyed) return;
    note.doneAt = new Date().toISOString();
    note.archivedHere = Date.now();
    if (archivedList && !archivedList.includes(note)) archivedList.unshift(note);
    bump = true;
    changed();
    const saving = save(note, { done: true });
    const toastEl = toast(fillText(t.archivedToast, { title: titleOf(note) }), { icon: true, action: t.undo, onAction: () => unarchive(note, orig, saving) });
    if ((await saving) !== FAILED) return;
    if (toastNow?.el === toastEl) dropToast();
    back(note);
  }
  /** An archived note back on the board (the store failed, or Undo). */
  function back(note) {
    archivedList = archivedList?.filter((n) => n !== note) ?? null;
    note.doneAt = null;
    if (!notes.includes(note)) notes.push(note);
    entering.add(refId(refOf(note)));
    changed();
    if (archiveView) syncBar();
  }

  /** Undo: back where it was, in its lane, on top. */
  async function unarchive(note, orig, saving) {
    if ((await saving) === FAILED || destroyed || notes.includes(note)) return;
    if (orig) Object.assign(note, copy(orig));
    note.z = topZ() + 1;
    back(note);
    if (archiveView) requestRender();
    const patch = { done: false, z: note.z, ...(orig ? { x: note.x, y: note.y, lane: note.lane, lanePos: note.lanePos } : {}) };
    if ((await save(note, patch)) === FAILED) {
      notes = notes.filter((n) => n !== note);
      note.doneAt = new Date().toISOString();
      archivedList?.unshift(note);
      changed();
    }
  }

  /** Restore: back on the board, in its lane and place; the first lane when its lane is gone. */
  async function restore(note, row) {
    confirming = null;
    await leaveRow(row);
    if (destroyed || !archivedList?.includes(note)) return;
    const patch = { done: false, z: topZ() + 1 };
    note.z = patch.z;
    let where = '';
    if (lanesOn()) {
      const list = laneList();
      if (note.lane?.[lanes.mode] != null && !list.some((l) => l.id === note.lane[lanes.mode])) {
        setLane(note, list[0].id);
        Object.assign(patch, { lane: note.lane, lanePos: note.lanePos });
      }
      where = laneName(laneOf(note, lanes.mode, list), list);
    }
    const index = archivedList.indexOf(note);
    back(note);
    focusRow(index);
    toast(fillText(where ? t.restoredInToast : t.restoredToast, { title: titleOf(note), lane: where }), {
      action: t.show,
      onAction: () => { setArchiveView(false); noteEl(refId(refOf(note)))?.focus({ preventScroll: true }); },
    });
    if ((await save(note, patch)) === FAILED) {
      notes = notes.filter((n) => n !== note);
      note.doneAt = note.doneAt || new Date().toISOString();
      if (!archivedList.includes(note)) archivedList.splice(index, 0, note);
      changed();
    }
  }

  /** Delete for good, after the row asked: no Undo. */
  async function purge(note, row) {
    confirming = null;
    await leaveRow(row);
    if (destroyed || !archivedList?.includes(note)) return;
    const index = archivedList.indexOf(note);
    archivedList = archivedList.filter((n) => n !== note);
    archivedChanged();
    focusRow(index);
    toast(fillText(t.deletedToast, { title: titleOf(note) }));
    if ((await save(note, { removed: true })) === FAILED) {
      archivedList.splice(index, 0, note);
      archivedChanged();
    }
  }

  function leaveRow(row) {
    row?.classList.add('pb-row--leaving');
    return wait(row ? duration('out') : 0);
  }
  /** After a row leaves, the focus goes to the row now in its place, or to the filter. */
  function focusRow(index) {
    const rows = glass.querySelectorAll('.pb-table tbody tr');
    (rows[Math.min(index, rows.length - 1)]?.querySelector('button') || glass.querySelector('.pb-search input'))?.focus({ preventScroll: true });
  }

  /* ---------- app notes: Open → and Dismiss ---------- */
  /** The menu's Open →: the same as a click on the note's own link (the app's listeners on it run too). */
  function openLink(note) {
    const link = noteEl(refId(refOf(note)))?.querySelector('.pb-link');
    if (link) { link.click(); return; }
    if (!note.link) return;
    const a = document.createElement('a');
    a.href = note.link;
    if (/^https?:/i.test(note.link)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    a.click();
  }

  /** The store call for an app note's key (its position, or its Dismiss). */
  async function saveKey(key, patch) {
    if (!opts.store) return undefined;
    try {
      return await opts.store.update({ key }, patch);
    } catch (err) { fail(err); return FAILED; }
  }
  /** Sets or clears the Dismiss of an app note here (with when), and redraws. */
  function setDismissed(key, signature, at = null) {
    const { dismissed: _old, dismissedAt: _when, ...rest } = positions[key] || {};
    positions[key] = signature ? { ...rest, dismissed: signature, dismissedAt: at || new Date().toISOString() } : rest;
    setData();
  }

  /**
   * Dismiss: the app note leaves the board until the app sends something else for it. What it said is kept
   * as a signature under its key (`dismissed`); Undo, or Bring back in Archived, clears it.
   */
  async function dismiss(note, { flight = null } = {}) {
    if (!note.auto || !auto.includes(note)) return;
    const { key } = note;
    const signature = autoSignature(note);
    const before = normalizeSignature(positions[key]?.dismissed);
    const beforeAt = positions[key]?.dismissedAt ?? null;
    opened.delete(refId(refOf(note)));
    const el = noteEl(refId(refOf(note)));
    // dropped on the box it flew in; from the menu it fades out
    if (flight) await flight; else if (el) await fadeOut(el);
    if (destroyed) return;
    setDismissed(key, signature);
    bump = true;
    changed();
    const saving = saveKey(key, { dismissed: signature });
    const toastEl = toast(fillText(t.dismissedToast, { title: titleOf(note) }), { action: t.undo, onAction: () => bringBack(key, { saving }) });
    const saved = await saving;
    if (saved !== FAILED) {
      // the store's time, when it says one (the server's clock)
      const at = normalizeDue(saved?.dismissedAt);
      if (at && positions[key]?.dismissed === signature && positions[key].dismissedAt !== at) {
        positions[key] = { ...positions[key], dismissedAt: at };
        setData();
        if (archiveView) archivedChanged();
      }
      return;
    }
    if (toastNow?.el === toastEl) dropToast();
    setDismissed(key, before, beforeAt);
    changed();
  }

  /** Undo of a Dismiss, or Bring back in Archived: the app note shows again, on top. */
  async function bringBack(key, { saving = null, row = null } = {}) {
    if ((await saving) === FAILED || destroyed) return;
    const signature = normalizeSignature(positions[key]?.dismissed);
    if (!signature) return;
    const at = positions[key]?.dismissedAt ?? null;
    const rows = [...glass.querySelectorAll('.pb-table tbody tr')];
    const index = row ? rows.indexOf(row) : -1;
    if (row) await leaveRow(row);
    if (destroyed) return;
    setDismissed(key, null);
    const note = auto.find((n) => n.key === key);
    if (note) entering.add(refId(refOf(note)));
    changed();
    if (archiveView) syncBar();
    if (row) {
      focusRow(index);
      if (note) {
        toast(fillText(t.restoredToast, { title: titleOf(note) }), {
          action: t.show,
          onAction: () => { setArchiveView(false); noteEl(refId(refOf(note)))?.focus({ preventScroll: true }); },
        });
      }
    }
    if ((await saveKey(key, { dismissed: null })) === FAILED) {
      setDismissed(key, signature, at);
      changed();
    }
  }

  /* ---------- the toast: a short line at the bottom, with Undo ---------- */
  function toast(message, { action = null, onAction = null, icon = false } = {}) {
    // a new one takes the old one's place at once: two never show together
    if (toastNow) { clearTimeout(toastNow.timer); toastNow.el.remove(); toastNow = null; }
    const el = document.createElement('div');
    el.className = 'pb-toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `${icon ? ICONS.box : ''}<span class="pb-toast-msg">${escapeHtml(message)}</span>${action ? `<button type="button" class="pb-toast-act" data-pb="toast-act">${escapeHtml(action)}</button>` : ''}${duration('in') ? '<span class="pb-toast-bar" aria-hidden="true"></span>' : ''}`;
    root.append(el);
    toastNow = { el, onAction, timer: setTimeout(() => dropToast(el), TOAST_MS) };
    return el;
  }
  function dropToast(el = toastNow?.el) {
    if (!el || toastNow?.el !== el) return;
    clearTimeout(toastNow.timer);
    toastNow = null;
    const ms = duration('out');
    if (!ms) { el.remove(); return; }
    el.classList.add('pb-toast--out');
    setTimeout(() => el.remove(), ms);
  }

  /* ---------- the Archive box: on the glass edge while a note is dragged; drop it there to archive ---------- */
  /**
   * Where the box goes: astride the glass edge on the side nearer the note (or the one with room), a third of
   * it over the glass so a note dragged to the edge touches it, the rest in the margin. As big as a note when
   * the margin holds two thirds of one, smaller when it is narrow, else a pill in the bar above the glass,
   * else at the edge of the window. Fixed to the window, inside it, level with the note.
   */
  function boxPlace(d) {
    const vw = d.vw;
    const vh = innerHeight;
    const g = d.glassRect;
    const { pad, pill } = BOX;
    const full = { w: d.nw, h: bound(d.nh, 150, 210) };
    // the margin beside the glass holds the two thirds of the box that are not over it
    const room = { left: g.left - pad, right: vw - g.right - pad };
    const outside = (w) => Math.round((w * 2) / 3);
    const noteCx = d.noteRect.left + d.noteRect.width / 2;
    const sides = noteCx - g.left <= g.right - noteCx ? ['left', 'right'] : ['right', 'left'];
    const level = (h) => bound(d.noteRect.top + (d.noteRect.height - h) / 2, pad, Math.max(pad, vh - h - pad));
    let side = sides.find((s) => room[s] >= outside(full.w));
    let { w, h } = full;
    if (!side) {
      side = sides.find((s) => room[s] >= outside(BOX.min));
      if (side) { w = Math.min(full.w, Math.floor((room[side] * 3) / 2)); h = bound(Math.round(w * 1.15), 120, full.h); }
    }
    if (side) return { kind: 'side', side, w, h, left: side === 'left' ? g.left - outside(w) : g.right - (w - outside(w)), top: level(h) };
    const b = d.barRect;
    if (b && b.top >= 0 && b.bottom <= vh && b.toolsLeft - b.left - 12 >= pill.w) {
      return { kind: 'bar', w: pill.w, h: pill.h, left: b.toolsLeft - 12 - pill.w, top: b.top + (b.height - pill.h) / 2 };
    }
    const left = bound((Math.max(g.left, 0) + Math.min(g.right, vw)) / 2 - pill.w / 2, pad, Math.max(pad, vw - pill.w - pad));
    const top = g.top >= pill.h + 2 * pad ? Math.max(pad, g.top - pill.h - pad) : vh - g.bottom >= pill.h + 2 * pad ? Math.min(vh - pill.h - pad, g.bottom + pad) : pad;
    return { kind: 'dock', w: pill.w, h: pill.h, left, top };
  }

  /** The box and the soft blur under it. Fixed to the window, or (phone) in the glass over a note. */
  function makeBox(place, container = root) {
    const halo = document.createElement('div');
    halo.className = `pb-halo${container === glass ? ' pb-halo--in' : ''}`;
    halo.setAttribute('aria-hidden', 'true');
    // bigger than the box: it may spill over the glass, and never takes a pointer
    const size = Math.round(Math.max(place.w, place.h) * (place.kind === 'bar' || place.kind === 'dock' ? 2.6 : 3.2));
    for (const [k, v] of [['--pb-hx', `${place.left + place.w / 2 - size / 2}px`], ['--pb-hy', `${place.top + place.h / 2 - size / 2}px`], ['--pb-hd', `${size}px`]]) halo.style.setProperty(k, v);
    const box = document.createElement('div');
    box.className = `pb-target pb-target--${place.kind}${place.side ? ` pb-target--${place.side}` : ''}`;
    box.setAttribute('aria-hidden', 'true');
    box.innerHTML = `${ICONS.box}<span class="pb-target-label">${escapeHtml(place.dismiss ? t.dismiss : t.archive)}</span>`;
    for (const [k, v] of [['--pb-tx', `${place.left}px`], ['--pb-ty', `${place.top}px`], ['--pb-tw', `${place.w}px`], ['--pb-th', `${place.h}px`]]) box.style.setProperty(k, v);
    container.append(halo, box);
    return { ...place, box, halo, balloon: null };
  }

  /** The balloon next to the box: the note leaves the board and stays in Archived. */
  function addBalloon(target, vw) {
    const b = document.createElement('div');
    b.className = 'pb-balloon';
    b.setAttribute('role', 'status');
    b.innerHTML = `<b>${escapeHtml(target.dismiss ? t.dropDismiss : t.dropArchive)}</b><span>${escapeHtml(target.dismiss ? t.dismissBalloon : t.archiveBalloon)}</span>`;
    // nothing is measured here: the width is set, and above the box the balloon hangs from its bottom edge
    const bw = Math.min(BOX.balloon, vw - 2 * BOX.pad);
    const above = target.top >= 96;
    // lined up on the box's outer edge, away from the glass
    const edge = target.side === 'left' ? target.left : target.side === 'right' ? target.left + target.w - bw : target.left + target.w / 2 - bw / 2;
    const left = bound(edge, BOX.pad, Math.max(BOX.pad, vw - bw - BOX.pad));
    b.dataset.arrow = above ? 'down' : 'up';
    b.style.setProperty('--pb-bw', `${bw}px`);
    b.style.setProperty('--pb-bx', `${left}px`);
    b.style.setProperty('--pb-by', `${above ? target.top - 12 : target.top + target.h + 12}px`);
    b.style.setProperty('--pb-ax', `${bound(target.left + target.w / 2 - left, 16, bw - 16)}px`);
    root.append(b);
    target.balloon = b;
  }

  /** The box, the blur and the balloon grow stronger as the pointer comes; only the pointer over the box arms it. */
  function updateBox(d, ev) {
    const tg = d.target;
    const cx = tg.left + tg.w / 2;
    const cy = tg.top + tg.h / 2;
    const k = bound(1 - (Math.hypot(ev.clientX - cx, ev.clientY - cy) - Math.max(tg.w, tg.h) * 0.55) / 420, 0, 1);
    const armed = ev.clientX >= tg.left - 4 && ev.clientX <= tg.left + tg.w + 4 && ev.clientY >= tg.top - 4 && ev.clientY <= tg.top + tg.h + 4;
    tg.box.style.setProperty('--pb-near', (0.35 + 0.65 * k).toFixed(3));
    tg.box.style.setProperty('--pb-k', k.toFixed(3));
    tg.halo.style.setProperty('--pb-k', k.toFixed(3));
    tg.balloon?.style.setProperty('--pb-near-b', bound((k - 0.05) / 0.35, 0, 1).toFixed(3));
    if (armed === d.armed) return;
    d.armed = armed;
    tg.box.classList.toggle('pb-target--armed', armed);
    (d.lift || d.el).classList.toggle('pb-note--over', armed);
    const head = tg.balloon?.querySelector('b');
    if (head) head.textContent = tg.dismiss ? (armed ? t.releaseDismiss : t.dropDismiss) : (armed ? t.releaseArchive : t.dropArchive);
  }

  /** The box, its blur and its balloon fade out and go. */
  function dropBox(target) {
    const ms = duration('out');
    for (const el of [target.box, target.halo, target.balloon]) {
      if (!el?.isConnected) continue;
      if (!ms) { el.remove(); continue; }
      const from = getComputedStyle(el).opacity;
      el.animate([{ opacity: from }, { opacity: 0 }], { duration: ms, easing: EASE.out, fill: 'forwards' }).finished.catch(() => {}).then(() => el.remove());
    }
  }

  /** Dropped on the box: the note flies into it, the box gulps, then the note is archived. */
  function dropInto(d) {
    const tg = d.target;
    tg.box.classList.add('pb-target--armed', 'pb-target--gulp');
    tg.balloon?.remove();
    const ms = Math.round(duration('in') * 1.4);
    const ghost = d.lift;
    let flight = null;
    if (ms && ghost) {
      ghost.classList.add('pb-note--landing');
      const cx = d.gx + d.nw / 2;
      const cy = d.gy + d.nh / 2;
      flight = ghost.animate([
        { transform: 'rotate(0deg) scale(1.05)', opacity: 0.88 },
        { transform: `translate(${tg.left + tg.w / 2 - cx}px, ${tg.top + tg.h / 2 - cy}px) rotate(-10deg) scale(0.22)`, opacity: 0 },
      ], { duration: ms, easing: EASE.out, fill: 'forwards' }).finished.catch(() => {}).then(() => { ghost.remove(); return wait(Math.round(ms * 0.45)); });
    } else {
      ghost?.remove();
    }
    (flight || Promise.resolve()).then(() => dropBox(tg));
    // an app note is dismissed instead: the same box, the same flight
    if (d.note.auto) dismiss(d.note, { flight }); else archive(d.note, { orig: d.orig, flight });
  }

  /* ---------- the lifted note: out of the glass while it is dragged, so it can go anywhere on the screen ---------- */
  /**
   * A copy of the dragged note fixed to the window, over the glass and under the Archive box, made from what
   * was measured on pointerdown (nothing is read here). The note itself waits hidden in its place.
   */
  function lift(d) {
    const ghost = document.createElement('div');
    ghost.className = `${d.el.className} pb-ghost pb-note--lifted`;
    ghost.classList.remove('pb-note--over', 'pb-note--enter', 'pb-note--open', 'pb-note--closing', 'pb-note--sinking', 'pb-note--pressed', 'pb-note--reading', 'pb-note--hidden');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.innerHTML = d.el.innerHTML;
    for (const [k, v] of [['--pb-note', d.el.style.getPropertyValue('--pb-note')], ['--pb-gx', `${d.gx}px`], ['--pb-gy', `${d.gy}px`], ['--pb-gw', `${d.nw}px`], ['--pb-gh', `${d.nh}px`]]) ghost.style.setProperty(k, v);
    root.append(ghost);
    d.el.classList.add('pb-note--gone');
    d.lift = ghost;
  }

  /**
   * After a drop: the lifted copy glides to where the note now is (back inside the glass when it was dropped
   * outside), turning into its tilt, and the note shows again. Reduced motion: at once.
   */
  function land(d) {
    const ghost = d.lift;
    const ref = refId(refOf(d.note));
    const el = noteEl(ref);
    if (!ghost) { el?.classList.remove('pb-note--gone'); return; }
    const done = () => {
      ghost.remove();
      landing.delete(ref);
      noteEl(ref)?.classList.remove('pb-note--gone');
    };
    const ms = duration('out');
    if (!ms || !el) { done(); return; }
    // where the note is now, from the glass origin measured on pointerdown
    const dx = d.originX + el.offsetLeft - d.gx;
    const dy = d.originY + el.offsetTop - d.gy;
    landing.add(ref);
    el.classList.add('pb-note--gone');
    ghost.classList.add('pb-note--landing');
    ghost.animate([
      { transform: 'rotate(0deg) scale(1.05)' },
      { transform: `translate(${dx}px, ${dy}px) rotate(${tilt(ref)}deg) scale(1)` },
    ], { duration: Math.hypot(dx, dy) < 2 ? Math.min(ms, 120) : ms, easing: EASE.out, fill: 'forwards' }).finished.catch(() => {}).then(done);
  }

  /* ---------- events ---------- */
  function onClick(ev) {
    // the lift of the long press that opened the sheet (a keyboard click has no detail and always counts)
    if (shown?.kind === 'sheet' && ev.detail !== 0 && dialog.contains(ev.target) && downAt < shown.openedAt) return undefined;
    if (ev.target === dialog) {
      // the backdrop; a text selection that ends outside the reader does not close it
      if (downOnBackdrop && shown?.kind === 'reader') closeReader();
      else if (downOnBackdrop && shown?.kind === 'sheet') closeDialog();
      return;
    }
    const btn = ev.target.closest('[data-pb]');
    if (!btn || !root.contains(btn)) return onNoteClick(ev);
    const action = btn.dataset.pb;
    if (action === 'cancel') return closeDialog();
    if (action === 'toast-act') {
      const run = toastNow?.onAction;
      dropToast(btn.closest('.pb-toast'));
      return run?.();
    }
    if (action.startsWith('reader-')) {
      const target = shown?.note;
      if (action === 'reader-edit' && target) return openEditor(target); // the editor takes the reader's place at once
      return closeReader().then(() => { if (action === 'reader-done' && target) finish(target); });
    }
    if (action === 'more') return toggleOpen(btn.closest('.pb-note'));
    if (action === 'fold') return toggleFold(btn);
    if (action === 'add') return openEditor(null);
    if (action === 'archived') return setArchiveView(!archiveView);
    if (action === 'settings') return openSettings();
    if (action === 'lane-toggle') {
      const lane = btn.dataset.lane;
      if (collapsed.has(lane)) collapsed.delete(lane); else collapsed.add(lane);
      btn.closest('.pb-sec')?.toggleAttribute('data-collapsed', collapsed.has(lane));
      btn.setAttribute('aria-expanded', String(!collapsed.has(lane)));
      return undefined;
    }
    if (action === 'menu-new') {
      const at = { ...menuAt, color: btn.dataset.color };
      closeMenu({ restoreFocus: true });
      return openEditor(null, at);
    }
    if (action === 'sheet-back') return sheetView('main');
    if (action.startsWith('menu-')) {
      const inSheet = shown?.kind === 'sheet';
      if (action === 'menu-sub') return inSheet ? sheetView(btn.dataset.sub) : openSub(btn, ev.detail === 0);
      const target = menuNote;
      if (inSheet) closeDialog(); else closeMenu({ restoreFocus: true });
      if (!target) return undefined;
      if (action === 'menu-open') return openLink(target);
      if (action === 'menu-dismiss') return dismiss(target);
      if (action === 'menu-edit') return openEditor(target);
      if (action === 'menu-archive') return finish(target);
      if (action === 'menu-lane') return moveToLane(target, btn.dataset.lane);
      if (action === 'menu-color' && target.color !== btn.dataset.color) {
        target.color = btn.dataset.color;
        target.z = topZ() + 1;
        requestRender();
        save(target, { color: target.color, z: target.z });
      }
      return undefined;
    }
    if (action === 'filter') {
      const c = btn.dataset.color;
      if (hidden.has(c)) hidden.delete(c); else hidden.add(c);
      return requestRender();
    }
    if (action === 'arch-kind') {
      archiveKind = btn.dataset.kind;
      confirming = null;
      renderRows();
      renderLegend();
      return undefined;
    }
    if (action === 'clear-filter') {
      archiveFilter = '';
      const input = glass.querySelector('.pb-search input');
      if (input) input.value = '';
      renderRows();
      return glass.querySelector('.pb-search input')?.focus();
    }
    const appRow = btn.closest('tr[data-key]');
    if (appRow && action === 'bring-back') return bringBack(appRow.dataset.key, { row: appRow });
    const row = btn.closest('tr[data-id]');
    if (row) {
      const note = archivedList?.find((n) => String(n.id) === row.dataset.id);
      if (!note) return undefined;
      if (action === 'restore') return restore(note, row);
      if (action === 'purge') { confirming = note.id; renderRows(); return glass.querySelector(`tr[data-id="${CSS.escape(row.dataset.id)}"] [data-pb="purge-no"]`)?.focus(); }
      if (action === 'purge-no') { confirming = null; renderRows(); return glass.querySelector(`tr[data-id="${CSS.escape(row.dataset.id)}"] [data-pb="purge"]`)?.focus(); }
      if (action === 'purge-yes') return purge(note, row);
      return undefined;
    }
    const el = btn.closest('.pb-note');
    const note = el && find(el.dataset.ref);
    if (!note) return undefined;
    if (action === 'edit') return openEditor(note);
    if (action === 'done') return finish(note);
    return undefined;
  }

  /** The menu's State or Category: the note flows to the bottom of that lane. */
  function moveToLane(note, laneId) {
    if (!lanesOn() || note.auto || laneOf(note) === laneId) return;
    setLane(note, laneId);
    note.z = topZ() + 1;
    flashLane = laneId;
    entering.add(refId(refOf(note)));
    requestRender();
    toast(fillText(t.movedToast, { lane: laneName(laneId) }));
    save(note, { lane: note.lane, lanePos: note.lanePos, z: note.z });
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

  function onDblClick(ev) {
    if (ev.target !== glass || isGrid() || archiveView) return;
    openEditor(null, pointOnGlass(ev));
  }

  function onInput(ev) {
    if (ev.target.name !== 'archiveFilter' || !glass.contains(ev.target)) return;
    archiveFilter = ev.target.value;
    confirming = null;
    renderRows();
  }

  function onPointerDown(ev) {
    const el = ev.target.closest('.pb-note');
    if (!el || ev.button !== 0 || ev.target.closest('button,a,input,textarea,select') || archiveView) return;
    const note = find(el.dataset.ref);
    if (!note) return;
    // a phone has no drag: holding a note opens its menu
    if (isGrid()) { startPress(ev, el, note); return; }
    ev.preventDefault();
    // measured once here, before anything is written: moving only writes, so a drag never forces a layout
    const width = glass.clientWidth || 1;
    const g = glass.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    const tools = bar.querySelector('.pb-btn');
    const vw = document.documentElement.clientWidth || innerWidth;
    const lanesNow = lanesOn() ? laneGeom() : null;
    const nw = el.offsetWidth;
    const nh = el.offsetHeight;
    // the note's box without its tilt, in the window: the lifted copy starts there
    const gx = r.left + r.width / 2 - nw / 2;
    const gy = r.top + r.height / 2 - nh / 2;
    // an app note stays in the lane the app gave it
    const own = lanesNow && note.auto ? Math.max(0, lanesNow.list.findIndex((l) => l.id === laneOf(note, lanes.mode, lanesNow.list))) : -1;
    const minLeft = own >= 0 ? own * lanesNow.laneW + LANE_GAP : 0;
    drag = {
      el, note, x0: ev.clientX, y0: ev.clientY, left: el.offsetLeft, top: el.offsetTop, width,
      nw, nh, minLeft, gx, gy, x: gx, y: gy, originX: gx - el.offsetLeft, originY: gy - el.offsetTop,
      maxLeft: own >= 0 ? Math.max(minLeft, (own + 1) * lanesNow.laneW - LANE_GAP - nw) : Math.max(0, width - nw),
      // the lowest place still in sight: a note dropped outside the glass comes back to the edge, not below it
      maxTop: Math.max(0, glass.scrollTop + glass.clientHeight - nh),
      glassRect: { left: g.left, top: g.top, right: g.right, bottom: g.bottom },
      noteRect: { left: r.left, top: r.top, width: r.width, height: r.height },
      barRect: { left: b.left, top: b.top, bottom: b.bottom, height: b.height, toolsLeft: tools ? tools.getBoundingClientRect().left : b.right },
      lanes: lanesNow, laneEls: lanesNow ? [...glass.querySelectorAll('.pb-lane, .pb-lane-h')] : [], laneIdx: -1,
      orig: { x: note.x, y: note.y, lane: copy(note.lane), lanePos: copy(note.lanePos) },
      curL: el.offsetLeft, curT: el.offsetTop, moved: false, out: false, target: null, armed: false, vw, lift: null,
    };
    // where the Archive box will go, worked out now and drawn on the first move (a click draws nothing);
    // an app note gets the same box, which dismisses it
    drag.place = boxOn() ? { ...boxPlace(drag), dismiss: note.auto } : null;
    note.z = topZ() + 1;
    el.style.setProperty('--pb-z', note.z);
    el.setPointerCapture?.(ev.pointerId);
    el.classList.add('pb-note--dragging');
  }

  /** Is the pointer over the glass (as measured when the drag began)? */
  const overGlass = (d, ev) => ev.clientX >= d.glassRect.left && ev.clientX <= d.glassRect.right && ev.clientY >= d.glassRect.top && ev.clientY <= d.glassRect.bottom;

  function onPointerMove(ev) {
    if (press) { if (Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 8) cancelPress(); return; }
    if (!drag) return;
    const dx = ev.clientX - drag.x0;
    const dy = ev.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      if (drag.place) {
        drag.target = makeBox(drag.place);
        addBalloon(drag.target, drag.vw);
      }
      lift(drag);
    }
    // the lifted copy follows the pointer anywhere; the note's place in the glass is kept inside it
    drag.gx = drag.x + dx;
    drag.gy = drag.y + dy;
    drag.lift.style.setProperty('--pb-gx', `${drag.gx}px`);
    drag.lift.style.setProperty('--pb-gy', `${drag.gy}px`);
    drag.curL = bound(drag.left + dx, drag.minLeft, drag.maxLeft);
    drag.curT = Math.max(0, Math.round(drag.top + dy));
    drag.out = !overGlass(drag, ev);
    if (drag.out) drag.curT = Math.min(drag.curT, drag.maxTop);
    // with lanes, x and y stay the free board's place: the lane and the place in it are set on the drop
    if (!drag.lanes) { drag.note.x = drag.curL / drag.width; drag.note.y = drag.curT; }
    if (drag.target) updateBox(drag, ev);
    if (drag.lanes) {
      const g = drag.lanes;
      const i = drag.armed ? -1 : drag.note.auto ? Math.floor(drag.minLeft / g.laneW) : bound(Math.floor((drag.curL + drag.nw / 2) / g.laneW), 0, g.list.length - 1);
      if (i !== drag.laneIdx) {
        drag.laneIdx = i;
        for (const l of drag.laneEls) l.classList.toggle('pb-lane--over', i >= 0 && l.dataset.lane === g.list[i].id);
      }
    }
  }

  function onPointerUp(ev) {
    if (press) { cancelPress(); return; }
    if (!drag) return;
    const d = drag;
    const { el, note, moved } = d;
    drag = null;
    // the click that ends a drag does not open the note
    dragged = moved;
    if (moved) setTimeout(() => { dragged = false; }, 0);
    el.classList.remove('pb-note--dragging', 'pb-note--over');
    for (const l of d.laneEls) l.classList.remove('pb-lane--over');
    if (d.armed && ev.type === 'pointerup') { dropInto(d); return; }
    if (d.target) dropBox(d.target);
    if (moved && !d.lanes) {
      // the place the lifted copy lands on: where it was dropped, kept inside the glass
      el.style.setProperty('--pb-x', d.curL / d.width);
      el.style.setProperty('--pb-y', `${d.curT}px`);
    }
    if (moved && d.lanes) {
      // dropped in a lane: in its place there, never over the header; another lane changes the note's state or category
      const before = laneOf(note, lanes.mode, d.lanes.list);
      const at = laneAt(d.lanes, note, d.curL, d.curT);
      note.lanePos = { ...note.lanePos, [lanes.mode]: at.pos };
      laneFlowed.delete(refId(refOf(note)));
      const patch = { lanePos: note.lanePos, z: note.z };
      if (!note.auto && at.id !== before) {
        note.lane = { ...note.lane, [lanes.mode]: at.id };
        patch.lane = note.lane;
        flashLane = at.id;
      }
      save(note, patch);
    } else {
      // the note touched last stays on top, also after a reload
      save(note, moved || note.auto ? { x: note.x, y: note.y, z: note.z } : { z: note.z });
    }
    if (!pendingRender && !(moved && d.lanes)) {
      fitHeight();
    } else {
      // new data came in during the drag: the fresh copy of this note lands where it was dropped
      const current = find(refId(refOf(note)));
      if (current && current !== note) Object.assign(current, { x: note.x, y: note.y, z: note.z, lanePos: note.lanePos, ...(note.auto ? {} : { lane: note.lane }) });
      render();
    }
    if (moved) land(d);
  }

  /** Arrow keys move the focused note; each note's move is saved a moment after its last key. */
  const keySaves = new Map();
  const keyPatch = (note) => (lanesOn() ? { lane: note.lane, lanePos: note.lanePos } : { x: note.x, y: note.y });
  function flushKeySaves() {
    for (const { note, timer } of keySaves.values()) { clearTimeout(timer); save(note, keyPatch(note)); }
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
    const ref = el.dataset.ref;
    if (lanesOn()) {
      keyInLane(el, note, m, step);
    } else {
      const maxX = Math.max(0, 1 - el.offsetWidth / (glass.clientWidth || 1));
      note.x = Math.min(Math.max(0, note.x + m[0] * step), maxX);
      note.y = Math.max(0, note.y + m[1] * step);
      el.style.setProperty('--pb-x', note.x);
      el.style.setProperty('--pb-y', `${note.y}px`);
      fitHeight();
    }
    clearTimeout(keySaves.get(ref)?.timer);
    keySaves.set(ref, { note, timer: setTimeout(() => { keySaves.delete(ref); save(note, keyPatch(note)); }, 400) });
  }
  /** Arrows in a lane: up and down never over the header; left and right move on to the next lane at its edge. */
  function keyInLane(el, note, m, step) {
    const g = laneGeom();
    const mode = lanes.mode;
    let i = Math.max(0, g.list.findIndex((l) => l.id === laneOf(note, mode, g.list)));
    const pos = { ...(note.lanePos?.[mode] ?? { x: 0.5, y: el.offsetTop }) };
    pos.y = Math.max(LANE_TOP, pos.y + m[1] * step);
    if (m[0]) {
      const x = pos.x + Math.sign(m[0]) * 0.1 * step;
      const next = i + Math.sign(m[0]);
      if ((x < 0 || x > 1 || !g.free) && !note.auto && next >= 0 && next < g.list.length && (x < 0 || x > 1 || !g.free)) {
        i = next;
        pos.x = m[0] < 0 ? 1 : 0;
        note.lane = { ...note.lane, [mode]: g.list[i].id };
        note.lanePos = { ...note.lanePos, [mode]: pos };
        laneFlowed.delete(refId(refOf(note)));
        flashLane = g.list[i].id;
        render(); // the counts and the lane change; the focus stays on the note
        return;
      }
      pos.x = bound(x, 0, 1);
    }
    note.lanePos = { ...note.lanePos, [mode]: pos };
    laneFlowed.delete(refId(refOf(note)));
    el.style.setProperty('--pb-x', laneLeft(g, i, pos.x) / g.width);
    el.style.setProperty('--pb-y', `${pos.y}px`);
    fitHeight();
  }

  /** Due chips move from "Tomorrow" to "Today" to overdue without redrawing the board. */
  function refreshDue() {
    const now = opts.now();
    for (const el of root.querySelectorAll('time.pb-due')) {
      const due = el.getAttribute('datetime');
      el.className = `pb-due pb-due--${dueStatus(due, now, clock())}`;
      el.textContent = formatDue(due, { ...clock(), now, words: t });
    }
  }

  // every listener outside the board's own elements, so destroy() can take them all off
  const cleanups = [];
  const on = (target, type, fn, capture = false) => {
    target.addEventListener(type, fn, capture);
    cleanups.push(() => target.removeEventListener(type, fn, capture));
  };
  let lastPointer = 'mouse';
  let downAt = 0; // when a pointer last went down on the board, its dialogs included
  on(root, 'pointerdown', (ev) => { lastPointer = ev.pointerType || 'mouse'; downAt = performance.now(); }, true);
  on(root, 'click', onClick);
  on(root, 'keydown', onKeyDown);
  on(root, 'input', onInput);
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
  sub.addEventListener('keydown', onMenuKey);
  menu.addEventListener('pointerover', onMenuHover);
  sub.addEventListener('pointerover', () => clearTimeout(subTimer));
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
  let laneWidth = 0;
  on(globalThis, 'resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (drag || sizing || destroyed) return;
      const columnsChanged = flowColumns && columnsFor(glass.clientWidth || 1) !== flowColumns;
      const lanesChanged = lanesOn() && !archiveView && !isGrid() && glass.clientWidth !== laneWidth;
      if (isGrid() !== lastGrid || columnsChanged || lanesChanged) {
        for (const n of all()) {
          const k = refId(refOf(n));
          if (flowed.get(k) === `${n.x},${n.y}`) { n.x = null; n.y = null; }
          flowed.delete(k);
          // in lanes too: a note flowed there, and not moved since, flows again at the new width
          const pos = n.lanePos?.[lanes.mode];
          if (pos && laneFlowed.get(k) === `${lanes.mode}:${pos.x},${pos.y}`) {
            const { [lanes.mode]: _gone, ...rest } = n.lanePos;
            n.lanePos = Object.keys(rest).length ? rest : null;
          }
          laneFlowed.delete(k);
        }
        laneWidth = glass.clientWidth;
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
  laneWidth = glass.clientWidth;

  return {
    /** Replace the data (any of notes, auto, positions) and redraw. */
    update(data = {}) { setData(data); requestRender(); },
    /** Load everything from `store.load()` (shape `{ notes, positions, legend?, size?, view?, lanes? }`), and the archived list. */
    async reload() {
      if (!opts.store?.load) return;
      try {
        const data = await opts.store.load();
        if (destroyed) return;
        if (data.legend) { savedLegend = data.legend; applyLegend(); }
        if (data.lanes) { savedLanes = data.lanes; applyLanes(); }
        if (data.size) { size = normalizeSize(data.size); applySize(); }
        if (data.view) {
          const before = expand();
          view = normalizeView(data.view);
          if (expand() !== before) opened.clear();
        }
        setData({ notes: data.notes, positions: data.positions });
        requestRender();
      } catch (err) { fail(err); }
      if (canListArchived()) await refreshArchived();
    },
    /** Change options after mounting: legend, lanes, strings, colors, locale, timeZone, hour12, addButton, size, view, expand, width, resizable… */
    configure(next = {}) {
      const before = expand();
      if (next.legend) appLegend = next.legend;
      if (next.lanes) appLanes = next.lanes;
      opts = { ...opts, ...next };
      applyStrings();
      if ('size' in next) size = normalizeSize(next.size);
      if ('view' in next) view = normalizeView(next.view);
      if (expand() !== before) opened.clear();
      if (!canListArchived() && !dismissedAuto.length && archiveView) archiveView = false;
      applyLegend();
      applyLanes();
      applySize();
      renderChrome();
      requestRender();
      if (canListArchived() && archivedList === null && opts.store?.archived) refreshArchived();
    },
    openEditor: (draft) => openEditor(null, draft),
    /** Open the board settings, on a tab: 'types' (default), 'lanes' or 'view'. */
    openSettings: (tab) => openSettings(tab),
    /** Show the archived notes in place of the board (true), or the board again (false). */
    showArchived: (on = true) => setArchiveView(on),
    /** The view people chose in the gear: `{ expand, archiveBox }` (null = the app default). */
    get view() { return { ...view }; },
    /** Open a note big in the center of the screen, as a click does. */
    openNote: (ref) => { const n = find(typeof ref === 'string' ? ref : refId(ref)); if (n) openReader(n); },
    /** The board size people chose: `{ width, height, locked }` (null = the default). */
    get size() { return { ...size }; },
    /** The legend in use: what the app shipped plus what people changed with the gear. */
    get legend() { return opts.legend.map((i) => ({ ...i })); },
    /** The lanes in use: `{ mode, states, categories }`, every lane named. */
    get lanes() { return { mode: lanes.mode, states: laneList('states'), categories: laneList('categories') }; },
    get notes() { return notes.map((n) => ({ ...n })); },
    /** The archived notes the board knows (null before the store answered), the last archived first. */
    get archived() { return archivedList ? archivedList.map(({ archivedHere: _here, ...n }) => ({ ...n })) : null; },
    /** The app notes people dismissed that the app still sends with the same content: `[{ key, title, …, dismissed, dismissedAt }]`. */
    get dismissed() { return dismissedAuto.map((n) => ({ ...n, dismissed: normalizeSignature(positions[n.key]?.dismissed), dismissedAt: n.dismissedAt })); },
    /** Takes the board off the element: listeners, timers and classes. Moves typed with the arrows are saved first. */
    destroy() {
      if (destroyed) return;
      flushKeySaves();
      destroyed = true;
      clearInterval(ticker);
      clearTimeout(resizeTimer);
      clearTimeout(subTimer);
      if (toastNow) clearTimeout(toastNow.timer);
      cancelPress();
      for (const off of cleanups) off();
      if (dialog.open) dialog.close();
      root.classList.remove('pb', 'pb--resizable', 'pb--sizing');
      delete root.dataset.expand;
      root.style.removeProperty('--pb-frame');
      root.innerHTML = '';
    },
  };
}


global.PostitBoard = { DEFAULT_STRINGS, restStore, localStore, createBoard, DEFAULT_COLORS, LIMITS, isColorKey, isHex, SIZE, normalizeSize, EXPAND, normalizeView, LANE_MODES, LANE_PRESETS, normalizeLanes, normalizeLaneOf, normalizeLanePos, fillText, normalizeLegend, mergeLegend, legendColors, safeUrl, escapeHtml, linkify, tilt, normalizeDue, normalizeNote, refOf, refId, autoSignature, normalizeSignature, autoPlace, withPositions, boardHeight, dueStatus, formatDue, formatWhen, toLocalInput, fromLocalInput };
})(typeof globalThis !== 'undefined' ? globalThis : window);
