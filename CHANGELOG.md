# Changelog

## 0.7.0 (2026-11-14)

Archive and Archived, lanes (a Kanban by state, or columns by category), a richer right-click menu, board settings with tabs, and a phone that shows the urgent notes first. Everything is additive: a board that sets nothing looks and works as before, with Archived next to "+ Note" when the store can list archived notes.

**Archive.** "Archive" is the word everywhere: the ✓ (its tooltip), the menu, the reader. Archiving is the note's `done` flag, so notes done before 0.7.0 are the archived ones.

- The ✓, the menu's Archive (always its last item) and the reader's Archive send the note flying into the Archived button. "Archived “…” · Undo" stays at the bottom for 6 seconds; Undo puts the note back where it was, in its lane. The Archived count pulses.
- A dragged note **lifts off the glass** and follows the pointer anywhere on the screen, over the glass and under the Archive box. Dropped inside the glass it lands there as before; dropped outside it and off the box, it glides back to the nearest place inside, at the edge (at once with reduced motion).
- Drag a written note and an Archive box appears **astride the glass edge**, on the side nearer the note: a third of it over the glass, so the note can touch it, the rest in the margin. As big as a note when the margin has room, smaller (at least 96 px) when it is narrow, else a pill in the bar above the glass, else at the window's edge. It stays put during the drag, and only the pointer on it archives (a note that just overlaps it, or a drop beside it, moves as usual). A big soft blur around it dims what is near and never takes a click or a drop; a balloon says the note leaves the board and stays in Archived.
- On a phone, holding a note opens its menu as a sheet from the bottom; Archive there (or the ✓) brings the box and its blur over the note, and the note sinks in.
- App notes are never archived: no ✓ and no Archive. Dragged, they get the same box, which says Dismiss and dismisses them.
- The gear's View tab has "Show the Archive box while a note is dragged" (on by default; option `archiveBox`).

**App notes: Open → and Dismiss.** An app note has a menu too (right-click, the menu key, a long press on a phone): Open → when it has a link (the same as clicking it), then Dismiss, "Hides it until the app changes it". Dismiss takes it off the board with "Dismissed “…” · Undo"; the board stores a signature of its title, text, due, link and color under its key (`dismissed`) and keeps it hidden while the app sends the same content. When the app changes any of those, it shows again. Dragging an app note brings the same box, saying Dismiss ("Drop here to dismiss", "Release to dismiss"); a drop on it dismisses the note, a drop elsewhere moves it. Archived lists the dismissed app notes the app still sends among the archived notes, by date, with a "Dismissed" chip and Bring back.

**Archived.** A toggle next to "+ Note", with the count (option `archivedButton`; shown when the store has `archived()`). It swaps the notes for a table: the note, its type, its lane (with lanes on), When (an "Archived" or "Dismissed" chip and the date: "Today 9:30 AM", "Thu 18:00", "Nov 4"), Restore and Delete for good (Bring back for a dismissed app note). While an app note is dismissed, "All · Archived · Dismissed" picks which rows show, with the text filter and the legend. A filter field and the legend narrow it, and say so when nothing matches. Restore puts the note back in its lane and place (the first lane when its lane is gone); Delete for good asks in the row and has no Undo. On a phone the rows are cards.

**Lanes,** off by default. The gear's Lanes tab picks Off, States · Kanban or Categories, each with its own list to rename, reorder, add to or remove from (a warning past 5, at most 12). Removing a lane with notes asks where they go (the neighbor by default), with Undo until Save. Every note keeps a value in both modes and its own place in its lane in each, so switching never loses anything. The glass shows columns with each lane's name and count; notes stay free inside a lane, and dragging one to another lane changes its state or category. No note ever sits over the header row: notes start below it, a drop near the top lands below it, the dragged note slides under it, and it sticks to the top when the page scrolls. On a phone, lanes are stacked sections with sticky titles that fold. App notes take their lane from `lane` (an id or a name), else the first.

**The editor starts on the title,** for a new note ("+ Note", "New note here", a lane's) and for Edit (the cursor at the end of the title).

**A title alone** (no text, no image) sits in the middle of the note above its footer and may take up to 4 lines (`--pb-title-only-lines`), on written and app notes.

**The right-click menu:** State ▸ or Category ▸ (with lanes on), Color ▸, Edit, a separator and Archive, last. Each submenu item shows the current value on the right; submenus open on hover, on click and with → (← closes). The empty glass keeps "New note here", saying the lane. On a phone the same menu is a sheet with ‹ Back. Every part works from the keyboard, and the menu key opens a focused note's menu on the note.

**Board settings** (the gear): a 760 px dialog with tabs Types · Lanes · View, every option under a titled group with soft dividers (Long text; Board, with "Lock the board size"; Archive). On a phone it comes up from the bottom at full width, the tabs share the width and Save stays in sight.

**Narrow screens.** Option `narrowOrder`: `'position'` (default, as before) or `'priority'`: overdue first, then due today, then by type in legend order, then by position, written and app notes alike. Option `narrowLimit`: show the first N notes, then "Show N more", which opens the rest in place with a short transition, and "Show less" under them; it stays as people left it until the page reloads. With lanes on, both apply inside each section. The desktop is untouched.

**Dates and times** follow the browser, and the app can say otherwise (unpublished 0.6.0, folded in here):

- Due times read the way the person's browser does: its language, its time zone and its clock. A 12-hour locale now writes `3:30 PM` (it used to be `03:30 PM`); a 24-hour one keeps `15:30`.
- New options `timeZone` and `hour12`, next to `locale`, at creation or with `configure`. `timeZone` decides which day is "Today" as well as the hour; `hour12` forces 12 or 24 hours.
- `dueStatus(due, now, { timeZone })` and `formatDue(due, { locale, timeZone, hour12 })` take them too. A locale or zone the runtime does not know falls back instead of throwing.
- README: a "Dates and times" section with examples.

**API, all additive.**

- Board options `lanes`, `archiveBox`, `archivedButton`, `narrowOrder`, `narrowLimit`; methods `showArchived(on)` and `openSettings(tab)`; getters `lanes`, `archived` and `dismissed`. `reload()` also loads the lanes and the archived list.
- Notes carry `lane: { states?, categories? }` and `lanePos: { states?: { x, y }, categories?: { x, y } }`; app notes take `lane`; app note positions keep `lanePos`, `dismissed` (a signature string of at most 100 characters) and `dismissedAt` by key.
- Stores: new optional `archived()` (in `createSqliteStore`, `restStore`, `localStore`) and `saveLanes(lanes)`; `load()` returns `lanes`; `update(ref, { done: false })` restores. A custom store without `archived()` simply has no Archived button.
- Stores: `update({ key }, { dismissed })` dismisses an app note and sets `dismissedAt` (`null` brings it back and clears both), and `load()` returns them in `positions[key]` (SQLite, `restStore`, `localStore`).
- HTTP: `GET /archived` and `PUT /lanes`; `PATCH /:id` takes `lane` and `lanePos`; `PUT /key/:key` takes `lanePos` and `dismissed` (a string of at most 100 characters, or null; 400 otherwise).
- `onChange` events: new `restore` (an archived note back on the board), `dismiss` (`{ key, dismissed, dismissedAt }`, no note) and `lanes`; `done` is an archive, `remove` a delete for good.
- The SQLite store adds the `lane`, `lane_pos`, `dismissed` and `dismissed_at` columns to a table made by an older version, in place, keeping every row.
- `view` is `{ expand, archiveBox }`. Core: `normalizeLanes`, `normalizeLaneOf`, `normalizeLanePos`, `LANE_MODES`, `LANE_PRESETS`, `fillText`, `formatWhen`, `autoSignature`, `normalizeSignature`.
- Strings: every new word is in `DEFAULT_STRINGS`. `done` became `archive` (an app that set only `done` keeps its word), and `menuColor` is gone (the menu has Color ▸).
- Strings for app notes: `dismiss`, `dismissHint`, `dismissedToast`, `dropDismiss`, `releaseDismiss`, `dismissBalloon`, `bringBack` (and `open`, which already labeled their link). Archived: `archivedChip`, `dismissedChip`, `dismissedTitle`, `filterKind`, `filterAll`, `filterArchivedOnly`, `filterDismissed`; `colWhen` is now "When".
- CSS: new custom properties `--pb-done`, `--pb-accent-soft`, `--pb-line`, `--pb-lane-head`, `--pb-target`, `--pb-halo`, `--pb-sticky-top`, `--pb-title-only-lines`; state classes `pb-note--lifted`, `pb-note--landing`, `pb-note--title-only`; `pb-state` chips and the `pb-seg` filter in Archived. The container is named (`container: pb / inline-size`) and the dialog is one too (`pb-dialog`).
- Demos: Kanban, Categories and Archived pages next to the board, reachable from each other, with a "Phone width" switch and the phone order and fold in their header. `npm run screenshots` makes the new images.

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
