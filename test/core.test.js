import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSize,
  normalizeView,
  LANE_MODES, LANE_PRESETS, normalizeLanes, normalizeLaneOf, normalizeLanePos, fillText, formatWhen,
  autoPlace, boardHeight, dueStatus, escapeHtml, formatDue, fromLocalInput, legendColors, linkify, mergeLegend, normalizeLegend, normalizeNote,
  safeUrl, tilt, toLocalInput, withPositions, autoSignature, normalizeSignature, LIMITS,
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

test('safeUrl refuses the spellings browsers turn into another site', () => {
  // browsers read a backslash as a slash and drop tabs and line breaks: all three mean //evil.example
  assert.equal(safeUrl('/\\evil.example'), null);
  assert.equal(safeUrl('/\t/evil.example'), null);
  assert.equal(safeUrl('/\n/evil.example'), null);
  assert.equal(safeUrl('https://example.com/a\tb'), null);
  assert.equal(safeUrl('/docs/a\\b'), '/docs/a\\b', 'a backslash later in the path stays on this site');
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
  // 12 or 24 hours: the locale decides, as its own clock does; hour12 forces one of them
  assert.equal(formatDue(new Date(2026, 10, 14, 9, 30), { now, locale: 'en-US' }), 'Tomorrow 9:30 AM');
  assert.equal(formatDue(new Date(2026, 10, 14, 9, 30), { now, locale: 'en-GB' }), 'Tomorrow 09:30');
  assert.equal(formatDue(new Date(2026, 10, 14, 9, 30), { now, locale: 'en-US', hour12: false }), 'Tomorrow 09:30');
  assert.match(formatDue(new Date(2026, 10, 14, 21, 30), { now, locale: 'pt-BR', hour12: true }), /^Tomorrow 9:30/);
  assert.match(formatDue(new Date(2026, 10, 13, 18, 0), { now, locale: 'pt-BR', words: { today: 'Hoje' } }), /^Hoje 18:00/);
  assert.match(formatDue(new Date(2027, 0, 5, 8, 0), { now, locale: 'en-US' }), /2027/);
  assert.ok(formatDue(new Date(2026, 10, 14, 9, 30), { now, locale: 'xx-NOPE', timeZone: 'Bad/Zone' }).length > 0, 'a bad locale or zone falls back');
});

test('timeZone says which day and hour a due time is, wherever the browser is', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  const due = '2026-11-14T01:30:00Z'; // Saturday 01:30 in UTC, still Friday 22:30 in Sao Paulo
  assert.equal(formatDue(due, { now, locale: 'en-GB', timeZone: 'UTC' }), 'Tomorrow 01:30');
  assert.equal(formatDue(due, { now, locale: 'en-GB', timeZone: 'America/Sao_Paulo' }), 'Today 22:30');
  assert.equal(dueStatus(due, now, { timeZone: 'UTC' }), 'soon');
  assert.equal(dueStatus(due, now, { timeZone: 'America/Sao_Paulo' }), 'today');
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

test('normalizeLegend drops bad entries, repeated colors and anything past the limit', () => {
  const out = normalizeLegend([
    { color: 'green', label: '  Print  ', description: 'x'.repeat(300), hex: '#ABCDEF', locked: true },
    { color: 'green', label: 'again' },
    { color: 'Bad Key', label: 'no' },
    { color: 'c-1', label: '', hex: 'red' },
    null,
  ]);
  assert.deepEqual(out, [
    { color: 'green', label: 'Print', description: 'x'.repeat(160), hex: '#abcdef', locked: true },
    { color: 'c-1', label: 'c-1' },
  ]);
  assert.equal(normalizeLegend(Array.from({ length: 40 }, (_, i) => ({ color: `c-${i}`, label: 'n' }))).length, 24);
  assert.deepEqual(normalizeLegend('nope'), []);
});

test('mergeLegend: saved order, names and colors win; app types stay and keep their color', () => {
  const app = [
    { color: 'pink', label: 'Broken', locked: true },
    { color: 'yellow', label: 'Notes' },
    { color: 'blue', label: 'Someday' },
  ];
  assert.deepEqual(mergeLegend(app, null), normalizeLegend(app));
  const saved = [
    { color: 'yellow', label: 'Mine', hex: '#ffcc00' },
    { color: 'pink', label: 'Fix now', hex: '#000000', locked: false },
    { color: 'c-1', label: 'Calls', hex: '#123456', locked: true },
  ];
  assert.deepEqual(mergeLegend(app, saved), [
    { color: 'yellow', label: 'Mine', hex: '#ffcc00' },
    { color: 'pink', label: 'Fix now', locked: true },
    { color: 'c-1', label: 'Calls', hex: '#123456' },
  ]);
  // an app type the saved legend lost comes back at the end
  assert.deepEqual(mergeLegend(app, [{ color: 'blue', label: 'Later' }]).map((i) => i.color), ['blue', 'pink']);
  assert.deepEqual(legendColors(saved), { yellow: '#ffcc00', pink: '#000000', 'c-1': '#123456' });
});

test('normalizeSize keeps the board between its limits and falls back to the default', () => {
  assert.deepEqual(normalizeSize(null), { width: null, height: null, locked: false });
  assert.deepEqual(normalizeSize({ width: 0.05, height: 99999, locked: 'yes' }), { width: 0.2, height: 6000, locked: false });
  assert.deepEqual(normalizeSize({ width: 0.66666, height: 700.4, locked: true }), { width: 0.667, height: 700, locked: true });
});

test('normalizeView keeps only the known ways to open cut text, and the Archive box switch', () => {
  assert.deepEqual(normalizeView({ expand: 'more' }), { expand: 'more', archiveBox: null });
  assert.deepEqual(normalizeView({ expand: 'popup', archiveBox: 'no' }), { expand: null, archiveBox: null });
  assert.deepEqual(normalizeView({ archiveBox: false }), { expand: null, archiveBox: false });
  assert.deepEqual(normalizeView(null), { expand: null, archiveBox: null });
});

test('normalizeLanes: off by default, two lists kept apart, ids unique, at most 12', () => {
  assert.deepEqual(normalizeLanes(null), { mode: 'off' });
  assert.deepEqual(normalizeLanes({ mode: 'kanban' }), { mode: 'off' }, 'an unknown mode is off');
  assert.deepEqual(LANE_MODES, ['states', 'categories']);
  assert.deepEqual(LANE_PRESETS.states, ['todo', 'doing', 'waiting', 'done']);
  const lanes = normalizeLanes({
    mode: 'states',
    states: [{ id: 'todo', name: ' To do ' }, { id: 'todo', name: 'again' }, { id: '', name: 'no id' }, { id: 7, name: 'x'.repeat(60) }, null],
    categories: [],
  });
  assert.deepEqual(lanes, { mode: 'states', states: [{ id: 'todo', name: 'To do' }, { id: '7', name: 'x'.repeat(40) }] });
  const many = normalizeLanes({ mode: 'categories', categories: Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, name: '' })) });
  assert.equal(many.categories.length, 12);
  assert.deepEqual(many.categories[0], { id: 'c0', name: '' }, 'an empty name is filled by the board');
});

test('a note keeps its lane and its place in each mode; a string names the same lane in both', () => {
  assert.deepEqual(normalizeLaneOf('doing'), { states: 'doing', categories: 'doing' });
  assert.deepEqual(normalizeLaneOf({ states: 'done', categories: '', other: 'x' }), { states: 'done' });
  assert.equal(normalizeLaneOf({}), null);
  assert.equal(normalizeLaneOf(['x']), null);
  assert.deepEqual(normalizeLanePos({ states: { x: 1.5, y: 80.4 }, categories: { x: 'a', y: 3 } }), { states: { x: 1, y: 80 } });
  assert.equal(normalizeLanePos({ states: { x: null, y: 1 } }), null);
  assert.equal(normalizeLanePos('x'), null);
  const note = normalizeNote({ id: 1, text: 'x', lane: { categories: 'home' }, lanePos: { categories: { x: 0.2, y: 90 } } });
  assert.deepEqual([note.lane, note.lanePos], [{ categories: 'home' }, { categories: { x: 0.2, y: 90 } }]);
  assert.deepEqual([normalizeNote({ id: 2 }).lane, normalizeNote({ id: 2 }).lanePos], [null, null]);
});

test('fillText fills the blanks it knows and leaves the others', () => {
  assert.equal(fillText('Moved to {lane}', { lane: 'Doing' }), 'Moved to Doing');
  assert.equal(fillText('{n} of {total}', { n: 2 }), '2 of {total}');
  assert.equal(fillText(undefined), '');
});

test('formatWhen says when a note was archived: today, yesterday, the weekday, then the date', () => {
  const now = new Date(2026, 10, 13, 18, 0); // a Friday
  const opts = { locale: 'en-US', now, hour12: true };
  const sp = (s) => s.replace(/\s/g, ' ');
  assert.equal(sp(formatWhen(new Date(2026, 10, 13, 9, 30), opts)), 'Today 9:30 AM');
  assert.equal(sp(formatWhen(new Date(2026, 10, 12, 21, 5), { ...opts, words: { yesterday: 'Ontem' } })), 'Ontem 9:05 PM');
  assert.equal(sp(formatWhen(new Date(2026, 10, 10, 8, 0), opts)), 'Tue 8:00 AM');
  assert.equal(formatWhen(new Date(2026, 9, 2, 8, 0), opts), 'Oct 2');
  assert.equal(formatWhen(new Date(2025, 9, 2, 8, 0), opts), 'Oct 2, 2025');
  assert.equal(formatWhen(new Date(2026, 10, 13, 9, 30), { ...opts, hour12: false }), 'Today 09:30');
  assert.equal(formatWhen('nope', opts), '');
  assert.equal(formatWhen(null, opts), '');
});

test('autoSignature: what an app note says (title, text, due, link, color); not its place, lane or key', () => {
  const base = { key: 'disk', title: 'Disk at 91%', text: 'Clean it', due: '2026-11-20T10:00:00.000Z', link: '/disk', color: 'pink' };
  const sig = autoSignature(base);
  assert.match(sig, /^s1:[0-9a-z]+$/);
  assert.ok(sig.length <= LIMITS.signature);
  assert.equal(autoSignature({ ...base, key: 'other', x: 0.4, y: 90, lane: 'waiting', linkLabel: 'Go' }), sig, 'place, lane, key and label do not count');
  assert.equal(autoSignature({ ...base, title: '  Disk at 91%  ' }), sig, 'read as the board shows it');
  for (const change of [{ title: 'Disk at 95%' }, { text: 'Clean it now' }, { due: null }, { link: '/disk2' }, { color: 'orange' }]) {
    assert.notEqual(autoSignature({ ...base, ...change }), sig, JSON.stringify(change));
  }
  assert.equal(autoSignature({ title: 'x', color: 'NOT A KEY' }), autoSignature({ title: 'x', color: 'yellow' }), 'an unknown color reads as yellow');
  assert.equal(autoSignature(null), autoSignature({}));
});

test('normalizeSignature keeps short text and drops the rest', () => {
  assert.equal(normalizeSignature(' s1:abc '), 's1:abc');
  assert.equal(normalizeSignature('x'.repeat(300)).length, LIMITS.signature);
  for (const bad of [null, undefined, '', '   ', 3, {}, []]) assert.equal(normalizeSignature(bad), null, JSON.stringify(bad));
});
