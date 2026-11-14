# Changelog

## 0.5.0 (2026-11-13)

Long text opens and closes with smooth transitions, in all three ways:

- **Center.** The note grows out of its own place on the board (keeping its tilt and color on the way) into the reader in the middle of the screen; the words fade in as it lands and the backdrop fades in behind it. Esc, a click outside, × and Done play it back into the note. A note scrolled out of sight, or gone while it was open, fades and scales instead. The note itself takes the focus, so a screen reader starts reading it.
- **In place.** Hovering a cut note, or reaching it with Tab, grows it to its whole text with a height animation; it shrinks back when the mouse or the focus leaves, and the "…" returns at the end. The board grows with it near the bottom instead of cutting it off.
- **More.** The link reveals the rest the same way, and "less" rolls it back.
- 240 ms in, a little faster (180 ms) out, set with `--pb-motion-in` and `--pb-motion-out`. With reduced motion everything changes at once. A drag never opens or animates the notes it passes over, and it measures the page once, when it starts.

Fixes from a review of the whole library:

- **Strict CSP.** Colors and positions are set through the CSSOM instead of `style` attributes, which a strict Content-Security-Policy drops (notes ended up unplaced and gray).
- **Focus and keyboard.** After a dialog, the menu or a redraw, the focus goes back to the note or button it came from instead of falling to the page. Moving one note with the arrows and then another no longer loses the first move; the arrows keep the note inside the glass and grow the board. The menu reads as radio items with the current type checked; Home, End and Tab work, and Esc gives the focus back to the note.
- **Pointer.** A drag or a right-click on a scrolled board of fixed height lands under the pointer (it was off by the scroll), and a new note starts exactly at the click (it was 1 px off).
- **Data during a drag.** `update()` and `reload()` during a drag are drawn when it ends; before, they waited for the next change.
- **Failures.** When the store fails, a note marked done or deleted comes back (`postit-error` fires, as before). A note dragged before the store answered its creation keeps where it was dragged.
- **The gear saves only what changed.** Saving only "Long text" or the lock no longer freezes the types over the ones the app ships.
- **`configure()`** applies `strings` (the bar and "+ Note" too), `addButton`, `size`, `view`, `expand`, `width` and `resizable`. **`destroy()`** removes every listener and leaves the element clean, after saving moves typed with the arrows.
- **Due times** change from Tomorrow to Today to late in place, without redrawing the board every minute (which closed whatever was open). They use the browser's language when `locale` is not set, as the README says (they were always English).
- **Narrow to wide.** A board first drawn as a phone grid flows its notes into columns when the window gets wide, instead of leaving them on top of each other. On a phone the empty message spans the glass.
- **Look.** Links on notes and in the reader have no underline and turn #6e7681 on hover (`--pb-link`, `--pb-link-hover`), the "more" link too. ✎ and ✓ stay together on the right when a due time leaves no room (the ✓ used to wrap alone), and so do Edit and Done in the reader; only app notes keep room for the folded corner. The hover tilt only where there is a real hover (it stuck after a tap), and no tap flash on touch screens. The menu scrolls when there are many types.
- **CSS.** The class `pb-lock` is no longer styled as two things at once; the dialogs and the menu share `--pb-surface` and `--pb-surface-fg`; boxes and dots in forms lose the text field's border and background.
- **Accessibility.** A note without a title gives the reader a name; an empty board is not an empty list; the legend is a group, not the page's footer landmark.
- **Links.** `safeUrl` (and so the server) refuses `/\host` and URLs with tabs or line breaks, which browsers read as another site.
- **`localStore`** keeps `createdAt` and `meta` when a note is edited, sets `updatedAt`, and `done: false` reopens a note.
- **Server.** A body over 64 kB gets a 413 (the connection was reset before); a body that is not a JSON object, or a malformed key, gets a 400 (it was a 500). The SQLite store refuses a note or a patch that is not an object.
- `npm run screenshots` makes every README image (the menu and the gear were missing) plus the reader.
- A note made on a phone (where the board is a grid and a note has no place yet) is saved again through the HTTP handler: the board leaves x and y out, and the SQLite store takes them as null instead of answering 400.

New, all additive: CSS custom properties `--pb-motion-in`, `--pb-motion-out`, `--pb-link`, `--pb-link-hover`, `--pb-surface`, `--pb-surface-fg`; state classes `pb-note--closing`, `pb-note--reading`, `pb-dialog--closing` and the wrapper `pb-tools` around ✎ ✓.

## 0.4.1 (2026-11-13)

- The gear dialog looks right again: the "Long text" choices and "Lock the board size" sit on one line each, box or dot on the left, the "Long text" ones indented under their heading, under a divider below the types, and "Lock the board size" gets its own section under another divider, with one more above the buttons. The form-field rule had stacked them and centered them.
- Save reads well in the dark theme (dark text on the accent, `--pb-accent-ink`), and the dialog is a little wider so the descriptions fit. On a phone the types are spaced apart.

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
