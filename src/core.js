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

export const LIMITS = Object.freeze({ title: 120, text: 2000, url: 2048, linkLabel: 80, color: 32, label: 40, description: 160, legend: 24 });

const COLOR_KEY = /^[a-z][a-z0-9-]{0,31}$/;

export const isColorKey = (value) => typeof value === 'string' && COLOR_KEY.test(value);
export const isHex = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

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

/** Only http(s), relative (`/x`, `./x`, `../x`) and in-page links: never `javascript:` or `data:`. */
export function safeUrl(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || url.length > LIMITS.url) return null;
  if (/^(\/(?!\/)|\.{1,2}\/|#|\?)/.test(url)) return url;
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
  };
  if (auto && !out.key) throw new Error('an automatic note needs a key');
  return out;
}

export const refOf = (note) => (note.auto ? { key: note.key } : { id: note.id });
export const refId = (ref) => (ref.key != null ? `key:${ref.key}` : `id:${ref.id}`);

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

/** Automatic notes come from the app on every render; only their position is stored, by key. */
export function withPositions(autoNotes, positions = {}) {
  return autoNotes.map((n) => {
    const saved = positions[n.key];
    return saved ? { ...n, x: num(saved.x), y: num(saved.y), z: num(saved.z) ?? 0 } : n;
  });
}

export const boardHeight = (notes, { min = 560, noteHeight = 250 } = {}) =>
  Math.max(min, ...notes.map((n) => (n.y ?? 0) + noteHeight));

const DAY = 86_400_000;

/** 'overdue' | 'today' | 'soon' (next 7 days) | 'later' | null, compared in local time. */
export function dueStatus(due, now = new Date()) {
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
export function formatDue(due, { locale = 'en', now = new Date(), words = {} } = {}) {
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
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (value) => (value ? normalizeDue(new Date(value)) : null);
