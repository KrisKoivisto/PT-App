import { createApi, browserStore, safeStorage } from './lib/api.js';
import { demoFetch } from './lib/demo.js';
import { reasonsFor } from './lib/reasons.js';

const $ = (s) => document.querySelector(s);
const IMG = 'https://image.tmdb.org/t/p';
const REGIONS = {
  US: 'United States', CA: 'Canada', GB: 'United Kingdom', AU: 'Australia', NZ: 'New Zealand',
  IE: 'Ireland', DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy', NL: 'Netherlands',
  SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland', BR: 'Brazil', MX: 'Mexico',
  IN: 'India', JP: 'Japan', KR: 'South Korea',
};
const REACTIONS = [
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
};
const icon = (name, filled = false) => `<svg class="i${filled ? ' fill' : ''}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name]}</svg>`;
const BADGE = { love: 'heart', like: 'up', dislike: 'down' };

// Sample mode: made-up titles and no TMDB key needed. On with ?demo, or when
// the page that loads this sets window.WTW_DEMO (the shareable preview).
const DEMO = !!window.WTW_DEMO || new URLSearchParams(location.search).has('demo');
const store = DEMO ? browserStore(safeStorage(), 'wtw.demo.') : browserStore();
if (DEMO && !store.loadKey()) {
  store.saveKey('sample');
  store.saveProfile({ services: [8, 15] }); // Netflix and Hulu, so the rings show
}
const api = createApi({ store, fetchImpl: DEMO ? demoFetch : undefined });
const img = (size, path) => (path.startsWith('data:') ? path : `${IMG}/${size}${path}`);

let status;
const items = new Map(); // "type:id" -> latest item, shared by every view

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const keyOf = (it) => `${it.type}:${it.tmdbId}`;

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

function show(id, msg, isErr) {
  const el = $(id);
  el.textContent = msg;
  el.className = 'msg' + (isErr ? ' err' : '');
}

// Streaming (and free) services for a title, yours first.
function services(it) {
  const have = new Set(status.services);
  const seen = new Set();
  return [...it.stream, ...it.free]
    .filter((p) => !seen.has(p.id) && seen.add(p.id))
    .map((p) => ({ ...p, yours: have.has(p.id) }))
    .sort((a, b) => Number(b.yours) - Number(a.yours));
}

const logoImg = (p, size = 'w92') => (p.logo
  ? `<img src="${img(size, p.logo)}" alt="${esc(p.name)}">`
  : `<span class="logo-text">${esc(p.name.slice(0, 2))}</span>`);

// --- poster tiles --------------------------------------------------------------
function tile(it) {
  const m = it.mine ?? {};
  const where = services(it);
  const badge = m.reaction ? BADGE[m.reaction] : m.want ? 'bookmark' : null;
  const sub = it.role || [it.year, it.type === 'tv' ? 'Series' : 'Film'].filter(Boolean).join(' · ');
  return `<button class="tile${it.available === false ? ' dim' : ''}" data-key="${keyOf(it)}"${it.role ? ` data-role="${esc(it.role)}"` : ''}${it.available === false ? ' data-dim' : ''}>
    <span class="poster">
      ${it.poster ? `<img loading="lazy" src="${img('w342', it.poster)}" alt="">` : `<span class="noposter">${esc(it.title)}</span>`}
      ${badge ? `<span class="badge b-${m.reaction ?? 'want'}" title="${m.reaction ? 'You rated this' : 'On your watchlist'}">${icon(badge, true)}</span>` : ''}
      <span class="stamps">${where.length
        ? where.slice(0, 3).map((p) => `<span class="stamp${p.yours ? ' yours' : ''}" title="${esc(p.name)}">${logoImg(p)}</span>`).join('')
          + (where.length > 3 ? `<span class="stamp more">+${where.length - 3}</span>` : '')
        : `<span class="stamp none">${it.rentBuy?.length ? 'Rent/buy' : 'Not streaming'}</span>`}</span>
    </span>
    <span class="t">${esc(it.title)}</span>
    <span class="y">${esc(sub)}</span>
  </button>`;
}

// Role (on a person page) and availability (on the watchlist) belong to the
// view the poster is in, so they're passed along per wall, not stored.
const inView = (it) => ({ ...items.get(keyOf(it)), role: it.role, available: it.available });

function renderWall(sel, list, append = false) {
  for (const it of list) remember(it);
  const html = list.map((it) => tile(inView(it))).join('');
  if (append) $(sel).insertAdjacentHTML('beforeend', html);
  else $(sel).innerHTML = html;
}

// Keep the latest copy of each title without losing what other views know.
function remember(it) {
  const { role, available, ...rest } = it;
  items.set(keyOf(it), { ...items.get(keyOf(it)), ...rest });
}

function updateTiles(it) {
  document.querySelectorAll(`.tile[data-key="${keyOf(it)}"]`).forEach((el) => {
    el.outerHTML = tile({ ...it, role: el.dataset.role, available: 'dim' in el.dataset ? false : undefined });
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
    return;
  }
  const top = stack.at(-1);
  const scroll = panel.scrollTop;
  sheet.hidden = false;
  document.body.classList.add('locked');
  $('#sheet-close').innerHTML = stack.length > 1 ? icon('back') : icon('x');
  $('#sheet-close').setAttribute('aria-label', stack.length > 1 ? 'Back' : 'Close');
  $('#sheet-body').innerHTML = top.kind === 'title' ? titleView(top) : personView(top);
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
  const why = m.reaction ? reasonsFor(it, m.reaction, m.reasons) : null;
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
      <div class="takes">
        ${REACTIONS.map(([k, label, ic]) => `<button data-act="${k}" class="take ${k}${m.reaction === k ? ' on' : ''}" aria-pressed="${m.reaction === k}">${icon(ic, m.reaction === k)}<span>${label}</span></button>`).join('')}
        <button data-act="want" class="take want${m.want ? ' on' : ''}" aria-pressed="${!!m.want}">${icon('bookmark', m.want)}<span>${m.want ? 'On watchlist' : 'Watchlist'}</span></button>
      </div>
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
    ${it.imdbId ? `<p class="imdb"><a href="https://www.imdb.com/title/${it.imdbId}/" target="_blank" rel="noopener">Open on IMDb ›</a></p>` : ''}`;
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

// --- reacting -------------------------------------------------------------------
async function saveRating(it, reaction, reasons, note) {
  return (await api.mark({ list: 'ratings', type: it.type, tmdbId: it.tmdbId, reaction, reasons, note })).mine;
}

async function onSheet(e) {
  const top = stack.at(-1);
  if (!top || top.kind !== 'title' || !e.target.closest('#sheet-body')) return;
  const it = items.get(top.key);
  const m = it.mine ?? { reasons: [], note: '' };
  const ref = { type: it.type, tmdbId: it.tmdbId, imdbId: it.imdbId };
  const btn = e.target.closest('button');
  let mine;
  try {
    if (e.type === 'click' && btn?.dataset.act === 'want') {
      if (m.want) {
        api.unmark({ ...ref, list: 'watchlist' });
        mine = { ...m, want: false };
      } else {
        mine = (await api.mark({ ...ref, list: 'watchlist' })).mine;
        toast('Added to your watchlist.');
      }
    } else if (e.type === 'click' && btn?.dataset.act) {
      const act = btn.dataset.act;
      if (m.reaction === act) {
        // Tapping the active reaction again clears it.
        api.unmark({ ...ref, list: 'ratings' });
        mine = { ...m, reaction: null, reasons: [], note: '' };
      } else {
        // Keep reasons when switching between love and like; they still apply.
        const same = m.reaction && (m.reaction === 'dislike') === (act === 'dislike');
        mine = await saveRating(it, act, same ? m.reasons : [], same ? m.note : '');
      }
    } else if (e.type === 'click' && btn?.dataset.reason) {
      const r = btn.dataset.reason;
      const reasons = m.reasons.includes(r) ? m.reasons.filter((x) => x !== r) : [...m.reasons, r];
      mine = await saveRating(it, m.reaction, reasons, $('#note')?.value ?? m.note);
    } else if (e.type === 'change' && e.target.matches('[data-note]')) {
      mine = await saveRating(it, m.reaction, m.reasons, e.target.value);
    } else return;
    const next = { ...it, mine };
    items.set(top.key, next);
    renderSheet(true);
    updateTiles(next);
    refresh();
  } catch (err) {
    toast(err.message);
  }
}
document.addEventListener('click', onSheet);
document.addEventListener('change', onSheet);

document.addEventListener('click', (e) => {
  const t = e.target.closest('.tile');
  if (t) return openSheet({ kind: 'title', key: t.dataset.key });
  const p = e.target.closest('[data-person]');
  if (p) return openSheet({ kind: 'person', id: Number(p.dataset.person) });
});
$('#sheet-close').addEventListener('click', () => closeSheet());
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(true); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) closeSheet(); });

// --- browse & search ------------------------------------------------------------
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
  browseState.category = category;
  browseState.sub = sub;
  $('#q').value = '';
  $('#search-results').hidden = true;
  $('#browse-results').hidden = false;
  renderChips();
  loadBrowse();
}

async function loadBrowse(append = false) {
  if (!browseState.category) return;
  if (!append) { browseState.page = 1; $('#browse-grid').innerHTML = ''; }
  $('#more').hidden = true;
  const cat = categories.find((c) => c.key === browseState.category)?.name;
  const sub = trueCrimeSubs.find((s) => s.key === browseState.sub)?.name;
  $('#browse-title').hidden = false;
  $('#browse-title').textContent = sub ? `${cat} · ${sub}` : cat;
  show('#browse-msg', 'Loading…');
  try {
    const r = await api.browse({
      category: browseState.category, sub: browseState.sub, page: browseState.page,
      type: $('#b-type').value, sort: $('#b-sort').value,
      onlyMine: $('#b-mine').checked, hideRated: $('#b-hide').checked,
    });
    browseState.totalPages = r.totalPages;
    renderWall('#browse-grid', r.items, append);
    show('#browse-msg', $('#browse-grid').children.length ? legend() : 'Nothing here with these filters.');
    $('#more').hidden = browseState.page >= browseState.totalPages;
  } catch (e) { show('#browse-msg', e.message, true); }
}

const legend = () => (status.services.length
  ? 'Green ring = a service you have. Tap a poster for cast and every way to watch.'
  : 'Tap a poster for cast and where to watch. Tick your services in Setup to see which you already have.');

async function runSearch(q) {
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
    show('#search-msg', n ? legend() : r.suggestions.length ? 'No titles matched, but try the category above.' : 'Nothing matched. Try fewer words, or someone in the cast.');
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
for (const id of ['#b-type', '#b-sort', '#b-mine', '#b-hide']) {
  $(id).addEventListener('change', () => browseState.category && loadBrowse());
}
$('#more').addEventListener('click', () => { browseState.page++; loadBrowse(true); });

// --- for you / watchlist / seen -----------------------------------------------
async function loadRecs() {
  $('#foryou-grid').innerHTML = '';
  show('#foryou-msg', 'Working. The first run can take a minute.');
  try {
    const r = await api.recommendations({ type: $('#type').value, genre: $('#genre').value.trim() || null });
    if (r.reason === 'no-seeds') return show('#foryou-msg', 'Mark a few titles as Loved it or Liked it first. Tap any poster in Search to do that.');
    if (!r.items.length) return show('#foryou-msg', status.services.length ? 'Nothing matched your services. Try another filter, or count rent/buy in Setup.' : 'No results.');
    show('#foryou-msg', status.services.length ? "Only showing what's on your services." : 'Not filtered by service yet. Tick yours in Setup.');
    renderWall('#foryou-grid', r.items);
  } catch (e) { show('#foryou-msg', e.message, true); }
}

async function loadWatchlist() {
  $('#watchlist-grid').innerHTML = '';
  show('#watchlist-msg', 'Checking…');
  try {
    const { items: list } = await api.watchlist();
    if (!list.length) return show('#watchlist-msg', 'Nothing here yet. Tap a poster, then Watchlist.');
    const ready = list.filter((i) => i.available);
    show('#watchlist-msg', `${ready.length} of ${list.length} streaming now${status.services.length ? ' on your services' : ''}. Faded ones aren't.`);
    renderWall('#watchlist-grid', list);
  } catch (e) { show('#watchlist-msg', e.message, true); }
}

let mineShow = 'love';
async function loadMine() {
  $('#mine-grid').innerHTML = '';
  show('#mine-msg', 'Loading…');
  try {
    const r = await api.titles(mineShow);
    const labels = { love: 'Loved', like: 'Liked', dislike: 'Not for me', want: 'Watchlist' };
    $('#mine-tabs').innerHTML = Object.entries(labels)
      .map(([k, l]) => `<button data-show="${k}" class="${k === mineShow ? 'on' : ''}">${l} <span class="count">${r.counts[k]}</span></button>`).join('');
    show('#mine-msg', r.items.length ? '' : 'Nothing here yet. Tap any poster to mark it.');
    renderWall('#mine-grid', r.items);
  } catch (e) { show('#mine-msg', e.message, true); }
}
$('#mine-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-show]');
  if (b) { mineShow = b.dataset.show; loadMine(); }
});

// --- setup ----------------------------------------------------------------------
async function loadProviders() {
  if (!status.hasKey) { $('#providers').innerHTML = ''; return; }
  try {
    const list = await api.providers(status.region);
    $('#providers').innerHTML = list.slice(0, 60).map((p) => `<label class="prov" title="${esc(p.name)}">
      <input type="checkbox" value="${p.id}" ${status.services.includes(p.id) ? 'checked' : ''}>
      ${p.logo ? `<img src="${img('w92', p.logo)}" alt="">` : ''}<span>${esc(p.name)}</span></label>`).join('');
    show('#settings-msg', '');
  } catch (e) { show('#settings-msg', e.message, true); }
}

function saveSettings() {
  const svc = [...document.querySelectorAll('#providers input:checked')].map((i) => Number(i.value));
  api.settings({ services: svc, includeRentBuy: $('#rentbuy').checked, minSeedRating: Number($('#minseed').value) });
  refresh();
}

function renderStatus() {
  $('#region').innerHTML = Object.entries(REGIONS).map(([c, n]) => `<option value="${c}" ${c === status.region ? 'selected' : ''}>${n}</option>`).join('');
  $('#rentbuy').checked = status.includeRentBuy;
  $('#minseed').innerHTML = [10, 9, 8, 7, 6].map((n) => `<option ${n === status.minSeedRating ? 'selected' : ''}>${n}</option>`).join('');
  $('#taste').textContent = status.ratings
    ? `${status.ratings} rated and ${status.watchlist} on your watchlist.${status.topGenres.length ? ' You rate these highest: ' + status.topGenres.join(', ') + '.' : ''}`
    : 'Nothing marked yet.';
  $('#genres').innerHTML = status.topGenres.map((g) => `<option value="${esc(g)}">`).join('');
  $('#b-mine').disabled = !status.services.length;
  if (!status.services.length) $('#b-mine').checked = false;
  $('#key-state').textContent = status.hasKey ? 'Key saved on this phone. ✓' : '';
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
    show('#key-msg', 'That works.');
    refresh();
    await loadProviders();
  } catch (err) {
    show('#key-msg', /rejected/.test(err.message) ? "TMDB didn't accept that key. Copy it again from your TMDB settings." : err.message, true);
  }
});

$('#rentbuy').addEventListener('change', saveSettings);
$('#minseed').addEventListener('change', saveSettings);
$('#providers').addEventListener('change', saveSettings);
$('#region').addEventListener('change', async () => {
  api.settings({ region: $('#region').value, services: [] });
  refresh();
  await loadProviders();
});

document.querySelectorAll('[data-import]').forEach((input) => input.addEventListener('change', async () => {
  const file = input.files[0];
  if (!file) return;
  try {
    const r = api.importCsv(await file.text());
    show('#import-msg', `Imported ${r.count} ${r.kind === 'ratings' ? 'rated titles' : 'watchlist titles'}.`);
    refresh();
  } catch (e) { show('#import-msg', e.message, true); }
  input.value = '';
}));

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
    show('#backup-msg', `Restored ${r.ratings} rated and ${r.watchlist} watchlist titles.`);
    refresh();
    await loadProviders();
  } catch (err) { show('#backup-msg', err.message, true); }
  e.target.value = '';
});

// Two taps to delete, instead of a confirm() dialog.
let resetArmed;
$('#reset').addEventListener('click', async () => {
  const btn = $('#reset');
  if (!resetArmed) {
    btn.textContent = 'Tap again to delete everything';
    resetArmed = setTimeout(() => { resetArmed = null; btn.textContent = 'Delete my data'; }, 4000);
    return;
  }
  clearTimeout(resetArmed);
  resetArmed = null;
  btn.textContent = 'Delete my data';
  api.reset();
  toast('Deleted.');
  refresh();
  await loadProviders();
});

// --- tabs -------------------------------------------------------------------------
function openTab(name) {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x.dataset.tab === name));
  document.querySelectorAll('main > section').forEach((s) => (s.hidden = s.id !== name));
  if (name === 'watchlist') loadWatchlist();
  if (name === 'mine') loadMine();
  window.scrollTo(0, 0);
}
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => openTab(b.dataset.tab)));
$('#go').addEventListener('click', loadRecs);

if (DEMO) {
  $('#demo-banner').hidden = false;
  $('#demo-exit').hidden = !!window.WTW_DEMO; // the preview page has nothing to exit to
  for (const id of ['#key-card', '#backup-card', '#imdb-card']) $(id).hidden = true;
}

refresh();
loadCategories();
loadProviders();
if (!status.hasKey) openTab('setup');
else if (DEMO) openCategory('true-crime');

// Ask the browser not to clear our storage (Safari otherwise can after a week
// of not opening the site, unless it's been added to the home screen).
navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.WTW_DEMO) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
