// The release notes come from CHANGELOG.md, and the CHANGELOG keeps the shape release.yml relies on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { changelogSection, releaseNotes } from '../scripts/release-notes.mjs';

const root = new URL('..', import.meta.url);
const changelog = readFileSync(new URL('CHANGELOG.md', root), 'utf8');
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

const SAMPLE = `# Changelog

## [Unreleased]

## [1.2.0] - 2026-01-02

### Added

- A thing.

## [1.1.0] - 2026-01-01

- An older thing.

[Unreleased]: https://example.com/compare/v1.2.0...HEAD
[1.2.0]: https://example.com/releases/tag/v1.2.0
`;

test('a section runs from its heading to the next one, trimmed', () => {
  assert.equal(changelogSection(SAMPLE, '1.2.0'), '### Added\n\n- A thing.');
  assert.equal(changelogSection(SAMPLE.replace(/\n/g, '\r\n'), '1.2.0'), '### Added\n\n- A thing.', 'CRLF too');
});

test('the last section stops at the link references', () => {
  assert.equal(changelogSection(SAMPLE, '1.1.0'), '- An older thing.');
});

test('no section, an empty one, or a version that only looks alike: null', () => {
  assert.equal(changelogSection(SAMPLE, '9.9.9'), null);
  assert.equal(changelogSection(SAMPLE, 'Unreleased'), null);
  assert.equal(changelogSection(SAMPLE, '1.2'), null);
  assert.equal(changelogSection(SAMPLE, '1x2.0'), null, 'the dots are not wildcards');
});

test('the tag must name the version in package.json', () => {
  assert.equal(releaseNotes('v1.2.0', { changelog: SAMPLE, version: '1.2.0' }), '### Added\n\n- A thing.');
  assert.equal(releaseNotes('refs/tags/v1.2.0', { changelog: SAMPLE, version: '1.2.0' }), '### Added\n\n- A thing.');
  assert.throws(() => releaseNotes('v1.1.0', { changelog: SAMPLE, version: '1.2.0' }), /does not name the version in package.json, 1\.2\.0/);
  assert.throws(() => releaseNotes(undefined, { changelog: SAMPLE, version: '1.2.0' }), /\(none\)/);
  assert.throws(() => releaseNotes('v9.9.9', { changelog: SAMPLE, version: '9.9.9' }), /no section, or an empty one, for 9\.9\.9/);
});

test('CHANGELOG.md: Unreleased on top, then a dated section for the version in package.json', () => {
  const headings = changelog.split('\n').filter((line) => line.startsWith('## '));
  assert.equal(headings[0], '## [Unreleased]');
  assert.match(headings[1], new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`));
  assert.ok(releaseNotes(`v${version}`, { changelog, version }).length > 0);
});

test('the command prints the notes of the tag, or says why it cannot and exits 1', () => {
  const run = (tag) => spawnSync(process.execPath, [fileURLToPath(new URL('scripts/release-notes.mjs', root)), tag], { encoding: 'utf8' });
  const ok = run(`v${version}`);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, `${releaseNotes(`v${version}`, { changelog, version })}\n`);
  const bad = run('v0.0.0');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^release-notes: the tag v0\.0\.0 does not name the version/);
});
