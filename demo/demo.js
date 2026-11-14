// The demo pages: one board each, saved in this browser (localStorage). Every name and text here is made up.
import { createBoard, localStore } from '../src/postit-board.js';

const hours = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

export const LEGEND = [
  { color: 'pink', label: 'Broken', description: 'Something failed (added by the app)', locked: true },
  { color: 'orange', label: 'Attention', description: 'Needs a look soon (added by the app)', locked: true },
  { color: 'yellow', label: 'Notes', description: 'Anything you write' },
  { color: 'green', label: 'Routine', description: 'Recurring chores' },
  { color: 'purple', label: 'Numbers', description: 'Reports and metrics' },
  { color: 'teal', label: 'Home', description: 'Around the house' },
  { color: 'blue', label: 'Someday', description: 'Future improvements' },
];

// what an app would compute from its own data on every render
const AUTO = [
  { key: 'auto:backup', title: 'Backup is 2 days old', text: 'Ut enim ad minim veniam, quis nostrud.', color: 'pink', link: '#backup', lane: 'waiting' },
  { key: 'auto:disk', title: 'Disk at 91%', text: 'Excepteur sint occaecat cupidatat.', color: 'orange', link: '#disk', lane: 'work' },
];

/** Notes archived some time ago: `ago` in hours. */
const ARCHIVED = [
  { title: 'Renew the library card', text: 'Two books still out.', color: 'yellow', ago: 3 },
  { title: 'Fix the squeaky door', text: 'A drop of oil on the hinge did it.', color: 'teal', ago: 27, lane: { states: 'done', categories: 'home' } },
  { title: 'Monthly numbers', text: 'Sent, with the chart of the last six months.', color: 'purple', ago: 76, lane: { states: 'done', categories: 'work' } },
  { title: 'Water filter', text: 'Changed the cartridge.', color: 'green', ago: 200, lane: { states: 'done', categories: 'home' } },
  { title: 'Sort old photos', text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.', color: 'blue', ago: 900 },
];

const PAGES = {
  board: {
    key: 'postit-board-demo',
    lanes: null,
    notes: [
      { title: 'Lorem ipsum', text: 'Dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor.', color: 'yellow', due: hours(3) },
      { title: 'Vestibulum ante', text: 'Ipsum primis in faucibus: https://example.com/lorem', color: 'blue', image: './img/mountains.svg' },
      { title: 'Curabitur', text: 'Pretium tincidunt lacus. Nulla gravida orci a odio.', color: 'green', link: 'https://example.com/report', linkLabel: 'Report →', due: hours(30) },
      { title: 'Quarterly numbers', text: 'Integer in mauris eu nibh euismod gravida.', color: 'purple', image: './img/chart.svg' },
      { title: 'Nam liber', text: 'Tempor cum soluta nobis eleifend option congue nihil imperdiet.', color: 'yellow', due: hours(-2) },
      { title: 'Desk setup', text: 'Duis aute irure dolor in reprehenderit.', color: 'teal', image: './img/desk.svg' },
    ],
    archived: ARCHIVED.slice(0, 3),
  },
  kanban: {
    key: 'postit-board-demo-kanban',
    lanes: { mode: 'states' },
    notes: [
      { title: 'Plan the garden beds', text: 'Tomatoes by the fence, herbs near the door.', color: 'teal', lane: { states: 'todo', categories: 'home' } },
      { title: 'Lorem ipsum', text: 'Dolor sit amet, consectetur adipiscing elit.', color: 'yellow', due: hours(-3), lane: { states: 'todo', categories: 'ideas' } },
      { title: 'Weekly report', text: 'Integer in mauris eu nibh euismod gravida.', color: 'purple', due: hours(4), lane: { states: 'doing', categories: 'work' } },
      { title: 'Paint the fence', text: 'Second coat on Saturday.', color: 'green', lane: { states: 'doing', categories: 'home' } },
      { title: 'Order seeds', text: 'Waiting for the spring catalog.', color: 'blue', lane: { states: 'waiting', categories: 'home' } },
      { title: 'Clean the gutters', text: 'Done before the rain.', color: 'green', lane: { states: 'done', categories: 'home' } },
    ],
    archived: ARCHIVED.slice(1, 4),
  },
  categories: {
    key: 'postit-board-demo-categories',
    lanes: { mode: 'categories' },
    notes: [
      { title: 'Weekly report', text: 'Integer in mauris eu nibh euismod gravida.', color: 'purple', due: hours(4), lane: { states: 'doing', categories: 'work' } },
      { title: 'Nam liber', text: 'Tempor cum soluta nobis eleifend option.', color: 'yellow', due: hours(-1), lane: { states: 'todo', categories: 'work' } },
      { title: 'Paint the fence', text: 'Second coat on Saturday.', color: 'green', lane: { states: 'doing', categories: 'home' } },
      { title: 'Plan the garden beds', text: 'Tomatoes by the fence, herbs near the door.', color: 'teal', lane: { states: 'todo', categories: 'home' } },
      { title: 'A reading lamp', text: 'Warm light, a long arm.', color: 'blue', image: './img/desk.svg', lane: { states: 'todo', categories: 'ideas' } },
      { title: 'Curabitur', text: 'Pretium tincidunt lacus. Nulla gravida orci a odio.', color: 'yellow', lane: { states: 'waiting', categories: 'ideas' } },
    ],
    archived: ARCHIVED.slice(0, 3),
  },
  archived: {
    key: 'postit-board-demo-archived',
    lanes: null,
    notes: [
      { title: 'Lorem ipsum', text: 'Dolor sit amet, consectetur adipiscing elit.', color: 'yellow' },
      { title: 'Quarterly numbers', text: 'Integer in mauris eu nibh euismod gravida.', color: 'purple', image: './img/chart.svg' },
    ],
    archived: ARCHIVED,
    open: true,
  },
};

/** Writes the page's sample once: its notes, then its archived ones, archived `ago` hours back. */
function seed(store, key, page) {
  if (localStorage.getItem(key)) return;
  for (const n of page.notes) store.create(n);
  const when = new Map();
  for (const { ago, ...n } of page.archived) {
    const made = store.create(n);
    store.update({ id: made.id }, { done: true });
    when.set(made.id, hours(-ago));
  }
  // the store stamps "now" when a note is archived: the demo moves those stamps back in time
  const data = JSON.parse(localStorage.getItem(key));
  for (const n of data.notes) if (when.has(n.id)) n.doneAt = when.get(n.id);
  localStorage.setItem(key, JSON.stringify(data));
}

/** Mounts the board of a demo page and wires its header: Reset, the phone width and the phone's order and fold. */
export function startDemo(name) {
  const page = PAGES[name];
  const store = localStore(page.key);
  seed(store, page.key, page);
  const board = createBoard(document.getElementById('board'), { store, auto: AUTO, legend: LEGEND, lanes: page.lanes });
  board.reload().then(() => { if (page.open) board.showArchived(true); });
  window.board = board;

  document.getElementById('reset').addEventListener('click', () => {
    localStorage.removeItem(page.key);
    location.reload();
  });
  // a desktop can try the phone: a narrow board, the most urgent first, the rest folded
  const phone = document.getElementById('phone');
  const params = new URLSearchParams(location.search);
  const setPhone = (on) => {
    phone.setAttribute('aria-pressed', String(on));
    document.querySelector('main').classList.toggle('phone', on);
    dispatchEvent(new Event('resize'));
  };
  phone.addEventListener('click', () => setPhone(phone.getAttribute('aria-pressed') !== 'true'));
  const order = document.getElementById('order');
  const limit = document.getElementById('limit');
  const apply = () => board.configure({ narrowOrder: order.value, narrowLimit: limit.value ? Number(limit.value) : null });
  order.addEventListener('change', apply);
  limit.addEventListener('change', apply);
  if (params.has('priority')) order.value = 'priority';
  if (params.has('limit')) limit.value = params.get('limit') || '2';
  if (params.has('priority') || params.has('limit')) apply();
  if (params.has('phone')) setPhone(true);
  return board;
}
