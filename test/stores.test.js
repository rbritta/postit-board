// localStore without a browser: an in-memory stand-in for localStorage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localStore } from '../src/postit-board.js';

const memory = () => {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
};

test('localStore keeps createdAt and meta through edits, and done hides a note', () => {
  const store = localStore('t', memory());
  const a = store.create({ title: 'Call', text: 'the clinic', meta: { patient: 12 } });
  const b = store.create({ text: 'second' });
  assert.deepEqual([a.id, b.id], [1, 2]);
  assert.deepEqual(a.meta, { patient: 12 });
  assert.ok(a.createdAt && a.updatedAt);
  const edited = store.update({ id: 1 }, { text: 'the clinic again', x: 0.4 });
  assert.equal(edited.createdAt, a.createdAt, 'an edit keeps when it was created');
  assert.deepEqual(edited.meta, { patient: 12 }, 'and the app\'s own meta');
  assert.equal(edited.text, 'the clinic again');
  store.update({ id: 2 }, { done: true });
  assert.deepEqual(store.load().notes.map((n) => n.id), [1]);
  store.update({ id: 1 }, { removed: true });
  assert.deepEqual(store.load().notes, []);
  assert.throws(() => store.update({ id: 9 }, { text: 'x' }), /not found/);
});

test('localStore keeps app note positions by key, and the legend, size and view', () => {
  const store = localStore('t', memory());
  store.update({ key: 'auto:disk' }, { x: 0.5, y: 100, z: 3 });
  store.update({ key: 'auto:disk' }, { z: 7 });
  store.saveLegend([{ color: 'green', label: 'Print' }, { color: 'BAD' }]);
  store.saveSize({ width: 0.5, height: 10, locked: true });
  store.saveView({ expand: 'more' });
  assert.deepEqual(store.load(), {
    notes: [],
    positions: { 'auto:disk': { x: 0.5, y: 100, z: 7 } },
    legend: [{ color: 'green', label: 'Print' }],
    size: { width: 0.5, height: 320, locked: true },
    view: { expand: 'more', archiveBox: null },
  });
});

test('localStore lists archived notes, the last first; Restore and Delete for good', () => {
  const store = localStore('t', memory());
  for (const title of ['a', 'b', 'c']) store.create({ title, lane: { states: 'doing' } });
  assert.deepEqual(store.archived(), { notes: [] });
  store.update({ id: 1 }, { done: true });
  store.update({ id: 3 }, { done: true });
  const listed = store.archived().notes;
  assert.deepEqual(listed.map((n) => n.id), [3, 1], 'the last archived first');
  assert.ok(listed.every((n) => n.doneAt), 'with when');
  assert.deepEqual(listed[0].lane, { states: 'doing' }, 'and the lane it was in');
  assert.deepEqual(store.load().notes.map((n) => n.id), [2]);
  // Restore: back on the board, with its lane
  const back = store.update({ id: 3 }, { done: false });
  assert.equal(back.doneAt, null);
  assert.deepEqual(store.load().notes.map((n) => n.id), [2, 3]);
  // Delete for good
  store.update({ id: 1 }, { removed: true });
  assert.deepEqual(store.archived(), { notes: [] });
});

test('localStore keeps the lanes, and where an app note sits in each mode', () => {
  const store = localStore('t', memory());
  const saved = store.saveLanes({ mode: 'categories', categories: [{ id: 'work', name: 'Work' }, { id: 'work', name: 'dup' }] });
  assert.deepEqual(saved, { lanes: { mode: 'categories', categories: [{ id: 'work', name: 'Work' }] } });
  store.update({ key: 'auto:disk' }, { lanePos: { categories: { x: 0.5, y: 70 } }, z: 2 });
  store.update({ key: 'auto:disk' }, { x: 0.1, y: 10 });
  const n = store.create({ text: 'x', lane: 'work', lanePos: { categories: { x: 2, y: 60 } } });
  assert.deepEqual([n.lane, n.lanePos], [{ states: 'work', categories: 'work' }, { categories: { x: 1, y: 60 } }]);
  const loaded = store.load();
  assert.deepEqual(loaded.lanes, { mode: 'categories', categories: [{ id: 'work', name: 'Work' }] });
  assert.deepEqual(loaded.positions['auto:disk'], { z: 2, lanePos: { categories: { x: 0.5, y: 70 } }, x: 0.1, y: 10 });
  store.update({ key: 'auto:disk' }, { lanePos: null });
  assert.equal(store.load().positions['auto:disk'].lanePos, undefined);
});

test('localStore keeps a dismissed app note by key, with when and its place; null brings it back', () => {
  const store = localStore('t', memory());
  store.update({ key: 'auto:disk' }, { x: 0.2, y: 40 });
  const saved = store.update({ key: 'auto:disk' }, { dismissed: 's1:abc' });
  assert.match(saved.dismissedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.deepEqual(saved, { key: 'auto:disk', x: 0.2, y: 40, dismissed: 's1:abc', dismissedAt: saved.dismissedAt });
  assert.deepEqual(store.load().positions['auto:disk'], { x: 0.2, y: 40, dismissed: 's1:abc', dismissedAt: saved.dismissedAt });
  store.update({ key: 'auto:disk' }, { z: 4 });
  assert.deepEqual([store.load().positions['auto:disk'].dismissed, store.load().positions['auto:disk'].dismissedAt], ['s1:abc', saved.dismissedAt], 'a move keeps it');
  store.update({ key: 'auto:disk' }, { dismissed: null });
  assert.deepEqual(store.load().positions['auto:disk'], { x: 0.2, y: 40, z: 4 }, 'dismissed and dismissedAt go together');
});

test('localStore starts empty when what it finds is not JSON', () => {
  const storage = memory();
  storage.setItem('t', '{not json');
  assert.deepEqual(localStore('t', storage).load(), { notes: [], positions: {} });
});
