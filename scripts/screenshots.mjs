// Regenerates the README images from the demo: `npm run screenshots` (needs Chrome or Edge).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { serve } from './serve-demo.mjs';

const docs = fileURLToPath(new URL('../docs/', import.meta.url));
const server = await serve(0);
const url = `http://127.0.0.1:${server.address().port}/demo/`;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });

async function shot(name, { width, height, scale = 2, before }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
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

await browser.close();
server.close();
