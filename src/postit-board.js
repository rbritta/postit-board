/**
 * postit-board: a glass board of sticky notes with a color legend.
 *
 *   const board = createBoard(element, { legend, notes, auto, store });
 *   board.update({ notes, auto });   // after your data changes
 *   board.destroy();
 *
 * Right-click the glass for a menu of note types: the new note starts where you clicked.
 * Right-click a note to change its type. The gear at the start of the legend edits the types
 * (name, meaning, color) and saves them through `store.saveLegend`.
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
  DEFAULT_COLORS, autoPlace, boardHeight, dueStatus, escapeHtml, formatDue, fromLocalInput, legendColors,
  linkify, mergeLegend, normalizeLegend, normalizeNote, refId, refOf, safeUrl, tilt, toLocalInput, withPositions,
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
  menuNew: 'New note here',
  menuColor: 'Change type',
  settings: 'Note types',
  settingsHint: 'Each color is a type of note. Rename it, say what it means or pick another color. Notes keep their type.',
  addType: '+ Type',
  typeName: 'Name',
  typeMeaning: 'Meaning',
  typeColor: 'Color',
  moveUp: 'Move up',
  removeType: 'Remove type',
  locked: 'Set by the app: rename only',
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
  contextMenu: true,
  editLegend: null,
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
    saveLegend: (legend) => call('PUT', '/legend', { legend }),
  };
}

/** A store in localStorage: for demos, prototypes and boards that live in one browser. */
export function localStore(name = 'postit-board', storage = globalThis.localStorage) {
  const read = () => {
    try { return { notes: [], positions: {}, next: 1, ...JSON.parse(storage.getItem(name) || '{}') }; } catch { return { notes: [], positions: {}, next: 1 }; }
  };
  const write = (data) => storage.setItem(name, JSON.stringify(data));
  return {
    load: () => {
      const d = read();
      return { notes: d.notes.filter((n) => !n.doneAt), positions: d.positions, ...(d.legend ? { legend: d.legend } : {}) };
    },
    saveLegend(legend) {
      const d = read();
      d.legend = normalizeLegend(legend);
      write(d);
      return { legend: d.legend };
    },
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
        const pos = { ...d.positions[ref.key] };
        for (const k of ['x', 'y', 'z']) if (patch[k] !== undefined) pos[k] = patch[k];
        d.positions[ref.key] = pos;
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
  let appLegend = opts.legend; // what the app ships; opts.legend is that plus what people saved
  let savedLegend = null;
  let colors;
  const baseColors = () => ({ ...DEFAULT_COLORS, ...opts.colors });
  function applyLegend() {
    opts.legend = mergeLegend(appLegend, savedLegend);
    colors = { ...baseColors(), ...legendColors(opts.legend) };
  }
  applyLegend();
  const canEditLegend = () => opts.editLegend ?? Boolean(opts.store?.saveLegend);
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
    <div class="pb-menu" role="menu" hidden></div>
    <dialog class="pb-dialog" aria-labelledby="${id}-h"></dialog>`;
  const glass = root.querySelector('.pb-glass');
  const legendEl = root.querySelector('.pb-legend');
  const menu = root.querySelector('.pb-menu');
  const dialog = root.querySelector('.pb-dialog');
  let menuAt = null; // { x, y } on the glass, or null in the phone grid
  let menuNote = null;

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
      ${n.title ? `<h3 class="pb-title" title="${escapeHtml(n.title)}">${escapeHtml(n.title)}</h3>` : ''}
      ${n.image ? `<img class="pb-img" src="${escapeHtml(n.image)}" alt="" loading="lazy" draggable="false">` : ''}
      ${n.text ? `<p class="pb-text" title="${escapeHtml(n.text)}">${linkify(n.text)}</p>` : ''}
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
    const gear = canEditLegend()
      ? `<button type="button" class="pb-gear" data-pb="settings" title="${escapeHtml(t.settings)}" aria-label="${escapeHtml(t.settings)}">⚙</button>`
      : '';
    if (!opts.legend.length && !gear) { legendEl.hidden = true; return; }
    legendEl.hidden = false;
    const count = (c) => all().filter((n) => n.color === c).length;
    legendEl.innerHTML = opts.legend.map((item) => {
      const on = !hidden.has(item.color);
      return `<button type="button" class="pb-key" data-pb="filter" data-color="${escapeHtml(item.color)}" aria-pressed="${on}"
          title="${escapeHtml(item.description || t.filter)}">
        <span class="pb-swatch" style="--pb-note:${escapeHtml(colors[item.color] || item.color)}"></span>
        <span class="pb-key-label">${escapeHtml(item.label)}</span><span class="pb-count">${count(item.color)}</span>
      </button>`;
    }).join('') + gear;
  }

  /** The types offered when creating or recoloring: the legend, or every color without one. */
  const choices = () => (opts.legend.length ? opts.legend : Object.keys(colors).map((c) => ({ color: c, label: c })));
  const swatchOf = (c) => escapeHtml(colors[c] || c);

  /** Where a click lands on the glass, as a note position: its top-left corner, kept inside. */
  function pointOnGlass(ev) {
    if (isGrid()) return null;
    const box = glass.getBoundingClientRect();
    const noteWidth = Math.min(220, box.width * 0.23);
    return {
      x: Math.min(Math.max(0, (ev.clientX - box.left) / box.width), Math.max(0, 1 - noteWidth / box.width)),
      y: Math.max(0, Math.round(ev.clientY - box.top)),
    };
  }

  /* ---------- the right-click menu ---------- */
  function openMenu(ev, note) {
    menuNote = note || null;
    menuAt = note ? null : pointOnGlass(ev);
    const action = note ? 'menu-color' : 'menu-new';
    const items = choices().map((c) => `<button type="button" role="menuitem" class="pb-menu-item" data-pb="${action}" data-color="${escapeHtml(c.color)}"${note && note.color === c.color ? ' aria-current="true"' : ''}>
        <span class="pb-swatch" style="--pb-note:${swatchOf(c.color)}"></span><span class="pb-menu-label">${escapeHtml(c.label)}</span>
        ${c.description ? `<small>${escapeHtml(c.description)}</small>` : ''}</button>`).join('');
    const extra = note
      ? `<hr><button type="button" role="menuitem" class="pb-menu-item" data-pb="menu-edit"><span class="pb-menu-label">✎ ${escapeHtml(t.edit)}</span></button>
         <button type="button" role="menuitem" class="pb-menu-item" data-pb="menu-done"><span class="pb-menu-label">✓ ${escapeHtml(t.done)}</span></button>`
      : '';
    menu.innerHTML = `<p class="pb-menu-h">${escapeHtml(note ? t.menuColor : t.menuNew)}</p>${items}${extra}`;
    menu.hidden = false;
    // fixed to the viewport, flipped when it would leave the screen
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    menu.style.left = `${Math.max(4, ev.clientX + w > innerWidth ? ev.clientX - w : ev.clientX)}px`;
    menu.style.top = `${Math.max(4, ev.clientY + h > innerHeight ? ev.clientY - h : ev.clientY)}px`;
    (menu.querySelector('[aria-current]') || menu.querySelector('.pb-menu-item'))?.focus();
  }

  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    menu.innerHTML = '';
    menuNote = null;
  }

  function onContextMenu(ev) {
    if (!opts.contextMenu || ev.shiftKey) return; // Shift + right-click keeps the browser's own menu
    if (ev.target.closest('a,input,textarea')) return;
    const el = ev.target.closest('.pb-note');
    const note = el && find(el.dataset.ref);
    if (note?.auto) return;
    ev.preventDefault();
    openMenu(ev, note);
  }

  function onMenuKey(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); closeMenu(); return; }
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const items = [...menu.querySelectorAll('.pb-menu-item')];
    const i = items.indexOf(document.activeElement);
    items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }

  const onOutside = (ev) => { if (!menu.hidden && !menu.contains(ev.target)) closeMenu(); };

  /* ---------- the note types (gear at the end of the legend) ---------- */
  function typeRow(item) {
    const hex = colors[item.color] || '#fde68a';
    const lock = item.locked ? ` disabled title="${escapeHtml(t.locked)}"` : '';
    return `<li class="pb-type" data-color="${escapeHtml(item.color)}"${item.locked ? ' data-locked' : ''}>
      <input type="color" name="hex" value="${escapeHtml(hex)}" aria-label="${escapeHtml(t.typeColor)}"${lock}>
      <input name="label" maxlength="40" value="${escapeHtml(item.label)}" aria-label="${escapeHtml(t.typeName)}" placeholder="${escapeHtml(t.typeName)}" required>
      <input name="description" maxlength="160" value="${escapeHtml(item.description)}" aria-label="${escapeHtml(t.typeMeaning)}" placeholder="${escapeHtml(t.typeMeaning)}">
      <button type="button" class="pb-icon" data-pb="type-up" title="${escapeHtml(t.moveUp)}" aria-label="${escapeHtml(t.moveUp)}">↑</button>
      ${item.locked
    ? `<span class="pb-lock" title="${escapeHtml(t.locked)}" aria-label="${escapeHtml(t.locked)}">🔒</span>`
    : `<button type="button" class="pb-icon" data-pb="type-remove" title="${escapeHtml(t.removeType)}" aria-label="${escapeHtml(t.removeType)}">✕</button>`}
    </li>`;
  }

  /** A color key for a new type: a built-in color nobody uses yet, else c-1, c-2… */
  function freeKey(used) {
    const free = Object.keys(DEFAULT_COLORS).find((c) => !used.has(c));
    if (free) return free;
    let n = 1;
    while (used.has(`c-${n}`)) n += 1;
    return `c-${n}`;
  }

  function openSettings() {
    closeMenu();
    dialog.innerHTML = `<form method="dialog" class="pb-form pb-settings">
      <h2 id="${id}-h">${escapeHtml(t.settings)}</h2>
      <p class="pb-settings-hint">${escapeHtml(t.settingsHint)}</p>
      <ol class="pb-types">${opts.legend.map(typeRow).join('')}</ol>
      <div class="pb-actions">
        <button type="button" class="pb-btn" data-pb="type-add">${escapeHtml(t.addType)}</button>
        <span class="pb-spacer"></span>
        <button type="button" class="pb-btn" data-pb="cancel">${escapeHtml(t.cancel)}</button>
        <button type="submit" class="pb-btn pb-btn--primary">${escapeHtml(t.save)}</button>
      </div></form>`;
    const form = dialog.querySelector('form');
    const list = form.querySelector('.pb-types');
    form.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-pb]');
      if (!btn) return;
      const row = btn.closest('.pb-type');
      const action = btn.dataset.pb;
      if (action === 'cancel') dialog.close();
      if (action === 'type-remove') row.remove();
      if (action === 'type-up' && row.previousElementSibling) row.previousElementSibling.before(row);
      if (action === 'type-add') {
        const key = freeKey(new Set([...list.querySelectorAll('.pb-type')].map((r) => r.dataset.color)));
        list.insertAdjacentHTML('beforeend', typeRow({ color: key, label: '' }));
        list.lastElementChild.querySelector('[name=label]').focus();
      }
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const base = baseColors();
      const legend = normalizeLegend([...list.querySelectorAll('.pb-type')].map((row) => {
        const hex = row.querySelector('[name=hex]').value.toLowerCase();
        const own = (base[row.dataset.color] || '').toLowerCase();
        return {
          color: row.dataset.color,
          label: row.querySelector('[name=label]').value,
          description: row.querySelector('[name=description]').value,
          hex: hex && hex !== own ? hex : undefined,
          locked: row.hasAttribute('data-locked'),
        };
      }));
      dialog.close();
      savedLegend = legend;
      applyLegend();
      render();
      try { await opts.store?.saveLegend?.(legend); } catch (err) { fail(err); }
    });
    dialog.showModal();
    form.querySelector('[name=label]')?.focus();
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
    closeMenu();
    const types = choices();
    const current = note?.color || at?.color || opts.defaultColor || (types.some((c) => c.color === 'yellow') ? 'yellow' : types[0]?.color) || 'yellow';
    dialog.innerHTML = `<form method="dialog" class="pb-form">
      <h2 id="${id}-h">${escapeHtml(note ? t.editNote : t.newNote)}</h2>
      <label>${escapeHtml(t.title)}<input name="title" maxlength="120" value="${escapeHtml(note?.title)}"></label>
      <label>${escapeHtml(t.text)}<textarea name="text" rows="4" maxlength="2000">${escapeHtml(note?.text)}</textarea></label>
      <fieldset class="pb-colors"><legend>${escapeHtml(t.color)}</legend>${types.map((c) => `
        <label class="pb-choice" title="${escapeHtml(c.description || c.label)}"><input type="radio" name="color" value="${escapeHtml(c.color)}"${c.color === current ? ' checked' : ''}>
          <span class="pb-swatch" style="--pb-note:${swatchOf(c.color)}"></span>${escapeHtml(c.label)}</label>`).join('')}
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
    if (action === 'settings') return openSettings();
    if (action === 'menu-new') {
      const at = { ...menuAt, color: btn.dataset.color };
      closeMenu();
      return openEditor(null, at);
    }
    if (action.startsWith('menu-')) {
      const target = menuNote;
      closeMenu();
      if (!target) return;
      if (action === 'menu-edit') return openEditor(target);
      if (action === 'menu-done') return finish(target);
      if (action === 'menu-color' && target.color !== btn.dataset.color) {
        target.color = btn.dataset.color;
        target.z = topZ() + 1;
        render();
        save(target, { color: target.color, z: target.z });
      }
      return;
    }
    if (action === 'filter') {
      const c = btn.dataset.color;
      if (hidden.has(c)) hidden.delete(c); else hidden.add(c);
      return render();
    }
    const el = btn.closest('.pb-note');
    const note = el && find(el.dataset.ref);
    if (!note) return;
    if (action === 'edit') return openEditor(note);
    if (action === 'done') finish(note);
  }

  function finish(note) {
    glass.querySelector(`[data-ref="${CSS.escape(refId(refOf(note)))}"]`)?.classList.add('pb-note--leaving');
    notes = notes.filter((n) => n !== note);
    setTimeout(render, 180);
    save(note, { done: true });
  }

  function onDblClick(ev) {
    if (ev.target !== glass || isGrid()) return;
    openEditor(null, pointOnGlass(ev));
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
    // the note touched last stays on top, also after a reload
    save(note, moved || note.auto ? { x: note.x, y: note.y, z: note.z } : { z: note.z });
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
  glass.addEventListener('contextmenu', onContextMenu);
  menu.addEventListener('keydown', onMenuKey);
  document.addEventListener('pointerdown', onOutside, true);
  addEventListener('scroll', closeMenu, true);
  addEventListener('resize', closeMenu);
  addEventListener('blur', closeMenu);
  // due chips move from "Tomorrow" to "Today" to overdue without a reload
  const ticker = setInterval(() => { if (!drag && !dialog.open && all().some((n) => n.due)) render(); }, 60_000);

  setData({ notes: opts.notes, auto: opts.auto, positions: opts.positions });
  render();

  return {
    /** Replace the data (any of notes, auto, positions) and redraw. */
    update(data = {}) { setData(data); if (!drag) render(); },
    /** Load everything from `store.load()` (shape `{ notes, positions, legend? }`). */
    async reload() {
      if (!opts.store?.load) return;
      try {
        const data = await opts.store.load();
        if (data.legend) { savedLegend = data.legend; applyLegend(); }
        setData({ notes: data.notes, positions: data.positions });
        render();
      } catch (err) { fail(err); }
    },
    /** Change options (legend, strings, colors…) after mounting. */
    configure(next = {}) {
      if (next.legend) appLegend = next.legend;
      opts = { ...opts, ...next };
      t = { ...DEFAULT_STRINGS, ...opts.strings };
      applyLegend();
      render();
    },
    openEditor: (draft) => openEditor(null, draft),
    openSettings: () => openSettings(),
    /** The legend in use: what the app shipped plus what people changed with the gear. */
    get legend() { return opts.legend.map((i) => ({ ...i })); },
    get notes() { return notes.map((n) => ({ ...n })); },
    destroy() {
      clearInterval(ticker);
      clearTimeout(keyTimer);
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onOutside, true);
      removeEventListener('scroll', closeMenu, true);
      removeEventListener('resize', closeMenu);
      removeEventListener('blur', closeMenu);
      root.classList.remove('pb');
      root.innerHTML = '';
    },
  };
}

export default createBoard;
