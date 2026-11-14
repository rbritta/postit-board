/**
 * A store for postit-board on SQLite. Works with `node:sqlite` (DatabaseSync) and with
 * better-sqlite3: both expose `exec` and `prepare(sql).run/get/all`.
 *
 *   import { DatabaseSync } from 'node:sqlite';
 *   const store = createSqliteStore(new DatabaseSync('board.db'));
 *   await store.load();                       // { notes, positions }
 *   store.create({ text: 'Buy filament', color: 'green' });
 *   store.update({ id: 3 }, { done: true });
 *   store.update({ key: 'auto:dry' }, { x: 0.5, y: 120 });   // position of an automatic note
 *   store.update({ key: 'auto:dry' }, { dismissed: 's1:…' }); // Dismiss an app note (sets dismissedAt; null brings it back)
 *   store.saveLegend([{ color: 'green', label: 'Print' }]);   // note types edited with the gear
 *   store.archived();                         // { notes } archived (done), the last archived first
 *   store.update({ id: 3 }, { done: false }); // restore an archived note
 *
 * Nothing is ever deleted: done (archived) and removed notes keep their row with a timestamp.
 * A table made by an older version gets the new columns in place when the store opens it.
 */
import {
  LIMITS, isColorKey, normalizeDue, normalizeLaneOf, normalizeLanePos, normalizeLanes, normalizeLegend, normalizeSignature, normalizeSize, normalizeView, safeUrl,
} from '../src/core.js';

const COLUMNS = `
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'yellow',
  x REAL, y REAL, z INTEGER NOT NULL DEFAULT 0,
  due TEXT, notified_at TEXT,
  link TEXT, link_label TEXT NOT NULL DEFAULT '', image TEXT,
  meta TEXT, lane TEXT, lane_pos TEXT, dismissed TEXT, dismissed_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, done_at TEXT, removed_at TEXT`;

/** Columns added after 0.1.0. A table without them gets them with ALTER TABLE ADD COLUMN, keeping every row. */
const ADDED = Object.freeze({ lane: 'TEXT', lane_pos: 'TEXT', dismissed: 'TEXT', dismissed_at: 'TEXT' });

const json = (raw) => {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
};

export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; this.status = 400; }
}
export class NotFoundError extends Error {
  constructor(message) { super(message); this.name = 'NotFoundError'; this.status = 404; }
}

const fromRow = (r) => ({
  id: r.id,
  title: r.title,
  text: r.text,
  color: r.color,
  x: r.x,
  y: r.y,
  z: r.z,
  due: r.due,
  link: r.link,
  linkLabel: r.link_label,
  image: r.image,
  meta: r.meta ? JSON.parse(r.meta) : null,
  lane: normalizeLaneOf(json(r.lane)),
  lanePos: normalizeLanePos(json(r.lane_pos)),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  doneAt: r.done_at,
});

/** The patch as columns, refusing what the board would never send. */
function toColumns(patch, { creating = false } = {}) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) throw new ValidationError('a note must be an object');
  const cols = {};
  const str = (name, col, max) => {
    if (patch[name] === undefined) return;
    if (patch[name] !== null && typeof patch[name] !== 'string') throw new ValidationError(`${name} must be text`);
    cols[col] = (patch[name] ?? '').trim().slice(0, max);
  };
  const url = (name, col) => {
    if (patch[name] === undefined) return;
    if (patch[name] === null || patch[name] === '') { cols[col] = null; return; }
    const ok = safeUrl(patch[name]);
    if (!ok) throw new ValidationError(`${name} must be an http(s) or relative URL`);
    cols[col] = ok;
  };
  // x and y may be null: a note not placed yet (made on a narrow screen, where the board is a plain grid)
  const number = (name, lo, hi, { nullable = false } = {}) => {
    if (patch[name] === undefined) return;
    if (patch[name] === null && nullable) { cols[name] = null; return; }
    const n = Number(patch[name]);
    if (patch[name] === null || !Number.isFinite(n)) throw new ValidationError(`${name} must be a number`);
    cols[name] = Math.min(Math.max(n, lo), hi);
  };
  str('title', 'title', LIMITS.title);
  str('text', 'text', LIMITS.text);
  str('linkLabel', 'link_label', LIMITS.linkLabel);
  url('link', 'link');
  url('image', 'image');
  if (patch.color !== undefined) {
    if (!isColorKey(patch.color)) throw new ValidationError('color must be a lowercase key like "yellow"');
    cols.color = patch.color;
  }
  number('x', 0, 1, { nullable: true });
  number('y', 0, 1e6, { nullable: true });
  number('z', 0, 1e9);
  if (cols.y != null) cols.y = Math.round(cols.y);
  if (cols.z !== undefined) cols.z = Math.round(cols.z);
  if (patch.due !== undefined) {
    const due = normalizeDue(patch.due);
    if (patch.due && !due) throw new ValidationError('due must be a date');
    cols.due = due;
    cols.notified_at = null; // a new time rings again
  }
  if (patch.meta !== undefined) cols.meta = patch.meta === null ? null : JSON.stringify(patch.meta);
  // the lane of the note in each mode ({ states, categories }) and where it sits inside it
  if (patch.lane !== undefined) {
    if (patch.lane !== null && typeof patch.lane !== 'object' && typeof patch.lane !== 'string') throw new ValidationError('lane must be an object');
    const lane = normalizeLaneOf(patch.lane);
    cols.lane = lane ? JSON.stringify(lane) : null;
  }
  if (patch.lanePos !== undefined) {
    if (patch.lanePos !== null && (typeof patch.lanePos !== 'object' || Array.isArray(patch.lanePos))) throw new ValidationError('lanePos must be an object');
    const pos = normalizeLanePos(patch.lanePos);
    cols.lane_pos = pos ? JSON.stringify(pos) : null;
  }
  if (creating && !cols.title && !cols.text && !cols.image) throw new ValidationError('a note needs a title, a text or an image');
  return cols;
}

export function createSqliteStore(db, { table = 'postits', now = () => new Date().toISOString(), onChange = () => {} } = {}) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error('invalid table name');
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const many = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const byId = (id) => one(`SELECT * FROM ${table} WHERE id = ? AND removed_at IS NULL`, id);

  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (${COLUMNS})`);
  // a table made by an older version: add what it lacks, in place
  const have = new Set(many(`PRAGMA table_info(${table})`).map((c) => c.name));
  for (const [name, type] of Object.entries(ADDED)) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  db.exec(`CREATE INDEX IF NOT EXISTS ${table}_open ON ${table}(done_at, removed_at)`);
  db.exec(`CREATE TABLE IF NOT EXISTS ${table}_settings (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`);

  const setting = (name) => json(one(`SELECT value FROM ${table}_settings WHERE name = ?`, name)?.value);
  const saveSetting = (name, value) => run(`INSERT INTO ${table}_settings (name, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, name, JSON.stringify(value), now());
  // an app note people dismissed keeps the signature of what it said then: the board hides it while that holds
  const position = (r) => {
    const lanePos = normalizeLanePos(json(r.lane_pos));
    const dismissed = normalizeSignature(r.dismissed);
    return { x: r.x, y: r.y, z: r.z, ...(lanePos ? { lanePos } : {}), ...(dismissed ? { dismissed, dismissedAt: r.dismissed_at ?? null } : {}) };
  };

  function write(id, cols) {
    const names = Object.keys(cols);
    if (!names.length) return;
    run(`UPDATE ${table} SET ${names.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...names.map((c) => cols[c]), now(), id);
  }

  return {
    table,

    /** Open notes plus the saved positions of automatic notes, and the settings people saved. */
    load() {
      const notes = many(`SELECT * FROM ${table} WHERE key IS NULL AND done_at IS NULL AND removed_at IS NULL ORDER BY id`).map(fromRow);
      const positions = {};
      for (const r of many(`SELECT key, x, y, z, lane_pos, dismissed, dismissed_at FROM ${table} WHERE key IS NOT NULL`)) positions[r.key] = position(r);
      const out = { notes, positions };
      for (const name of ['legend', 'size', 'view', 'lanes']) {
        const value = setting(name);
        if (value) out[name] = value;
      }
      return out;
    },

    /** Archived notes (marked done, not deleted for good), the last archived first. */
    archived() {
      const notes = many(`SELECT * FROM ${table} WHERE key IS NULL AND done_at IS NOT NULL AND removed_at IS NULL ORDER BY done_at DESC, id DESC`).map(fromRow);
      return { notes };
    },

    /** The note types people edited with the gear. The board merges them over the app's legend. */
    saveLegend(legend) {
      if (!Array.isArray(legend)) throw new ValidationError('legend must be a list');
      const clean = normalizeLegend(legend);
      saveSetting('legend', clean);
      onChange({ type: 'legend', legend: clean });
      return { legend: clean };
    },

    /** The lanes people set in the gear: `{ mode, states, categories }`, kept next to the legend. */
    saveLanes(lanes) {
      if (!lanes || typeof lanes !== 'object' || Array.isArray(lanes)) throw new ValidationError('lanes must be an object');
      const clean = normalizeLanes(lanes);
      saveSetting('lanes', clean);
      onChange({ type: 'lanes', lanes: clean });
      return { lanes: clean };
    },

    /** The board size people chose by dragging its corners (and the lock from the gear). */
    saveSize(size) {
      if (!size || typeof size !== 'object') throw new ValidationError('size must be an object');
      const clean = normalizeSize(size);
      saveSetting('size', clean);
      onChange({ type: 'size', size: clean });
      return { size: clean };
    },

    /** How cut text opens and whether the Archive box shows, picked in the gear: `{ expand, archiveBox }`. */
    saveView(view) {
      if (!view || typeof view !== 'object') throw new ValidationError('view must be an object');
      const clean = normalizeView(view);
      saveSetting('view', clean);
      onChange({ type: 'view', view: clean });
      return { view: clean };
    },

    get(id) {
      const row = byId(Number(id));
      return row ? fromRow(row) : null;
    },

    create(draft = {}) {
      const cols = { color: 'yellow', ...toColumns(draft, { creating: true }) };
      const stamp = now();
      const names = Object.keys(cols);
      const res = run(`INSERT INTO ${table} (${names.join(', ')}, created_at, updated_at) VALUES (${names.map(() => '?').join(', ')}, ?, ?)`,
        ...names.map((c) => cols[c]), stamp, stamp);
      const note = fromRow(byId(Number(res.lastInsertRowid)));
      onChange({ type: 'create', note });
      return note;
    },

    /**
     * `ref` is `{ id }` for a written note or `{ key }` for the position of an automatic one. `{ done: true }`
     * archives a note, `{ done: false }` restores it, `{ removed: true }` deletes it for good.
     */
    update(ref = {}, patch = {}) {
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) throw new ValidationError('a patch must be an object');
      if (ref.key != null) {
        const key = String(ref.key).slice(0, 200);
        const cols = toColumns({ x: patch.x, y: patch.y, z: patch.z, lanePos: patch.lanePos });
        // Dismiss: the signature of the app note's content (null brings it back)
        if (patch.dismissed !== undefined) {
          if (patch.dismissed !== null && (typeof patch.dismissed !== 'string' || patch.dismissed.length > LIMITS.signature)) {
            throw new ValidationError(`dismissed must be text up to ${LIMITS.signature} characters, or null`);
          }
          cols.dismissed = normalizeSignature(patch.dismissed);
          // when, by the server's clock; cleared with the Dismiss
          cols.dismissed_at = cols.dismissed ? now() : null;
        }
        const stamp = now();
        run(`INSERT INTO ${table} (key, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING`, key, stamp, stamp);
        const row = one(`SELECT id FROM ${table} WHERE key = ?`, key);
        write(row.id, cols);
        const saved = { key, ...position(one(`SELECT x, y, z, lane_pos, dismissed, dismissed_at FROM ${table} WHERE id = ?`, row.id)) };
        if (patch.dismissed !== undefined) onChange({ type: 'dismiss', key, dismissed: saved.dismissed ?? null, dismissedAt: saved.dismissedAt ?? null });
        return saved;
      }
      const id = Number(ref.id);
      const before = byId(id);
      if (!before || before.key != null) throw new NotFoundError('note not found');
      const cols = toColumns(patch);
      if (patch.done === true) cols.done_at = now();
      if (patch.done === false) cols.done_at = null;
      if (patch.removed === true) cols.removed_at = now();
      write(id, cols);
      const after = one(`SELECT * FROM ${table} WHERE id = ?`, id);
      const note = fromRow(after);
      // done: true archives the note; done: false on an archived note restores it
      const type = patch.removed ? 'remove' : patch.done === true ? 'done' : patch.done === false && before.done_at ? 'restore' : 'update';
      onChange({ type, note, before: fromRow(before), patch });
      return note;
    },

    /** Open notes whose due time has come and that were not announced yet. */
    dueNotes(at = now()) {
      return many(`SELECT * FROM ${table} WHERE key IS NULL AND done_at IS NULL AND removed_at IS NULL
        AND due IS NOT NULL AND due <= ? AND notified_at IS NULL ORDER BY due`, at).map(fromRow);
    },

    markNotified(id, at = now()) {
      run(`UPDATE ${table} SET notified_at = ? WHERE id = ?`, at, Number(id));
    },
  };
}
