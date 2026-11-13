/**
 * postit-board: a glass board of sticky notes with a color legend.
 *
 *   const board = createBoard(element, { legend, notes, auto, store });
 *   board.update({ notes, auto });   // after your data changes
 *   board.destroy();
 *
 * Two kinds of notes live together:
 *   - notes people write (`notes`): editable, a ✓ marks them done;
 *   - automatic notes your app computes (`auto`): folded corner, read-only, they go away
 *     when your app stops sending them. Only their position is stored, by `key`.
 *
 * The board never talks to a server by itself: every change goes through `store`
 * (see `restStore` for the matching HTTP client, and `server/` for the Node side).
 */
import {
  DEFAULT_COLORS, autoPlace, boardHeight, dueStatus, escapeHtml, formatDue, fromLocalInput,
  linkify, normalizeNote, refId, refOf, safeUrl, tilt, toLocalInput, withPositions,
} from './core.js';

export * from './core.js';

export const DEFAULT_STRINGS = Object.freeze({
  add: '+ Note',
  empty: 'Nothing on the board.',
  hint: 'Drag notes around · folded corners are added and removed by the app',
  open: 'Open →',
  edit: 'Edit',
  done: 'Done',
  newNote: 'New note',
  editNote: 'Note',
  title: 'Title',
  text: 'Text',
  color: 'Color',
  due: 'Due',
  link: 'Link',
  linkLabel: 'Link label',
  image: 'Image URL',
  save: 'Save',
  cancel: 'Cancel',
  remove: 'Delete',
  legend: 'Legend',
  filter: 'Show only this color',
  today: 'Today',
  tomorrow: 'Tomorrow',
  yesterday: 'Yesterday',
  failed: 'Could not save',
});

const DEFAULTS = {
  legend: [],
  notes: [],
  auto: [],
  positions: {},
  colors: {},
  strings: {},
  locale: undefined,
  store: null,
  addButton: true,
  defaultColor: null,
  gridBelow: 700,
  onError: (err) => console.error('[postit-board]', err),
  now: () => new Date(),
};

let uid = 0;

/** A fetch-based store for the routes in `server/http-handler.js`. */
export function restStore(base, { headers = {}, fetch: doFetch = globalThis.fetch.bind(globalThis) } = {}) {
  const root = base.replace(/\/$/, '');
  const call = async (method, path, body) => {
    const res = await doFetch(root + path, {
      method,
      headers: { 'content-type': 'application/json', ...(typeof headers === 'function' ? headers() : headers) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${method} ${path}: ${res.status}`);
    return data;
  };
  return {
    load: () => call('GET', ''),
    create: (draft) => call('POST', '', draft),
    update: (ref, patch) =>
      ref.key != null ? call('PUT', `/key/${encodeURIComponent(ref.key)}`, patch) : call('PATCH', `/${ref.id}`, patch),
  };
}

/** A store in localStorage: for demos, prototypes and boards that live in one browser. */
export function localStore(name = 'postit-board', storage = globalThis.localStorage) {
  const read = () => {
    try { return { notes: [], positions: {}, next: 1, ...JSON.parse(storage.getItem(name) || '{}') }; } catch { return { notes: [], positions: {}, next: 1 }; }
  };
  const write = (data) => storage.setItem(name, JSON.stringify(data));
  return {
    load: () => { const d = read(); return { notes: d.notes.filter((n) => !n.doneAt), positions: d.positions }; },
    create(draft) {
      const d = read();
      const note = { ...normalizeNote({ ...draft, id: d.next }), createdAt: new Date().toISOString() };
      d.notes.push(note);
      d.next += 1;
      write(d);
      return note;
    },
    update(ref, patch) {
      const d = read();
      if (ref.key != null) {
        d.positions[ref.key] = { x: patch.x, y: patch.y, z: patch.z };
        write(d);
        return { key: ref.key, ...d.positions[ref.key] };
      }
      const i = d.notes.findIndex((n) => n.id === ref.id);
      if (i < 0) throw new Error('note not found');
      if (patch.removed) { d.notes.splice(i, 1); write(d); return null; }
      const { done, removed: _removed, ...fields } = patch;
      d.notes[i] = { ...normalizeNote({ ...d.notes[i], ...fields }), doneAt: done ? new Date().toISOString() : d.notes[i].doneAt };
      write(d);
      return d.notes[i];
    },
  };
}

export function createBoard(root, options = {}) {
  if (!root) throw new Error('createBoard needs an element');
  const id = `pb${++uid}`;
  let opts = { ...DEFAULTS, ...options };
  let t = { ...DEFAULT_STRINGS, ...opts.strings };
  let colors = { ...DEFAULT_COLORS, ...opts.colors };
  let notes = [];
  let auto = [];
  let rawAuto = [];
  let positions = { ...opts.positions };
  const hidden = new Set();
  let drag = null;

  root.classList.add('pb');
  root.innerHTML = `
    <div class="pb-bar">
      <span class="pb-hint">${escapeHtml(t.hint)}</span>
      ${opts.addButton ? `<button type="button" class="pb-btn" data-pb="add">${escapeHtml(t.add)}</button>` : ''}
    </div>
    <div class="pb-glass" role="list"></div>
    <footer class="pb-legend" aria-label="${escapeHtml(t.legend)}"></footer>
    <dialog class="pb-dialog" aria-labelledby="${id}-h"></dialog>`;
  const glass = root.querySelector('.pb-glass');
  const legendEl = root.querySelector('.pb-legend');
  const dialog = root.querySelector('.pb-dialog');

  const isGrid = () => root.clientWidth > 0 && root.clientWidth < opts.gridBelow;
  const all = () => [...auto, ...notes];
  const find = (ref) => all().find((n) => refId(refOf(n)) === ref);
  const fail = (err) => { opts.onError(err); root.dispatchEvent(new CustomEvent('postit-error', { detail: err })); };

  function setData({ notes: n = notes, auto: a, positions: p } = {}) {
    if (p) positions = { ...positions, ...p };
    if (n !== notes) notes = (n || []).map((x) => normalizeNote(x));
    if (a !== undefined) rawAuto = a || [];
    // automatic notes are rebuilt from what the app sent plus the saved positions, never from a past layout
    auto = withPositions(rawAuto.map((x) => normalizeNote(x, { auto: true })), positions);
  }

  function noteHtml(n) {
    const ref = refId(refOf(n));
    const status = dueStatus(n.due, opts.now());
    const due = n.due
      ? `<time class="pb-due pb-due--${status}" datetime="${escapeHtml(n.due)}">${escapeHtml(formatDue(n.due, { locale: opts.locale, now: opts.now(), words: t }))}</time>`
      : '';
    const link = n.link
      ? `<a class="pb-link" href="${escapeHtml(n.link)}"${/^https?:/i.test(n.link) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(n.linkLabel || (n.auto ? t.open : n.link))}</a>`
      : '';
    const actions = n.auto
      ? ''
      : `<button type="button" class="pb-icon" data-pb="edit" title="${escapeHtml(t.edit)}" aria-label="${escapeHtml(t.edit)}">✎</button>
         <button type="button" class="pb-icon" data-pb="done" title="${escapeHtml(t.done)}" aria-label="${escapeHtml(t.done)}">✓</button>`;
    const swatch = colors[n.color] || colors.yellow;
    return `<article class="pb-note${n.auto ? ' pb-note--auto' : ''}${hidden.has(n.color) ? ' pb-note--hidden' : ''}" role="listitem" tabindex="0"
        data-ref="${escapeHtml(ref)}" data-color="${escapeHtml(n.color)}"
        style="--pb-x:${n.x};--pb-y:${n.y}px;--pb-z:${n.z || 0};--pb-r:${tilt(ref)}deg;--pb-note:${escapeHtml(swatch)}">
      <span class="pb-tape" aria-hidden="true"></span>
      ${n.title ? `<h3 class="pb-title">${escapeHtml(n.title)}</h3>` : ''}
      ${n.image ? `<img class="pb-img" src="${escapeHtml(n.image)}" alt="" loading="lazy" draggable="false">` : ''}
      ${n.text ? `<p class="pb-text">${linkify(n.text)}</p>` : ''}
      ${link && !n.auto ? `<p class="pb-linkrow">${link}</p>` : ''}
      <div class="pb-foot">${due}<span class="pb-spacer"></span>${n.auto ? link : ''}${actions}</div>
    </article>`;
  }

  function render() {
    // placed in the same objects: callbacks keep references to them
    const list = all();
    const flowing = list.filter((n) => n.x === null || n.y === null);
    autoPlace(list).forEach((p, i) => { list[i].x = p.x; list[i].y = p.y; });
    glass.style.setProperty('--pb-height', `${boardHeight(list)}px`);
    glass.innerHTML = list.length ? list.map(noteHtml).join('') : `<p class="pb-empty">${escapeHtml(t.empty)}</p>`;
    if (flowing.length && !isGrid()) flow(flowing);
    fitHeight();
    renderLegend();
  }

  /** Notes without a position stack in four columns by their real height, so none covers another. */
  function flow(flowing) {
    const columns = 4;
    const bottoms = Array(columns).fill(26);
    flowing.forEach((n, k) => {
      const el = glass.querySelector(`[data-ref="${CSS.escape(refId(refOf(n)))}"]`);
      if (!el) return;
      const col = k % columns;
      n.x = col / columns + 0.012;
      n.y = bottoms[col];
      el.style.setProperty('--pb-x', n.x);
      el.style.setProperty('--pb-y', `${n.y}px`);
      bottoms[col] += el.offsetHeight + 34;
    });
  }

  function fitHeight() {
    if (isGrid()) return;
    const bottom = Math.max(0, ...[...glass.querySelectorAll('.pb-note')].map((el) => el.offsetTop + el.offsetHeight));
    glass.style.setProperty('--pb-height', `${Math.max(560, bottom + 40)}px`);
  }

  function renderLegend() {
    if (!opts.legend.length) { legendEl.hidden = true; return; }
    legendEl.hidden = false;
    const count = (c) => all().filter((n) => n.color === c).length;
    legendEl.innerHTML = opts.legend.map((item) => {
      const on = !hidden.has(item.color);
      return `<button type="button" class="pb-key" data-pb="filter" data-color="${escapeHtml(item.color)}" aria-pressed="${on}"
          title="${escapeHtml(item.description || t.filter)}">
        <span class="pb-swatch" style="--pb-note:${escapeHtml(colors[item.color] || item.color)}"></span>
        <span class="pb-key-label">${escapeHtml(item.label)}</span><span class="pb-count">${count(item.color)}</span>
      </button>`;
    }).join('');
  }

  async function save(note, patch) {
    if (note.auto) positions[note.key] = { x: note.x, y: note.y, z: note.z };
    if (!opts.store) return;
    try {
      return await opts.store.update(refOf(note), patch);
    } catch (err) { fail(err); }
  }

  /* ---------- the edit dialog ---------- */
  function openEditor(note, at) {
    const choices = opts.legend.length ? opts.legend : Object.keys(colors).map((c) => ({ color: c, label: c }));
    const current = note?.color || at?.color || opts.defaultColor || (choices.some((c) => c.color === 'yellow') ? 'yellow' : choices[0]?.color) || 'yellow';
    dialog.innerHTML = `<form method="dialog" class="pb-form">
      <h2 id="${id}-h">${escapeHtml(note ? t.editNote : t.newNote)}</h2>
      <label>${escapeHtml(t.title)}<input name="title" maxlength="120" value="${escapeHtml(note?.title)}"></label>
      <label>${escapeHtml(t.text)}<textarea name="text" rows="4" maxlength="2000">${escapeHtml(note?.text)}</textarea></label>
      <fieldset class="pb-colors"><legend>${escapeHtml(t.color)}</legend>${choices.map((c) => `
        <label class="pb-choice" title="${escapeHtml(c.description || c.label)}"><input type="radio" name="color" value="${escapeHtml(c.color)}"${c.color === current ? ' checked' : ''}>
          <span class="pb-swatch" style="--pb-note:${escapeHtml(colors[c.color] || c.color)}"></span>${escapeHtml(c.label)}</label>`).join('')}
      </fieldset>
      <div class="pb-row">
        <label>${escapeHtml(t.due)}<input name="due" type="datetime-local" value="${escapeHtml(toLocalInput(note?.due))}"></label>
        <label>${escapeHtml(t.image)}<input name="image" type="url" inputmode="url" value="${escapeHtml(note?.image)}" placeholder="https://"></label>
      </div>
      <div class="pb-row">
        <label>${escapeHtml(t.link)}<input name="link" inputmode="url" value="${escapeHtml(note?.link)}" placeholder="https://"></label>
        <label>${escapeHtml(t.linkLabel)}<input name="linkLabel" maxlength="80" value="${escapeHtml(note?.linkLabel)}"></label>
      </div>
      <div class="pb-actions">
        ${note ? `<button type="button" class="pb-btn pb-btn--danger" data-pb="remove">${escapeHtml(t.remove)}</button>` : ''}
        <span class="pb-spacer"></span>
        <button type="button" class="pb-btn" data-pb="cancel">${escapeHtml(t.cancel)}</button>
        <button type="submit" class="pb-btn pb-btn--primary">${escapeHtml(t.save)}</button>
      </div></form>`;
    const form = dialog.querySelector('form');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(form);
      const draft = {
        title: f.get('title').trim(), text: f.get('text').trim(), color: f.get('color') || current,
        due: fromLocalInput(f.get('due')), link: safeUrl(f.get('link')), linkLabel: f.get('linkLabel').trim(),
        image: safeUrl(f.get('image')),
      };
      if (!draft.title && !draft.text && !draft.image) return dialog.close();
      dialog.close();
      if (note) {
        Object.assign(note, draft);
        render();
        await save(note, draft);
      } else {
        const local = normalizeNote({ ...draft, id: -Date.now(), x: at?.x ?? null, y: at?.y ?? null, z: topZ() + 1 });
        notes.push(local);
        render();
        if (!opts.store) return;
        try {
          const saved = await opts.store.create({ ...draft, x: local.x, y: local.y, z: local.z });
          Object.assign(local, normalizeNote(saved));
          render();
        } catch (err) { notes = notes.filter((n) => n !== local); render(); fail(err); }
      }
    });
    dialog.querySelector('[data-pb=cancel]').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-pb=remove]')?.addEventListener('click', async () => {
      dialog.close();
      notes = notes.filter((n) => n !== note);
      render();
      await save(note, { removed: true });
    });
    dialog.showModal();
    form.elements.text.focus();
  }

  const topZ = () => Math.max(0, ...all().map((n) => n.z || 0));

  /* ---------- events ---------- */
  function onClick(ev) {
    const btn = ev.target.closest('[data-pb]');
    if (!btn || !root.contains(btn)) return;
    const action = btn.dataset.pb;
    if (action === 'add') return openEditor(null);
    if (action === 'filter') {
      const c = btn.dataset.color;
      if (hidden.has(c)) hidden.delete(c); else hidden.add(c);
      return render();
    }
    const el = btn.closest('.pb-note');
    const note = el && find(el.dataset.ref);
    if (!note) return;
    if (action === 'edit') return openEditor(note);
    if (action === 'done') {
      el.classList.add('pb-note--leaving');
      notes = notes.filter((n) => n !== note);
      setTimeout(render, 180);
      save(note, { done: true });
    }
  }

  function onDblClick(ev) {
    if (ev.target !== glass || isGrid()) return;
    const box = glass.getBoundingClientRect();
    openEditor(null, { x: Math.max(0, Math.min(0.8, (ev.clientX - box.left) / box.width - 0.05)), y: Math.max(0, Math.round(ev.clientY - box.top - 20)) });
  }

  function onPointerDown(ev) {
    const el = ev.target.closest('.pb-note');
    if (!el || ev.button !== 0 || ev.target.closest('button,a,input,textarea') || isGrid()) return;
    const note = find(el.dataset.ref);
    if (!note) return;
    ev.preventDefault();
    const r = el.getBoundingClientRect();
    note.z = topZ() + 1;
    el.style.setProperty('--pb-z', note.z);
    el.classList.add('pb-note--dragging');
    el.setPointerCapture?.(ev.pointerId);
    drag = { el, note, dx: ev.clientX - r.left, dy: ev.clientY - r.top, moved: false };
  }

  function onPointerMove(ev) {
    if (!drag) return;
    const box = glass.getBoundingClientRect();
    const w = drag.el.offsetWidth;
    drag.moved = true;
    drag.note.x = Math.min(Math.max(0, (ev.clientX - box.left - drag.dx) / box.width), Math.max(0, 1 - w / box.width));
    drag.note.y = Math.max(0, Math.round(ev.clientY - box.top - drag.dy));
    drag.el.style.setProperty('--pb-x', drag.note.x);
    drag.el.style.setProperty('--pb-y', `${drag.note.y}px`);
  }

  function onPointerUp() {
    if (!drag) return;
    const { el, note, moved } = drag;
    drag = null;
    el.classList.remove('pb-note--dragging');
    fitHeight();
    save(note, moved ? { x: note.x, y: note.y, z: note.z } : { z: note.z });
  }

  let keyTimer = null;
  function onKeyDown(ev) {
    const el = ev.target.closest?.('.pb-note');
    if (!el || ev.target !== el) return;
    const note = find(el.dataset.ref);
    if (!note) return;
    if (ev.key === 'Enter' && !note.auto) { ev.preventDefault(); return openEditor(note); }
    const step = ev.shiftKey ? 5 : 1;
    const moves = { ArrowLeft: [-0.01, 0], ArrowRight: [0.01, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
    const m = moves[ev.key];
    if (!m || isGrid()) return;
    ev.preventDefault();
    note.x = Math.min(Math.max(0, note.x + m[0] * step), 0.95);
    note.y = Math.max(0, note.y + m[1] * step);
    el.style.setProperty('--pb-x', note.x);
    el.style.setProperty('--pb-y', `${note.y}px`);
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => save(note, { x: note.x, y: note.y }), 400);
  }

  root.addEventListener('click', onClick);
  glass.addEventListener('dblclick', onDblClick);
  glass.addEventListener('pointerdown', onPointerDown);
  glass.addEventListener('pointermove', onPointerMove);
  glass.addEventListener('pointerup', onPointerUp);
  glass.addEventListener('pointercancel', onPointerUp);
  root.addEventListener('keydown', onKeyDown);
  // due chips move from "Tomorrow" to "Today" to overdue without a reload
  const ticker = setInterval(() => { if (!drag && !dialog.open && all().some((n) => n.due)) render(); }, 60_000);

  setData({ notes: opts.notes, auto: opts.auto, positions: opts.positions });
  render();

  return {
    /** Replace the data (any of notes, auto, positions) and redraw. */
    update(data = {}) { setData(data); if (!drag) render(); },
    /** Load everything from `store.load()` (shape `{ notes, positions }`). */
    async reload() {
      if (!opts.store?.load) return;
      try { const data = await opts.store.load(); setData({ notes: data.notes, positions: data.positions }); render(); } catch (err) { fail(err); }
    },
    /** Change options (legend, strings, colors…) after mounting. */
    configure(next = {}) {
      opts = { ...opts, ...next };
      t = { ...DEFAULT_STRINGS, ...opts.strings };
      colors = { ...DEFAULT_COLORS, ...opts.colors };
      render();
    },
    openEditor: (draft) => openEditor(null, draft),
    get notes() { return notes.map((n) => ({ ...n })); },
    destroy() {
      clearInterval(ticker);
      clearTimeout(keyTimer);
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKeyDown);
      root.classList.remove('pb');
      root.innerHTML = '';
    },
  };
}

export default createBoard;
