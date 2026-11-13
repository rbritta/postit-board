import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoPlace, boardHeight, dueStatus, escapeHtml, formatDue, fromLocalInput, linkify, normalizeNote,
  safeUrl, tilt, toLocalInput, withPositions,
} from '../src/core.js';

test('safeUrl keeps http(s) and relative links, refuses script schemes', () => {
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl('/settings#disk'), '/settings#disk');
  assert.equal(safeUrl('#backup'), '#backup');
  assert.equal(safeUrl('./img/a.svg'), './img/a.svg');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,x'), null);
  assert.equal(safeUrl('//evil.example'), null);
  assert.equal(safeUrl(42), null);
});

test('linkify escapes the text and links bare URLs without trailing punctuation', () => {
  const html = linkify('See <b>this</b>: https://example.com/x, then stop.');
  assert.match(html, /&lt;b&gt;this&lt;\/b&gt;/);
  assert.match(html, /<a href="https:\/\/example.com\/x" target="_blank" rel="noopener noreferrer">/);
  assert.match(html, /<\/a>, then stop\./);
  assert.equal(escapeHtml(`"'`), '&quot;&#39;');
});

test('normalizeNote clamps the position and falls back on bad input', () => {
  const n = normalizeNote({ id: '7', x: 4, y: -10.4, color: 'Not A Key', link: 'javascript:x', due: 'nope' });
  assert.deepEqual([n.id, n.x, n.y, n.color, n.link, n.due], [7, 1, 0, 'yellow', null, null]);
  assert.throws(() => normalizeNote({}, { auto: true }), /key/);
  assert.equal(normalizeNote({ key: 'auto:x' }, { auto: true }).id, null);
});

test('autoPlace fills a 4-column grid only for notes without a position', () => {
  const notes = [{ x: 0.5, y: 10 }, { x: null, y: null }, { x: null, y: null }, ...Array(4).fill({ x: null, y: null })];
  const placed = autoPlace(notes);
  assert.deepEqual([placed[0].x, placed[0].y], [0.5, 10]);
  assert.equal(placed[1].x.toFixed(3), '0.012');
  assert.equal(placed[2].x.toFixed(3), '0.262');
  assert.equal(placed[5].y, 26 + 235);
  assert.equal(boardHeight(placed), Math.max(560, 261 + 250));
});

test('withPositions brings back where an automatic note was dragged', () => {
  const [a, b] = withPositions([{ key: 'k1', x: null, y: null }, { key: 'k2', x: null, y: null }], { k1: { x: 0.3, y: 40, z: 2 } });
  assert.deepEqual([a.x, a.y, a.z], [0.3, 40, 2]);
  assert.equal(b.x, null);
});

test('dueStatus and formatDue read the day in local time', () => {
  const now = new Date(2026, 10, 13, 15, 0);
  assert.equal(dueStatus(new Date(2026, 10, 13, 14, 0), now), 'overdue');
  assert.equal(dueStatus(new Date(2026, 10, 13, 18, 0), now), 'today');
  assert.equal(dueStatus(new Date(2026, 10, 15, 9, 0), now), 'soon');
  assert.equal(dueStatus(new Date(2026, 11, 25, 9, 0), now), 'later');
  assert.equal(dueStatus(null, now), null);
  assert.match(formatDue(new Date(2026, 10, 14, 9, 30), { now, locale: 'en-US' }), /^Tomorrow 09:30/);
  assert.match(formatDue(new Date(2026, 10, 13, 18, 0), { now, locale: 'pt-BR', words: { today: 'Hoje' } }), /^Hoje 18:00/);
  assert.match(formatDue(new Date(2027, 0, 5, 8, 0), { now, locale: 'en-US' }), /2027/);
});

test('datetime-local round trip keeps the minute', () => {
  const iso = new Date(2026, 10, 20, 14, 5).toISOString();
  assert.equal(toLocalInput(iso), '2026-11-20T14:05');
  assert.equal(fromLocalInput('2026-11-20T14:05'), iso);
  assert.equal(fromLocalInput(''), null);
});

test('tilt is stable and small', () => {
  assert.equal(tilt('id:1'), tilt('id:1'));
  for (const s of ['a', 'id:2', 'key:auto:x']) assert.ok(Math.abs(tilt(s)) <= 2.1);
});
