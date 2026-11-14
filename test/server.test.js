import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHttpHandler, createSqliteStore, watchDue } from '../server/index.js';
import { restStore } from '../src/postit-board.js';

const clock = (start = '2026-11-13T12:00:00.000Z') => {
  let t = Date.parse(start);
  const now = () => new Date(t).toISOString();
  now.advance = (ms) => { t += ms; };
  return now;
};

test('create, edit, finish and remove a note; positions of automatic notes by key', () => {
  const now = clock();
  const changes = [];
  const store = createSqliteStore(new DatabaseSync(':memory:'), { now, onChange: (c) => changes.push(c.type) });
  const a = store.create({ title: 'Lorem', text: 'ipsum', color: 'green', x: 0.2, y: 40 });
  const b = store.create({ text: 'dolor' });
  assert.equal(b.color, 'yellow');
  store.update({ id: a.id }, { text: 'ipsum dolor', link: 'https://example.com', linkLabel: 'Open' });
  store.update({ key: 'auto:disk' }, { x: 0.7, y: 300, z: 4 });
  let data = store.load();
  assert.deepEqual(data.notes.map((n) => n.text), ['ipsum dolor', 'dolor']);
  assert.deepEqual(data.positions['auto:disk'], { x: 0.7, y: 300, z: 4 });
  store.update({ id: a.id }, { done: true });
  store.update({ id: b.id }, { removed: true });
  data = store.load();
  assert.equal(data.notes.length, 0);
  assert.equal(data.legend, undefined, 'no legend until someone edits the types');
  store.update({ key: 'auto:disk' }, { z: 9 });
  assert.deepEqual(store.load().positions['auto:disk'], { x: 0.7, y: 300, z: 9 }, 'raising a note keeps where it is');
  assert.deepEqual(changes, ['create', 'create', 'update', 'done', 'remove']);
  assert.throws(() => store.update({ id: b.id }, { text: 'x' }), { name: 'NotFoundError' });
});

test('the store refuses what the board would never send', () => {
  const store = createSqliteStore(new DatabaseSync(':memory:'));
  assert.throws(() => store.create({}), { name: 'ValidationError' });
  assert.throws(() => store.create({ text: 'x', link: 'javascript:alert(1)' }), /link/);
  assert.throws(() => store.create({ text: 'x', color: 'Red!' }), /color/);
  assert.throws(() => store.create({ text: 'x', due: 'someday' }), /due/);
  assert.throws(() => createSqliteStore(new DatabaseSync(':memory:'), { table: 'x; DROP' }), /table/);
  const n = store.create({ text: 'x'.repeat(5000), x: 9, meta: { patient: 12 } });
  assert.equal(n.text.length, 2000);
  assert.equal(n.x, 1);
  assert.deepEqual(n.meta, { patient: 12 });
});

test('a note without a place yet (x and y null, as on a narrow screen) is kept, and only z must be a number', () => {
  const store = createSqliteStore(new DatabaseSync(':memory:'));
  const n = store.create({ text: 'made on a phone', color: 'green', x: null, y: null, z: 1 });
  assert.equal(n.x, null);
  assert.equal(n.y, null);
  assert.equal(store.update({ id: n.id }, { x: 0.25, y: 40 }).x, 0.25);
  assert.equal(store.update({ id: n.id }, { x: null, y: null }).x, null, 'back to the grid');
  assert.throws(() => store.create({ text: 'x', z: null }), /z must be a number/);
  assert.throws(() => store.create({ text: 'x', x: 'left' }), /x must be a number/);
});

test('a due note rings once; moving the time rings again', async () => {
  const now = clock();
  const store = createSqliteStore(new DatabaseSync(':memory:'), { now });
  const n = store.create({ text: 'call', due: '2026-11-13T12:30:00.000Z' });
  const rang = [];
  const ring = (note) => { rang.push(note.id); };
  assert.equal(store.dueNotes().length, 0);
  now.advance(31 * 60_000);
  let stop = watchDue(store, { onDue: ring, now, intervalMs: 1e6 });
  await new Promise((r) => setTimeout(r, 10));
  stop();
  stop = watchDue(store, { onDue: ring, now, intervalMs: 1e6 });
  await new Promise((r) => setTimeout(r, 10));
  stop();
  assert.deepEqual(rang, [n.id]);
  store.update({ id: n.id }, { due: '2026-11-13T12:40:00.000Z' });
  assert.equal(store.dueNotes().length, 0);
  now.advance(10 * 60_000);
  assert.equal(store.dueNotes().length, 1);
});

test('a failing onDue rings again on the next tick', async () => {
  const now = clock();
  const store = createSqliteStore(new DatabaseSync(':memory:'), { now });
  store.create({ text: 'x', due: '2026-11-13T11:00:00.000Z' });
  let calls = 0;
  const stop = watchDue(store, { onDue: () => { calls += 1; throw new Error('offline'); }, now, intervalMs: 1e6, onError: () => {} });
  await new Promise((r) => setTimeout(r, 10));
  stop();
  assert.equal(calls, 1);
  assert.equal(store.dueNotes().length, 1);
});

test('restStore and the HTTP handler speak the same routes', async () => {
  const store = createSqliteStore(new DatabaseSync(':memory:'));
  const handle = createHttpHandler(store, { prefix: '/api/postits' });
  const server = createServer(async (req, res) => { if (!(await handle(req, res))) { res.writeHead(418); res.end(); } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const client = restStore(`${base}/api/postits/`);
    const created = await client.create({ title: 'Lorem', text: 'ipsum', color: 'blue' });
    const unplaced = await client.create({ text: 'from a phone', color: 'green', x: null, y: null, z: 2 });
    assert.equal(unplaced.x, null, 'the HTTP route takes a note with no place yet');
    await client.update({ id: unplaced.id }, { removed: true });
    await client.update({ id: created.id }, { text: 'changed' });
    await client.update({ key: 'auto:x y' }, { x: 0.5, y: 10 });
    const data = await client.load();
    assert.equal(data.notes[0].text, 'changed');
    assert.deepEqual(data.positions['auto:x y'], { x: 0.5, y: 10, z: 0 });
    await assert.rejects(client.create({ text: 'x', link: 'javascript:x' }), /link/);
    await assert.rejects(client.update({ id: 999 }, { text: 'x' }), /not found/);
    const saved = await client.saveLegend([{ color: 'green', label: 'Print', hex: '#00ff00' }, { color: 'BAD' }]);
    assert.deepEqual(saved.legend, [{ color: 'green', label: 'Print', hex: '#00ff00' }]);
    assert.deepEqual((await client.load()).legend, saved.legend);
    const size = await client.saveSize({ width: 5, height: 10, locked: true, extra: 1 });
    assert.deepEqual(size.size, { width: 1, height: 320, locked: true }, 'clamped to the limits');
    assert.deepEqual((await client.load()).size, size.size);
    assert.deepEqual((await client.saveView({ expand: 'inplace', archiveBox: false })).view, { expand: 'inplace', archiveBox: false });
    assert.deepEqual((await client.load()).view, { expand: 'inplace', archiveBox: false });
    // lanes and the archived list
    const lanes = await client.saveLanes({ mode: 'states', states: [{ id: 'todo', name: 'To do' }, { id: 'done', name: 'Done' }] });
    assert.deepEqual(lanes.lanes, { mode: 'states', states: [{ id: 'todo', name: 'To do' }, { id: 'done', name: 'Done' }] });
    assert.deepEqual((await client.load()).lanes, lanes.lanes);
    await assert.rejects(client.saveLanes('kanban'), /lanes must be an object/);
    await client.update({ id: created.id }, { lane: { states: 'done' }, lanePos: { states: { x: 0.5, y: 80 } } });
    await client.update({ id: created.id }, { done: true });
    const archived = await client.archived();
    assert.deepEqual(archived.notes.map((n) => [n.id, n.lane, n.lanePos]), [[created.id, { states: 'done' }, { states: { x: 0.5, y: 80 } }]]);
    assert.ok(archived.notes[0].doneAt);
    assert.equal((await client.load()).notes.length, 0, 'an archived note leaves the board');
    await client.update({ id: created.id }, { done: false });
    assert.deepEqual((await client.archived()).notes, []);
    assert.equal((await client.load()).notes[0].id, created.id, 'restored');
    await client.update({ key: 'auto:x y' }, { lanePos: { states: { x: 0.25, y: 60 } } });
    assert.deepEqual((await client.load()).positions['auto:x y'], { x: 0.5, y: 10, z: 0, lanePos: { states: { x: 0.25, y: 60 } } });
    // Dismiss of an app note: PUT /key/:key { dismissed }, back in load() with its place; null brings it back
    const dismissed = await client.update({ key: 'auto:x y' }, { dismissed: 's1:abc' });
    assert.match(dismissed.dismissedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, 'when, by the server clock');
    assert.deepEqual(dismissed, { key: 'auto:x y', x: 0.5, y: 10, z: 0, lanePos: { states: { x: 0.25, y: 60 } }, dismissed: 's1:abc', dismissedAt: dismissed.dismissedAt });
    assert.deepEqual([(await client.load()).positions['auto:x y'].dismissed, (await client.load()).positions['auto:x y'].dismissedAt], ['s1:abc', dismissed.dismissedAt]);
    await assert.rejects(client.update({ key: 'auto:x y' }, { dismissed: 'x'.repeat(101) }), /dismissed must be text/);
    await assert.rejects(client.update({ key: 'auto:x y' }, { dismissed: 5 }), /dismissed must be text/);
    await client.update({ key: 'auto:x y' }, { dismissed: null });
    assert.deepEqual((await client.load()).positions['auto:x y'], { x: 0.5, y: 10, z: 0, lanePos: { states: { x: 0.25, y: 60 } } }, 'dismissed and dismissedAt cleared');
    await assert.rejects(fetch(`${base}/api/postits/legend`, { method: 'PUT', body: '{"legend":"x"}' }).then((r) => r.json()).then((d) => { throw new Error(d.error); }), /legend must be a list/);
    assert.equal((await fetch(`${base}/other`)).status, 418);
    assert.equal((await fetch(`${base}/api/postits/abc`, { method: 'DELETE' })).status, 404);
  } finally {
    server.close();
  }
});

test('the handler answers bad requests with 400 and 413, never a 500 or a reset connection', async () => {
  const store = createSqliteStore(new DatabaseSync(':memory:'));
  const handle = createHttpHandler(store);
  const server = createServer(async (req, res) => { if (!(await handle(req, res))) { res.writeHead(418); res.end(); } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const api = `http://127.0.0.1:${server.address().port}/api/postits`;
  const call = async (path, method, body) => {
    const res = await fetch(api + path, { method, body });
    return [res.status, (await res.json()).error];
  };
  try {
    assert.deepEqual(await call('', 'POST', JSON.stringify({ text: 'x'.repeat(100_000) })), [413, 'body too large']);
    assert.deepEqual(await call('', 'POST', 'null'), [400, 'the body must be a JSON object']);
    assert.deepEqual(await call('', 'POST', '[1]'), [400, 'the body must be a JSON object']);
    assert.deepEqual(await call('', 'POST', '{nope'), [400, 'invalid JSON']);
    assert.deepEqual(await call('/key/%E0%A4%A', 'PUT', '{}'), [400, 'invalid key']);
    const { id } = store.create({ text: 'still here' });
    assert.deepEqual(await call(`/${id}`, 'PATCH', '"text"'), [400, 'the body must be a JSON object']);
    assert.equal(store.get(id).text, 'still here');
  } finally {
    server.close();
  }
});

test('a body some framework already read (string, Buffer or object) goes through the same checks', async () => {
  const store = createSqliteStore(new DatabaseSync(':memory:'));
  const handle = createHttpHandler(store);
  const answer = async (body) => {
    const res = { status: 0, data: null, writeHead(status) { this.status = status; }, end(text) { this.data = JSON.parse(text); } };
    await handle({ url: '/api/postits', method: 'POST', body }, res);
    return [res.status, res.data.error ?? res.data.text];
  };
  assert.deepEqual(await answer({ text: 'object' }), [201, 'object']);
  assert.deepEqual(await answer('{"text":"string"}'), [201, 'string']);
  assert.deepEqual(await answer(Buffer.from('{"text":"buffer"}')), [201, 'buffer']);
  assert.deepEqual(await answer('{bad'), [400, 'invalid JSON']);
  assert.deepEqual(await answer(null), [400, 'the body must be a JSON object']);
});

test('the store refuses a note or a patch that is not an object', () => {
  const store = createSqliteStore(new DatabaseSync(':memory:'));
  const { id } = store.create({ text: 'x' });
  assert.throws(() => store.create(null), { name: 'ValidationError' });
  assert.throws(() => store.update({ id }, null), { name: 'ValidationError' });
  assert.throws(() => store.update({ key: 'k' }, []), { name: 'ValidationError' });
  assert.throws(() => store.create({ text: 'x', link: '/\\evil.example' }), /link/, 'a link that browsers read as another site');
});

test('Archived: the list, Restore, Delete for good, and what onChange says for each', () => {
  const now = clock();
  const changes = [];
  const store = createSqliteStore(new DatabaseSync(':memory:'), { now, onChange: (c) => changes.push(c.type) });
  const a = store.create({ text: 'first', lane: 'doing' });
  const b = store.create({ text: 'second' });
  const c = store.create({ text: 'third' });
  store.update({ id: a.id }, { done: true });
  now.advance(60_000);
  store.update({ id: c.id }, { done: true });
  assert.deepEqual(store.archived().notes.map((n) => n.text), ['third', 'first'], 'the last archived first');
  assert.deepEqual(store.archived().notes[1].lane, { states: 'doing', categories: 'doing' });
  assert.deepEqual(store.load().notes.map((n) => n.id), [b.id]);
  store.update({ id: a.id }, { done: false });
  store.update({ id: c.id }, { removed: true });
  assert.deepEqual(store.archived().notes, []);
  assert.deepEqual(store.load().notes.map((n) => n.id), [a.id, b.id]);
  store.update({ id: b.id }, { done: false });
  store.update({ key: 'auto:disk' }, { x: 0.2 });
  store.update({ key: 'auto:disk' }, { dismissed: 's1:abc' });
  store.update({ key: 'auto:disk' }, { dismissed: null });
  assert.deepEqual(changes, ['create', 'create', 'create', 'done', 'done', 'restore', 'remove', 'update', 'dismiss', 'dismiss'], 'done: false on an open note is a plain update; a move by key says nothing; Dismiss and its undo do');
});

test('lanes are kept with the legend; a note keeps its lane and its place in each mode', () => {
  const changes = [];
  const store = createSqliteStore(new DatabaseSync(':memory:'), { onChange: (c) => changes.push(c) });
  assert.equal(store.load().lanes, undefined, 'off until someone sets them');
  store.saveLanes({ mode: 'categories', categories: [{ id: 'work', name: 'Work' }] });
  assert.deepEqual(store.load().lanes, { mode: 'categories', categories: [{ id: 'work', name: 'Work' }] });
  assert.deepEqual(changes.at(-1), { type: 'lanes', lanes: { mode: 'categories', categories: [{ id: 'work', name: 'Work' }] } });
  const n = store.create({ text: 'x', lane: { states: 'doing', categories: 'work' }, lanePos: { categories: { x: 0.3, y: 70 } } });
  assert.deepEqual([n.lane, n.lanePos], [{ states: 'doing', categories: 'work' }, { categories: { x: 0.3, y: 70 } }]);
  const moved = store.update({ id: n.id }, { lane: { states: 'done', categories: 'work' }, lanePos: null });
  assert.deepEqual([moved.lane, moved.lanePos], [{ states: 'done', categories: 'work' }, null]);
  assert.throws(() => store.update({ id: n.id }, { lane: 7 }), /lane must be an object/);
  assert.throws(() => store.update({ id: n.id }, { lanePos: [1] }), /lanePos must be an object/);
  assert.throws(() => store.saveLanes(null), /lanes must be an object/);
  assert.deepEqual(store.update({ key: 'auto:k' }, { lanePos: { states: { x: 0.5, y: 90 } } }), { key: 'auto:k', x: null, y: null, z: 0, lanePos: { states: { x: 0.5, y: 90 } } });
});

/** The table as 0.6.0 and earlier made it: no lane columns. */
const OLD_TABLE = `CREATE TABLE postits (
  id INTEGER PRIMARY KEY, key TEXT UNIQUE, title TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'yellow', x REAL, y REAL, z INTEGER NOT NULL DEFAULT 0, due TEXT, notified_at TEXT,
  link TEXT, link_label TEXT NOT NULL DEFAULT '', image TEXT, meta TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, done_at TEXT, removed_at TEXT)`;
const OLD_ROWS = `INSERT INTO postits (title, text, created_at, updated_at, done_at) VALUES
  ('Open', 'still on the board', '2026-01-01', '2026-01-01', NULL),
  ('Done', 'finished last year', '2026-01-01', '2026-01-02', '2026-01-02T10:00:00.000Z')`;

test('a table made by an older version gets the lane and dismissed columns in place, keeping every row', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(OLD_TABLE);
  db.exec(OLD_ROWS);
  db.exec("INSERT INTO postits (key, x, y, created_at, updated_at) VALUES ('auto:old', 0.3, 50, '2026-01-01', '2026-01-01')");
  const now = clock('2026-11-14T09:30:00.000Z');
  const store = createSqliteStore(db, { now });
  const columns = db.prepare('PRAGMA table_info(postits)').all().map((c) => c.name);
  assert.ok(['lane', 'lane_pos', 'dismissed', 'dismissed_at'].every((c) => columns.includes(c)), columns.join());
  assert.deepEqual(store.load().positions['auto:old'], { x: 0.3, y: 50, z: 0 }, 'an old app note position, nothing dismissed');
  store.update({ key: 'auto:old' }, { dismissed: 's1:old' });
  assert.deepEqual(store.load().positions['auto:old'], { x: 0.3, y: 50, z: 0, dismissed: 's1:old', dismissedAt: '2026-11-14T09:30:00.000Z' });
  now.advance(60_000);
  store.update({ key: 'auto:old' }, { y: 80 });
  assert.equal(store.load().positions['auto:old'].dismissedAt, '2026-11-14T09:30:00.000Z', 'a move keeps when it was dismissed');
  store.update({ key: 'auto:old' }, { dismissed: null });
  assert.deepEqual(store.load().positions['auto:old'], { x: 0.3, y: 80, z: 0 }, 'Bring back clears both');
  assert.equal(db.prepare("SELECT dismissed_at FROM postits WHERE key = 'auto:old'").get().dismissed_at, null);
  assert.deepEqual(store.load().notes.map((n) => [n.title, n.lane, n.lanePos]), [['Open', null, null]]);
  assert.deepEqual(store.archived().notes.map((n) => n.title), ['Done'], 'notes done before 0.7.0 are the archived ones');
  assert.deepEqual(store.update({ id: 1 }, { lane: 'todo' }).lane, { states: 'todo', categories: 'todo' });
  createSqliteStore(db); // opening it again changes nothing
  assert.equal(db.prepare('PRAGMA table_info(postits)').all().length, columns.length);
});

test('a database file from an older version opens and migrates (temp dir)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'postit-board-'));
  const file = join(dir, 'board.db');
  try {
    const old = new DatabaseSync(file);
    old.exec(OLD_TABLE);
    old.exec(OLD_ROWS);
    old.close();
    const db = new DatabaseSync(file);
    try {
      const store = createSqliteStore(db);
      store.update({ id: 1 }, { lane: { categories: 'home' }, lanePos: { categories: { x: 0.1, y: 60 } } });
      store.update({ key: 'auto:disk' }, { dismissed: 's1:file' });
      assert.match(store.load().positions['auto:disk'].dismissedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    } finally {
      db.close();
    }
    const again = new DatabaseSync(file);
    try {
      const loaded = createSqliteStore(again).load();
      const note = loaded.notes[0];
      assert.deepEqual([note.title, note.lane, note.lanePos], ['Open', { categories: 'home' }, { categories: { x: 0.1, y: 60 } }]);
      assert.equal(loaded.positions['auto:disk'].dismissed, 's1:file', 'the Dismiss is kept in the file');
      assert.match(loaded.positions['auto:disk'].dismissedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, 'with when');
    } finally {
      again.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
