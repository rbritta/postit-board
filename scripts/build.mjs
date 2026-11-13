// Builds dist/postit-board.global.js (a classic <script> that defines window.PostitBoard)
// and copies the stylesheet. No bundler: the two source modules are small and flat.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(await readFile(`${root}package.json`, 'utf8'));
const core = await readFile(`${root}src/core.js`, 'utf8');
const board = await readFile(`${root}src/postit-board.js`, 'utf8');

const coreNames = [...core.matchAll(/^export (?:const|function|class) (\w+)/gm)].map((m) => m[1]);
const boardNames = [...board.matchAll(/^export (?:const|function|class) (\w+)/gm)].map((m) => m[1]);

const strip = (src) => src.split(String.fromCharCode(13)).join("")
  .replace(/^import[\s\S]*?from '[^']+';\n/gm, '')
  .replace(/^export \* from '[^']+';\n/gm, '')
  .replace(/^export default \w+;\n/gm, '')
  .replace(/^export (const|function|class) /gm, '$1 ');

const out = `/*! postit-board v${pkg.version} | MIT | ${pkg.homepage} */
(function (global) {
'use strict';
${strip(core)}
${strip(board)}
global.PostitBoard = { ${[...boardNames, ...coreNames].join(', ')} };
})(typeof globalThis !== 'undefined' ? globalThis : window);
`;

await mkdir(`${root}dist`, { recursive: true });
await writeFile(`${root}dist/postit-board.global.js`, out);
await copyFile(`${root}src/postit-board.css`, `${root}dist/postit-board.css`);
console.log(`dist/postit-board.global.js (${(out.length / 1024).toFixed(1)} kB), dist/postit-board.css`);
