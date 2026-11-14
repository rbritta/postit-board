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
    view: { expand: 'more' },
  });
});

test('localStore starts empty when what it finds is not JSON', () => {
  const storage = memory();
  storage.setItem('t', '{not json');
  assert.deepEqual(localStore('t', storage).load(), { notes: [], positions: {} });
});
