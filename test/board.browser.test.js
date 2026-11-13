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

async function page(width = 1200) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${base}/demo/`);
  await p.waitForSelector('.pb-note');
  return { p, ctx, errors };
}

test('renders notes, legend counts and due chips', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  assert.equal(await p.locator('.pb-note').count(), 8);
  assert.equal(await p.locator('.pb-note--auto').count(), 2);
  assert.equal(await p.locator('.pb-due--overdue').count(), 1);
  assert.equal(await p.locator('.pb-key[data-color=yellow] .pb-count').textContent(), '2');
  assert.equal(await p.locator('.pb-img').count(), 3);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a legend item filters its color in and out', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx } = await page();
  await p.click('.pb-key[data-color=yellow]');
  assert.equal(await p.locator('.pb-note:visible').count(), 6);
  assert.equal(await p.getAttribute('.pb-key[data-color=yellow]', 'aria-pressed'), 'false');
  await p.click('.pb-key[data-color=yellow]');
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

test('create through the dialog, escape what was typed, then finish it', async (t) => {
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
  await note.locator('[data-pb=done]').click();
  await p.waitForTimeout(300);
  assert.equal(await p.locator('.pb-note').count(), 8);
  await p.reload();
  await p.waitForSelector('.pb-note');
  assert.equal(await p.locator('.pb-note').count(), 8);
  await ctx.close();
});

test('right-click on the glass: pick a type, the note starts exactly where you clicked', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  const glass = await p.locator('.pb-glass').boundingBox();
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
  assert.ok(await p.locator('.pb-menu').isHidden());
  assert.ok(await p.locator('.pb-dialog [name=color][value=green]').isChecked());
  await p.fill('.pb-dialog [name=text]', 'Right here');
  await p.click('.pb-dialog [type=submit]');
  const note = p.locator('.pb-note', { hasText: 'Right here' });
  await note.waitFor();
  const pos = await note.evaluate((el) => ({ x: el.offsetLeft, y: el.offsetTop }));
  assert.ok(Math.abs(glass.x + pos.x - at.x) <= 2 && Math.abs(glass.y + pos.y - at.y) <= 2, JSON.stringify(pos));
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('postit-board-demo')).notes.find((n) => n.text === 'Right here'));
  assert.equal(saved.color, 'green');
  assert.equal(saved.y, Math.round(at.y - glass.y));
  // Escape and a click outside close the menu without creating anything
  await p.mouse.click(at.x, at.y + 20, { button: 'right' });
  await p.keyboard.press('Escape');
  assert.ok(await p.locator('.pb-menu').isHidden());
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('right-click on a note changes its type; app notes keep the browser menu', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx } = await page();
  const note = p.locator('.pb-note:not(.pb-note--auto)').first();
  const ref = await note.getAttribute('data-ref');
  await note.click({ button: 'right', position: { x: 60, y: 80 } });
  assert.equal(await p.locator('.pb-menu [data-pb=menu-color]').count(), 7);
  assert.equal(await p.locator('.pb-menu [data-pb=menu-edit]').count(), 1);
  await p.click('.pb-menu [data-pb=menu-color][data-color=teal]');
  assert.equal(await p.getAttribute(`[data-ref="${ref}"]`, 'data-color'), 'teal');
  await p.locator('.pb-note--auto').first().click({ button: 'right', position: { x: 60, y: 80 } });
  assert.ok(await p.locator('.pb-menu').isHidden());
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
  await p.reload();
  await p.waitForSelector('.pb-note');
  assert.deepEqual(await keys(), ['Broken', 'Attention', 'Mine', 'Routine', 'Numbers', 'Calls', 'Someday']);
  await p.mouse.click(300, 700, { button: 'right' });
  assert.match(await p.locator('.pb-menu').textContent(), /Calls[\s\S]*People to call back/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a wide screen gets more columns; long text ends in an ellipsis with the full text in the tooltip', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(1900);
  const long = 'word '.repeat(80).trim();
  await p.evaluate(async (txt) => {
    document.body.innerHTML = '<div id="wide" style="width:100%"></div>';
    const { createBoard } = await import('../src/postit-board.js');
    const notes = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, title: `n${i}`, text: i ? 'short' : txt }));
    createBoard(document.getElementById('wide'), { notes });
  }, long);
  const columns = () => p.$$eval('#wide .pb-note', (els) => new Set(els.map((e) => e.offsetLeft)).size);
  assert.ok((await columns()) > 4, `columns: ${await columns()}`);
  await p.setViewportSize({ width: 1000, height: 900 });
  await p.waitForTimeout(400);
  assert.equal(await columns(), 4);
  const clip = await p.$eval('#wide .pb-text', (e) => ({ cut: e.scrollHeight > e.clientHeight + 2, title: e.title }));
  assert.ok(clip.cut, 'text is clipped');
  assert.equal(clip.title, long);
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
  await p.check('[name=lockSize]');
  await p.click('.pb-settings [type=submit]');
  assert.equal(await p.locator('.pb-resize--right').isVisible(), false);
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('postit-board-demo')).size.locked), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('on a phone the board is a grid without horizontal scroll', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx } = await page(360);
  assert.equal(await p.locator('.pb-glass').evaluate((el) => getComputedStyle(el).display), 'grid');
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow, 0);
  await ctx.close();
});

test('the global build exposes the same API to a classic script', async (t) => {
  if (!browser) return t.skip('no browser');
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${base}/demo/`);
  await p.addScriptTag({ url: `${base}/dist/postit-board.global.js` });
  const api = await p.evaluate(() => Object.keys(window.PostitBoard).sort());
  for (const name of ['createBoard', 'restStore', 'localStore', 'linkify', 'DEFAULT_COLORS']) assert.ok(api.includes(name), name);
  await ctx.close();
});
