# postit-board for AI agents

Read this before adding the board to an app or changing the library.

## Adding the board to an app

1. **Pick the store.** Server with a database: `createSqliteStore(db)` + `createHttpHandler(store)` on the server and `restStore(prefix)` in the browser. One browser only: `localStore(name)`. Existing tables or an API of your own: implement `{ load(), create(draft), update(ref, patch), saveLegend?(legend) }` (shapes below). Without `saveLegend` the gear is hidden.
2. **Put the handler behind the app's own auth and CSRF.** It has none. With a CSRF header, pass `restStore(prefix, { headers: () => ({ 'x-csrf-token': token }) })`.
3. **Write the legend with meanings, not color names.** Each entry is `{ color, label, description }`. Keep it short (5 to 7 colors). The same color should mean the same thing everywhere in the app. Mark the types your app notes use with `locked: true`: people can rename them but not recolor or remove them.
4. **Compute app notes on every render** from the app's own data and pass them as `auto`. Give each one a stable `key` (`'disk:/dev/sda'`, not an index). When the problem is solved, stop sending it: that is how it disappears. Never write app notes to the store.
5. **Due times:** run `watchDue(store, { onDue })` once per process on the server. `onDue` must throw if delivery failed, so it rings again on the next tick.
6. **Translate** with `strings` and `locale`. Every visible word lives in `DEFAULT_STRINGS`.

Use the CSS from `src/` (ESM) or `dist/` (script tag). Never copy the library code into an app: depend on it.

## Shapes

```js
// a written note, as the store returns it
{ id, title, text, color, x /* 0..1 of the width */, y /* px */, z, due /* ISO */, link, linkLabel, image, meta, createdAt, updatedAt, doneAt }
// an app note, as you pass it in `auto`
{ key, title, text, color, link, linkLabel, image, due }
// store.load()
{ notes: [/* open written notes */], positions: { [key]: { x, y, z } }, legend /* only once someone edited the types */ }
// store.saveLegend(legend) -> { legend }; legend items are { color, label, description?, hex?, locked? }
// store.update(ref, patch): ref is { id } or { key }; patch has any note field, or done: true, or removed: true
```

## Changing the library

- `src/core.js` holds every rule that has no DOM: validation, layout, dates, escaping. Test it there (`test/core.test.js`).
- `src/postit-board.js` is the DOM: rendering, dialogs, right-click menu, drag, keyboard. Its behavior is covered by `test/board.browser.test.js` (real Chrome through playwright-core).
- `server/` is Node only and must keep working with both `node:sqlite` and better-sqlite3 (only `exec` and `prepare().run/get/all`). The legend lives in `<table>_settings`.
- `onChange` events with `type: 'legend'` have no `note`: handlers that read `event.note` must check the type first.
- No runtime dependencies. No build step for ESM users. After changing `src/`, run `npm run build` and commit `dist/`.
- Everything rendered is escaped with `escapeHtml` or `linkify`. URLs go through `safeUrl`. Keep it that way.
- Run `npm test` before committing. If the look changed, run `npm run screenshots` and commit `docs/`.
