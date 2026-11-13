# Changelog

## 0.4.0 (2026-11-13)

- Read a cut note whole. By default a click opens it big in the center of the screen, with its link, Edit and Done. Esc or a click outside closes it, and the end of a drag never opens it.
- Two more ways, picked in the gear and saved with `store.saveView` (`PUT /view`): the note grows in place on hover (a tap on touch screens), or a "more" link appears on notes whose text is cut.
- New: option `expand` (`'center'`, `'inplace'` or `'more'`), option `view`, `normalizeView`, `EXPAND`, `board.view` and `board.openNote(ref)`.

## 0.3.0 (2026-11-13)

- Resize the board from either bottom corner. It stays centered, keeps a minimum of 480 × 320 px and is saved with `store.saveSize` (`PUT /size`, `<table>_settings`, `localStore`). Double-click a corner to go back to the default.
- By default the board takes 80% of the width (option `width`), leaving 10% on each side.
- The gear has "Lock the board size", which hides the corners.
- New: `normalizeSize`, `SIZE`, the `size` option (start with a saved size and skip a reload) and the `board.size` getter. Option `resizable: false` turns it off.

## 0.2.2 (2026-11-13)

- Wide screens get more columns: notes nobody placed flow into as many 220 px columns as fit (never fewer than four), and reflow when the window changes width.
- The demo uses the whole width.

## 0.2.1 (2026-11-13)

- Smaller notes: long titles stop at 2 lines and long text at 4, ending in "…". The full text is in the tooltip and in Edit. Tune with `--pb-title-lines` / `--pb-text-lines` (`none` shows everything).
- Minimum note height 180 → 140 px (120 px in the narrow list).

## 0.2.0 (2026-11-13)

- Right-click the glass: a menu of the note types (with their meanings) creates a note exactly where you clicked. Double-click lands there too now.
- Right-click a written note: change its type, edit it or mark it done. App notes keep the browser menu; Shift + right-click always does.
- Gear at the end of the legend: rename, describe, recolor, add, reorder and remove note types. `locked` types (the app's) only rename. Saved with `store.saveLegend` (`PUT /legend`, `<table>_settings`, `localStore`), merged over the app's legend with `mergeLegend`.
- The note touched last stays on top after a reload, also for app notes. Raising an app note no longer drops its position in `localStore`.
- New helpers: `normalizeLegend`, `mergeLegend`, `legendColors`, `isHex`.

## 0.1.0 (2026-11-13)

First release, extracted from a home-lab dashboard where it ran as the home screen of a 3D printing app.

- Board with written notes and app notes, color legend with filters, due times, images, links.
- Grid layout on narrow screens, keyboard moving and editing.
- `restStore`, `localStore`, SQLite store, HTTP handler and `watchDue` for Node.
