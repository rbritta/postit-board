/**
 * The HTTP routes that `restStore()` in the browser talks to, for plain `node:http`
 * (or anything with the same req/res, like Express).
 *
 *   const handle = createHttpHandler(store, { prefix: '/api/postits' });
 *   http.createServer(async (req, res) => {
 *     if (await handle(req, res)) return;    // true when it answered
 *     ...your other routes
 *   });
 *
 *   GET    /api/postits              -> { notes, positions }
 *   POST   /api/postits              -> the new note
 *   PATCH  /api/postits/:id          -> the note (fields, { done: true } or { removed: true })
 *   PUT    /api/postits/key/:key     -> position of an automatic note { x, y, z }
 *
 * Authentication and CSRF are yours: run your checks before calling `handle`.
 */
const MAX_BODY = 64 * 1024;

function readJson(req) {
  if (req.body !== undefined) return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body);
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch {
        reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

export function createHttpHandler(store, { prefix = '/api/postits' } = {}) {
  const base = prefix.replace(/\/$/, '');
  return async function handle(req, res) {
    const path = new URL(req.url, 'http://x').pathname;
    if (path !== base && !path.startsWith(`${base}/`)) return false;
    const rest = path.slice(base.length);
    try {
      if (rest === '' && req.method === 'GET') return send(res, 200, await store.load()), true;
      if (rest === '' && req.method === 'POST') return send(res, 201, await store.create(await readJson(req))), true;
      let m = rest.match(/^\/(\d+)$/);
      if (m && req.method === 'PATCH') return send(res, 200, await store.update({ id: Number(m[1]) }, await readJson(req))), true;
      m = rest.match(/^\/key\/([^/]+)$/);
      if (m && req.method === 'PUT') return send(res, 200, await store.update({ key: decodeURIComponent(m[1]) }, await readJson(req))), true;
      send(res, 404, { error: 'not found' });
    } catch (err) {
      send(res, err.status || 500, { error: err.status ? err.message : 'internal error' });
      if (!err.status) console.error('[postit-board]', err);
    }
    return true;
  };
}
