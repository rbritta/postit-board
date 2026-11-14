/**
 * Pure helpers shared by the browser board and the server store. No DOM, no I/O,
 * so every rule here is covered by plain `node --test`.
 */

/** The built-in palette. Any other key works too: pass it in `colors`. */
export const DEFAULT_COLORS = Object.freeze({
  yellow: '#fde68a',
  pink: '#fbcfe8',
  green: '#bbf7d0',
  blue: '#bfdbfe',
  orange: '#fed7aa',
  purple: '#ddd6fe',
  teal: '#99f6e4',
  gray: '#e5e7eb',
});

export const LIMITS = Object.freeze({ title: 120, text: 2000, url: 2048, linkLabel: 80, color: 32, label: 40, description: 160, legend: 24, lanes: 12, laneId: 64, laneName: 40, signature: 100 });

const COLOR_KEY = /^[a-z][a-z0-9-]{0,31}$/;

export const isColorKey = (value) => typeof value === 'string' && COLOR_KEY.test(value);
export const isHex = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

/** Board size limits: the width is a share of the space the board has, the height is in pixels. */
export const SIZE = Object.freeze({ width: 0.8, minWidth: 480, minHeight: 320, maxHeight: 6000 });

/**
 * The board size people chose by dragging its bottom corners: `{ width, height, locked }`.
 * `width` is a share of the available width (0.2 to 1), `height` pixels (null = grow with the notes),
 * `locked` hides the handles. Anything else falls back to the default.
 */
export function normalizeSize(size) {
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
export const EXPAND = Object.freeze(['center', 'inplace', 'more']);

/**
 * The board view people chose in the gear: `{ expand, archiveBox }`. `archiveBox` says whether the Archive box
 * shows up while a note is dragged. Unknown values become null (the app default).
 */
export function normalizeView(view) {
  const v = view && typeof view === 'object' ? view : {};
  return { expand: EXPAND.includes(v.expand) ? v.expand : null, archiveBox: typeof v.archiveBox === 'boolean' ? v.archiveBox : null };
}

/** Lanes split the board into columns: by state (a Kanban) or by category. Off by default. */
export const LANE_MODES = Object.freeze(['states', 'categories']);
/** The lanes each mode starts with. The board names them from its strings (laneTodo, laneWork…). */
export const LANE_PRESETS = Object.freeze({ states: Object.freeze(['todo', 'doing', 'waiting', 'done']), categories: Object.freeze(['work', 'home', 'ideas']) });

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
export function normalizeLanes(lanes) {
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
export function normalizeLaneOf(value) {
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
export function normalizeLanePos(value) {
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
export const fillText = (template, values = {}) => String(template ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));

/**
 * A legend as the board and the stores keep it: `[{ color, label, description?, hex?, locked? }]`.
 * `color` is the key notes carry; `hex` repaints that key; `locked` marks a type the app owns
 * (its color can't change and it can't be removed, only renamed). Bad entries are dropped.
 */
export function normalizeLegend(list) {
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
export function mergeLegend(appLegend, saved) {
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
export const legendColors = (legend) => Object.fromEntries(normalizeLegend(legend).filter((i) => i.hex).map((i) => [i.color, i.hex]));

/**
 * Only http(s), relative (`/x`, `./x`, `../x`) and in-page links: never `javascript:` or `data:`,
 * and never another site through a protocol-relative link (`//x`, which browsers also read in
 * `/\x` and in `/<tab>/x`, since they drop tabs and line breaks from URLs).
 */
export function safeUrl(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || url.length > LIMITS.url || /[\u0000-\u001f\u007f]/.test(url)) return null;
  if (/^(\/(?![/\\])|\.{1,2}\/|#|\?)/.test(url)) return url;
  return /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Escaped text with bare http(s) URLs turned into links that open in a new tab. */
export function linkify(text) {
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
export function tilt(seed) {
  let hash = 0;
  for (const ch of String(seed)) hash = (hash * 31 + ch.codePointAt(0)) | 0;
  return ((Math.abs(hash) % 7) - 3) * 0.7;
}

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const text = (v, max) => (v === null || v === undefined ? '' : String(v).slice(0, max));

/** A due date as an ISO string, or null when absent or unreadable. */
export function normalizeDue(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * The note shape every part of the library agrees on. `ref` is what the store is called
 * with: `{ id }` for a note someone wrote, `{ key }` for an automatic one.
 */
export function normalizeNote(note, { auto = false } = {}) {
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

export const refOf = (note) => (note.auto ? { key: note.key } : { id: note.id });
export const refId = (ref) => (ref.key != null ? `key:${ref.key}` : `id:${ref.id}`);

/**
 * The signature of what the app sent for an app note: its title, text, due time, link and color, as a short
 * string (`s1:` and a hash). Dismissing an app note stores this with its key (`dismissed`); the note stays
 * hidden while the app sends the same content, and shows again when the content changes.
 */
export function autoSignature(note) {
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
export const normalizeSignature = (value) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, LIMITS.signature) : null);

/** Notes without a saved position flow into a grid, left to right, top to bottom. */
export function autoPlace(notes, { columns = 4, rowHeight = 235, top = 26, gap = 0.012 } = {}) {
  let k = 0;
  return notes.map((note) => {
    if (note.x !== null && note.y !== null) return note;
    const placed = { ...note, x: (k % columns) / columns + gap, y: Math.floor(k / columns) * rowHeight + top };
    k += 1;
    return placed;
  });
}

/** Automatic notes come from the app on every render; only their position is stored, by key (in lanes too). */
export function withPositions(autoNotes, positions = {}) {
  return autoNotes.map((n) => {
    const saved = positions[n.key];
    return saved ? { ...n, x: num(saved.x), y: num(saved.y), z: num(saved.z) ?? 0, lanePos: normalizeLanePos(saved.lanePos) } : n;
  });
}

export const boardHeight = (notes, { min = 560, noteHeight = 250 } = {}) =>
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
export function dueStatus(due, now = new Date(), { timeZone } = {}) {
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
export function formatDue(due, { locale, timeZone, hour12, now = new Date(), words = {} } = {}) {
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
export function formatWhen(when, { locale, timeZone, hour12, now = new Date(), words = {} } = {}) {
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
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (value) => (value ? normalizeDue(new Date(value)) : null);
