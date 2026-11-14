# postit-board for AI agents

Read this before adding the board to an app or changing the library.

## Adding the board to an app

1. **Pick the store.** Server with a database: `createSqliteStore(db)` + `createHttpHandler(store)` on the server and `restStore(prefix)` in the browser. One browser only: `localStore(name)`. Existing tables or an API of your own: implement `{ load(), create(draft), update(ref, patch), archived?(), saveLegend?(legend), saveLanes?(lanes), saveSize?(size), saveView?(view) }` (shapes below). Without `saveLegend` the gear is hidden; without `archived` the Archived button is.
2. **Put the handler behind the app's own auth and CSRF.** It has none. With a CSRF header, pass `restStore(prefix, { headers: () => ({ 'x-csrf-token': token }) })`.
3. **Write the legend with meanings, not color names.** Each entry is `{ color, label, description }`. Keep it short (5 to 7 colors). The same color should mean the same thing everywhere in the app. Mark the types your app notes use with `locked: true`: people can rename them but not recolor or remove them.
4. **Compute app notes on every render** from the app's own data and pass them as `auto`. Give each one a stable `key` (`'disk:/dev/sda'`, not an index). When the problem is solved, stop sending it: that is how it disappears. Never write app notes to the store, and never archive them (the board doesn't let people). With lanes, give them a `lane` (an id or a name). People can **Dismiss** one from its menu: the board stores a signature of its title, text, due, link and color under its key (`update({ key }, { dismissed })`) and hides it until one of those changes. A wrapper between the board and your store must pass `{ key }` updates through as they are, `dismissed` included.
5. **Lanes are off by default.** Turn them on with `lanes: { mode: 'states' }` (a Kanban) or `{ mode: 'categories' }`, with your own lists if the presets don't fit. People change them in the gear, and what they save wins.
6. **Due times:** run `watchDue(store, { onDue })` once per process on the server. `onDue` must throw if delivery failed, so it rings again on the next tick.
7. **Translate** with `strings`, `locale`, `timeZone` and `hour12`. Every visible word lives in `DEFAULT_STRINGS`; `{n}`, `{title}` and `{lane}` in a string are filled in.
8. **Phones:** for a home screen, `narrowOrder: 'priority'` and a `narrowLimit` put the urgent notes first and fold the rest.

Use the CSS from `src/` (ESM) or `dist/` (script tag). Never copy the library code into an app: depend on it.

## Shapes

```js
// a written note, as the store returns it; doneAt set = archived
{ id, title, text, color, x /* 0..1 of the width */, y /* px */, z, due /* ISO */, link, linkLabel, image, meta,
  lane /* { states?, categories? } lane ids, or null */, lanePos /* { states?: { x 0..1 of the lane, y px }, categories?: {…} } or null */,
  createdAt, updatedAt, doneAt }
// an app note, as you pass it in `auto`; lane: a lane id or name (both modes), or { states, categories }
{ key, title, text, color, link, linkLabel, image, due, lane }
// store.load()
{ notes: [/* open written notes */], positions: { [key]: { x, y, z, lanePos?, dismissed? /* signature string, ≤ 100 chars */, dismissedAt? /* ISO, set by the store */ } },
  legend, lanes, size, view /* each only once someone saved it */ }
// store.archived() -> { notes } (or a plain list): archived notes, the last archived first
// store.saveLegend(legend) -> { legend }; legend items are { color, label, description?, hex?, locked? }
// store.saveLanes(lanes) -> { lanes }; lanes is { mode: 'off' | 'states' | 'categories', states?: [{ id, name }], categories?: [{ id, name }] }
// store.saveView(view) -> { view }; view is { expand, archiveBox }
// store.update(ref, patch): ref is { id } or { key }; patch has any note field (lane, lanePos too),
//   or done: true (archive), done: false (restore), removed: true (delete for good)
// store.update({ key }, { dismissed: 's1:…' }) dismisses an app note and sets dismissedAt; { dismissed: null } brings it back and clears both
//   (autoSignature(note) makes the signature)
// HTTP (createHttpHandler): GET / · GET /archived · POST / · PATCH /:id · PUT /key/:key · PUT /legend · PUT /lanes · PUT /size · PUT /view
// onChange events (createSqliteStore): { type: 'create' | 'update' | 'done' | 'restore' | 'remove', note, before?, patch? },
//   { type: 'dismiss', key, dismissed /* or null */, dismissedAt } and { type: 'legend' | 'lanes' | 'size' | 'view', [type]: value }, both without a note
```

## Changing the library

- `src/core.js` holds every rule that has no DOM: validation, layout, dates, escaping. Test it there (`test/core.test.js`).
- `src/postit-board.js` is the DOM: rendering, dialogs, right-click menu, drag, keyboard. Its behavior is covered by `test/board.browser.test.js` (real Chrome through playwright-core).
- `src/postit-board.js` is also covered by `test/archive-lanes.browser.test.js`: Archive and Archived, lanes, the menu, the settings tabs, the phone (360 px), narrowOrder / narrowLimit, app notes (Open, Dismiss, Bring back), the lifted drag, a title alone and the editor's first field.
- `server/` is Node only and must keep working with both `node:sqlite` and better-sqlite3 (only `exec` and `prepare().run/get/all`). The legend, the lanes, the size and the view live in `<table>_settings`. A column added to the notes table goes in `ADDED` too, so tables made by older versions get it in place (`ALTER TABLE ADD COLUMN`).
- `onChange` events with `type: 'legend'`, `'lanes'`, `'size'`, `'view'` or `'dismiss'` have no `note`: handlers that read `event.note` must check the type first.
- A dragged note is lifted: on the first move a fixed copy (`pb-note--lifted`, built from what pointerdown measured) follows the pointer anywhere, over the glass and under the Archive box, while the note waits hidden in the glass with the pointer capture. On the drop the copy glides to where the note now is (`land()`, `duration('out')`, at once with reduced motion); a drop outside the glass and off the box comes back to the nearest place inside, at the edge.
- The Archive box sits astride the glass edge in a side margin, a third of its width over the glass, so a note dragged to the edge touches it; the bar pill and the window-edge dock stay off the glass. Only the pointer on it archives. Its halo, box and balloon never take the pointer.
- App notes are the app's: their menu has only Open → (their link) and Dismiss, and the box they get when dragged dismisses them (same box, words `dismiss`, `dropDismiss`, `releaseDismiss`, `dismissBalloon`). A dismissed one is kept out of `auto` while `autoSignature(note)` equals `positions[key].dismissed`; Archived lists it among the archived notes by `dismissedAt`, with a Dismissed chip, Bring back and the All · Archived · Dismissed filter.
- With lanes, nothing may sit over the header row: notes start at 56 px, drops land at 56 px or below, and the header row is above every note.
- No runtime dependencies. No build step for ESM users. After changing `src/`, run `npm run build` and commit `dist/`.
- Everything rendered is escaped with `escapeHtml` or `linkify`. URLs go through `safeUrl`. Keep it that way.
- No `style` attribute in markup and no inline handlers: a strict CSP drops them. Render the HTML, then set custom properties with `el.style.setProperty` (`paintNote`, `paintSwatches`). A browser test loads the board under such a CSP.
- Transitions take their length from `duration('in' | 'out')` (the `--pb-motion-*` properties, 0 with reduced motion) and must work with 0. A drag measures at pointerdown and only writes while it moves. Redraws go through `requestRender()`, which waits for a drag or a resize to end.
- Run `npm test` before committing. If the look changed, run `npm run screenshots` and commit `docs/`.
