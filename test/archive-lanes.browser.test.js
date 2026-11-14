// Archive, Archived, lanes, the menu, the board settings, the phone, app notes (Open, Dismiss), the lifted drag,
// a title alone and the editor's first field (0.7.0), in a real browser.
// Skipped when no browser is found: set PW_CHANNEL=msedge or PW_EXECUTABLE=/path to pick one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../scripts/serve-demo.mjs';

let browser;
let server;
let base;

before(async () => {
  try {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : { channel: process.env.PW_CHANNEL || 'chrome' }),
    });
  } catch {
    browser = null;
  }
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await browser?.close();
  server?.close();
});

const LEGEND = [
  { color: 'pink', label: 'Broken', locked: true },
  { color: 'yellow', label: 'Notes' },
  { color: 'green', label: 'Routine' },
  { color: 'blue', label: 'Someday' },
];
const MENU = '.pb-menu:not(.pb-menu--sub)';
const SUB = '.pb-menu--sub';
const near = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance;
const intersects = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

async function page(width = 1200, { height = 900, ...context } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'en-US', ...context });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${base}/demo/`);
  await p.waitForSelector('.pb-note');
  return { p, ctx, errors };
}

/**
 * A board of its own (window.B on #b). With `store`, the notes are written to that localStore first (`done: true`
 * archives one) and loaded from it; `keep` mounts again on what the store already has.
 */
async function mount(p, { store, keep = false, motion, ...options } = {}) {
  await p.evaluate(async ({ store, keep, motion, options }) => {
    window.B?.destroy();
    document.body.innerHTML = '<div id="b"></div>';
    const { createBoard, localStore } = await import('../src/postit-board.js');
    const el = document.getElementById('b');
    if (motion) for (const k of ['in', 'out']) el.style.setProperty(`--pb-motion-${k}`, motion);
    if (!store) { window.B = createBoard(el, options); return; }
    if (!keep) localStorage.removeItem(store);
    const s = localStore(store);
    if (!keep) {
      for (const n of options.notes || []) {
        const made = s.create(n);
        if (n.done) s.update({ id: made.id }, { done: true });
      }
    }
    window.B = createBoard(el, { ...options, notes: [], store: s });
    await window.B.reload();
  }, { store, keep, motion, options });
}

const settle = (p) => p.evaluate(async () => {
  for (const a of document.getAnimations()) a.finish();
  await new Promise((r) => setTimeout(r, 0));
});
const stored = (p, key) => p.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
const storedNote = async (p, key, title) => (await stored(p, key)).notes.find((n) => n.title === title);
const note = (p, title) => p.locator('.pb-glass .pb-note', { hasText: title });
const count = (p) => p.locator('.pb-glass .pb-note').count();
const noScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** The inside of the glass (inside its border), where notes land. */
const glassInner = (p) => p.$eval('.pb-glass', (g) => {
  const r = g.getBoundingClientRect();
  return { l: r.left + g.clientLeft, t: r.top + g.clientTop, r: r.left + g.clientLeft + g.clientWidth, b: r.top + g.clientTop + g.clientHeight };
});
/** Where the Archive box is laid out (its scale while the pointer is far only makes it smaller). */
const boxRect = (p) => p.$eval('.pb-target', (el) => {
  const v = (k) => parseFloat(el.style.getPropertyValue(k));
  const r = el.getBoundingClientRect();
  return { l: v('--pb-tx'), t: v('--pb-ty'), w: v('--pb-tw'), h: v('--pb-th'), r: v('--pb-tx') + v('--pb-tw'), b: v('--pb-ty') + v('--pb-th'), cx: r.left + r.width / 2, cy: r.top + r.height / 2, cls: el.className };
});

/** Presses the middle of a note and moves a little: the drag (and the Archive box) starts. */
async function grab(p, locator) {
  const b = await locator.boundingBox();
  const start = { x: b.x + b.width / 2, y: b.y + 40 };
  await p.mouse.move(start.x, start.y);
  await p.mouse.down();
  await p.mouse.move(start.x + 12, start.y + 10, { steps: 3 });
  return start;
}

/** A finger held on a note until its menu opens (touch events through the DevTools protocol). */
async function longPress(p, locator) {
  const b = await locator.boundingBox();
  const cdp = await p.context().newCDPSession(p);
  const point = { x: b.x + b.width / 2, y: b.y + 40 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await p.waitForTimeout(650);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(100);
}

/** The box sits astride the glass edge: over the glass only in the strip of a third of its width next to the edge. */
const astride = (box, inner, side) => (side === 'left'
  ? box.l < inner.l && box.r > inner.l && box.r - inner.l <= box.w / 3 + 1
  : box.r > inner.r && box.l < inner.r && inner.r - box.l <= box.w / 3 + 1);

test('the Archive box sits astride the glass edge beside the note; only the pointer on it archives; Undo puts the note back', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(1600);
  await mount(p, {
    store: 't-box', size: { width: 0.6 }, legend: LEGEND,
    notes: [{ title: 'Left', text: 'l', x: 0.1, y: 60 }, { title: 'Right', text: 'r', x: 0.75, y: 60 }, { title: 'Corner', text: 'c', x: 0.78, y: 380 }],
  });
  const inner = await glassInner(p);
  // a note near the left edge: a note-sized box on the left, level with it
  const left = note(p, 'Left');
  const size = await left.evaluate((el) => ({ w: el.offsetWidth, h: el.offsetHeight }));
  await grab(p, left);
  await settle(p);
  const box = await boxRect(p);
  const noteBox = await left.boundingBox();
  assert.ok(astride(box, inner, 'left'), `astride the left edge, a third over the glass: ${JSON.stringify({ box, inner })}`);
  assert.ok(box.l >= 0, 'inside the window');
  assert.ok(near(box.w, size.w, 1), `as wide as the note: ${box.w} vs ${size.w}`);
  assert.ok(near(box.t + box.h / 2, noteBox.y + noteBox.height / 2, 30), 'level with the note');
  assert.ok(near(box.cx, box.l + box.w / 2, 1) && near(box.cy, box.t + box.h / 2, 1), 'fixed to the window: drawn where it is laid out');
  const layers = await p.evaluate(() => ['.pb-target', '.pb-halo', '.pb-balloon'].map((s) => getComputedStyle(document.querySelector(s)).pointerEvents));
  assert.deepEqual(layers, ['none', 'none', 'none'], 'the box, its halo and its balloon never take the pointer');
  const halo = await p.$eval('.pb-halo', (el) => el.getBoundingClientRect().width);
  assert.equal(await noScroll(p), 0, 'the halo may spill over the window edge without a horizontal scroll');
  assert.ok(halo > box.w * 2.5, `a halo bigger than the box: ${halo}`);
  // it stays where it came, wherever the pointer goes
  await p.mouse.move(inner.l + 400, inner.t + 300, { steps: 5 });
  assert.deepEqual(await boxRect(p).then(({ l, t: top }) => [l, top]), [box.l, box.t], 'the box does not move during the drag');
  // dropped just inside the edge next to the box, not on it: a plain move, nothing archived
  await p.mouse.move(box.r + 8, box.t + box.h / 2, { steps: 8 });
  assert.ok(box.r + 8 < inner.l + box.w / 2, 'just inside the edge');
  assert.equal(await p.locator('.pb-target--armed').count(), 0, 'beside the box is not on it');
  await p.mouse.up();
  await settle(p);
  assert.equal(await count(p), 3);
  const moved = await storedNote(p, 't-box', 'Left');
  assert.ok(moved.doneAt === null && moved.x < 0.1 && moved.y > 60, `moved, not archived: ${JSON.stringify(moved)}`);
  assert.equal(await p.locator('.pb-target, .pb-halo, .pb-balloon').count(), 0, 'the box goes when the drag ends');
  // a note near the right edge: the box comes on the right; the pointer on it arms it, the drop archives
  const right = note(p, 'Right');
  await grab(p, right);
  await settle(p);
  const rbox = await boxRect(p);
  assert.ok(astride(rbox, inner, 'right'), `astride the right edge: ${JSON.stringify({ rbox, inner })}`);
  // the lifted note goes over the edge and onto the box, under it
  const layers2 = await p.evaluate(() => ['.pb-note--lifted', '.pb-target', '.pb-balloon'].map((s) => Number(getComputedStyle(document.querySelector(s)).zIndex)));
  assert.ok(layers2[0] < layers2[1] && layers2[1] < layers2[2], `the note under the box and its balloon: ${layers2}`);
  await p.mouse.move(rbox.l + rbox.w / 2, rbox.t + rbox.h / 2, { steps: 10 });
  assert.ok(await p.locator('.pb-target--armed').count(), 'armed with the pointer on it');
  assert.match(await p.textContent('.pb-balloon'), /Release to archive[\s\S]*You can still see it in Archived/);
  await p.mouse.up();
  await settle(p);
  await p.waitForFunction(() => document.querySelectorAll('.pb-glass .pb-note').length === 2);
  assert.match(await p.textContent('.pb-toast'), /Archived “Right”\s*Undo/);
  assert.equal(await p.textContent('[data-pb=archived] .pb-badge'), '1');
  assert.ok((await storedNote(p, 't-box', 'Right')).doneAt, 'archived in the store');
  // Undo: back where it was
  await p.click('.pb-toast [data-pb=toast-act]');
  await note(p, 'Right').waitFor();
  const back = await storedNote(p, 't-box', 'Right');
  assert.deepEqual([back.doneAt, back.x, back.y], [null, 0.75, 60]);
  assert.equal(await p.textContent('[data-pb=archived] .pb-badge'), '0');
  // a note in the corner: the box stays inside the window
  await grab(p, note(p, 'Corner'));
  const cbox = await boxRect(p);
  assert.ok(cbox.t >= 0 && cbox.b <= 900 && astride(cbox, inner, 'right'), JSON.stringify(cbox));
  await p.mouse.up();
  await settle(p); // the box fades out
  // no room beside the glass: a pill in the bar above it, still off the glass
  await p.evaluate(() => window.B.configure({ size: { width: 1 } }));
  const wide = await glassInner(p);
  await grab(p, note(p, 'Left'));
  const pill = await boxRect(p);
  assert.match(pill.cls, /pb-target--bar/);
  assert.ok(pill.b <= wide.t && !intersects(pill, wide), `in the bar: ${JSON.stringify({ pill, wide })}`);
  await p.mouse.up();
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the ✓ and the menu archive too; app notes are never archived (their box dismisses); a store without archived() has no Archived button', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  await mount(p, {
    store: 't-done', legend: LEGEND,
    notes: [{ title: 'One', text: '1', x: 0.05, y: 40 }, { title: 'Two', text: '2', x: 0.35, y: 40 }],
    auto: [{ key: 'app', title: 'From the app', text: 'a', color: 'pink' }],
    positions: { app: { x: 0.7, y: 40 } },
  });
  const app = note(p, 'From the app');
  assert.equal(await app.locator('[data-pb=done]').count(), 0, 'no ✓ on an app note');
  await app.click({ button: 'right', position: { x: 40, y: 60 } });
  assert.equal(await p.locator(`${MENU} [data-pb=menu-archive]`).count(), 0, 'no Archive in its menu');
  await p.keyboard.press('Escape');
  await grab(p, app);
  assert.equal(await p.textContent('.pb-target-label'), 'Dismiss', 'its box dismisses, it never archives');
  await p.mouse.up();
  await settle(p);
  // the menu
  await note(p, 'Two').click({ button: 'right', position: { x: 40, y: 60 } });
  await p.click(`${MENU} [data-pb=menu-archive]`);
  await p.waitForFunction(() => document.querySelectorAll('.pb-glass .pb-note').length === 2);
  assert.match(await p.textContent('.pb-toast'), /Archived “Two”/);
  await p.click('.pb-toast [data-pb=toast-act]');
  await note(p, 'Two').waitFor();
  // the ✓
  await note(p, 'One').locator('[data-pb=done]').click();
  await p.waitForFunction(() => document.querySelectorAll('.pb-glass .pb-note').length === 2);
  assert.deepEqual(await p.evaluate(() => window.B.archived.map((n) => n.title)), ['One']);
  assert.ok((await storedNote(p, 't-done', 'One')).doneAt);
  // a custom store without archived(): no Archived button, and the ✓ still archives (the note fades out)
  await p.evaluate(async () => {
    window.B.destroy();
    const { createBoard } = await import('../src/postit-board.js');
    window.PATCHES = [];
    const store = { load: async () => ({ notes: [{ id: 1, title: 'Own store', text: 'x' }] }), create: async (d) => ({ ...d, id: 2 }), update: async (ref, patch) => { window.PATCHES.push(patch); return patch; } };
    window.B = createBoard(document.getElementById('b'), { store });
    await window.B.reload();
  });
  assert.equal(await p.locator('[data-pb=archived]').count(), 0);
  await note(p, 'Own store').locator('[data-pb=done]').click();
  await p.waitForFunction(() => window.PATCHES.some((x) => x.done === true));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Archived: the table lists, filters and counts; Restore goes back to the lane; Delete for good asks first', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  await p.clock.setFixedTime(new Date(2026, 10, 13, 18, 0));
  await mount(p, {
    store: 't-list', legend: LEGEND, lanes: { mode: 'states' },
    notes: [
      { title: 'Open note', text: 'stays', lane: { states: 'doing' } },
      { title: 'Garden plan', text: 'beds and herbs', color: 'green', lane: { states: 'doing' }, done: true },
      { title: 'Old idea', text: 'lorem', color: 'blue', lane: { states: 'gone-lane' }, done: true },
      { title: 'Letter', text: 'ipsum', done: true },
    ],
  });
  const toggle = p.locator('[data-pb=archived]');
  assert.deepEqual([await toggle.getAttribute('aria-pressed'), await toggle.locator('.pb-badge').textContent()], ['false', '3']);
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  assert.equal(await p.textContent('.pb-hint'), 'Archived notes · Restore puts one back on the board');
  const rows = p.locator('.pb-table tbody tr');
  await rows.first().waitFor();
  assert.deepEqual(await p.$$eval('.pb-table th', (els) => els.map((e) => e.textContent.trim())), ['Note', 'Type', 'State', 'When', 'Actions']);
  const lanesOf = () => p.$$eval('.pb-table tbody tr', (els) => els.map((e) => [e.querySelector('.pb-arch-title').textContent, e.querySelector('.pb-lane-chip').textContent]));
  assert.deepEqual((await lanesOf()).sort(), [['Garden plan', 'Doing'], ['Letter', 'To do'], ['Old idea', 'removed']]);
  assert.match(await rows.first().locator('.pb-arch-when').textContent(), /^Today/);
  // the filter and the legend
  await p.fill('[name=archiveFilter]', 'garden');
  assert.equal(await rows.count(), 1);
  assert.equal(await p.textContent('.pb-arch-count'), '1 of 3');
  await p.fill('[name=archiveFilter]', 'zzz');
  assert.match(await p.textContent('.pb-arch-none'), /No archived note matches “zzz”/);
  await p.click('[data-pb=clear-filter]');
  assert.equal(await rows.count(), 3);
  assert.equal(await p.textContent('.pb-key[data-color=green] .pb-count'), '1', 'the legend counts the archived notes');
  await p.click('.pb-key[data-color=green]');
  assert.equal(await rows.count(), 2);
  await p.click('.pb-key[data-color=green]');
  // no lane column with lanes off
  await p.evaluate(() => window.B.configure({ lanes: { mode: 'off' } }));
  assert.equal(await p.locator('.pb-table th').count(), 4);
  await p.evaluate(() => window.B.configure({ lanes: { mode: 'states' } }));
  // Delete for good: asks in the row, Keep backs out, no Undo
  const letter = rows.filter({ hasText: 'Letter' });
  await letter.locator('[data-pb=purge]').click();
  assert.match(await letter.textContent(), /Delete for good\?/);
  assert.equal(await p.evaluate(() => document.activeElement.dataset.pb), 'purge-no', 'the focus goes to Keep');
  await letter.locator('[data-pb=purge-no]').click();
  await letter.locator('[data-pb=purge]').click();
  await letter.locator('[data-pb=purge-yes]').click();
  await p.waitForFunction(() => document.querySelectorAll('.pb-table tbody tr').length === 2);
  assert.match(await p.textContent('.pb-toast'), /“Letter” deleted for good/);
  assert.equal(await p.locator('.pb-toast [data-pb=toast-act]').count(), 0, 'no Undo');
  assert.equal(await storedNote(p, 't-list', 'Letter'), undefined, 'gone from the store');
  // Restore: back in its lane; the first lane when its lane is gone
  await rows.filter({ hasText: 'Old idea' }).locator('[data-pb=restore]').click();
  await p.waitForFunction(() => document.querySelectorAll('.pb-table tbody tr').length === 1);
  assert.match(await p.textContent('.pb-toast'), /“Old idea” is back on the board in To do/);
  assert.equal((await storedNote(p, 't-list', 'Old idea')).lane.states, 'todo');
  await rows.filter({ hasText: 'Garden plan' }).locator('[data-pb=restore]').click();
  await p.waitForSelector('.pb-arch-none:not([hidden])');
  assert.match(await p.textContent('.pb-arch-none'), /Nothing archived yet/);
  await toggle.click();
  const laneOf = (title) => note(p, title).evaluate((el) => document.getElementById(el.getAttribute('aria-describedby')).dataset.lane);
  assert.deepEqual([await laneOf('Old idea'), await laneOf('Garden plan')], ['todo', 'doing']);
  assert.equal((await storedNote(p, 't-list', 'Garden plan')).doneAt, null);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('lanes: off by default; a drag to another lane changes the state, never over the header, which sticks and stays on top', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(1200, { height: 600 });
  await mount(p, { notes: [{ id: 1, title: 'Free', text: 'x' }] });
  assert.equal(await p.evaluate(() => window.B.lanes.mode), 'off');
  assert.equal(await p.locator('.pb-lane-heads').count(), 0);
  await mount(p, {
    store: 't-lanes', legend: LEGEND, lanes: { mode: 'states' },
    notes: [
      { title: 'Alpha', text: 'a', lane: { states: 'todo', categories: 'home' } },
      { title: 'Beta', text: 'b', lane: { states: 'doing', categories: 'work' } },
      { title: 'Gamma', text: 'c' },
    ],
    auto: [{ key: 'watch', title: 'Watcher', text: 'w', color: 'pink', lane: 'waiting' }],
  });
  const heads = () => p.$$eval('.pb-lane-h', (els) => els.map((e) => `${e.querySelector('.pb-lane-name').textContent} ${e.querySelector('.pb-count').textContent}`));
  assert.deepEqual(await heads(), ['To do 2', 'Doing 1', 'Waiting 1', 'Done 0'], 'a note with no lane is in the first; the app note in its own');
  assert.equal(await p.textContent('.pb-hint'), 'Drag a note to another state');
  const tops = await p.$$eval('.pb-glass .pb-note', (els) => els.map((e) => e.offsetTop));
  assert.ok(tops.every((y) => y >= 56), `every note starts below the header: ${tops}`);
  // drag Alpha to Done, dropping over the header: it lands below it, in Done
  const inner = await glassInner(p);
  const done = await p.locator('.pb-lane-h[data-lane=done]').boundingBox();
  await grab(p, note(p, 'Alpha'));
  await p.mouse.move(done.x + done.width / 2, inner.t + 18, { steps: 12 });
  const over = await p.evaluate(({ x, y }) => ({ lifted: document.elementFromPoint(x, y)?.closest('.pb-note--lifted') !== null, lane: document.querySelector('.pb-lane-h.pb-lane--over')?.dataset.lane }), { x: done.x + done.width / 2, y: inner.t + 18 });
  assert.deepEqual(over, { lifted: true, lane: 'done' }, 'the lifted note passes over the header; the lane it would land in lights up');
  await p.mouse.up();
  await settle(p);
  assert.deepEqual(await heads(), ['To do 1', 'Doing 1', 'Waiting 1', 'Done 1']);
  assert.equal(await note(p, 'Alpha').evaluate((el) => el.offsetTop), 56, 'landed right below the header');
  const alpha = await storedNote(p, 't-lanes', 'Alpha');
  assert.deepEqual([alpha.lane, alpha.lanePos.states.y], [{ states: 'done', categories: 'home' }, 56], 'its category is kept');
  // the app note stays in its lane when dragged
  const watch = note(p, 'Watcher');
  await grab(p, watch);
  await p.mouse.move(inner.l + 20, inner.t + 300, { steps: 8 });
  await p.mouse.up();
  assert.equal(await watch.evaluate((el) => document.getElementById(el.getAttribute('aria-describedby')).dataset.lane), 'waiting');
  assert.ok((await stored(p, 't-lanes')).positions.watch.lanePos.states, 'its place in the lane is saved by key');
  // the header row sticks when the page scrolls, above the notes
  await p.evaluate(() => { document.body.style.setProperty('padding-bottom', '1500px'); window.scrollTo(0, 260); });
  const stuck = await p.evaluate(() => {
    const h = document.querySelector('.pb-lane-heads').getBoundingClientRect();
    const hit = document.elementFromPoint(h.left + 60, h.top + 20);
    return { top: Math.round(h.top), onTop: hit?.closest('.pb-lane-heads') !== null };
  });
  assert.deepEqual(stuck, { top: 0, onTop: true });
  await p.evaluate(() => window.scrollTo(0, 0));
  // the other mode: each note keeps its category
  await p.evaluate(() => window.B.configure({ lanes: { mode: 'categories' } }));
  assert.deepEqual(await heads(), ['Work 3', 'Home 1', 'Ideas 0'], 'Alpha in Home; no category or an unknown one is the first');
  assert.equal(await p.textContent('.pb-hint'), 'Drag a note to another category');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the menu with lanes: State ▸ first, with the lane; picking one moves the note; the glass menu says the lane', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  await mount(p, { store: 't-menu', legend: LEGEND, lanes: { mode: 'states' }, notes: [{ title: 'Beta', text: 'b', lane: { states: 'doing' } }] });
  await note(p, 'Beta').click({ button: 'right', position: { x: 40, y: 60 } });
  const items = await p.$$eval(`${MENU} .pb-menu-item, ${MENU} hr`, (els) => els.map((el) => (el.tagName === 'HR' ? '---' : el.dataset.sub || el.dataset.pb)));
  assert.deepEqual(items, ['lane', 'color', 'menu-edit', '---', 'menu-archive']);
  assert.match(await p.textContent(`${MENU} [data-sub=lane]`), /State\s*Doing/);
  // the menu key on a focused note (no pointer): the menu opens on the note, not in the corner of the window
  await p.keyboard.press('Escape');
  await note(p, 'Beta').focus();
  await note(p, 'Beta').dispatchEvent('contextmenu', { clientX: 0, clientY: 0, button: 0 });
  const [menuBox, noteBox] = [await p.locator(MENU).boundingBox(), await note(p, 'Beta').boundingBox()];
  assert.ok(near(menuBox.x, noteBox.x + 24, 30) && near(menuBox.y, noteBox.y + 24, 30), JSON.stringify({ menuBox, noteBox }));
  await p.click(`${MENU} [data-sub=lane]`);
  assert.deepEqual(await p.$$eval(`${SUB} [data-pb=menu-lane]`, (els) => els.map((e) => [e.dataset.lane, e.getAttribute('aria-checked')])),
    [['todo', 'false'], ['doing', 'true'], ['waiting', 'false'], ['done', 'false']]);
  await p.click(`${SUB} [data-lane=done]`);
  assert.match(await p.textContent('.pb-toast'), /Moved to Done/);
  assert.equal((await storedNote(p, 't-menu', 'Beta')).lane.states, 'done');
  // right-click the empty glass in Waiting: the new note starts there
  const waiting = await p.locator('.pb-lane[data-lane=waiting]').boundingBox();
  const at = { x: waiting.x + 30, y: waiting.y + 300 };
  await p.mouse.click(at.x, at.y, { button: 'right' });
  assert.equal(await p.getAttribute(MENU, 'aria-label'), 'New note here · Waiting');
  await p.click(`${MENU} [data-pb=menu-new][data-color=green]`);
  assert.equal(await p.inputValue('.pb-dialog select[name=lane]'), 'waiting');
  await p.fill('.pb-dialog [name=text]', 'Made in Waiting');
  await p.click('.pb-dialog [type=submit]');
  await note(p, 'Made in Waiting').waitFor();
  const made = (await stored(p, 't-menu')).notes.find((n) => n.text === 'Made in Waiting');
  assert.equal(made.lane.states, 'waiting');
  assert.ok(near(made.lanePos.states.y, Math.round(at.y - (await glassInner(p)).t), 2), JSON.stringify(made.lanePos));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Board settings: tabs Types · Lanes · View; lanes edited, a removed lane hands its notes on; saved in the store', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  await mount(p, { store: 't-set', legend: LEGEND, notes: [{ title: 'In waiting', text: 'w', lane: { states: 'waiting' } }, { title: 'In doing', text: 'd', lane: { states: 'doing' } }] });
  await p.click('.pb-gear');
  assert.deepEqual(await p.$$eval('.pb-tab', (els) => els.map((e) => [e.getAttribute('role'), e.textContent.replace(/\s+/g, ' ').trim(), e.getAttribute('aria-selected')])),
    [['tab', 'Types 4', 'true'], ['tab', 'Lanes Off', 'false'], ['tab', 'View', 'false']]);
  await p.focus('.pb-tab[data-tab=types]');
  await p.keyboard.press('ArrowRight');
  assert.equal(await p.evaluate(() => document.activeElement.dataset.tab), 'lanes');
  assert.ok(await p.locator('[data-panel=lanes]').isVisible() && await p.locator('[data-panel=types]').isHidden());
  await p.keyboard.press('End');
  assert.equal(await p.evaluate(() => document.activeElement.dataset.tab), 'view');
  // every option under a titled group: the board lock has its own
  assert.deepEqual(await p.$$eval('[data-panel=view] .pb-group-h', (els) => els.map((e) => e.textContent)), ['Long text', 'Board', 'Archive']);
  assert.equal(await p.locator('[data-panel=view] .pb-group', { has: p.locator('[name=lockSize]') }).locator('.pb-group-h').textContent(), 'Board');
  await p.keyboard.press('Home');
  // more than 5 lanes warns
  await p.click('.pb-tab[data-tab=lanes]');
  assert.ok(await p.locator('[name=mode][value=off]').isChecked(), 'lanes are off by default');
  await p.check('[name=mode][value=states]');
  assert.equal(await p.locator('.pb-lanerow').count(), 4);
  for (let i = 0; i < 2; i += 1) await p.click('[data-pb=lane-add]');
  assert.ok(await p.locator('.pb-warn').isVisible());
  await p.click('.pb-dialog [data-pb=cancel] >> nth=-1');
  // the real edit: rename, remove Waiting (Undo, then again), its note goes to Done
  await p.click('.pb-gear');
  await p.click('.pb-tab[data-tab=lanes]');
  await p.check('[name=mode][value=states]');
  assert.deepEqual(await p.$$eval('.pb-lanerow', (els) => els.map((e) => [e.querySelector('[name=laneName]').value, e.querySelector('.pb-lanecount').textContent])),
    [['To do', '0 notes'], ['Doing', '1 note'], ['Waiting', '1 note'], ['Done', '0 notes']]);
  await p.fill('.pb-lanerow[data-i="0"] [name=laneName]', 'Backlog');
  await p.click('.pb-lanerow[data-i="2"] [data-pb=lane-remove]');
  assert.match(await p.textContent('.pb-gone'), /Waiting removed · its note goes to/);
  assert.equal(await p.inputValue('.pb-gone select'), 'doing', 'the neighbor by default');
  await p.click('.pb-gone [data-pb=lane-undo]');
  assert.equal(await p.locator('.pb-lanerow').count(), 4);
  await p.click('.pb-lanerow[data-i="2"] [data-pb=lane-remove]');
  await p.selectOption('.pb-gone select', 'done');
  await p.click('.pb-dialog [type=submit]');
  const heads = await p.$$eval('.pb-lane-h .pb-lane-name', (els) => els.map((e) => e.textContent));
  assert.deepEqual(heads, ['Backlog', 'Doing', 'Done']);
  const data = await stored(p, 't-set');
  assert.deepEqual(data.lanes, { mode: 'states', states: [{ id: 'todo', name: 'Backlog' }, { id: 'doing', name: 'Doing' }, { id: 'done', name: 'Done' }], categories: [{ id: 'work', name: 'Work' }, { id: 'home', name: 'Home' }, { id: 'ideas', name: 'Ideas' }] });
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('t-set')).notes.find((n) => n.title === 'In waiting').lane.states === 'done');
  // View: the Archive box can be turned off
  await p.click('.pb-gear');
  await p.click('.pb-tab[data-tab=view]');
  assert.ok(await p.locator('[name=archiveBox]').isChecked(), 'on by default');
  await p.uncheck('[name=archiveBox]');
  await p.click('.pb-dialog [type=submit]');
  assert.equal((await stored(p, 't-set')).view.archiveBox, false);
  // all of it comes back from the store
  await mount(p, { store: 't-set', keep: true, legend: LEGEND });
  assert.deepEqual(await p.$$eval('.pb-lane-h .pb-lane-name', (els) => els.map((e) => e.textContent)), ['Backlog', 'Doing', 'Done']);
  await grab(p, note(p, 'In doing'));
  assert.equal(await p.locator('.pb-target').count(), 0, 'no box once turned off');
  await p.mouse.up();
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('on a phone: lanes are sections that fold, a long press opens the menu as a sheet, the box sinks over the note, archived notes are cards', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(360, { height: 760, hasTouch: true, isMobile: true });
  await mount(p, {
    store: 't-phone', legend: LEGEND, lanes: { mode: 'states' },
    notes: [{ title: 'Alpha', text: 'a', lane: { states: 'todo' } }, { title: 'Beta', text: 'b', lane: { states: 'doing' } }, { title: 'Old', text: 'o', done: true }],
  });
  assert.deepEqual(await p.$$eval('.pb-sec-h', (els) => els.map((e) => [e.querySelector('.pb-lane-name').textContent, getComputedStyle(e).position])),
    [['To do', 'sticky'], ['Doing', 'sticky'], ['Waiting', 'sticky'], ['Done', 'sticky']]);
  await p.click('.pb-sec-h[data-lane=todo]');
  assert.equal(await p.getAttribute('.pb-sec-h[data-lane=todo]', 'aria-expanded'), 'false');
  assert.ok(await note(p, 'Alpha').isHidden());
  await p.click('.pb-sec-h[data-lane=todo]');
  assert.ok(await note(p, 'Alpha').isVisible());
  assert.equal(await noScroll(p), 0);
  // a long press: the menu as a sheet; lifting the finger picks nothing
  await longPress(p, note(p, 'Beta'));
  assert.ok(await p.evaluate(() => document.querySelector('.pb-dialog').matches('[open].pb-dialog--sheet')));
  const items = await p.$$eval('.pb-sheet .pb-menu-item, .pb-sheet hr', (els) => els.map((el) => (el.tagName === 'HR' ? '---' : el.dataset.sub || el.dataset.pb)));
  assert.deepEqual(items, ['lane', 'color', 'menu-edit', '---', 'menu-archive']);
  await p.click('.pb-sheet [data-sub=lane]');
  assert.equal(await p.textContent('.pb-sheet-back'), '‹ Back');
  await p.click('.pb-sheet-back');
  assert.equal(await p.locator('.pb-sheet [data-pb=menu-archive]').count(), 1);
  await p.click('.pb-sheet [data-sub=lane]');
  await p.click('.pb-sheet [data-lane=done]');
  assert.equal(await note(p, 'Beta').evaluate((el) => el.closest('.pb-sec').dataset.lane), 'done');
  // Archive from the sheet: the box and its blur come over the note, and it sinks
  await longPress(p, note(p, 'Alpha'));
  await p.click('.pb-sheet [data-pb=menu-archive]');
  await p.waitForSelector('.pb-glass .pb-target--over');
  await settle(p);
  await p.waitForFunction(() => !document.querySelector('.pb-glass .pb-note') || ![...document.querySelectorAll('.pb-glass .pb-note')].some((n) => n.textContent.includes('Alpha')));
  assert.ok((await storedNote(p, 't-phone', 'Alpha')).doneAt);
  assert.equal(await noScroll(p), 0);
  // archived notes are cards, without the table head
  await p.click('[data-pb=archived]');
  await p.locator('.pb-table tbody tr').first().waitFor();
  assert.deepEqual(await p.evaluate(() => [getComputedStyle(document.querySelector('.pb-table thead')).display, getComputedStyle(document.querySelector('.pb-table tbody tr')).display]), ['none', 'flex']);
  assert.equal(await noScroll(p), 0);
  // the settings come up from the bottom, the whole width, Save in sight
  await p.click('.pb-gear');
  await p.click('.pb-tab[data-tab=lanes]');
  const sheet = await p.evaluate(() => {
    const d = document.querySelector('.pb-dialog').getBoundingClientRect();
    const save = document.querySelector('.pb-dialog [type=submit]').getBoundingClientRect();
    return { left: Math.round(d.left), right: Math.round(d.right), bottom: Math.round(d.bottom), save: save.bottom <= innerHeight && save.top >= 0 };
  });
  assert.deepEqual(sheet, { left: 0, right: 360, bottom: 760, save: true });
  assert.equal(await noScroll(p), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('narrow screens: narrowOrder puts the urgent first, narrowLimit folds the rest behind "Show N more"; a desktop is untouched', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(360, { height: 760 });
  await p.clock.setFixedTime(new Date(2026, 10, 13, 9, 0));
  const notes = [
    { id: 1, title: 'Plain blue', text: 'x', color: 'blue', lane: { states: 'todo' } },
    { id: 2, title: 'Today green', text: 'x', color: 'green', due: new Date(2026, 10, 13, 15, 0).toISOString(), lane: { states: 'todo' } },
    { id: 3, title: 'Plain yellow', text: 'x', color: 'yellow', lane: { states: 'doing' } },
    { id: 4, title: 'Overdue blue', text: 'x', color: 'blue', due: new Date(2026, 10, 13, 7, 0).toISOString(), lane: { states: 'todo' } },
  ];
  const auto = [{ key: 'app', title: 'App pink', text: 'x', color: 'pink', lane: 'todo' }];
  const titles = () => p.$$eval('.pb-glass .pb-note', (els) => els.map((e) => e.querySelector('.pb-title').textContent));
  await mount(p, { legend: LEGEND, notes, auto });
  assert.deepEqual(await titles(), ['App pink', 'Plain blue', 'Today green', 'Plain yellow', 'Overdue blue'], 'by position, as before');
  await mount(p, { legend: LEGEND, notes, auto, narrowOrder: 'priority', motion: '10s' });
  assert.deepEqual(await titles(), ['Overdue blue', 'Today green', 'App pink', 'Plain yellow', 'Plain blue'], 'overdue, today, then the legend order, app notes alike');
  // the fold: the first 2, then "Show 3 more", which opens in place with a transition and stays open
  await p.evaluate(() => window.B.configure({ narrowLimit: 2 }));
  assert.deepEqual(await titles(), ['Overdue blue', 'Today green']);
  const fold = p.locator('.pb-glass > .pb-fold');
  assert.deepEqual([await fold.textContent(), await fold.getAttribute('aria-expanded')], ['Show 3 more', 'false']);
  await fold.click();
  const grow = await p.$eval('.pb-glass', (g) => g.getAnimations().map((a) => a.effect.getKeyframes().map((k) => k.height)));
  assert.ok(grow.length === 1 && parseFloat(grow[0][0]) < parseFloat(grow[0][1]), `the glass grows: ${JSON.stringify(grow)}`);
  await settle(p);
  assert.equal((await titles()).length, 5);
  assert.deepEqual([await fold.textContent(), await fold.getAttribute('aria-expanded')], ['Show less', 'true']);
  assert.equal(await p.evaluate(() => document.activeElement.querySelector('.pb-title')?.textContent), 'App pink', 'the focus goes to the first note shown');
  await p.evaluate(() => window.B.update({ auto: [{ key: 'app', title: 'App pink', text: 'y', color: 'pink' }] }));
  assert.equal((await titles()).length, 5, 'still open after a redraw');
  await fold.click();
  await settle(p);
  assert.deepEqual(await titles(), ['Overdue blue', 'Today green']);
  // with lanes, each section folds on its own
  await p.evaluate(() => window.B.configure({ lanes: { mode: 'states' } }));
  assert.deepEqual(await p.$$eval('.pb-sec', (els) => els.map((s) => [s.dataset.lane, s.querySelectorAll('.pb-note').length, s.querySelector('.pb-fold')?.textContent ?? null])),
    [['todo', 2, 'Show 2 more'], ['doing', 1, null], ['waiting', 0, null], ['done', 0, null]]);
  assert.deepEqual(await p.$$eval('.pb-sec[data-lane=todo] .pb-note .pb-title', (els) => els.map((e) => e.textContent)), ['Overdue blue', 'Today green']);
  await p.click('.pb-sec[data-lane=todo] .pb-fold');
  await settle(p);
  assert.equal(await p.locator('.pb-sec[data-lane=todo] .pb-note').count(), 4);
  assert.equal(await noScroll(p), 0);
  // a desktop: every note, where it was, no fold
  await p.setViewportSize({ width: 1200, height: 800 });
  await mount(p, { legend: LEGEND, notes, auto, narrowOrder: 'priority', narrowLimit: 2 });
  assert.deepEqual(await titles(), ['App pink', 'Plain blue', 'Today green', 'Plain yellow', 'Overdue blue']);
  assert.equal(await p.locator('.pb-fold').count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('reduced motion: archiving, the box and the toast change at once', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(1600, { reducedMotion: 'reduce' });
  await mount(p, { store: 't-still', size: { width: 0.6 }, legend: LEGEND, notes: [{ title: 'One', text: '1', x: 0.05, y: 40 }, { title: 'Two', text: '2', x: 0.5, y: 40 }] });
  await note(p, 'One').locator('[data-pb=done]').click();
  await p.waitForFunction(() => document.querySelectorAll('.pb-glass .pb-note').length === 1);
  assert.equal(await p.evaluate(() => document.getAnimations().length), 0, 'no animation');
  assert.equal(await p.locator('.pb-toast-bar').count(), 0);
  await grab(p, note(p, 'Two'));
  assert.equal(await p.$eval('.pb-target', (el) => getComputedStyle(el).animationName), 'none');
  const box = await boxRect(p);
  await p.mouse.move(box.l + box.w / 2, box.t + box.h / 2, { steps: 4 });
  await p.mouse.up();
  await p.waitForFunction(() => document.querySelectorAll('.pb-glass .pb-note').length === 0);
  assert.equal(await p.locator('.pb-target, .pb-halo, .pb-ghost').count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('under a strict Content-Security-Policy too: the Archive box, Archived, lanes and the settings', async (t) => {
  if (!browser) return t.skip('no browser');
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: 'en-US' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const csp = "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:";
  const html = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/src/postit-board.css"></head>'
    + '<body><div id="b"></div><script type="module" src="/csp-boot.js"></script></body></html>';
  const boot = `
    import { createBoard, localStore } from '/src/postit-board.js';
    window.violations = [];
    document.addEventListener('securitypolicyviolation', (e) => window.violations.push(e.violatedDirective));
    localStorage.removeItem('t-csp');
    const store = localStore('t-csp');
    store.create({ title: 'One', text: 'one', x: 0.05, y: 40 });
    store.create({ title: 'Two', text: 'two', x: 0.5, y: 40, lane: { states: 'doing' } });
    window.B = createBoard(document.getElementById('b'), { store, size: { width: 0.6 }, legend: [{ color: 'yellow', label: 'Notes' }] });
    await window.B.reload();
    window.ready = true;`;
  await p.route(`${base}/csp.html`, (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/html', 'content-security-policy': csp }, body: html }));
  await p.route(`${base}/csp-boot.js`, (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/javascript' }, body: boot }));
  await p.goto(`${base}/csp.html`);
  await p.waitForFunction(() => window.ready);
  await grab(p, note(p, 'One'));
  const box = await boxRect(p);
  assert.ok(box.w > 0, 'the box is placed through custom properties');
  await p.mouse.move(box.l + box.w / 2, box.t + box.h / 2, { steps: 6 });
  await p.mouse.up();
  await p.waitForFunction(() => document.querySelectorAll('.pb-glass .pb-note').length === 1);
  await p.click('[data-pb=archived]');
  await p.locator('.pb-table tbody tr').first().waitFor();
  assert.equal(await p.locator('.pb-table .pb-swatch').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(253, 230, 138)');
  await p.click('[data-pb=restore]');
  await p.click('[data-pb=archived]');
  await p.evaluate(() => window.B.configure({ lanes: { mode: 'states' } }));
  assert.equal(await p.locator('.pb-lane-h').count(), 4);
  assert.equal(await p.$eval('.pb-lane-heads', (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length), 4, 'the lane count reaches the CSS');
  await p.click('.pb-gear');
  await p.click('.pb-tab[data-tab=lanes]');
  await p.keyboard.press('Escape');
  assert.deepEqual(await p.evaluate(() => window.violations), []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

/* ---------- app notes: Open → and Dismiss ---------- */

const dialogGone = (p) => p.waitForFunction(() => !document.querySelector('.pb-dialog').open);

const menuItems = (p, scope = MENU) => p.$$eval(`${scope} .pb-menu-item, ${scope} hr`, (els) => els.map((el) => (el.tagName === 'HR' ? '---' : el.dataset.sub || el.dataset.pb)));
const APP = [
  { key: 'disk', title: 'Disk at 91%', text: 'Clean the cache.', color: 'pink', link: '#disk' },
  { key: 'plain', title: 'No link here', text: 'Just a heads-up.', color: 'pink' },
];
const POS = { disk: { x: 0.4, y: 40 }, plain: { x: 0.7, y: 40 } };

test('app notes: Open → and Dismiss in the menu; Dismiss hides one until the app changes it; Undo; Bring back in Archived', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  await mount(p, { store: 't-dismiss', legend: LEGEND, notes: [{ title: 'Mine', text: 'm', x: 0.05, y: 40 }], auto: APP, positions: POS });
  // without a link: Dismiss only, with its hint; with a link: Open →, a line, then Dismiss
  await note(p, 'No link here').click({ button: 'right', position: { x: 40, y: 60 } });
  assert.deepEqual(await menuItems(p), ['menu-dismiss']);
  assert.match(await p.textContent(`${MENU} [data-pb=menu-dismiss]`), /Dismiss\s*Hides it until the app changes it/);
  await p.keyboard.press('Escape');
  await note(p, 'Disk at 91%').click({ button: 'right', position: { x: 40, y: 60 } });
  assert.deepEqual(await menuItems(p), ['menu-open', '---', 'menu-dismiss'], 'no Color, State, Edit or Archive');
  assert.match(await p.textContent(`${MENU} [data-pb=menu-open]`), /Open →/);
  await p.click(`${MENU} [data-pb=menu-open]`);
  await p.waitForFunction(() => location.hash === '#disk');
  assert.ok(await p.locator(MENU).isHidden());
  // Dismiss: gone from the board, a toast with Undo, the signature kept under its key
  await note(p, 'Disk at 91%').click({ button: 'right', position: { x: 40, y: 60 } });
  await p.click(`${MENU} [data-pb=menu-dismiss]`);
  await p.waitForFunction(() => document.querySelectorAll('.pb-glass .pb-note').length === 2);
  assert.match(await p.textContent('.pb-toast'), /Dismissed “Disk at 91%”\s*Undo/);
  const sig = (await stored(p, 't-dismiss')).positions.disk?.dismissed;
  assert.match(sig, /^s1:[0-9a-z]+$/);
  assert.equal(await p.textContent('[data-pb=archived] .pb-badge'), '1', 'Archived counts it');
  assert.deepEqual(await p.evaluate(() => window.B.dismissed.map((n) => [n.key, n.dismissed])), [['disk', sig]]);
  // Undo: back on the board, the signature cleared
  await p.click('.pb-toast [data-pb=toast-act]');
  await note(p, 'Disk at 91%').waitFor();
  assert.equal((await stored(p, 't-dismiss')).positions.disk?.dismissed, undefined);
  assert.equal(await p.textContent('[data-pb=archived] .pb-badge'), '0');
  // the keyboard: the menu key on the focused note, End, Enter
  await settle(p);
  await note(p, 'Disk at 91%').focus();
  await note(p, 'Disk at 91%').dispatchEvent('contextmenu', { clientX: 0, clientY: 0, button: 0 });
  await p.keyboard.press('End');
  assert.equal(await p.evaluate(() => document.activeElement.dataset.pb), 'menu-dismiss');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.querySelectorAll('.pb-glass .pb-note').length === 2);
  // a reload keeps it hidden
  await mount(p, { store: 't-dismiss', keep: true, legend: LEGEND, auto: APP, positions: POS });
  assert.equal(await count(p), 2);
  assert.equal(await note(p, 'Disk at 91%').count(), 0);
  // the app changes it: it shows again; the same content as when it was dismissed hides it again
  await p.evaluate((app) => window.B.update({ auto: [{ ...app[0], title: 'Disk at 95%' }, app[1]] }), APP);
  await note(p, 'Disk at 95%').waitFor();
  assert.equal(await count(p), 3);
  await p.evaluate((app) => window.B.update({ auto: app }), APP);
  assert.equal(await count(p), 2);
  // Archived lists it while the app sends it, marked as the app's, with Bring back
  await p.click('[data-pb=archived]');
  const row = p.locator('.pb-table tbody tr[data-key=disk]');
  await row.waitFor();
  assert.match(await row.textContent(), /Disk at 91%[\s\S]*Dismissed/);
  assert.deepEqual(await row.locator('button').evaluateAll((els) => els.map((e) => e.dataset.pb)), ['bring-back'], 'no Restore, no Delete for good');
  await row.locator('[data-pb=bring-back]').click();
  await p.waitForSelector('.pb-arch-none:not([hidden])');
  assert.match(await p.textContent('.pb-toast'), /“Disk at 91%” is back on the board/);
  assert.equal((await stored(p, 't-dismiss')).positions.disk?.dismissed, undefined);
  await p.click('[data-pb=archived]');
  await note(p, 'Disk at 91%').waitFor();
  // a store that lists no archived notes: the Archived button comes with the first app note dismissed
  await mount(p, { legend: LEGEND, auto: APP, positions: POS });
  assert.equal(await p.locator('[data-pb=archived]').count(), 0);
  await note(p, 'No link here').click({ button: 'right', position: { x: 40, y: 60 } });
  await p.click(`${MENU} [data-pb=menu-dismiss]`);
  await p.locator('[data-pb=archived]').waitFor();
  await p.click('[data-pb=archived]');
  await p.click('.pb-table tbody tr[data-key=plain] [data-pb=bring-back]');
  await p.waitForSelector('.pb-arch-none:not([hidden])');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('app notes on a phone: a long press opens Open → and Dismiss as a sheet', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(360, { height: 760, hasTouch: true, isMobile: true });
  await mount(p, { store: 't-dismiss-phone', legend: LEGEND, auto: APP });
  await longPress(p, note(p, 'Disk at 91%'));
  assert.ok(await p.evaluate(() => document.querySelector('.pb-dialog').matches('[open].pb-dialog--sheet')));
  assert.deepEqual(await menuItems(p, '.pb-sheet'), ['menu-open', '---', 'menu-dismiss']);
  await p.click('.pb-sheet [data-pb=menu-dismiss]');
  await p.waitForFunction(() => document.querySelectorAll('.pb-glass .pb-note').length === 1);
  assert.match(await p.textContent('.pb-toast'), /Dismissed “Disk at 91%”/);
  assert.match((await stored(p, 't-dismiss-phone')).positions.disk.dismissed, /^s1:/);
  assert.equal(await noScroll(p), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

/* ---------- the lifted note ---------- */

test('a dragged note is lifted out of the glass: visible outside it mid-drag, back inside after a drop elsewhere; at once with reduced motion', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(1600);
  await mount(p, { store: 't-lift', size: { width: 0.6 }, legend: LEGEND, notes: [{ title: 'Traveler', text: 't', x: 0.3, y: 60 }] });
  const inner = await glassInner(p);
  const traveler = note(p, 'Traveler');
  // into the left margin, below the box
  await grab(p, traveler);
  const box = await boxRect(p);
  const out = { x: inner.l - 160, y: Math.max(box.b + 80, inner.t + 380) };
  await p.mouse.move(out.x, out.y, { steps: 10 });
  const mid = await p.evaluate(({ x, y }) => {
    const lifted = document.querySelector('.pb-note--lifted');
    const r = lifted.getBoundingClientRect();
    const s = getComputedStyle(lifted);
    return {
      right: r.right, visible: s.visibility === 'visible' && Number(s.opacity) > 0.5, position: s.position,
      hit: document.elementFromPoint(x, y)?.closest('.pb-note--lifted') === lifted,
      original: getComputedStyle(document.querySelector('.pb-glass .pb-note')).visibility,
    };
  }, out);
  assert.ok(mid.right < inner.l && mid.visible && mid.hit, `seen outside the glass, under the pointer: ${JSON.stringify({ mid, inner })}`);
  assert.deepEqual([mid.position, mid.original], ['fixed', 'hidden'], 'a fixed copy follows the pointer; the note waits hidden in the glass');
  assert.equal(await p.locator('.pb-target--armed').count(), 0, 'not on the box');
  await p.mouse.up();
  assert.equal(await p.locator('.pb-note--landing').count(), 1, 'it glides back');
  await settle(p);
  assert.equal(await p.locator('.pb-note--lifted').count(), 0);
  const back = await traveler.evaluate((el) => ({ left: el.offsetLeft, visibility: getComputedStyle(el).visibility }));
  assert.deepEqual(back, { left: 0, visibility: 'visible' }, 'back inside, at the left edge');
  assert.equal((await storedNote(p, 't-lift', 'Traveler')).x, 0);
  // below the glass: back at the bottom edge, not under it
  const glassH = await p.$eval('.pb-glass', (g) => g.clientHeight);
  await grab(p, traveler);
  await p.mouse.move(inner.l + 300, inner.b + 110, { steps: 10 });
  const below = await p.$eval('.pb-note--lifted', (el) => el.getBoundingClientRect().bottom);
  assert.ok(below > inner.b, 'it hangs below the glass mid-drag');
  await p.mouse.up();
  await settle(p);
  const low = await traveler.evaluate((el) => el.offsetTop + el.offsetHeight);
  assert.ok(low <= glassH && low >= glassH - 2, `back at the bottom edge: ${low} of ${glassH}`);
  // reduced motion: it snaps back
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await grab(p, traveler);
  await p.mouse.move(inner.l - 160, inner.t + 420, { steps: 6 });
  await p.mouse.up();
  assert.equal(await p.locator('.pb-note--lifted').count(), 0, 'no glide');
  assert.deepEqual(await traveler.evaluate((el) => [el.offsetLeft, getComputedStyle(el).visibility]), [0, 'visible']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

/* ---------- a title alone ---------- */

test('a note with only a title shows it in the middle of the note, up to 4 lines; with text it stays on top', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  const long = 'Call the plumber about the kitchen sink before the weekend starts please';
  const notes = [
    { id: 1, title: 'Just a title', x: 0.02, y: 40 },
    { id: 2, title: 'Title and text', text: 'Some words under it.', x: 0.27, y: 40 },
    { id: 3, title: long, due: new Date(Date.now() + 864e5).toISOString(), x: 0.52, y: 40 },
  ];
  const auto = [{ key: 'only', title: 'App says hi', color: 'pink', link: '#hi' }];
  const measure = () => p.$$eval('.pb-glass .pb-note', (els) => els.map((el) => {
    const title = el.querySelector('.pb-title');
    const foot = el.querySelector('.pb-foot');
    const s = getComputedStyle(el);
    const top = parseFloat(s.paddingTop);
    const bottom = foot.offsetTop - parseFloat(s.rowGap || s.gap || '0');
    const lineHeight = parseFloat(getComputedStyle(title).lineHeight);
    return {
      title: title.textContent, only: el.classList.contains('pb-note--title-only'),
      offset: Math.round(title.offsetTop + title.offsetHeight / 2 - (top + bottom) / 2), atTop: Math.round(title.offsetTop - top),
      lines: Math.round(title.offsetHeight / lineHeight), clamp: getComputedStyle(title).webkitLineClamp,
    };
  }));
  for (const width of [1200, 360]) {
    await p.setViewportSize({ width, height: 900 });
    await mount(p, { legend: LEGEND, notes, auto });
    const all = await measure();
    for (const m of all.filter((x) => x.only)) assert.ok(Math.abs(m.offset) <= 1, `${width}: “${m.title}” in the middle: ${JSON.stringify(m)}`);
    assert.deepEqual(all.filter((x) => x.only).map((x) => x.title).sort(), ['App says hi', 'Just a title', long].sort(), `${width}: app notes and written ones`);
    const withText = all.find((x) => x.title === 'Title and text');
    assert.ok(!withText.only && withText.atTop === 0, `${width}: with text, the title stays on top`);
    const longOne = all.find((x) => x.title === long);
    assert.ok(longOne.lines >= 3 && longOne.lines <= 4 && longOne.clamp === '4', `${width}: more lines when alone: ${JSON.stringify(longOne)}`);
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});

/* ---------- the editor starts on the title ---------- */

test('the editor starts on the title: "+ Note", "New note here", a lane, Edit (cursor at the end), and on a phone', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  const onTitle = () => p.evaluate(() => {
    const el = document.activeElement;
    return { name: el?.name, end: el?.selectionStart === el?.value.length && el?.selectionEnd === el?.value.length };
  });
  await mount(p, { legend: LEGEND, notes: [{ id: 1, title: 'Groceries', text: 'milk', x: 0.05, y: 40 }] });
  await p.click('[data-pb=add]');
  assert.deepEqual(await onTitle(), { name: 'title', end: true }, '+ Note');
  await p.keyboard.press('Escape');
  await dialogGone(p);
  await p.mouse.click((await glassInner(p)).l + 600, (await glassInner(p)).t + 300, { button: 'right' });
  await p.click(`${MENU} [data-pb=menu-new][data-color=green]`);
  assert.deepEqual(await onTitle(), { name: 'title', end: true }, 'New note here');
  await p.keyboard.press('Escape');
  await dialogGone(p);
  await note(p, 'Groceries').click({ button: 'right', position: { x: 40, y: 60 } });
  await p.click(`${MENU} [data-pb=menu-edit]`);
  assert.deepEqual(await onTitle(), { name: 'title', end: true }, 'Edit: the title, the cursor at its end');
  assert.equal(await p.inputValue('.pb-dialog [name=title]'), 'Groceries');
  await p.keyboard.press('Escape');
  await dialogGone(p);
  await p.evaluate(() => window.B.configure({ lanes: { mode: 'states' } }));
  const waiting = await p.locator('.pb-lane[data-lane=waiting]').boundingBox();
  await p.mouse.click(waiting.x + 30, waiting.y + 300, { button: 'right' });
  await p.click(`${MENU} [data-pb=menu-new][data-color=yellow]`);
  assert.deepEqual(await onTitle(), { name: 'title', end: true }, 'New note here · Waiting');
  await p.keyboard.press('Escape');
  await dialogGone(p);
  // a phone: "+ Note", and Edit from the sheet
  await p.setViewportSize({ width: 360, height: 760 });
  await mount(p, { legend: LEGEND, notes: [{ id: 1, title: 'Groceries', text: 'milk' }] });
  await p.click('[data-pb=add]');
  assert.deepEqual(await onTitle(), { name: 'title', end: true }, '+ Note on a phone');
  assert.deepEqual(errors, []);
  await ctx.close();
  const phone = await page(360, { height: 760, hasTouch: true, isMobile: true });
  await mount(phone.p, { legend: LEGEND, notes: [{ id: 1, title: 'Groceries', text: 'milk' }] });
  await longPress(phone.p, note(phone.p, 'Groceries'));
  await phone.p.click('.pb-sheet [data-pb=menu-edit]');
  await phone.p.waitForSelector('.pb-dialog[open] [name=title]');
  assert.equal(await phone.p.evaluate(() => document.activeElement?.name), 'title', 'Edit from the sheet');
  assert.deepEqual(phone.errors, []);
  await phone.ctx.close();
});

test('an app note dragged to the box is dismissed: the same box, its own words; a drop elsewhere moves it; archiveBox off hides the box for both', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(1600);
  await mount(p, {
    store: 't-drag-dismiss', size: { width: 0.6 }, legend: LEGEND,
    notes: [{ title: 'Mine', text: 'm', x: 0.05, y: 40 }], auto: APP, positions: { disk: { x: 0.75, y: 60 }, plain: { x: 0.4, y: 60 } },
  });
  const inner = await glassInner(p);
  const disk = note(p, 'Disk at 91%');
  await grab(p, disk);
  await settle(p);
  const box = await boxRect(p);
  assert.ok(astride(box, inner, 'right'), `the same box, astride the edge: ${JSON.stringify({ box, inner })}`);
  assert.deepEqual(await p.evaluate(() => [document.querySelector('.pb-target-label').textContent, Boolean(document.querySelector('.pb-target svg.pb-ico-box')), Boolean(document.querySelector('.pb-halo'))]), ['Dismiss', true, true], 'the box icon and halo, the word Dismiss');
  assert.match(await p.textContent('.pb-balloon'), /Drop here to dismiss[\s\S]*It leaves the board until the app changes it\. You can bring it back from Archived\./);
  assert.ok(await p.locator('.pb-note--lifted').count(), 'lifted like any note');
  await p.mouse.move(box.l + box.w / 2, box.t + box.h / 2, { steps: 10 });
  assert.ok(await p.locator('.pb-target--armed').count(), 'armed with the pointer on it');
  assert.match(await p.textContent('.pb-balloon b'), /Release to dismiss/);
  await p.mouse.up();
  await settle(p);
  await p.waitForFunction(() => document.querySelectorAll('.pb-glass .pb-note').length === 2);
  assert.match(await p.textContent('.pb-toast'), /Dismissed “Disk at 91%”\s*Undo/);
  const pos = (await stored(p, 't-drag-dismiss')).positions.disk;
  assert.match(pos.dismissed, /^s1:/);
  assert.match(pos.dismissedAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal(pos.x, undefined, 'a drop on the box does not move it');
  assert.equal(await p.textContent('[data-pb=archived] .pb-badge'), '1');
  assert.equal(await p.locator('[data-pb=archived] .pb-badge--bump').count(), 1, 'the count pulses');
  await p.click('.pb-toast [data-pb=toast-act]');
  await disk.waitFor();
  assert.equal((await stored(p, 't-drag-dismiss')).positions.disk.dismissed, undefined);
  assert.equal(await disk.evaluate((el) => el.style.getPropertyValue('--pb-x')), '0.75', 'back where it was');
  // dropped elsewhere: it moves and its place is saved by key
  await settle(p);
  await grab(p, disk);
  await p.mouse.move(inner.l + 260, inner.t + 330, { steps: 10 });
  assert.equal(await p.locator('.pb-target--armed').count(), 0);
  await p.mouse.up();
  await settle(p);
  const moved = (await stored(p, 't-drag-dismiss')).positions.disk;
  assert.ok(moved.x < 0.5 && moved.y > 60 && !moved.dismissed, `moved, not dismissed: ${JSON.stringify(moved)}`);
  assert.equal(await count(p), 3);
  // archiveBox off: no box for an app note nor for a written one
  await p.evaluate(() => window.B.configure({ archiveBox: false }));
  for (const title of ['Disk at 91%', 'Mine']) {
    await grab(p, note(p, title));
    assert.equal(await p.locator('.pb-target, .pb-halo, .pb-balloon').count(), 0, `no box for ${title}`);
    await p.mouse.up();
    await settle(p);
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Archived: Archived and Dismissed chips with their dates, the last first; All · Archived · Dismissed; a chip on each phone card', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  const at = (h) => new Date(2026, 10, 14, h, 0);
  await p.clock.setFixedTime(at(9));
  await mount(p, { store: 't-chips', legend: LEGEND, notes: [{ title: 'Older', text: 'o', done: true }, { title: 'Newest', text: 'n', x: 0.05, y: 40 }], auto: APP, positions: POS });
  await p.clock.setFixedTime(at(10));
  await note(p, 'Disk at 91%').click({ button: 'right', position: { x: 40, y: 60 } });
  await p.click(`${MENU} [data-pb=menu-dismiss]`);
  await p.waitForFunction(() => document.querySelectorAll('.pb-glass .pb-note').length === 2);
  assert.equal((await stored(p, 't-chips')).positions.disk.dismissedAt, at(10).toISOString(), 'dismissedAt stored');
  await p.clock.setFixedTime(at(11));
  await note(p, 'Newest').locator('[data-pb=done]').click();
  await p.waitForFunction(() => document.querySelectorAll('.pb-glass .pb-note').length === 1);
  await note(p, 'No link here').click({ button: 'right', position: { x: 40, y: 60 } });
  const eye = await p.$eval(`${MENU} [data-pb=menu-dismiss] svg`, (el) => el.innerHTML);
  await p.keyboard.press('Escape');
  await p.click('[data-pb=archived]');
  await p.locator('.pb-table tbody tr').nth(2).waitFor();
  const table = () => p.$$eval('.pb-table tbody tr', (els) => els.map((e) => {
    const chip = e.querySelector('.pb-state');
    return [e.querySelector('.pb-arch-title').textContent, chip.textContent, chip.title || '', Boolean(chip.querySelector('svg')), e.querySelector('.pb-arch-when')?.textContent ?? ''];
  }));
  assert.deepEqual(await table(), [
    ['Newest', 'Archived', '', true, 'Today 11:00 AM'],
    ['Disk at 91%', 'Dismissed', 'From the app · it comes back when the app changes it', true, 'Today 10:00 AM'],
    ['Older', 'Archived', '', true, 'Today 9:00 AM'],
  ], 'the last to leave the board first, each with its chip and date');
  assert.equal(await p.$eval('.pb-table tbody tr[data-key] .pb-state svg', (el) => el.innerHTML), eye, 'the eye of the menu item');
  assert.deepEqual(await p.$$eval('.pb-table th', (els) => els.map((e) => e.textContent.trim())), ['Note', 'Type', 'When', 'Actions']);
  // the kind filter, with the text filter and the legend
  const seg = p.locator('.pb-seg');
  assert.ok(await seg.isVisible());
  const kinds = () => seg.locator('[data-kind]').evaluateAll((els) => els.map((e) => [e.dataset.kind, e.getAttribute('aria-pressed'), e.querySelector('.pb-count').textContent]));
  assert.deepEqual(await kinds(), [['all', 'true', '3'], ['archived', 'false', '2'], ['dismissed', 'false', '1']]);
  await seg.locator('[data-kind=dismissed]').click();
  assert.deepEqual((await table()).map((r) => r[0]), ['Disk at 91%']);
  assert.equal(await p.textContent('.pb-arch-count'), '1 note');
  assert.equal(await p.textContent('.pb-key[data-color=pink] .pb-count'), '1', 'the legend counts what the filter shows');
  assert.equal(await p.textContent('.pb-key[data-color=yellow] .pb-count'), '0');
  await seg.locator('[data-kind=archived]').click();
  assert.deepEqual((await table()).map((r) => r[0]), ['Newest', 'Older']);
  await p.fill('[name=archiveFilter]', 'old');
  assert.deepEqual((await table()).map((r) => r[0]), ['Older']);
  assert.equal(await p.textContent('.pb-arch-count'), '1 of 2');
  assert.deepEqual(await kinds(), [['all', 'false', '1'], ['archived', 'true', '1'], ['dismissed', 'false', '0']], 'the counts follow the text filter');
  await p.fill('[name=archiveFilter]', '');
  await p.click('.pb-key[data-color=yellow]');
  assert.match(await p.textContent('.pb-arch-none'), /Nothing to show/);
  await p.click('.pb-key[data-color=yellow]');
  await seg.locator('[data-kind=all]').click();
  assert.equal(await p.locator('.pb-table tbody tr').count(), 3);
  // a phone: each card keeps its chip and date
  await p.setViewportSize({ width: 360, height: 760 });
  const cards = await p.$$eval('.pb-table tbody tr', (els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    const c = e.querySelector('.pb-state').getBoundingClientRect();
    return { display: getComputedStyle(e).display, inside: c.left >= r.left && c.right <= r.right + 1 && c.width > 0 };
  }));
  assert.ok(cards.length === 3 && cards.every((c) => c.display === 'flex' && c.inside), JSON.stringify(cards));
  assert.ok(await seg.isVisible());
  assert.equal(await noScroll(p), 0);
  await p.setViewportSize({ width: 1200, height: 900 });
  // Bring back clears when, and the kind filter goes with the last dismissed note
  await p.click('.pb-table tbody tr[data-key=disk] [data-pb=bring-back]');
  await p.waitForFunction(() => document.querySelectorAll('.pb-table tbody tr').length === 2);
  assert.equal((await stored(p, 't-chips')).positions.disk.dismissedAt, undefined);
  assert.ok(await seg.isHidden());
  assert.deepEqual(errors, []);
  await ctx.close();
});
