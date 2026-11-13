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
 *   store.saveLegend([{ color: 'green', label: 'Print' }]);   // note types edited with the gear
 *
 * Nothing is ever deleted: done and removed notes keep their row with a timestamp.
 */
import { LIMITS, isColorKey, normalizeDue, normalizeLegend, safeUrl } from '../src/core.js';

const COLUMNS = `
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'yellow',
  x REAL, y REAL, z INTEGER NOT NULL DEFAULT 0,
  due TEXT, notified_at TEXT,
  link TEXT, link_label TEXT NOT NULL DEFAULT '', image TEXT,
  meta TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, done_at TEXT, removed_at TEXT`;

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
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  doneAt: r.done_at,
});

/** The patch as columns, refusing what the board would never send. */
function toColumns(patch, { creating = false } = {}) {
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
  const number = (name, lo, hi) => {
    if (patch[name] === undefined) return;
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
  number('x', 0, 1);
  number('y', 0, 1e6);
  number('z', 0, 1e9);
  if (cols.y !== undefined) cols.y = Math.round(cols.y);
  if (cols.z !== undefined) cols.z = Math.round(cols.z);
  if (patch.due !== undefined) {
    const due = normalizeDue(patch.due);
    if (patch.due && !due) throw new ValidationError('due must be a date');
    cols.due = due;
    cols.notified_at = null; // a new time rings again
  }
  if (patch.meta !== undefined) cols.meta = patch.meta === null ? null : JSON.stringify(patch.meta);
  if (creating && !cols.title && !cols.text && !cols.image) throw new ValidationError('a note needs a title, a text or an image');
  return cols;
}

export function createSqliteStore(db, { table = 'postits', now = () => new Date().toISOString(), onChange = () => {} } = {}) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error('invalid table name');
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (${COLUMNS})`);
  db.exec(`CREATE INDEX IF NOT EXISTS ${table}_open ON ${table}(done_at, removed_at)`);
  db.exec(`CREATE TABLE IF NOT EXISTS ${table}_settings (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`);

  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const many = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const byId = (id) => one(`SELECT * FROM ${table} WHERE id = ? AND removed_at IS NULL`, id);

  function write(id, cols) {
    const names = Object.keys(cols);
    if (!names.length) return;
    run(`UPDATE ${table} SET ${names.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...names.map((c) => cols[c]), now(), id);
  }

  return {
    table,

    /** Open notes plus the saved positions of automatic notes. */
    load() {
      const notes = many(`SELECT * FROM ${table} WHERE key IS NULL AND done_at IS NULL AND removed_at IS NULL ORDER BY id`).map(fromRow);
      const positions = {};
      for (const r of many(`SELECT key, x, y, z FROM ${table} WHERE key IS NOT NULL`)) positions[r.key] = { x: r.x, y: r.y, z: r.z };
      const legend = one(`SELECT value FROM ${table}_settings WHERE name = 'legend'`);
      return legend ? { notes, positions, legend: JSON.parse(legend.value) } : { notes, positions };
    },

    /** The note types people edited with the gear. The board merges them over the app's legend. */
    saveLegend(legend) {
      if (!Array.isArray(legend)) throw new ValidationError('legend must be a list');
      const clean = normalizeLegend(legend);
      run(`INSERT INTO ${table}_settings (name, value, updated_at) VALUES ('legend', ?, ?)
        ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, JSON.stringify(clean), now());
      onChange({ type: 'legend', legend: clean });
      return { legend: clean };
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

    /** `ref` is `{ id }` for a written note or `{ key }` for the position of an automatic one. */
    update(ref = {}, patch = {}) {
      if (ref.key != null) {
        const key = String(ref.key).slice(0, 200);
        const cols = toColumns({ x: patch.x, y: patch.y, z: patch.z });
        const stamp = now();
        run(`INSERT INTO ${table} (key, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING`, key, stamp, stamp);
        const row = one(`SELECT id FROM ${table} WHERE key = ?`, key);
        write(row.id, cols);
        return { key, ...one(`SELECT x, y, z FROM ${table} WHERE id = ?`, row.id) };
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
      const type = patch.removed ? 'remove' : patch.done ? 'done' : 'update';
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
