import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
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
    assert.deepEqual((await client.saveView({ expand: 'inplace' })).view, { expand: 'inplace' });
    assert.deepEqual((await client.load()).view, { expand: 'inplace' });
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
