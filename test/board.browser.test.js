// The board in a real browser (installed Chrome or Edge, through playwright-core).
// Skipped when no browser is found: set PW_CHANNEL=msedge or PW_EXECUTABLE=/path to pick one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../scripts/serve-demo.mjs';

let chromium;
let browser;
let server;
let base;

before(async () => {
  try {
    ({ chromium } = await import('playwright-core'));
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

async function page(width = 1200, { height = 900, ...context } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'en-US', ...context });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${base}/demo/`);
  await p.waitForSelector('.pb-note');
  return { p, ctx, errors };
}

const LONG = 'word '.repeat(80).trim();
const near = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance;

/**
 * Replaces the demo with a board of its own (window.B on #b). With `store`, the notes are written to
 * that localStore first and loaded from it. `motion` sets --pb-motion-in/out: '10s' keeps an animation
 * running long enough to look at it halfway, and `settle(p)` then ends it.
 */
async function mount(p, { store, motion, ...options } = {}) {
  await p.evaluate(async ({ store, motion, options }) => {
    document.body.innerHTML = '<div id="b"></div>';
    const { createBoard, localStore } = await import('../src/postit-board.js');
    const el = document.getElementById('b');
    if (motion) for (const k of ['in', 'out']) el.style.setProperty(`--pb-motion-${k}`, motion);
    if (!store) { window.B = createBoard(el, options); return; }
    localStorage.removeItem(store);
    const s = localStore(store);
    for (const n of options.notes || []) s.create(n);
    window.B = createBoard(el, { ...options, notes: [], store: s });
    await window.B.reload();
  }, { store, motion, options });
}

/** Ends every animation and transition on the page, then lets the promises waiting on them run. */
const settle = (p) => p.evaluate(async () => {
  for (const a of document.getAnimations()) a.finish();
  await new Promise((r) => setTimeout(r, 0));
});

const dialogClosed = (p) => p.waitForFunction(() => !document.querySelector('.pb-dialog').open);

/** The right-click menu (its submenu is another .pb-menu). */
const MENU = '.pb-menu:not(.pb-menu--sub)';
const SUB = '.pb-menu--sub';

/** The keyframes of the first animation running on an element: `[{ height: '80px' }, …]`. */
const keyframes = (locator) => locator.evaluate((el) => el.getAnimations()[0]?.effect.getKeyframes() ?? null);

test('renders notes, legend counts and due chips', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  assert.equal(await p.locator('.pb-note').count(), 8);
  assert.equal(await p.locator('.pb-note--auto').count(), 2);
  assert.equal(await p.locator('.pb-due--overdue').count(), 1);
  assert.equal(await p.locator('.pb-key[data-color=yellow] .pb-count').textContent(), '2');
  assert.equal(await p.locator('.pb-img').count(), 3);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'no horizontal scroll');
  assert.equal(await p.getAttribute('.pb-legend', 'role'), 'group', 'the legend is not the page footer');
  // links: no underline, #6e7681 on hover
  const link = p.locator('.pb-note .pb-text a').first();
  assert.equal(await link.evaluate((a) => getComputedStyle(a).textDecorationLine), 'none');
  await link.hover();
  assert.equal(await link.evaluate((a) => getComputedStyle(a).color), 'rgb(110, 118, 129)');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('due times follow the browser\'s language, zone and clock unless the app sets locale, timeZone or hour12', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(1200, { locale: 'pt-BR' });
  await p.clock.setFixedTime(new Date(2026, 10, 13, 9, 0));
  const due = new Date(2026, 10, 20, 15, 30).toISOString();
  await mount(p, { notes: [{ id: 1, title: 'Call', text: 'x', due }] });
  assert.match(await p.textContent('.pb-due'), /15:30/, 'a 24-hour clock, as the browser speaks');
  await mount(p, { locale: 'en-US', notes: [{ id: 1, title: 'Call', text: 'x', due }] });
  assert.match(await p.textContent('.pb-due'), /3:30\sPM/);
  // the app can also pin the clock and the zone, and change them later
  await p.evaluate(() => window.B.configure({ hour12: false }));
  assert.match(await p.textContent('.pb-due'), /15:30/);
  await p.evaluate(() => window.B.configure({ locale: 'en-GB', hour12: undefined, timeZone: 'Asia/Tokyo' }));
  const tokyo = await p.evaluate((d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d)), due);
  assert.ok((await p.textContent('.pb-due')).includes(tokyo), `the hour in Tokyo (${tokyo})`);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a legend item filters its color in and out, and keeps the keyboard focus', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx } = await page();
  await p.focus('.pb-key[data-color=yellow]');
  await p.keyboard.press('Enter');
  assert.equal(await p.locator('.pb-note:visible').count(), 6);
  assert.equal(await p.getAttribute('.pb-key[data-color=yellow]', 'aria-pressed'), 'false');
  assert.equal(await p.evaluate(() => document.activeElement.dataset.color), 'yellow', 'the redrawn legend keeps the focus');
  await p.keyboard.press('Enter');
  assert.equal(await p.locator('.pb-note:visible').count(), 8);
  await ctx.close();
});

test('dragging saves the position, also for automatic notes', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx } = await page();
  for (const sel of ['.pb-note:not(.pb-note--auto) >> nth=0', '.pb-note--auto >> nth=0']) {
    const box = await p.locator(sel).boundingBox();
    await p.mouse.move(box.x + 40, box.y + 60);
    await p.mouse.down();
    await p.mouse.move(box.x + 240, box.y + 400, { steps: 8 });
    await p.mouse.up();
  }
  await p.waitForTimeout(100);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('postit-board-demo')));
  assert.ok(saved.notes.some((n) => n.y > 300), 'a written note moved down');
  assert.ok(saved.positions['auto:backup'].y > 300, 'the automatic note position is stored by key');
  await p.reload();
  await p.waitForSelector('.pb-note');
  const top = await p.locator('[data-ref="key:auto:backup"]').evaluate((el) => parseFloat(el.style.getPropertyValue('--pb-y')));
  assert.ok(top > 300);
  await ctx.close();
});

test('create through the dialog, escape what was typed, then archive it', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx } = await page();
  await p.click('[data-pb=add]');
  await p.fill('.pb-dialog [name=title]', '<img src=x onerror="window.pwned=1">');
  await p.fill('.pb-dialog [name=text]', 'Read https://example.com/doc today');
  await p.check('.pb-dialog [name=color][value=green]', { force: true });
  await p.click('.pb-dialog [type=submit]');
  const note = p.locator('.pb-note', { hasText: 'Read' });
  await note.waitFor();
  assert.equal(await note.getAttribute('data-color'), 'green');
  assert.equal(await note.locator('.pb-text a').getAttribute('href'), 'https://example.com/doc');
  assert.equal(await p.evaluate(() => window.pwned), undefined);
  assert.equal(await p.locator('.pb-note').count(), 9);
  assert.equal(await p.evaluate(() => document.activeElement.dataset.pb), 'add', 'the focus goes back to "+ Note"');
  assert.equal(await note.locator('[data-pb=done]').getAttribute('title'), 'Archive');
  await note.locator('[data-pb=done]').click();
  // it flies into the Archived button, then leaves the board
  await p.waitForFunction(() => document.querySelectorAll('.pb-note').length === 8);
  assert.equal(await p.textContent('[data-pb=archived] .pb-badge'), '4');
  await p.reload();
  await p.waitForSelector('.pb-note');
  assert.equal(await p.locator('.pb-note').count(), 8);
  await ctx.close();
});

test('right-click on the glass: pick a type, the note starts exactly where you clicked', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  // the inside of the glass (inside its 1 px border), where notes are placed
  const glass = await p.locator('.pb-glass').evaluate((g) => { const r = g.getBoundingClientRect(); return { x: r.x + g.clientLeft, y: r.y + g.clientTop }; });
  // an empty spot of the glass, away from the notes
  const at = await p.evaluate(() => {
    const g = document.querySelector('.pb-glass');
    const b = g.getBoundingClientRect();
    for (let y = b.bottom - 30; y > b.top; y -= 20) {
      for (let x = b.left + 20; x < b.left + b.width * 0.6; x += 20) if (document.elementFromPoint(x, y) === g) return { x, y };
    }
    return null;
  });
  await p.mouse.click(at.x, at.y, { button: 'right' });
  const items = p.locator('.pb-menu [data-pb=menu-new]');
  assert.equal(await items.count(), 7, 'one item per type');
  assert.match(await items.nth(0).textContent(), /Broken[\s\S]*Something failed/, 'with its meaning');
  await p.click('.pb-menu [data-pb=menu-new][data-color=green]');
  assert.ok(await p.locator(MENU).isHidden());
  assert.ok(await p.locator('.pb-dialog [name=color][value=green]').isChecked());
  await p.fill('.pb-dialog [name=text]', 'Right here');
  await p.click('.pb-dialog [type=submit]');
  const note = p.locator('.pb-note', { hasText: 'Right here' });
  await note.waitFor();
  const pos = await note.evaluate((el) => ({ x: el.offsetLeft, y: el.offsetTop }));
  assert.ok(near(glass.x + pos.x, at.x, 1) && near(glass.y + pos.y, at.y, 1), JSON.stringify({ glass, pos, at }));
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('postit-board-demo')).notes.find((n) => n.text === 'Right here'));
  assert.equal(saved.color, 'green');
  assert.equal(saved.y, Math.round(at.y - glass.y));
  // Escape and a click outside close the menu without creating anything
  await p.mouse.click(at.x, at.y + 20, { button: 'right' });
  await p.keyboard.press('Escape');
  assert.ok(await p.locator(MENU).isHidden());
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('right-click on a note: Color ▸, Edit, then Archive last; Color opens on hover; an app note has Open and Dismiss only', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx } = await page();
  const note = p.locator('.pb-note:not(.pb-note--auto)').first();
  const ref = await note.getAttribute('data-ref');
  await note.click({ button: 'right', position: { x: 60, y: 80 } });
  const items = await p.$$eval(`${MENU} .pb-menu-item, ${MENU} hr`, (els) => els.map((el) => (el.tagName === 'HR' ? '---' : el.dataset.sub || el.dataset.pb)));
  assert.deepEqual(items, ['color', 'menu-edit', '---', 'menu-archive'], 'no State or Category while lanes are off; Archive is last');
  assert.match(await p.textContent(`${MENU} [data-sub=color]`), /Color[\s\S]*Notes/, 'the current value on the right');
  await p.hover(`${MENU} [data-sub=color]`);
  await p.waitForSelector(`${SUB} [data-pb=menu-color]`);
  assert.equal(await p.locator(`${SUB} [data-pb=menu-color]`).count(), 7);
  assert.equal(await p.getAttribute(`${SUB} [aria-checked=true]`, 'data-color'), 'yellow');
  await p.click(`${SUB} [data-pb=menu-color][data-color=teal]`);
  assert.equal(await p.getAttribute(`[data-ref="${ref}"]`, 'data-color'), 'teal');
  assert.ok(await p.locator(SUB).isHidden() && await p.locator(MENU).isHidden());
  await p.locator('.pb-note--auto').first().click({ button: 'right', position: { x: 60, y: 80 } });
  const appItems = await p.$$eval(`${MENU} .pb-menu-item, ${MENU} hr`, (els) => els.map((el) => (el.tagName === 'HR' ? '---' : el.dataset.pb)));
  assert.deepEqual(appItems, ['menu-open', '---', 'menu-dismiss'], 'no Color, State, Edit or Archive on an app note');
  await p.keyboard.press('Escape');
  assert.ok(await p.locator(MENU).isHidden());
  await p.reload();
  await p.waitForSelector('.pb-note');
  assert.equal(await p.getAttribute(`[data-ref="${ref}"]`, 'data-color'), 'teal');
  await ctx.close();
});

test('the note touched last stays on top, also after a reload', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx } = await page();
  const notes = p.locator('.pb-note');
  const z = () => notes.evaluateAll((els) => els.map((el) => [el.dataset.ref, Number(el.style.getPropertyValue('--pb-z'))]));
  for (const i of [0, 7]) {
    const box = await notes.nth(i).boundingBox();
    await p.mouse.click(box.x + 50, box.y + 70);
    if (await p.evaluate(() => document.querySelector('.pb-dialog').open)) { await p.keyboard.press('Escape'); await dialogClosed(p); }
  }
  await p.waitForTimeout(100);
  const before = await z();
  const top = before.reduce((a, b) => (b[1] > a[1] ? b : a));
  await p.reload();
  await p.waitForSelector('.pb-note');
  const after = await z();
  assert.equal(after.reduce((a, b) => (b[1] > a[1] ? b : a))[0], top[0]);
  await ctx.close();
});

test('the gear edits the types: rename, recolor, add, remove; app types only rename', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  await p.click('.pb-legend [data-pb=settings]');
  const rows = p.locator('.pb-dialog .pb-type');
  assert.equal(await rows.count(), 7);
  assert.ok(await rows.nth(0).locator('[name=hex]').isDisabled(), 'Broken is set by the app');
  assert.equal(await rows.nth(0).locator('[data-pb=type-remove]').count(), 0);
  await rows.nth(2).locator('[name=label]').fill('Mine');
  await rows.nth(2).locator('[name=hex]').fill('#ffcc00');
  await rows.nth(5).locator('[data-pb=type-remove]').click();
  await p.click('.pb-dialog [data-pb=type-add]');
  await rows.last().locator('[name=label]').fill('Calls');
  await rows.last().locator('[name=description]').fill('People to call back');
  await rows.last().locator('[data-pb=type-up]').click();
  await p.click('.pb-dialog [type=submit]');
  const keys = () => p.locator('.pb-legend .pb-key').evaluateAll((els) => els.map((el) => el.querySelector('.pb-key-label').textContent));
  assert.deepEqual(await keys(), ['Broken', 'Attention', 'Mine', 'Routine', 'Numbers', 'Calls', 'Someday']);
  const yellow = await p.locator('.pb-note[data-color=yellow]').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.equal(yellow, 'rgb(255, 204, 0)', 'notes of the type take its new color');
  assert.equal(await p.evaluate(() => document.activeElement.dataset.pb), 'settings', 'the focus goes back to the gear');
  await p.reload();
  await p.waitForSelector('.pb-note');
  assert.deepEqual(await keys(), ['Broken', 'Attention', 'Mine', 'Routine', 'Numbers', 'Calls', 'Someday']);
  await p.mouse.click(300, 700, { button: 'right' });
  assert.match(await p.locator(MENU).textContent(), /Calls[\s\S]*People to call back/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a wide screen gets more columns; long text ends in an ellipsis with the full text in the tooltip', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(1900);
  await mount(p, { notes: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, title: `n${i}`, text: i ? 'short' : LONG })) });
  const columns = () => p.$$eval('#b .pb-note', (els) => new Set(els.map((e) => e.offsetLeft)).size);
  assert.ok((await columns()) > 4, `columns: ${await columns()}`);
  await p.setViewportSize({ width: 1000, height: 900 });
  await p.waitForTimeout(400);
  assert.equal(await columns(), 4);
  const clip = await p.$eval('#b .pb-text', (e) => ({ cut: e.scrollHeight > e.clientHeight + 2, title: e.title }));
  assert.ok(clip.cut, 'text is clipped');
  assert.equal(clip.title, LONG);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a board first drawn as a phone grid flows its notes into columns when the window gets wide', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(600);
  await mount(p, { notes: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, title: `n${i}`, text: i % 2 ? LONG.slice(0, 120) : 'short' })) });
  assert.equal(await p.locator('.pb-glass').evaluate((el) => getComputedStyle(el).display), 'grid');
  await p.setViewportSize({ width: 1300, height: 900 });
  await p.waitForTimeout(400);
  const boxes = await p.$$eval('#b .pb-note', (els) => els.map((e) => ({ l: e.offsetLeft, t: e.offsetTop, r: e.offsetLeft + e.offsetWidth, b: e.offsetTop + e.offsetHeight })));
  assert.ok(new Set(boxes.map((b) => b.l)).size >= 4, 'in columns');
  const overlaps = boxes.some((a, i) => boxes.some((b, j) => i < j && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b));
  assert.equal(overlaps, false, 'no note covers another');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the bottom corners resize the board, centered and saved; double-click resets; the gear locks it', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(1400);
  const box = () => p.$eval('.pb-stage', (e) => { const r = e.getBoundingClientRect(); const a = e.closest('.pb').getBoundingClientRect(); return { w: Math.round(r.width), left: Math.round(r.left - a.left), right: Math.round(a.right - r.right), h: Math.round(e.querySelector('.pb-glass').getBoundingClientRect().height), avail: Math.round(a.width) }; });
  const b0 = await box();
  assert.ok(Math.abs(b0.w - b0.avail * 0.8) <= 2 && Math.abs(b0.left - b0.right) <= 2, JSON.stringify(b0));
  const h = await p.locator('.pb-resize--right').boundingBox();
  await p.mouse.move(h.x + 11, h.y + 11);
  await p.mouse.down();
  await p.mouse.move(h.x + 11 - 100, h.y + 11 - 150, { steps: 5 });
  await p.mouse.up();
  const b1 = await box();
  assert.ok(Math.abs(b1.w - (b0.w - 200)) <= 3 && Math.abs(b1.left - b1.right) <= 2 && Math.abs(b1.h - (b0.h - 150)) <= 3, JSON.stringify({ b0, b1 }));
  const l = await p.locator('.pb-resize--left').boundingBox();
  await p.mouse.move(l.x + 11, l.y + 11);
  await p.mouse.down();
  await p.mouse.move(l.x + 11 + 5000, l.y + 11 - 5000, { steps: 5 });
  await p.mouse.up();
  const b2 = await box();
  assert.ok(b2.w === Math.min(b2.avail, 480) || Math.abs(b2.w - 480) <= 2, `minimum width: ${JSON.stringify(b2)}`);
  assert.ok(Math.abs(b2.h - 320) <= 2, `minimum height: ${b2.h}`);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('postit-board-demo')).size);
  assert.equal(saved.height, 320);
  await p.reload();
  await p.waitForSelector('.pb-note');
  const b3 = await box();
  assert.ok(Math.abs(b3.w - b2.w) <= 2 && Math.abs(b3.h - 320) <= 2, `after reload: ${JSON.stringify(b3)}`);
  await p.dblclick('.pb-resize--right');
  const b4 = await box();
  assert.ok(Math.abs(b4.w - b4.avail * 0.8) <= 2, `reset: ${JSON.stringify(b4)}`);
  await p.click('.pb-gear');
  await p.click('.pb-tab[data-tab=view]');
  await p.check('[name=lockSize]');
  await p.click('.pb-settings [type=submit]');
  assert.equal(await p.locator('.pb-resize--right').isVisible(), false);
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('postit-board-demo')));
  assert.equal(stored.size.locked, true);
  assert.equal(stored.legend, undefined, 'only what changed is saved: the types were not touched');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('cut text: a click opens it whole in the center; the gear switches to "more" or to growing in place', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(1400);
  await mount(p, {
    store: 't-expand', legend: [{ color: 'yellow', label: 'Notes' }],
    notes: [{ title: 'Long one', text: LONG }, { title: 'Short', text: 'ok' }],
    auto: [{ key: 'a', title: 'App note', text: LONG, link: '/x', linkLabel: 'open →' }],
  });
  const note = (title) => p.locator('.pb-note', { hasText: title });
  // center (default): click opens the reader with the whole text, Esc closes
  await note('Long one').click();
  assert.equal(await p.locator('.pb-reader-text').textContent(), LONG);
  assert.equal(await p.locator('.pb-reader [data-pb=reader-edit]').count(), 1);
  await p.keyboard.press('Escape');
  await dialogClosed(p);
  await note('App note').click();
  assert.equal(await p.locator('.pb-reader .pb-link').textContent(), 'open →');
  assert.equal(await p.locator('.pb-reader [data-pb=reader-edit]').count(), 0, 'app notes are read-only');
  await p.click('.pb-reader-close');
  await dialogClosed(p);
  // the end of a drag does not open it
  const bb = await note('Short').boundingBox();
  await p.mouse.move(bb.x + 40, bb.y + 40); await p.mouse.down(); await p.mouse.move(bb.x + 140, bb.y + 90, { steps: 4 }); await p.mouse.up();
  assert.equal(await p.locator('.pb-dialog[open]').count(), 0);
  // "more": only cut notes get the link, it opens in place and is saved in the store
  await p.click('.pb-gear');
  await p.click('.pb-tab[data-tab=view]');
  await p.check('[name=expand][value=more]');
  await p.click('.pb-settings [type=submit]');
  assert.equal(await p.locator('.pb-more').count(), 2);
  await note('Long one').locator('.pb-more').click();
  await settle(p);
  const open = await note('Long one').locator('.pb-text').evaluate((e) => e.scrollHeight - e.clientHeight < 10);
  assert.ok(open, 'text no longer cut');
  assert.equal(await note('Long one').locator('.pb-more').textContent(), 'less ▴');
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('t-expand')).view.expand), 'more');
  // in place: hovering a cut note shows it whole
  await p.click('.pb-gear');
  await p.click('.pb-tab[data-tab=view]');
  await p.check('[name=expand][value=inplace]');
  await p.click('.pb-settings [type=submit]');
  await note('App note').hover();
  await settle(p);
  assert.ok(await note('App note').locator('.pb-text').evaluate((e) => e.scrollHeight - e.clientHeight < 10), 'hover shows it whole');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('center: the reader grows out of its note, the backdrop fades in, and Esc plays it back into the note', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  await mount(p, { motion: '10s', notes: [{ id: 1, title: 'Long one', text: LONG }, { id: 2, title: 'Short', text: 'ok' }] });
  await p.mouse.move(1, 1);
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const same = (a, b) => near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h);
  const noteBox = await p.locator('[data-ref="id:1"]').evaluate(rect);
  await p.focus('[data-ref="id:1"]');
  await p.keyboard.press('Enter');
  // halfway through nothing yet: at time 0 the reader is exactly where the note is, words hidden
  const start = await p.evaluate(() => {
    const article = document.querySelector('.pb-reader');
    for (const a of article.getAnimations({ subtree: true })) { a.pause(); a.currentTime = 0; }
    const r = article.getBoundingClientRect();
    return {
      box: { x: r.x, y: r.y, w: r.width, h: r.height },
      words: getComputedStyle(article.querySelector('.pb-reader-text')).opacity,
      backdrop: getComputedStyle(article.parentElement, '::backdrop').animationName,
      note: getComputedStyle(document.querySelector('[data-ref="id:1"]')).visibility,
    };
  });
  assert.ok(same(start.box, noteBox), `starts at the note: ${JSON.stringify({ noteBox, start: start.box })}`);
  assert.equal(start.words, '0', 'the words fade in once the paper is almost there');
  assert.equal(start.backdrop, 'pb-fade-in');
  assert.equal(start.note, 'hidden', 'the note itself is what flew to the center');
  // at the end: big, in the center of the screen
  const end = await p.evaluate(() => {
    const article = document.querySelector('.pb-reader');
    for (const a of article.getAnimations({ subtree: true })) a.finish();
    const r = article.getBoundingClientRect();
    return { cx: r.x + r.width / 2, w: r.width, center: innerWidth / 2, words: getComputedStyle(article.querySelector('.pb-reader-text')).opacity };
  });
  assert.ok(near(end.cx, end.center) && end.w > noteBox.w * 2 && end.words === '1', JSON.stringify(end));
  // Esc: the dialog stays open while the reader flies back, and lands on the note
  await p.keyboard.press('Escape');
  const back = await p.evaluate(() => {
    const d = document.querySelector('.pb-dialog');
    const article = d.querySelector('.pb-reader');
    for (const a of article.getAnimations({ subtree: true })) { a.pause(); a.currentTime = a.effect.getComputedTiming().endTime; }
    const r = article.getBoundingClientRect();
    return { open: d.open, closing: d.classList.contains('pb-dialog--closing'), box: { x: r.x, y: r.y, w: r.width, h: r.height }, backdrop: getComputedStyle(d, '::backdrop').animationName };
  });
  assert.ok(back.open && back.closing, 'still open while it goes back');
  assert.ok(same(back.box, noteBox), `ends at the note: ${JSON.stringify({ noteBox, back: back.box })}`);
  assert.equal(back.backdrop, 'pb-fade-out');
  await settle(p);
  await dialogClosed(p);
  const after = await p.evaluate(() => ({ note: getComputedStyle(document.querySelector('[data-ref="id:1"]')).visibility, focus: document.activeElement.dataset.ref }));
  assert.deepEqual(after, { note: 'visible', focus: 'id:1' }, 'the note is back, with the focus');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('center: ×, a click outside and Done play it back too; a note off screen or gone fades instead', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(1200, { height: 700 });
  const notes = [{ id: 1, title: 'First', text: LONG, x: 0.05, y: 30 }, { id: 2, title: 'Second', text: 'two', x: 0.5, y: 30 }, { id: 3, title: 'Far below', text: 'three', x: 0.05, y: 1500 }];
  await mount(p, { motion: '10s', store: 't-reader', notes });
  const closing = async () => {
    const state = await p.evaluate(() => {
      const d = document.querySelector('.pb-dialog');
      const kf = d.querySelector('.pb-reader').getAnimations()[0]?.effect.getKeyframes() ?? [];
      return { open: d.open, closing: d.classList.contains('pb-dialog--closing'), fade: kf.some((k) => k.opacity !== undefined) };
    });
    await settle(p);
    await dialogClosed(p);
    return state;
  };
  const openFirst = async () => { await p.click('[data-ref="id:1"]', { position: { x: 60, y: 60 } }); await settle(p); };
  // a text selection that ends on the backdrop does not close it
  await openFirst();
  const text = await p.locator('.pb-reader-text').boundingBox();
  await p.mouse.move(text.x + 20, text.y + 5); await p.mouse.down(); await p.mouse.move(5, 5, { steps: 3 }); await p.mouse.up();
  assert.equal(await p.evaluate(() => document.querySelector('.pb-dialog').classList.contains('pb-dialog--closing')), false);
  // a click on the backdrop
  await p.mouse.click(5, 5);
  assert.deepEqual(await closing(), { open: true, closing: true, fade: false });
  // the × button
  await openFirst();
  await p.click('.pb-reader-close');
  assert.deepEqual(await closing(), { open: true, closing: true, fade: false });
  // Archive: back into the note, which then flies into the Archived button
  await openFirst();
  assert.equal(await p.textContent('[data-pb=reader-done]'), 'Archive');
  await p.click('[data-pb=reader-done]');
  assert.deepEqual(await closing(), { open: true, closing: true, fade: false });
  assert.ok(await p.evaluate(() => document.querySelector('[data-ref="id:1"]').classList.contains('pb-note--gone') && document.querySelector('.pb-ghost') !== null), 'then it flies to Archived');
  await settle(p);
  await p.waitForFunction(() => !document.querySelector('[data-ref="id:1"]'));
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('t-reader')).notes.find((n) => n.id === 1).doneAt !== null), true);
  // a note scrolled out of sight opens with a fade
  await p.evaluate(() => window.B.openNote('id:3'));
  const far = await keyframes(p.locator('.pb-reader'));
  assert.ok(far[0].opacity !== undefined && /scale/.test(far[0].transform), JSON.stringify(far));
  await settle(p);
  await p.keyboard.press('Escape');
  await settle(p);
  await dialogClosed(p);
  // the note went away while it was open: Esc fades it out
  await p.click('[data-ref="id:2"]', { position: { x: 60, y: 60 } });
  await settle(p);
  await p.evaluate(() => window.B.update({ notes: [] }));
  await p.keyboard.press('Escape');
  assert.deepEqual(await closing(), { open: true, closing: true, fade: true });
  // a note without a title still gives the reader a name for screen readers
  await p.evaluate(() => { window.B.update({ notes: [{ id: 9, text: 'no title' }] }); window.B.openNote('id:9'); });
  assert.deepEqual(await p.evaluate(() => { const d = document.querySelector('.pb-dialog'); return [d.getAttribute('aria-label'), d.hasAttribute('aria-labelledby')]; }), ['Note', false]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('in place: a cut note grows with a height animation on hover or keyboard focus, and shrinks back', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  await mount(p, { motion: '10s', view: { expand: 'inplace' }, notes: [{ id: 1, title: 'Long one', text: LONG, x: 0.05, y: 30 }, { id: 2, title: 'Short', text: 'ok', x: 0.5, y: 30 }] });
  const note = p.locator('[data-ref="id:1"]');
  const text = note.locator('.pb-text');
  const cut = () => text.evaluate((e) => e.scrollHeight - e.clientHeight > 10);
  const clamped = await text.evaluate((e) => e.clientHeight);
  const full = await text.evaluate((e) => e.scrollHeight);
  await note.hover();
  const grow = await keyframes(text);
  assert.ok(await note.evaluate((el) => el.classList.contains('pb-note--open')));
  // (a cut text reports a few pixels of slack in scrollHeight: handwriting fonts draw past their line box)
  assert.ok(near(parseFloat(grow[0].height), clamped, 1) && near(parseFloat(grow[1].height), full, 4), JSON.stringify({ grow, clamped, full }));
  await settle(p);
  assert.equal(await cut(), false, 'whole once grown');
  await p.mouse.move(1, 1);
  const shrink = await keyframes(text);
  assert.ok(await note.evaluate((el) => el.classList.contains('pb-note--closing') && !el.classList.contains('pb-note--open')), 'the text stays whole while it shrinks');
  assert.ok(near(parseFloat(shrink[0].height), full, 4) && near(parseFloat(shrink[1].height), clamped, 1), JSON.stringify(shrink));
  await settle(p);
  assert.equal(await note.evaluate((el) => el.classList.contains('pb-note--closing')), false);
  assert.equal(await cut(), true, 'cut again, with its "…"');
  // a note that is not cut does not grow
  await p.locator('[data-ref="id:2"]').hover();
  assert.equal(await p.locator('[data-ref="id:2"]').evaluate((el) => el.classList.contains('pb-note--open')), false);
  // the keyboard: Tab to the note opens it, its own buttons keep it open, the next note closes it
  await p.mouse.move(1, 1);
  await p.focus('[data-pb=add]');
  await p.keyboard.press('Tab');
  assert.equal(await p.evaluate(() => document.activeElement.dataset.ref), 'id:1');
  assert.ok(await note.evaluate((el) => el.classList.contains('pb-note--open')));
  await settle(p);
  await p.keyboard.press('Tab');
  assert.ok(await note.evaluate((el) => el.classList.contains('pb-note--open')), 'still open on its ✎');
  await p.keyboard.press('Tab');
  await p.keyboard.press('Tab');
  assert.equal(await p.evaluate(() => document.activeElement.dataset.ref), 'id:2');
  assert.ok(await note.evaluate((el) => !el.classList.contains('pb-note--open') && el.classList.contains('pb-note--closing')));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('more: the link reveals the rest with a height animation and "less" rolls it back', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  await mount(p, { motion: '10s', view: { expand: 'more' }, notes: [{ id: 1, title: 'Long one', text: LONG, x: 0.05, y: 30 }, { id: 2, title: 'Short', text: 'ok', x: 0.5, y: 30 }] });
  const note = p.locator('[data-ref="id:1"]');
  const text = note.locator('.pb-text');
  assert.equal(await p.locator('.pb-more').count(), 1, 'only the cut note gets the link');
  const clamped = await text.evaluate((e) => e.clientHeight);
  await note.locator('.pb-more').click();
  const grow = await keyframes(text);
  assert.ok(near(parseFloat(grow[0].height), clamped, 1) && parseFloat(grow[1].height) > clamped * 2, JSON.stringify(grow));
  assert.equal(await note.locator('.pb-more').getAttribute('aria-expanded'), 'true');
  await settle(p);
  assert.equal(await note.locator('.pb-more').textContent(), 'less ▴');
  await note.locator('.pb-more').click();
  const shrink = await keyframes(text);
  assert.ok(near(parseFloat(shrink[1].height), clamped, 1) && await note.evaluate((el) => el.classList.contains('pb-note--closing')), JSON.stringify(shrink));
  await settle(p);
  assert.ok(await text.evaluate((e) => e.scrollHeight - e.clientHeight > 10), 'cut again');
  assert.equal(await note.locator('.pb-more').textContent(), 'more ▾');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('reduced motion: the three ways change at once, without animations', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(1200, { reducedMotion: 'reduce' });
  await mount(p, { view: { expand: 'inplace' }, notes: [{ id: 1, title: 'Long one', text: LONG, x: 0.05, y: 30 }] });
  const note = p.locator('[data-ref="id:1"]');
  await note.hover();
  assert.ok(await note.evaluate((el) => el.classList.contains('pb-note--open')));
  assert.equal(await p.evaluate(() => document.getAnimations().length), 0, 'in place: no animation');
  await p.mouse.move(1, 1);
  assert.ok(await note.evaluate((el) => !el.classList.contains('pb-note--open') && !el.classList.contains('pb-note--closing')));
  await p.evaluate(() => window.B.configure({ view: { expand: 'more' } }));
  await p.click('.pb-more');
  assert.equal(await p.evaluate(() => document.getAnimations().length), 0, 'more: no animation');
  await p.evaluate(() => window.B.configure({ view: { expand: 'center' } }));
  await note.click();
  const reader = await p.evaluate(() => ({ anims: document.getAnimations().length, backdrop: getComputedStyle(document.querySelector('.pb-dialog'), '::backdrop').animationName }));
  assert.deepEqual(reader, { anims: 0, backdrop: 'none' }, 'center: no animation');
  await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(() => document.querySelector('.pb-dialog').open), false, 'Esc closes at once');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a drag never opens the notes it passes over, nor makes them animate', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  await mount(p, { motion: '10s', view: { expand: 'inplace' }, notes: [{ id: 1, title: 'Moving', text: LONG, x: 0.05, y: 30 }, { id: 2, title: 'In the way', text: LONG, x: 0.4, y: 30 }] });
  const a = await p.locator('[data-ref="id:1"]').boundingBox();
  const b = await p.locator('[data-ref="id:2"]').boundingBox();
  await p.mouse.move(a.x + 60, a.y + 30);
  await p.mouse.down();
  await p.mouse.move(b.x + 60, b.y + 40, { steps: 10 });
  await p.mouse.move(b.x + 120, b.y + 80, { steps: 10 });
  const other = await p.locator('[data-ref="id:2"]').evaluate((el) => ({ open: el.classList.contains('pb-note--open'), anims: el.getAnimations({ subtree: true }).length }));
  await p.mouse.up();
  assert.deepEqual(other, { open: false, anims: 0 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a drag lands under the pointer on a scrolled board, and data sent during it shows up when it ends', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  const notes = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, title: `n${i}`, text: 'x', x: 0.05, y: 30 + i * 200 }));
  await mount(p, { store: 't-scroll', size: { height: 400 }, notes });
  await p.locator('.pb-glass').evaluate((g) => { g.scrollTop = 400; });
  const note = p.locator('[data-ref="id:3"]'); // y 430: near the top of what shows
  const box = await note.boundingBox();
  await p.mouse.move(box.x + 60, box.y + 40);
  await p.mouse.down();
  await p.mouse.move(box.x + 80, box.y + 60, { steps: 4 });
  await p.evaluate(() => window.B.update({ notes: window.B.notes, auto: [{ key: 'new', title: 'Arrived during the drag' }] }));
  await p.mouse.move(box.x + 90, box.y + 80, { steps: 4 });
  await p.mouse.up();
  await p.waitForTimeout(50);
  assert.equal(await note.evaluate((el) => el.offsetTop), 470, 'moved by what the pointer moved (+40), not by the scroll');
  assert.equal(await p.locator('.pb-note', { hasText: 'Arrived during the drag' }).count(), 1);
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('t-scroll')).notes.find((n) => n.id === 3).y), 470);
  // a right-click on the scrolled glass places the new note under the pointer too
  const at = await p.locator('.pb-glass').evaluate((g) => { const r = g.getBoundingClientRect(); return { x: r.x + r.width - 120, y: r.y + 300, top: r.y + g.clientTop, scroll: g.scrollTop }; });
  await p.mouse.click(at.x, at.y, { button: 'right' });
  await p.click('.pb-menu [data-pb=menu-new] >> nth=0');
  await p.fill('.pb-dialog [name=text]', 'Placed');
  await p.click('.pb-dialog [type=submit]');
  assert.equal(await p.locator('.pb-note', { hasText: 'Placed' }).evaluate((el) => el.offsetTop), Math.round(at.y - at.top + at.scroll));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('keyboard: arrows move notes and every move is saved; Enter, Esc and the menu give the focus back', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  await mount(p, { store: 't-keys', notes: [{ title: 'A', text: 'a', x: 0.1, y: 40 }, { title: 'B', text: 'b', x: 0.5, y: 40 }] });
  await p.focus('[data-ref="id:1"]');
  for (let i = 0; i < 3; i += 1) await p.keyboard.press('ArrowRight');
  await p.focus('[data-ref="id:2"]');
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(600);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('t-keys')).notes);
  assert.ok(near(saved[0].x, 0.13, 0.001), `the first note's move is not lost: ${saved[0].x}`);
  assert.equal(saved[1].y, 60);
  // Enter opens the reader, Esc closes it and the focus is back on the note
  await p.keyboard.press('Enter');
  assert.equal(await p.evaluate(() => document.activeElement.className), 'pb-reader', 'the note in the reader has the focus');
  await p.keyboard.press('Tab');
  assert.equal(await p.evaluate(() => document.activeElement.dataset.pb), 'reader-close', 'Tab reaches × first');
  await p.keyboard.press('Escape');
  await dialogClosed(p);
  assert.equal(await p.evaluate(() => document.activeElement.dataset.ref), 'id:2');
  // the menu of a note: → opens a submenu on its current value, ← comes back; End is Archive; Esc gives the focus back
  await p.focus('[data-ref="id:1"]');
  const a = await p.locator('[data-ref="id:1"]').boundingBox();
  await p.locator('[data-ref="id:1"]').dispatchEvent('contextmenu', { clientX: a.x + 20, clientY: a.y + 20, button: 2 });
  const focused = () => p.evaluate(() => { const el = document.activeElement; return { role: el.getAttribute('role'), pb: el.dataset.pb, sub: el.dataset.sub, checked: el.getAttribute('aria-checked'), color: el.dataset.color, expanded: el.getAttribute('aria-expanded') }; });
  assert.deepEqual(await focused(), { role: 'menuitem', pb: 'menu-sub', sub: 'color', checked: null, color: undefined, expanded: 'false' });
  assert.equal(await p.getAttribute(MENU, 'aria-label'), 'A', 'the menu is named after its note');
  await p.keyboard.press('ArrowRight');
  assert.deepEqual(await focused(), { role: 'menuitemradio', pb: 'menu-color', sub: undefined, checked: 'true', color: 'yellow', expanded: null });
  await p.keyboard.press('ArrowLeft');
  assert.deepEqual(await focused(), { role: 'menuitem', pb: 'menu-sub', sub: 'color', checked: null, color: undefined, expanded: 'false' });
  assert.ok(await p.locator(SUB).isHidden());
  await p.keyboard.press('End');
  assert.equal(await p.evaluate(() => document.activeElement.dataset.pb), 'menu-archive');
  await p.keyboard.press('Escape');
  assert.ok(await p.locator(MENU).isHidden());
  assert.equal(await p.evaluate(() => document.activeElement.dataset.ref), 'id:1');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('when the store fails, a note marked done or deleted comes back and postit-error fires', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  await p.evaluate(async () => {
    document.body.innerHTML = '<div id="b"></div>';
    const { createBoard } = await import('../src/postit-board.js');
    const el = document.getElementById('b');
    window.failures = [];
    el.addEventListener('postit-error', (e) => window.failures.push(e.detail.message));
    const store = { load: async () => ({ notes: [{ id: 1, title: 'Keep me', text: 'k' }] }), create: async (d) => ({ ...d, id: 2 }), update: async () => { throw new Error('offline'); } };
    window.B = createBoard(el, { store, onError: () => {} });
    await window.B.reload();
  });
  await p.click('[data-ref="id:1"] [data-pb=done]');
  await p.waitForTimeout(300);
  assert.equal(await p.locator('.pb-note', { hasText: 'Keep me' }).count(), 1, 'done failed: still on the board');
  await p.click('[data-ref="id:1"] [data-pb=edit]');
  await p.click('.pb-dialog [data-pb=remove]');
  await p.waitForTimeout(100);
  assert.equal(await p.locator('.pb-note', { hasText: 'Keep me' }).count(), 1, 'delete failed: still on the board');
  assert.deepEqual(await p.evaluate(() => window.failures), ['offline', 'offline']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('works under a strict Content-Security-Policy: no inline styles, no inline handlers, no eval', async (t) => {
  if (!browser) return t.skip('no browser');
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'en-US' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const csp = "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:";
  const html = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/src/postit-board.css"></head>'
    + '<body><div id="b"></div><script type="module" src="/csp-boot.js"></script></body></html>';
  const boot = `
    import { createBoard } from '/src/postit-board.js';
    window.violations = [];
    document.addEventListener('securitypolicyviolation', (e) => window.violations.push(e.violatedDirective));
    window.B = createBoard(document.getElementById('b'), {
      legend: [{ color: 'yellow', label: 'Notes' }, { color: 'pink', label: 'Broken', hex: '#ff8899' }],
      notes: [{ id: 1, title: 'One', text: 'one', color: 'yellow' }, { id: 2, title: 'Two', text: 'two', color: 'pink', x: 0.5, y: 200 }],
    });
    window.ready = true;`;
  await p.route(`${base}/csp.html`, (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/html', 'content-security-policy': csp }, body: html }));
  await p.route(`${base}/csp-boot.js`, (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/javascript' }, body: boot }));
  await p.goto(`${base}/csp.html`);
  await p.waitForFunction(() => window.ready);
  const two = await p.locator('[data-ref="id:2"]').evaluate((el) => ({ left: el.offsetLeft, top: el.offsetTop, bg: getComputedStyle(el).backgroundColor }));
  assert.ok(two.left > 100 && two.top === 200, `placed: ${JSON.stringify(two)}`);
  assert.equal(two.bg, 'rgb(255, 136, 153)', 'painted with its type color');
  assert.equal(await p.locator('.pb-key[data-color=pink] .pb-swatch').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(255, 136, 153)');
  await p.click('[data-ref="id:1"]', { position: { x: 40, y: 60 } });
  assert.equal(await p.locator('.pb-reader').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(253, 230, 138)', 'the reader too');
  await p.keyboard.press('Escape');
  await dialogClosed(p);
  await p.click('[data-ref="id:2"]', { button: 'right', position: { x: 40, y: 60 } });
  assert.equal(await p.locator(`${MENU} .pb-swatch >> nth=0`).evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(255, 136, 153)', 'and the menu');
  await p.hover(`${MENU} [data-sub=color]`);
  assert.equal(await p.locator(`${SUB} [data-color=pink] .pb-swatch`).evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(255, 136, 153)', 'and its submenu');
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  assert.deepEqual(await p.evaluate(() => window.violations), []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('configure() changes strings, size and view after mounting; destroy() leaves the element clean', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(1400);
  await mount(p, { notes: [{ id: 1, title: 'One', text: 'one' }] });
  await p.evaluate(() => window.B.configure({ strings: { add: '+ Nota', hint: 'Arraste as notas' }, view: { expand: 'more' }, size: { width: 0.5 } }));
  assert.equal(await p.textContent('[data-pb=add]'), '+ Nota');
  assert.equal(await p.textContent('.pb-hint'), 'Arraste as notas');
  assert.equal(await p.getAttribute('#b', 'data-expand'), 'more');
  const share = await p.$eval('.pb-stage', (e) => e.getBoundingClientRect().width / e.closest('.pb').getBoundingClientRect().width);
  assert.ok(near(share, 0.5, 0.01), `width: ${share}`);
  await p.evaluate(() => window.B.configure({ addButton: false }));
  assert.equal(await p.locator('[data-pb=add]').count(), 0);
  const after = await p.evaluate(() => {
    window.B.destroy();
    const el = document.getElementById('b');
    return { className: el.className, expand: el.dataset.expand ?? null, frame: el.style.getPropertyValue('--pb-frame'), html: el.innerHTML };
  });
  assert.deepEqual(after, { className: '', expand: null, frame: '', html: '' });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('due chips turn from today to overdue in place, without redrawing the board', async (t) => {
  if (!browser) return t.skip('no browser');
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'en-US' });
  const p = await ctx.newPage();
  await p.clock.install({ time: new Date(2026, 10, 13, 15, 0) });
  await p.goto(`${base}/demo/`);
  await p.waitForSelector('.pb-note');
  await mount(p, { notes: [{ id: 1, title: 'Call back', text: 'soon', due: new Date(2026, 10, 13, 15, 0, 30).toISOString() }] });
  const chip = p.locator('[data-ref="id:1"] .pb-due');
  assert.equal(await chip.getAttribute('class'), 'pb-due pb-due--today');
  await p.locator('[data-ref="id:1"]').evaluate((el) => { el.dataset.mark = 'same'; });
  await p.clock.runFor(61_000);
  assert.equal(await chip.getAttribute('class'), 'pb-due pb-due--overdue');
  assert.equal(await p.locator('[data-ref="id:1"]').getAttribute('data-mark'), 'same', 'the same element: nothing was redrawn');
  await ctx.close();
});

test('a note made on a phone reaches the store without a position (no x or y sent as null)', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(360, { height: 740 });
  await p.evaluate(async () => {
    document.body.innerHTML = '<div id="b"></div>';
    const { createBoard } = await import('../src/postit-board.js');
    window.SENT = [];
    const store = { load: async () => ({ notes: [] }), create: async (d) => { window.SENT.push(d); return { ...d, id: 7 }; }, update: async (r, patch) => patch };
    window.B = createBoard(document.getElementById('b'), { store });
    await window.B.reload();
  });
  await p.click('[data-pb=add]');
  await p.fill('.pb-dialog [name=text]', 'made on a phone');
  await p.click('.pb-dialog [type=submit]');
  await p.waitForFunction(() => window.SENT.length === 1);
  const sent = await p.evaluate(() => window.SENT[0]);
  assert.equal(sent.text, 'made on a phone');
  assert.ok(!('x' in sent) && !('y' in sent), `no position on a grid: ${JSON.stringify(sent)}`);
  assert.equal(typeof sent.z, 'number');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('on a phone the board is a grid without horizontal scroll, and every dialog fits', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(360, { height: 740 });
  assert.equal(await p.locator('.pb-glass').evaluate((el) => getComputedStyle(el).display), 'grid');
  const fits = () => p.evaluate(() => {
    const d = document.querySelector('.pb-dialog');
    const box = d.getBoundingClientRect();
    const inside = [...d.querySelectorAll('input:not([type=radio]), textarea, button')].every((el) => { const r = el.getBoundingClientRect(); return r.width === 0 || (r.left >= box.left - 1 && r.right <= box.right + 1); });
    return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, left: box.left >= 0, right: box.right <= innerWidth, inside };
  });
  const ok = { page: 0, left: true, right: true, inside: true };
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  await p.click('[data-pb=add]');
  assert.deepEqual(await fits(), ok, 'the editor');
  await p.click('.pb-dialog [data-pb=cancel]');
  await p.click('.pb-gear');
  assert.deepEqual(await fits(), ok, 'the note types');
  await p.click('.pb-dialog [data-pb=cancel]');
  await p.locator('.pb-note').nth(2).click({ position: { x: 30, y: 50 } });
  await settle(p);
  assert.deepEqual(await fits(), ok, 'the reader');
  await p.keyboard.press('Escape');
  await settle(p);
  await dialogClosed(p);
  // an empty board says so across the whole glass
  await mount(p, {});
  const empty = await p.locator('.pb-empty').evaluate((el) => ({ share: el.offsetWidth / el.parentElement.clientWidth, role: el.parentElement.getAttribute('role') }));
  assert.ok(empty.share > 0.8, `the message spans the glass: ${empty.share}`);
  assert.equal(empty.role, null, 'no empty list for screen readers');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the global build exposes the same API to a classic script', async (t) => {
  if (!browser) return t.skip('no browser');
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${base}/demo/`);
  await p.addScriptTag({ url: `${base}/dist/postit-board.global.js` });
  const api = await p.evaluate(() => Object.keys(window.PostitBoard).sort());
  for (const name of ['createBoard', 'restStore', 'localStore', 'linkify', 'DEFAULT_COLORS', 'DEFAULT_STRINGS', 'EXPAND', 'normalizeView']) assert.ok(api.includes(name), name);
  await ctx.close();
});
