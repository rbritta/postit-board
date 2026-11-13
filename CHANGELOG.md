# Changelog

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
