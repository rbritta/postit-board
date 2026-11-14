// Regenerates the README images from the demo: `npm run screenshots` (needs Chrome or Edge).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { serve } from './serve-demo.mjs';

const docs = fileURLToPath(new URL('../docs/', import.meta.url));
const server = await serve(0);
const url = `http://127.0.0.1:${server.address().port}/demo/`;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });

/** Ends the transitions (the reader growing out of its note) so the picture shows where they land. */
const settle = (page) => page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });

async function shot(name, { width, height, scale = 2, before }) {
  // due times are written in the browser's language: English for the README
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, locale: 'en-US' });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForSelector('.pb-note');
  await page.evaluate(() => document.fonts.ready);
  if (before) await before(page);
  await page.screenshot({ path: `${docs}${name}.png`, fullPage: true });
  await ctx.close();
  console.log(`docs/${name}.png`);
}

await shot('board', { width: 1200, height: 820 });
await shot('phone', { width: 390, height: 844 });
await shot('editor', {
  width: 1200, height: 820, scale: 1,
  before: async (page) => {
    await page.locator('.pb-note', { hasText: 'Curabitur' }).locator('[data-pb=edit]').click();
    await page.waitForTimeout(150);
  },
});
await shot('menu', {
  width: 1200, height: 900, scale: 1,
  before: async (page) => {
    const box = await page.locator('.pb-note', { hasText: 'Nam liber' }).boundingBox();
    await page.mouse.click(box.x + 48, box.y + 150, { button: 'right' });
  },
});
await shot('types', {
  width: 1200, height: 900, scale: 1,
  before: async (page) => {
    await page.click('.pb-gear');
    await page.mouse.move(1, 1);
  },
});
await shot('reader', {
  width: 1200, height: 820, scale: 1,
  before: async (page) => {
    await page.locator('.pb-note', { hasText: 'Vestibulum ante' }).click({ position: { x: 40, y: 40 } });
    await page.mouse.move(1, 1);
    await settle(page);
  },
});

await browser.close();
server.close();
