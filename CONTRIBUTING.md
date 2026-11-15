# Contributing to postit-board

Thanks for helping. Bug reports, fixes and ideas are all welcome. For a large change, open an issue first so we can agree on the shape before you write the code; the [roadmap](TODO.md) lists what is already planned.

## Set up

You need Node 22.5 or newer (the server tests use `node:sqlite`) and, for the browser tests, an installed Chrome or Edge.

```sh
git clone https://github.com/rbritta/postit-board.git
cd postit-board
npm ci               # only playwright-core, for the browser tests and screenshots
```

## Run the tests

```sh
npm test             # unit, server and browser tests
npm run test:coverage   # the same, with a coverage summary of the DOM-free code
```

The browser tests drive an installed Chrome, headless, through playwright-core (`test/browser.js`). Set `PW_CHANNEL=msedge` to use Edge, or `PW_EXECUTABLE=/path/to/chrome` for another Chromium. Without a browser they are skipped and the reason is printed; CI sets `PW_REQUIRE=1`, so there a missing browser fails the run. Every page runs in en-US, in UTC and at a fixed moment, so the results do not depend on the machine.

Tests never touch the network or real data: the server tests use an in-memory SQLite database, and the browser tests a local server for the demo.

## Run the demo

```sh
npm run demo         # http://localhost:5178/demo/ (and kanban.html, categories.html, archived.html)
```

The demo pages run under a strict Content-Security-Policy, with no inline script; a browser test loads each of them and fails on any console error. Their notes are made up and live in `demo/demo.js`. Keep it that way: no real names, notes or numbers.

## Build

```sh
npm run build        # dist/
npm run screenshots  # docs/*.png, from the demo
```

`dist/` is committed, because script-tag users take it straight from the repository. After changing `src/`, run the build and commit `dist/` with the change; CI fails when it is stale. If the look changed, regenerate the screenshots too.

## Commits

One change per commit, with a message that says in plain English what changed and why it matters, in one short line (more below it when needed). A release commit starts with the version, as in `0.7.1: ...`.

## Pull requests

A pull request needs:

- tests for the new behavior, and, for a bug fix, a test that fails without the fix;
- `npm test` passing;
- a line in `CHANGELOG.md` under `Unreleased`;
- the README and `AGENTS.md` updated when the API, an option or the behavior changes;
- `dist/` rebuilt when `src/` changed;
- no new runtime dependency.

[AGENTS.md](AGENTS.md) lists the rules the code keeps (escaping, the CSP, app notes, the stores); they apply to people too.

## Releases

For maintainers: move the `Unreleased` notes into a new dated section of `CHANGELOG.md`, bump `version` in `package.json` (and `package-lock.json`), run `npm run build`, commit, then tag `vX.Y.Z` and push the tag. `release.yml` runs the tests and creates the GitHub Release with that section as its notes and the `npm pack` tarball attached. Nothing is published to npm.
