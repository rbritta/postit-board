// The notes of one release: its section of CHANGELOG.md (Keep a Changelog). release.yml runs
// `node scripts/release-notes.mjs v1.2.3 > notes.md` and stops when the tag is not the version in
// package.json, or when CHANGELOG.md has no section (or an empty one) for it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The body of `## [version]` in a Keep a Changelog text, trimmed; null when there is none or it is empty. */
export function changelogSection(changelog, version) {
  const lines = String(changelog).replace(/\r\n?/g, '\n').split('\n');
  const head = new RegExp(`^## \\[${escape(String(version))}\\](?:\\s|$)`);
  const start = lines.findIndex((line) => head.test(line));
  if (start < 0) return null;
  const next = lines.findIndex((line, i) => i > start && (/^## /.test(line) || /^\[[^\]]+\]:\s/.test(line)));
  return lines.slice(start + 1, next < 0 ? lines.length : next).join('\n').trim() || null;
}

/** The notes for `tag` (`v1.2.3`), which must name `version`. Throws with the reason when it cannot. */
export function releaseNotes(tag, { changelog, version }) {
  const named = String(tag || '').replace(/^refs\/tags\//, '').replace(/^v/, '');
  if (named !== version) throw new Error(`the tag ${tag || '(none)'} does not name the version in package.json, ${version}`);
  const notes = changelogSection(changelog, version);
  if (!notes) throw new Error(`CHANGELOG.md has no section, or an empty one, for ${version}`);
  return notes;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  try {
    const { version } = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
    const notes = releaseNotes(process.argv[2], { changelog: readFileSync(`${root}CHANGELOG.md`, 'utf8'), version });
    process.stdout.write(`${notes}\n`);
  } catch (err) {
    console.error(`release-notes: ${err.message}`);
    process.exit(1);
  }
}
