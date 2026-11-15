// How the browser tests get a browser and a context, the same way on every machine.
//
// The browser is an installed Chrome, driven headless through playwright-core: PW_CHANNEL=msedge picks
// Edge, PW_EXECUTABLE=/path picks any Chromium. When none starts, the browser tests are skipped with
// the reason, printed once; with PW_REQUIRE=1 (CI sets it) they fail instead, so a run never passes by
// skipping them.
//
// Every context speaks en-US, lives in UTC and sees the same moment (NOW, a fixed Date.now() while
// timers keep running), whatever the machine's language, time zone and clock. Node's own zone is UTC
// too, so a date a test builds in Node means the same moment in the page.
process.env.TZ = 'UTC';

export const LOCALE = 'en-US';
export const TIME_ZONE = 'UTC';
export const NOW = new Date('2026-11-14T12:00:00Z');

/** `{ browser, skip }`: the browser, or null and the reason to give `t.skip()`. */
export async function launch() {
  try {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : { channel: process.env.PW_CHANNEL || 'chrome' }),
    });
    return { browser, skip: null };
  } catch (err) {
    const why = String(err?.message ?? err).split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 200);
    const skip = `no browser (${why}): install Chrome, or set PW_CHANNEL=msedge or PW_EXECUTABLE=/path`;
    if (process.env.PW_REQUIRE === '1') throw new Error(`PW_REQUIRE=1 and ${skip}`);
    console.log(`# browser tests skipped: ${skip}`);
    return { browser: null, skip };
  }
}

/** A context with the pinned language, time zone and clock; `options` may set others (`now: false` keeps the real clock). */
export async function newContext(browser, { now = NOW, ...options } = {}) {
  const ctx = await browser.newContext({ locale: LOCALE, timezoneId: TIME_ZONE, ...options });
  if (now) await ctx.clock.setFixedTime(now);
  return ctx;
}
