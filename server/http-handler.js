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
 *   GET    /api/postits              -> { notes, positions, legend?, size?, view? }
 *   POST   /api/postits              -> the new note
 *   PATCH  /api/postits/:id          -> the note (fields, { done: true } or { removed: true })
 *   PUT    /api/postits/key/:key     -> position of an automatic note { x, y, z }
 *   PUT    /api/postits/legend       -> { legend } edited with the gear
 *   PUT    /api/postits/size         -> { size } chosen by dragging the corners
 *   PUT    /api/postits/view         -> { view } how cut text opens (gear)
 *
 * Bodies are JSON objects of at most 64 kB. Authentication and CSRF are yours: run your checks
 * before calling `handle`.
 */
const MAX_BODY = 64 * 1024;

const httpError = (status, message) => Object.assign(new Error(message), { status });
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function parse(text) {
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { throw httpError(400, 'invalid JSON'); }
  if (!isObject(body)) throw httpError(400, 'the body must be a JSON object');
  return body;
}

function readJson(req) {
  // a framework may have read the body already (Express with express.json(), for one)
  if (req.body !== undefined) {
    try {
      const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
      const body = typeof raw === 'string' ? parse(raw) : raw;
      if (!isObject(body)) throw httpError(400, 'the body must be a JSON object');
      return Promise.resolve(body);
    } catch (err) { return Promise.reject(err); }
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const onData = (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY) { chunks.push(chunk); return; }
      // stop collecting, answer 413 and close the connection after it (see send): the client gets the
      // answer instead of a reset socket
      req.off('data', onData);
      req.off('end', onEnd);
      reject(Object.assign(httpError(413, 'body too large'), { close: true }));
    };
    const onEnd = () => {
      try { resolve(parse(Buffer.concat(chunks).toString('utf8'))); } catch (err) { reject(err); }
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', reject);
  });
}

function send(res, status, data, { close = false } = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(close ? { connection: 'close' } : {}) });
  res.end(JSON.stringify(data));
}

function decodeKey(raw) {
  try { return decodeURIComponent(raw); } catch { throw httpError(400, 'invalid key'); }
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
      if (rest === '/legend' && req.method === 'PUT' && store.saveLegend) return send(res, 200, await store.saveLegend((await readJson(req)).legend)), true;
      if (rest === '/size' && req.method === 'PUT' && store.saveSize) return send(res, 200, await store.saveSize((await readJson(req)).size)), true;
      if (rest === '/view' && req.method === 'PUT' && store.saveView) return send(res, 200, await store.saveView((await readJson(req)).view)), true;
      let m = rest.match(/^\/(\d+)$/);
      if (m && req.method === 'PATCH') return send(res, 200, await store.update({ id: Number(m[1]) }, await readJson(req))), true;
      m = rest.match(/^\/key\/([^/]+)$/);
      if (m && req.method === 'PUT') return send(res, 200, await store.update({ key: decodeKey(m[1]) }, await readJson(req))), true;
      send(res, 404, { error: 'not found' });
    } catch (err) {
      send(res, err.status || 500, { error: err.status ? err.message : 'internal error' }, { close: err.close });
      if (!err.status) console.error('[postit-board]', err);
    }
    return true;
  };
}
