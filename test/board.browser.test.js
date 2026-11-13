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
