// Regenerates the README images from the demo: `npm run screenshots` (needs Chrome or Edge).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { serve } from './serve-demo.mjs';

const docs = fileURLToPath(new URL('../docs/', import.meta.url));
const server = await serve(0);
const base = `http://127.0.0.1:${server.address().port}/demo/`;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });

/** Ends the transitions (the reader growing out of its note, a tab's underline) so the picture shows where they land. */
const settle = (page) => page.evaluate(async () => {
  for (const a of document.getAnimations()) a.finish();
  await new Promise((r) => setTimeout(r, 200));
});
const PHONE = { width: 390, height: 844, hasTouch: true, isMobile: true };

/** Holds a finger on an element until its menu opens. */
async function longPress(page, locator) {
  const b = await locator.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const point = { x: b.x + b.width / 2, y: b.y + 40 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(650);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function shot(name, { page: file = 'index.html', width, height, scale = 2, hasTouch, isMobile, fullPage = true, before }) {
  // due times are written in the browser's language: English for the README
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, locale: 'en-US', hasTouch, isMobile });
  const page = await ctx.newPage();
  await page.goto(base + file);
  await page.waitForSelector('.pb-note, .pb-table');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  if (before) await before(page);
  await page.screenshot({ path: `${docs}${name}.png`, fullPage });
  await ctx.close();
  console.log(`docs/${name}.png`);
}

await shot('board', { width: 1200, height: 820 });
await shot('phone', { ...PHONE });
await shot('editor', {
  width: 1200, height: 820, scale: 1,
  before: async (page) => {
    await page.locator('.pb-note', { hasText: 'Curabitur' }).locator('[data-pb=edit]').click();
    await settle(page);
  },
});
await shot('menu', {
  page: 'kanban.html', width: 1200, height: 900, scale: 1, fullPage: false,
  before: async (page) => {
    const box = await page.locator('.pb-note', { hasText: 'Paint the fence' }).boundingBox();
    await page.mouse.click(box.x + 60, box.y + 60, { button: 'right' });
    await page.hover('.pb-menu [data-sub=lane]');
    await page.waitForSelector('.pb-menu--sub:not([hidden])');
  },
});
await shot('app-menu', {
  width: 1200, height: 820, scale: 1, fullPage: false,
  before: async (page) => {
    await page.locator('.pb-note', { hasText: 'Disk at 91%' }).click({ button: 'right', position: { x: 60, y: 60 } });
    await page.hover('.pb-menu [data-pb=menu-dismiss]');
  },
});
for (const [name, tab] of [['types', 'types'], ['lanes', 'lanes'], ['view', 'view']]) {
  await shot(name, {
    page: 'kanban.html', width: 1200, height: 900, scale: 1, fullPage: false,
    before: async (page) => {
      await page.click('.pb-gear');
      await page.click(`.pb-tab[data-tab=${tab}]`);
      await page.mouse.move(1, 1);
      await settle(page);
    },
  });
}
await shot('reader', {
  width: 1200, height: 820, scale: 1,
  before: async (page) => {
    await page.locator('.pb-note', { hasText: 'Vestibulum ante' }).click({ position: { x: 40, y: 40 } });
    await page.mouse.move(1, 1);
    await settle(page);
  },
});
await shot('archive', {
  width: 1200, height: 820, scale: 1, fullPage: false,
  before: async (page) => {
    const b = await page.locator('.pb-note', { hasText: 'Desk setup' }).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + 40);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 10, b.y + 50, { steps: 3 });
    const t = await page.locator('.pb-target').boundingBox();
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 });
    await settle(page);
  },
});
const rows = { before: (page) => page.waitForSelector('.pb-table tbody tr') };
await shot('archived', {
  page: 'archived.html', width: 1200, height: 820,
  // with an app note dismissed: it is listed first, from the app, with Bring back
  before: async (page) => {
    await page.evaluate(() => window.board.showArchived(false));
    await page.locator('.pb-note', { hasText: 'Disk at 91%' }).click({ button: 'right', position: { x: 60, y: 60 } });
    await page.click('.pb-menu [data-pb=menu-dismiss]');
    await page.waitForFunction(() => !document.querySelector('.pb-glass .pb-note--leaving'));
    await page.evaluate(() => { window.board.showArchived(true); document.querySelector('.pb-toast')?.remove(); });
    await page.waitForSelector('.pb-table tbody tr[data-key]');
    await page.mouse.move(1, 1);
    await settle(page);
  },
});
await shot('kanban', { page: 'kanban.html', width: 1200, height: 900 });
await shot('categories', { page: 'categories.html', width: 1200, height: 900 });
await shot('phone-lanes', { ...PHONE, page: 'kanban.html' });
await shot('phone-sheet', {
  ...PHONE, page: 'kanban.html', fullPage: false,
  before: async (page) => {
    await longPress(page, page.locator('.pb-note', { hasText: 'Plan the garden beds' }));
    await settle(page);
  },
});
await shot('phone-fold', { ...PHONE, page: 'index.html?priority&limit=2' });
await shot('phone-archived', { ...PHONE, page: 'archived.html', ...rows });

await browser.close();
server.close();
