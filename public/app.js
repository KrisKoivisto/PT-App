import { createApi, browserStore, safeStorage } from './lib/api.js';
import { demoFetch } from './lib/demo.js';
import { reasonsFor } from './lib/reasons.js';
import { brand } from './lib/titles.js';
import { BUILT_IN_KEY } from './lib/config.js';

const $ = (s) => document.querySelector(s);
const IMG = 'https://image.tmdb.org/t/p';
const REGIONS = {
  US: 'United States', CA: 'Canada', GB: 'United Kingdom', AU: 'Australia', NZ: 'New Zealand',
  IE: 'Ireland', DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy', NL: 'Netherlands',
  SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland', BR: 'Brazil', MX: 'Mexico',
  IN: 'India', JP: 'Japan', KR: 'South Korea',
};
// How you felt about something you've seen. Optional, on the detail screen.
const FEELINGS = [
  ['love', 'Loved it', 'heart'],
  ['like', 'Liked it', 'up'],
  ['dislike', 'Not for me', 'down'],
];

const PATHS = {
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  up: '<path d="M7 10v10H4V10zM7 10l4-7c1.7 0 2.5 1 2.3 2.6L13 9h5.5c1.2 0 2 1.1 1.8 2.2l-1.4 7A2 2 0 0 1 17 20H7"/>',
  down: '<g transform="rotate(180 12 12)"><path d="M7 10v10H4V10zM7 10l4-7c1.7 0 2.5 1 2.3 2.6L13 9h5.5c1.2 0 2 1.1 1.8 2.2l-1.4 7A2 2 0 0 1 17 20H7"/></g>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  star: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
};
const icon = (name, filled = false) => `<svg class="i${filled ? ' fill' : ''}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name]}</svg>`;

// Sample mode: made-up titles and no TMDB key needed. On with ?demo, or when
// the page that loads this sets window.WTW_DEMO (the shareable preview).
const DEMO = !!window.WTW_DEMO || new URLSearchParams(location.search).has('demo');
const store = DEMO ? browserStore(safeStorage(), 'wtw.demo.') : browserStore();
if (DEMO && !store.loadKey()) {
  store.saveKey('sample');
  store.saveProfile({ services: [8, 15], serviceBrands: ['netflix', 'hulu'] }); // so the rings show
}
const api = createApi({ store, fetchImpl: DEMO ? demoFetch : undefined, builtInKey: DEMO ? null : BUILT_IN_KEY });
const img = (size, path) => (path.startsWith('data:') ? path : `${IMG}/${size}${path}`);

let status;
const items = new Map(); // "type:id" -> latest item, shared by every view

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const keyOf = (it) => `${it.type}:${it.tmdbId}`;

let toastTimer;
// Brief message at the bottom; with `onUndo` it carries an Undo button.
function toast(msg, onUndo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${onUndo ? '<button type="button" class="undo">Undo</button>' : ''}`;
  if (onUndo) el.querySelector('.undo').onclick = () => { el.hidden = true; onUndo(); };
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, onUndo ? 5000 : 3500);
}

// The key box only shows up if there's no key or TMDB turned the key down.
let keyRejected = false;

function show(id, msg, isErr) {
  if (isErr && /rejected the API key/.test(msg)) {
    keyRejected = true;
    $('#key-card').hidden = false;
    msg = "TMDB stopped accepting this app's key. Open Settings to paste a new one.";
  }
  const el = $(id);
  el.textContent = msg;
  el.className = 'msg' + (isErr ? ' err' : '');
}

// Streaming (and free) services for a title, one per brand, yours first.
function services(it) {
  const seen = new Set();
  return [...it.stream, ...it.free]
    .filter((p) => !seen.has(brand(p.name)) && seen.add(brand(p.name)))
    .map((p) => ({ ...p, yours: status.services.includes(p.id) || status.serviceBrands.includes(brand(p.name)) }))
    .sort((a, b) => Number(b.yours) - Number(a.yours));
}

const logoImg = (p, size = 'w92') => (p.logo
  ? `<img src="${img(size, p.logo)}" alt="${esc(p.name)}">`
  : `<span class="logo-text">${esc(p.name.slice(0, 2))}</span>`);

// --- poster tiles --------------------------------------------------------------
// The three one-tap marks on every poster, also at the top of the detail screen.
function quickButtons(m, attr) {
  const seen = !!m.reaction;
  return [
    ['seen', 'Seen it', 'Seen', 'check', seen],
    ['want', 'Bookmark', 'Bookmarked', 'bookmark', !!m.want],
    ['pass', 'Pass', 'Passed', 'x', !!m.passed],
  ].map(([k, label, onLabel, ic, on]) =>
    `<button ${attr}="${k}" class="q ${k}${on ? ' on' : ''}" aria-pressed="${on}" aria-label="${on ? onLabel : label}">${icon(ic, on && ic === 'bookmark')}<span>${on ? onLabel : label}</span></button>`).join('');
}

function tile(it) {
  const m = it.mine ?? {};
  const where = services(it);
  const sub = it.role || [it.year, it.type === 'movie' ? 'Film' : it.tvType === 'Miniseries' ? 'Limited series' : 'Series'].filter(Boolean).join(' · ');
  return `<div class="tile${m.passed ? ' passed' : ''}" data-key="${keyOf(it)}"${it.role ? ` data-role="${esc(it.role)}"` : ''}>
    <button class="poster" data-open aria-label="${esc(it.title)}: details and where to watch">
      ${it.poster ? `<img loading="lazy" src="${img('w342', it.poster)}" alt="">` : `<span class="noposter">${esc(it.title)}</span>`}
      <span class="stamps">${where.length
        ? where.slice(0, 3).map((p) => `<span class="stamp${p.yours ? ' yours' : ''}" title="${esc(p.name)}">${logoImg(p)}</span>`).join('')
          + (where.length > 3 ? `<span class="stamp more">+${where.length - 3}</span>` : '')
        : `<span class="stamp none">${it.rentBuy?.length ? 'Rent/buy' : 'Not streaming'}</span>`}</span>
    </button>
    <div class="quick">${quickButtons(m, 'data-quick')}</div>
    <span class="t">${esc(it.title)}</span>
    <span class="y">${esc(sub)}</span>
  </div>`;
}

// The role under a poster belongs to the actor page it's on, so it's passed
// along per wall, not stored with the title.
const inView = (it) => ({ ...items.get(keyOf(it)), role: it.role });

function renderWall(sel, list, append = false) {
  for (const it of list) remember(it);
  const html = list.map((it) => tile(inView(it))).join('');
  if (append) $(sel).insertAdjacentHTML('beforeend', html);
  else $(sel).innerHTML = html;
}

// Keep the latest copy of each title without losing what other views know.
function remember(it) {
  const { role, ...rest } = it;
  items.set(keyOf(it), { ...items.get(keyOf(it)), ...rest });
}

function updateTiles(it) {
  document.querySelectorAll(`.tile[data-key="${keyOf(it)}"]`).forEach((el) => {
    el.outerHTML = tile({ ...it, role: el.dataset.role });
  });
}

// --- the detail sheet (title or person), stacked so Back works -----------------
const stack = [];

function openSheet(view) {
  stack.push(view);
  try { history.pushState({ sheet: stack.length }, ''); } catch {}
  renderSheet();
}

function closeSheet(all = false) {
  const n = all ? stack.length : 1;
  if (!n) return;
  try { history.go(-n); } catch { stack.length -= n; renderSheet(); }
}

window.addEventListener('popstate', () => {
  const depth = history.state?.sheet ?? 0;
  stack.length = Math.min(stack.length, depth);
  renderSheet();
});

function renderSheet(keepScroll = false) {
  const sheet = $('#sheet');
  const panel = sheet.querySelector('.sheet-panel');
  if (!stack.length) {
    sheet.hidden = true;
    document.body.classList.remove('locked');
    if (view === 'list' && !sheet.dataset.closed) loadList(); // a title may have moved lists
    sheet.dataset.closed = '1';
    return;
  }
  delete sheet.dataset.closed;
  const top = stack.at(-1);
  const scroll = panel.scrollTop;
  sheet.hidden = false;
  document.body.classList.add('locked');
  $('#sheet-close').innerHTML = stack.length > 1 ? icon('back') : icon('x');
  $('#sheet-close').setAttribute('aria-label', stack.length > 1 ? 'Back' : 'Close');
  $('#sheet-body').innerHTML = top.kind === 'title' ? titleView(top) : top.kind === 'similar' ? similarView(top) : personView(top);
  panel.scrollTop = keepScroll ? scroll : 0;
  if (!top.loaded && !top.loading) load(top);
}

async function load(view) {
  view.loading = true;
  try {
    if (view.kind === 'title') {
      const [type, id] = view.key.split(':');
      const r = await api.title(type, Number(id));
      view.cast = r.cast;
      remember(r);
    } else if (view.kind === 'similar') {
      const [type, id] = view.key.split(':');
      view.similar = await api.similar(type, Number(id));
      view.similar.items.forEach(remember);
    } else {
      view.person = await api.person(view.id);
      view.person.items.forEach(remember);
    }
  } catch (e) {
    view.error = e.message;
  }
  view.loaded = true;
  view.loading = false;
  if (stack.at(-1) === view) renderSheet(true);
}

function titleView(view) {
  const it = items.get(view.key);
  const m = it.mine ?? { reasons: [] };
  const where = services(it);
  const meta = [
    it.year,
    it.type === 'tv' ? (it.seasons ? `${it.seasons} season${it.seasons > 1 ? 's' : ''}` : 'Series') : it.runtime ? `${Math.floor(it.runtime / 60)}h ${it.runtime % 60}m` : 'Film',
    it.genres.slice(0, 3).join(', '),
  ].filter(Boolean).join(' · ');
  const felt = ['love', 'like', 'dislike'].includes(m.reaction);
  const why = felt ? reasonsFor(it, m.reaction, m.reasons) : null;
  const rent = it.rentBuy ?? [];

  return `<div class="hero">
      ${it.backdrop ? `<img src="${img('w780', it.backdrop)}" alt="">` : it.poster ? `<img class="blur" src="${img('w342', it.poster)}" alt="">` : ''}
    </div>
    <div class="head">
      ${it.poster ? `<img class="head-poster" src="${img('w342', it.poster)}" alt="">` : ''}
      <div class="head-text">
        <h2>${esc(it.title)}</h2>
        <p class="meta">${esc(meta)}</p>
        ${it.voteCount >= 50 ? `<p class="score">${icon('star', true)} ${it.voteAverage.toFixed(1)} <span>TMDB</span></p>` : ''}
      </div>
    </div>

    <section class="block">
      <h3>Where to watch</h3>
      ${where.length ? `<div class="services">${where.map((p) => `
        <div class="service${p.yours ? ' yours' : ''}">
          <span class="service-logo">${logoImg(p, 'w154')}</span>
          <span class="service-name">${esc(p.name)}</span>
          ${p.yours ? '<span class="service-tag">You have it</span>' : ''}
        </div>`).join('')}</div>`
      : `<p class="msg">Not streaming in ${esc(status.region)} right now.</p>`}
      ${rent.length ? `<p class="rent">Rent or buy: ${esc([...new Set(rent.map((p) => p.name))].join(', '))}</p>` : ''}
      ${it.link ? `<a class="all-ways" href="${esc(it.link)}" target="_blank" rel="noopener">Every way to watch ›</a>` : ''}
      <p class="source">Availability from JustWatch</p>
    </section>

    <section class="block">
      <h3>Your take</h3>
      <div class="quick big">${quickButtons(m, 'data-act')}</div>
      ${m.reaction ? `<p class="why-label">How was it? <span>Optional</span></p>
      <div class="takes">
        ${FEELINGS.map(([k, label, ic]) => `<button data-act="${k}" class="take ${k}${m.reaction === k ? ' on' : ''}" aria-pressed="${m.reaction === k}">${icon(ic, m.reaction === k)}<span>${label}</span></button>`).join('')}
      </div>` : ''}
      ${why ? `<p class="why-label">${m.reaction === 'dislike' ? "What didn't work?" : 'What stood out?'} <span>Tap any that fit</span></p>
      <div class="why">
        ${why.map((r) => `<button data-reason="${esc(r)}" class="${m.reasons.includes(r) ? 'on' : ''}">${esc(r)}</button>`).join('')}
        <input id="note" data-note placeholder="Anything else? (optional)" value="${esc(m.note)}" maxlength="300">
      </div>` : ''}
    </section>

    ${it.overview ? `<p class="overview">${esc(it.overview)}</p>` : ''}
    ${it.because?.length ? `<p class="because">Because you liked ${it.because.map(esc).join(', ')}</p>` : ''}

    <section class="block">
      <h3>Cast</h3>
      ${view.cast ? (view.cast.length ? `<div class="cast scroll">${view.cast.map((c) => `
        <button class="person" data-person="${c.id}">
          <span class="face">${c.profile ? `<img loading="lazy" src="${img('w185', c.profile)}" alt="">` : `<span>${esc(c.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>`}</span>
          <span class="pn">${esc(c.name)}</span>
          ${c.character ? `<span class="pc">${esc(c.character)}</span>` : ''}
        </button>`).join('')}</div>` : '<p class="msg">No cast listed.</p>')
      : view.error ? `<p class="msg err">${esc(view.error)}</p>` : '<p class="msg">Loading cast…</p>'}
    </section>
    <section class="block">
      <button class="more-like" data-similar>More like this <span>Matched on what it's actually about</span></button>
    </section>
    ${it.imdbId ? `<p class="imdb"><a href="https://www.imdb.com/title/${it.imdbId}/" target="_blank" rel="noopener">Open on IMDb ›</a></p>` : ''}`;
}

function similarView(view) {
  const src = items.get(view.key);
  const r = view.similar;
  const head = `<div class="similar-head">
      <p class="eyebrow">More like</p>
      <h2>${esc(src?.title ?? '')}</h2>
      <p class="meta">Titles that share what this one is about. The tags they share are under each poster.</p>
    </div>`;
  if (!r) return head + (view.error ? `<p class="msg err pad-x">${esc(view.error)}</p>` : '<p class="msg pad-x">Finding titles about the same things…</p>');
  if (!r.items.length) {
    return head + `<p class="msg pad-x">No close matches${status.kind !== 'all' ? ' with the Movies / Shows / Limited filter you have on' : ''}. TMDB doesn't have enough detail on this one to be sure, and a vague list isn't worth your time.</p>`;
  }
  return head + `<section class="block"><div class="wall" data-clear>${r.items.map((i) => tile({ ...inView(i), role: i.because.join(' · ') })).join('')}</div></section>`;
}

function personView(view) {
  const p = view.person;
  if (!p) return view.error ? `<p class="msg err pad">${esc(view.error)}</p>` : '<p class="msg pad">Loading…</p>';
  return `<div class="person-head">
      <span class="face big">${p.profile ? `<img src="${img('h632', p.profile)}" alt="">` : `<span>${esc(p.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>`}</span>
      <div>
        <h2>${esc(p.name)}</h2>
        ${p.dept ? `<p class="meta">${esc(p.dept === 'Acting' ? 'Actor' : p.dept)} · ${p.items.length} title${p.items.length === 1 ? '' : 's'}</p>` : ''}
      </div>
    </div>
    <section class="block">
      <h3>Known for</h3>
      <div class="wall">${p.items.map((i) => tile(inView(i))).join('')}</div>
    </section>`;
}

// --- marking ------------------------------------------------------------------------
async function saveRating(it, reaction, reasons = [], note = '') {
  return (await api.mark({ list: 'ratings', type: it.type, tmdbId: it.tmdbId, reaction, reasons, note })).mine;
}

// One handler for every mark, from a poster or the detail screen. Tapping an
// active mark again undoes it.
async function act(key, what, extra = {}) {
  const it = items.get(key);
  const m = it.mine ?? { reasons: [], note: '' };
  const ref = { type: it.type, tmdbId: it.tmdbId, imdbId: it.imdbId };
  let mine;
  if (what === 'seen') {
    if (m.reaction) {
      api.unmark({ ...ref, list: 'ratings' });
      mine = { ...m, reaction: null, reasons: [], note: '' };
    } else mine = await saveRating(it, 'seen');
  } else if (what === 'want') {
    if (m.want) {
      api.unmark({ ...ref, list: 'watchlist' });
      mine = { ...m, want: false };
    } else mine = (await api.mark({ ...ref, list: 'watchlist' })).mine;
  } else if (what === 'pass') {
    if (m.passed) {
      api.unmark({ ...ref, list: 'passed' });
      mine = { ...m, passed: false };
    } else mine = (await api.mark({ ...ref, list: 'passed' })).mine;
  } else if (['love', 'like', 'dislike'].includes(what)) {
    // Tapping the active feeling again goes back to plain "seen".
    // Reasons carry over between love and like; they still apply.
    const same = ['love', 'like'].includes(m.reaction) && ['love', 'like'].includes(what);
    mine = m.reaction === what ? await saveRating(it, 'seen') : await saveRating(it, what, same ? m.reasons : [], same ? m.note : '');
  } else if (what === 'reason') {
    const reasons = m.reasons.includes(extra.reason) ? m.reasons.filter((x) => x !== extra.reason) : [...m.reasons, extra.reason];
    mine = await saveRating(it, m.reaction, reasons, extra.note ?? m.note);
  } else if (what === 'note') {
    mine = await saveRating(it, m.reaction, m.reasons, extra.note);
  } else return;
  const next = { ...it, mine };
  items.set(key, next);
  updateTiles(next);
  if (stack.at(-1)?.key === key) renderSheet(true);
  refresh();
  return { prev: m, next: mine };
}

const DONE_MSG = { seen: 'Marked seen.', want: 'Bookmarked.', pass: 'Passed.' };

// Seen, bookmark or pass from a poster: the title leaves the Find screen (and
// a More like this list), everything below moves up, and Undo puts it back.
// On My list it leaves the tab it no longer belongs to.
async function quick(key, what) {
  const { prev, next } = await act(key, what);
  const marked = next.reaction || next.want || next.passed;
  const belongs = { want: next.want, seen: !!next.reaction, passed: next.passed }[listShow];
  const leaving = [...document.querySelectorAll(`.tile[data-key="${key}"]`)].filter((el) =>
    (el.closest('[data-clear]') && marked) || (el.closest('#list-grid') && !belongs));
  if (!leaving.length) return;
  const spots = leaving.map((el) => ({ wall: el.parentElement, before: el.nextElementSibling, role: el.dataset.role }));
  leaving.forEach(removeTile);
  topUp();
  toast(marked ? DONE_MSG[what] : 'Removed.', async () => {
    await restore(key, prev);
    for (const { wall, before, role } of spots) {
      if (!wall.isConnected) continue;
      const html = tile({ ...items.get(key), role });
      if (before?.isConnected) before.insertAdjacentHTML('beforebegin', html);
      else wall.insertAdjacentHTML('beforeend', html);
    }
  });
}

function removeTile(el) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return el.remove();
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 200);
}

// Put a title's marks back exactly as they were before.
async function restore(key, prev) {
  const it = items.get(key);
  const ref = { type: it.type, tmdbId: it.tmdbId, imdbId: it.imdbId };
  for (const list of ['ratings', 'watchlist', 'passed']) api.unmark({ ...ref, list });
  let mine = { reaction: null, reasons: [], note: '', want: false, passed: false };
  if (prev.reaction) mine = await saveRating(it, prev.reaction, prev.reasons, prev.note);
  if (prev.want) mine = (await api.mark({ ...ref, list: 'watchlist' })).mine;
  if (prev.passed) mine = (await api.mark({ ...ref, list: 'passed' })).mine;
  const back = { ...it, mine };
  items.set(key, back);
  updateTiles(back);
  if (stack.at(-1)?.key === key) renderSheet(true);
  refresh();
}

document.addEventListener('click', async (e) => {
  const q = e.target.closest('[data-quick]');
  const a = e.target.closest('#sheet-body [data-act]');
  const r = e.target.closest('#sheet-body [data-reason]');
  try {
    if (q) return await quick(q.closest('.tile').dataset.key, q.dataset.quick);
    if (a) return await (['seen', 'want', 'pass'].includes(a.dataset.act) ? quick : act)(stack.at(-1).key, a.dataset.act);
    if (r) return await act(stack.at(-1).key, 'reason', { reason: r.dataset.reason, note: $('#note')?.value });
  } catch (err) { return toast(err.message); }
  const t = e.target.closest('[data-open]');
  if (t) return openSheet({ kind: 'title', key: t.closest('.tile').dataset.key });
  if (e.target.closest('#sheet-body [data-similar]')) return openSheet({ kind: 'similar', key: stack.at(-1).key });
  const p = e.target.closest('[data-person]');
  if (p) return openSheet({ kind: 'person', id: Number(p.dataset.person) });
});
document.addEventListener('change', (e) => {
  if (e.target.matches('#sheet-body [data-note]')) act(stack.at(-1).key, 'note', { note: e.target.value }).catch((err) => toast(err.message));
});
$('#sheet-close').addEventListener('click', () => closeSheet());
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(true); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) closeSheet(); });

// --- find: the Movies / Shows / Limited series toggle -------------------------------
const KIND_LABEL = { all: 'All', movie: 'Movies', show: 'Shows', limited: 'Limited series' };
let lastQuery = null;

function renderKinds() {
  $('#kinds').innerHTML = Object.entries(KIND_LABEL)
    .map(([k, l]) => `<button data-kind="${k}" class="${k === status.kind ? 'on' : ''}" aria-pressed="${k === status.kind}">${l}</button>`).join('');
}
$('#kinds').addEventListener('click', (e) => {
  const b = e.target.closest('[data-kind]');
  if (!b || b.dataset.kind === status.kind) return;
  api.settings({ kind: b.dataset.kind });
  refresh();
  renderKinds();
  if (browseState.category) loadBrowse();
  else if (lastQuery) runSearch(lastQuery);
});

// --- find: search and categories -----------------------------------------------
const browseState = { category: null, sub: null, page: 1, totalPages: 0 };
let categories = [];
let trueCrimeSubs = [];

function loadCategories() {
  ({ categories, trueCrime: trueCrimeSubs } = api.categories());
  $('#cats').innerHTML = categories.map((c) => `<button data-cat="${c.key}">${esc(c.name)}</button>`).join('');
}

function renderChips() {
  document.querySelectorAll('#cats button').forEach((x) => x.classList.toggle('on', x.dataset.cat === browseState.category));
  const subs = browseState.category === 'true-crime';
  $('#subcats').hidden = !subs;
  if (subs) {
    $('#subcats').innerHTML = [{ key: '', name: 'All true crime' }, ...trueCrimeSubs]
      .map((s) => `<button data-sub="${s.key}" class="${(browseState.sub ?? '') === s.key ? 'on' : ''}">${esc(s.name)}</button>`).join('');
  }
}

function openCategory(category, sub = null) {
  lastQuery = null;
  browseState.category = category;
  browseState.sub = sub;
  $('#q').value = '';
  $('#search-results').hidden = true;
  $('#browse-results').hidden = false;
  renderChips();
  loadBrowse();
}

async function loadBrowse(append = false) {
  if (!browseState.category || (append && browseState.loading)) return;
  browseState.loading = true;
  if (!append) { browseState.page = 1; $('#browse-grid').innerHTML = ''; }
  $('#more').hidden = true;
  const cat = categories.find((c) => c.key === browseState.category)?.name;
  const sub = trueCrimeSubs.find((s) => s.key === browseState.sub)?.name;
  $('#browse-title').hidden = false;
  $('#browse-title').textContent = sub ? `${cat} · ${sub}` : cat;
  $('#mine-toggle').hidden = !status.services.length;
  show('#browse-msg', 'Loading…');
  try {
    const r = await api.browse({
      category: browseState.category, sub: browseState.sub, page: browseState.page,
      onlyMine: $('#b-mine').checked,
    });
    browseState.totalPages = r.totalPages;
    renderWall('#browse-grid', r.items, append);
    const empty = status.kind === 'limited' || status.kind === 'show' || status.kind === 'movie'
      ? `Nothing here for ${KIND_LABEL[status.kind].toLowerCase()}. Try All.` : 'Nothing here yet. Try another category.';
    show('#browse-msg', $('#browse-grid').children.length ? legend() : empty);
    $('#more').hidden = browseState.page >= browseState.totalPages;
  } catch (e) { show('#browse-msg', e.message, true); }
  browseState.loading = false;
  topUp();
}

// As you clear posters off a category, quietly load the next page so the
// wall never runs dry.
function topUp() {
  const left = $('#browse-grid').querySelectorAll('.tile:not(.leaving)').length;
  if (browseState.category && !browseState.loading && left < 12 && browseState.page < browseState.totalPages) {
    browseState.page++;
    loadBrowse(true);
  }
}

const legend = () => (status.services.length
  ? 'Green ring = a service you have. Tap ✓, bookmark or ✕ and the poster moves off this screen.'
  : 'Tap a poster for cast and where to watch. Add your services in Settings to see which you already have.');

async function runSearch(q) {
  lastQuery = q;
  browseState.category = null;
  renderChips();
  $('#browse-results').hidden = true;
  $('#search-results').hidden = false;
  for (const id of ['#search-grid', '#topic-grid', '#people', '#suggest']) $(id).innerHTML = '';
  for (const id of ['#topic', '#people-block', '#titles-label']) $(id).hidden = true;
  show('#search-msg', 'Searching…');
  try {
    const r = await api.search(q);
    $('#suggest').innerHTML = r.suggestions
      .map((s) => `<button data-go-cat="${s.category}" data-go-sub="${s.sub ?? ''}">See all: ${esc(s.label)}</button>`).join('');
    if (r.people.length) {
      $('#people-block').hidden = false;
      $('#people').innerHTML = r.people.map((p) => `<button class="person" data-person="${p.id}">
        <span class="face">${p.profile ? `<img loading="lazy" src="${img('w185', p.profile)}" alt="">` : `<span>${esc(p.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>`}</span>
        <span class="pn">${esc(p.name)}</span>${p.dept ? `<span class="pc">${esc(p.dept === 'Acting' ? 'Actor' : p.dept)}</span>` : ''}
      </button>`).join('');
    }
    $('#titles-label').hidden = !r.items.length;
    renderWall('#search-grid', r.items);
    if (r.topic) {
      $('#topic').hidden = false;
      $('#topic-label').textContent = `About: ${r.topic.label}`;
      renderWall('#topic-grid', r.topic.items);
    }
    const n = r.items.length + (r.topic?.items.length ?? 0) + r.people.length;
    const hidden = r.hiddenByKind ? ` ${r.hiddenByKind} more match${r.hiddenByKind === 1 ? 'es' : ''} if you switch to All.` : '';
    show('#search-msg', (n ? legend() : r.suggestions.length ? 'No titles matched, but try the category above.' : 'Nothing matched. Try fewer words, or someone in the cast.') + hidden);
  } catch (e) { show('#search-msg', e.message, true); }
}

$('#cats').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (b) openCategory(b.dataset.cat);
});
$('#subcats').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sub]');
  if (b) openCategory('true-crime', b.dataset.sub || null);
});
$('#suggest').addEventListener('click', (e) => {
  const b = e.target.closest('[data-go-cat]');
  if (b) openCategory(b.dataset.goCat, b.dataset.goSub || null);
});
$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (!q) return;
  $('#q').blur(); // drop the phone keyboard so results are visible
  runSearch(q);
});
$('#b-mine').addEventListener('change', () => loadBrowse());
$('#more').addEventListener('click', () => { browseState.page++; loadBrowse(true); });

// --- my list ----------------------------------------------------------------------
const LIST_TABS = { want: 'Bookmarked', seen: 'Seen', passed: 'Passed' };
const LIST_EMPTY = {
  want: 'Nothing bookmarked yet. Tap the bookmark under any poster.',
  seen: "Nothing marked seen yet. Tap the check under any poster you've watched.",
  passed: 'Nothing passed yet. Tap the ✕ under anything you never want to see again.',
};
let listShow = 'want';

function renderListTabs() {
  $('#list-tabs').innerHTML = Object.entries(LIST_TABS)
    .map(([k, l]) => `<button data-show="${k}" class="${k === listShow ? 'on' : ''}">${l} <span class="count">${status.counts[k]}</span></button>`).join('');
}

async function loadList() {
  renderListTabs();
  if (!$('#list-grid').children.length) show('#list-msg', 'Loading…');
  try {
    const { items: list } = await api.list(listShow);
    renderWall('#list-grid', list);
    if (!list.length) return show('#list-msg', LIST_EMPTY[listShow]);
    const streaming = list.filter((i) => i.services.length).length;
    show('#list-msg', listShow === 'want' && status.services.length
      ? `${streaming} of ${list.length} streaming on your services now.`
      : '');
  } catch (e) { show('#list-msg', e.message, true); }
}
$('#list-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-show]');
  if (b && b.dataset.show !== listShow) {
    listShow = b.dataset.show;
    $('#list-grid').innerHTML = '';
    loadList();
  }
});

// --- settings ---------------------------------------------------------------------
async function loadProviders() {
  if (!status.hasKey) { $('#providers').innerHTML = ''; return; }
  try {
    const list = await api.providers(status.region);
    $('#providers').innerHTML = list.slice(0, 60).map((p) => `<label class="prov" title="${esc(p.name)}">
      <input type="checkbox" value="${p.id}" data-name="${esc(p.name)}" ${status.services.includes(p.id) ? 'checked' : ''}>
      ${p.logo ? `<img src="${img('w92', p.logo)}" alt="">` : ''}<span>${esc(p.name)}</span></label>`).join('');
    show('#settings-msg', '');
  } catch (e) { show('#settings-msg', e.message, true); }
}

function renderStatus() {
  $('#region').innerHTML = Object.entries(REGIONS).map(([c, n]) => `<option value="${c}" ${c === status.region ? 'selected' : ''}>${n}</option>`).join('');
  $('#key-card').hidden = DEMO || (status.hasKey && !keyRejected);
  $('#key-state').textContent = status.ownKey ? 'Using the key you pasted on this phone. ✓' : '';
  const total = status.counts.want + status.counts.seen;
  $('#list-count').textContent = total || '';
  if (!status.services.length) $('#b-mine').checked = false;
}

function refresh() {
  status = api.status();
  renderStatus();
}

$('#key-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  show('#key-msg', 'Checking…');
  try {
    await api.setKey($('#key').value);
    $('#key').value = '';
    keyRejected = false;
    show('#key-msg', 'That works. Now tick your streaming services below.');
    refresh();
    await loadProviders();
  } catch (err) {
    show('#key-msg', /rejected/.test(err.message) ? "TMDB didn't accept that key. Copy it again from your TMDB settings." : err.message, true);
  }
});

$('#providers').addEventListener('change', () => {
  const checked = [...document.querySelectorAll('#providers input:checked')];
  api.settings({ services: checked.map((i) => Number(i.value)), serviceNames: checked.map((i) => i.dataset.name) });
  refresh();
});
$('#region').addEventListener('change', async () => {
  api.settings({ region: $('#region').value, services: [] });
  refresh();
  await loadProviders();
});

$('#backup').addEventListener('click', () => {
  const blob = new Blob([api.exportData()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `what-to-watch-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#restore').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const r = api.importData(await file.text());
    show('#backup-msg', `Restored ${r.ratings} seen and ${r.watchlist} watchlist titles.`);
    refresh();
    await loadProviders();
  } catch (err) { show('#backup-msg', err.message, true); }
  e.target.value = '';
});

// Two taps to delete, instead of a confirm() dialog.
let resetArmed;
$('#reset').addEventListener('click', () => {
  const btn = $('#reset');
  if (!resetArmed) {
    btn.textContent = 'Tap again to delete your whole list';
    resetArmed = setTimeout(() => { resetArmed = null; btn.textContent = 'Delete my list'; }, 4000);
    return;
  }
  clearTimeout(resetArmed);
  resetArmed = null;
  btn.textContent = 'Delete my list';
  const keep = { region: status.region, services: status.services, serviceNames: status.serviceBrands };
  api.reset();
  api.settings(keep); // the list goes; your country and services stay
  toast('Your list is deleted.');
  refresh();
});

// --- views: Find, My list, Settings ------------------------------------------------
let view = 'find';
function openView(name) {
  view = name;
  document.querySelectorAll('.switch button').forEach((x) => x.classList.toggle('on', x.dataset.view === name));
  document.querySelectorAll('main > section').forEach((s) => (s.hidden = s.id !== name));
  $('#open-settings').classList.toggle('on', name === 'settings');
  if (name === 'list') loadList();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.switch button').forEach((b) => b.addEventListener('click', () => openView(b.dataset.view)));
$('#open-settings').addEventListener('click', () => openView(view === 'settings' ? 'find' : 'settings'));
$('#close-settings').addEventListener('click', () => {
  openView('find');
  if (browseState.category) loadBrowse(); // services may have changed
});

if (DEMO) {
  $('#demo-banner').hidden = false;
  $('#demo-exit').hidden = !!window.WTW_DEMO; // the preview page has nothing to exit to
  for (const id of ['#key-card', '#backup-card']) $(id).hidden = true;
}

refresh();
renderKinds();
loadCategories();
loadProviders();
if (!status.hasKey) openView('settings');
else openCategory('true-crime');

// Ask the browser not to clear our storage (Safari otherwise can after a week
// of not opening the site, unless it's been added to the home screen).
navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.WTW_DEMO) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
