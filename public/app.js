import { createApi, browserStore } from './lib/api.js';

const $ = (s) => document.querySelector(s);
const IMG = 'https://image.tmdb.org/t/p';
const REGIONS = {
  US: 'United States', CA: 'Canada', GB: 'United Kingdom', AU: 'Australia', NZ: 'New Zealand',
  IE: 'Ireland', DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy', NL: 'Netherlands',
  SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland', BR: 'Brazil', MX: 'Mexico',
  IN: 'India', JP: 'Japan', KR: 'South Korea',
};
const ACTIONS = [
  ['love', 'Loved it'],
  ['like', 'Liked it'],
  ['dislike', "Didn't like"],
];
const WHY = {
  good: ['Story', 'Characters', 'Acting', 'Funny', 'Suspense', 'Twists', 'Looks great', 'Rewatchable'],
  bad: ['Too slow', 'Boring', 'Too violent', 'Too dark', 'Bad ending', 'Bad acting', 'Not my genre', "Didn't finish"],
};

const api = createApi({ store: browserStore() });
let status;
const items = new Map(); // "type:id" -> item, shared by every tab

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const keyOf = (it) => `${it.type}:${it.tmdbId}`;

function show(id, msg, isErr) {
  const el = $(id);
  el.textContent = msg;
  el.className = 'msg' + (isErr ? ' err' : '');
}

// --- cards -----------------------------------------------------------------
function whereToWatch(it) {
  const have = new Set(status.services);
  const seen = new Set();
  const list = [...it.stream, ...it.free].filter((p) => !seen.has(p.id) && seen.add(p.id));
  list.sort((a, b) => Number(have.has(b.id)) - Number(have.has(a.id)));
  if (!list.length) {
    return `<span class="none">${it.rentBuy?.length ? 'Rent or buy only' : `Not streaming in ${status.region}`}</span>`;
  }
  return list.map((p) => {
    const img = p.logo ? `<img src="${IMG}/w92${p.logo}" alt="${esc(p.name)}">` : `<span class="pname">${esc(p.name)}</span>`;
    const cls = have.has(p.id) ? 'logo yours' : 'logo';
    return it.link
      ? `<a class="${cls}" title="${esc(p.name)}" href="${esc(it.link)}" target="_blank" rel="noopener">${img}</a>`
      : `<span class="${cls}" title="${esc(p.name)}">${img}</span>`;
  }).join('');
}

function card(it) {
  const m = it.mine ?? { reasons: [] };
  const meta = [
    it.year,
    it.type === 'tv' ? (it.seasons ? `${it.seasons} season${it.seasons > 1 ? 's' : ''}` : 'Show') : it.runtime ? `${it.runtime} min` : 'Movie',
    it.genres.slice(0, 3).join(', '),
  ].filter(Boolean).join(' · ');
  const why = m.reaction ? WHY[m.reaction === 'dislike' ? 'bad' : 'good'] : null;

  return `<article class="item${m.reaction ? ' marked' : ''}" data-key="${keyOf(it)}">
    <div class="top">
      ${it.poster ? `<img class="poster" loading="lazy" src="${IMG}/w185${it.poster}" alt="">` : '<div class="poster"></div>'}
      <div class="body">
        <h3>${it.imdbId ? `<a href="https://www.imdb.com/title/${it.imdbId}/" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title)}</h3>
        <p class="meta">${esc(meta)}</p>
        <div class="where">${whereToWatch(it)}</div>
        <p class="over">${esc(it.overview)}</p>
        ${it.because?.length ? `<p class="because">Because you liked ${it.because.map(esc).join(', ')}</p>` : ''}
      </div>
    </div>
    <div class="acts">
      ${ACTIONS.map(([k, label]) => `<button data-act="${k}" class="${k}${m.reaction === k ? ' on' : ''}">${label}</button>`).join('')}
      <button data-act="want" class="want${m.want ? ' on' : ''}">${m.want ? '✓ Watchlist' : '+ Watchlist'}</button>
    </div>
    ${why ? `<div class="why">
      <span class="whylabel">Why?</span>
      ${why.map((r) => `<button data-reason="${esc(r)}" class="${m.reasons.includes(r) ? 'on' : ''}">${esc(r)}</button>`).join('')}
      <input data-note placeholder="Anything else? (optional)" value="${esc(m.note)}" maxlength="300">
    </div>` : ''}
  </article>`;
}

function renderGrid(sel, list, append = false) {
  for (const it of list) items.set(keyOf(it), it);
  const html = list.map(card).join('');
  if (append) $(sel).insertAdjacentHTML('beforeend', html);
  else $(sel).innerHTML = html;
}

function rerender(it) {
  document.querySelectorAll(`[data-key="${keyOf(it)}"]`).forEach((el) => {
    const dim = el.classList.contains('dim');
    el.outerHTML = card(it);
    if (dim) document.querySelector(`[data-key="${keyOf(it)}"]`)?.classList.add('dim');
  });
}

async function saveRating(it, reaction, reasons, note) {
  it.mine = (await api.mark({ list: 'ratings', type: it.type, tmdbId: it.tmdbId, reaction, reasons, note })).mine;
}

async function onCard(e) {
  const el = e.target.closest('[data-key]');
  if (!el) return;
  const it = items.get(el.dataset.key);
  const m = it.mine ?? { reasons: [], note: '' };
  const ref = { type: it.type, tmdbId: it.tmdbId, imdbId: it.imdbId };
  const btn = e.target.closest('button');

  try {
    if (e.type === 'click' && btn?.dataset.act === 'want') {
      if (m.want) {
        api.unmark({ ...ref, list: 'watchlist' });
        it.mine = { ...m, want: false };
      } else {
        it.mine = (await api.mark({ ...ref, list: 'watchlist' })).mine;
      }
    } else if (e.type === 'click' && btn?.dataset.act) {
      const act = btn.dataset.act;
      if (m.reaction === act) {
        // Tapping the active reaction again clears it.
        api.unmark({ ...ref, list: 'ratings' });
        it.mine = { ...m, reaction: null, reasons: [], note: '' };
      } else {
        // Keep reasons when switching between love and like; they still apply.
        const samePolarity = m.reaction && (m.reaction === 'dislike') === (act === 'dislike');
        await saveRating(it, act, samePolarity ? m.reasons : [], samePolarity ? m.note : '');
      }
    } else if (e.type === 'click' && btn?.dataset.reason) {
      const r = btn.dataset.reason;
      const reasons = m.reasons.includes(r) ? m.reasons.filter((x) => x !== r) : [...m.reasons, r];
      // Read the note from the box in case it was typed but not yet saved.
      await saveRating(it, m.reaction, reasons, el.querySelector('[data-note]')?.value ?? m.note);
    } else if (e.type === 'change' && e.target.matches('[data-note]')) {
      await saveRating(it, m.reaction, m.reasons, e.target.value);
    } else return;
    rerender(it);
    refresh();
  } catch (err) {
    alert(err.message);
  }
}
document.addEventListener('click', onCard);
document.addEventListener('change', onCard);

// --- browse & search ---------------------------------------------------------
const browseState = { category: null, sub: null, page: 1, totalPages: 0 };
let trueCrimeSubs = [];

async function loadCategories() {
  const { categories, trueCrime } = api.categories();
  trueCrimeSubs = trueCrime;
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
  show('#browse-msg', 'Loading…');
  try {
    const r = await api.browse({
      category: browseState.category, sub: browseState.sub, page: browseState.page,
      type: $('#b-type').value, sort: $('#b-sort').value,
      onlyMine: $('#b-mine').checked, hideRated: $('#b-hide').checked,
    });
    browseState.totalPages = r.totalPages;
    renderGrid('#browse-grid', r.items, append);
    const count = $('#browse-grid').children.length;
    show('#browse-msg', count ? legend() : 'Nothing here with these filters.');
    $('#more').hidden = browseState.page >= browseState.totalPages;
  } catch (e) { show('#browse-msg', e.message, true); }
}

const legend = () => (status.services.length
  ? 'Green ring = a service you have. Tap a logo for every way to watch.'
  : 'Tick your services in Setup and they get a green ring.');

async function runSearch(q) {
  browseState.category = null;
  renderChips();
  $('#browse-results').hidden = true;
  $('#search-results').hidden = false;
  $('#search-grid').innerHTML = '';
  $('#topic').hidden = true;
  $('#suggest').innerHTML = '';
  show('#search-msg', 'Searching…');
  try {
    const r = await api.search(q);
    $('#suggest').innerHTML = r.suggestions
      .map((s) => `<button data-go-cat="${s.category}" data-go-sub="${s.sub ?? ''}">See all: ${esc(s.label)}</button>`).join('');
    renderGrid('#search-grid', r.items);
    if (r.topic) {
      $('#topic').hidden = false;
      $('#topic-label').textContent = `About: ${r.topic.label}`;
      renderGrid('#topic-grid', r.topic.items);
    }
    const n = r.items.length + (r.topic?.items.length ?? 0);
    show('#search-msg', n ? legend() : r.suggestions.length ? 'No titles matched, but try the category above.' : 'Nothing matched. Try fewer words, or a name from the cast.');
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

// --- for you / watchlist / my titles -----------------------------------------
async function loadRecs() {
  $('#foryou-grid').innerHTML = '';
  show('#foryou-msg', 'Working. The first run can take a minute.');
  try {
    const r = await api.recommendations({ type: $('#type').value, genre: $('#genre').value.trim() || null });
    if (r.reason === 'no-seeds') return show('#foryou-msg', 'Mark a few titles as Loved it or Liked it first. Browse is the quickest way.');
    if (!r.items.length) return show('#foryou-msg', status.services.length ? 'Nothing matched your services. Try another filter, or count rent/buy in Setup.' : 'No results.');
    show('#foryou-msg', status.services.length ? "Only showing what's on your services." : 'Not filtered by service yet. Tick yours in Setup.');
    renderGrid('#foryou-grid', r.items);
  } catch (e) { show('#foryou-msg', e.message, true); }
}

async function loadWatchlist() {
  $('#watchlist-grid').innerHTML = '';
  show('#watchlist-msg', 'Checking…');
  try {
    const { items: list } = await api.watchlist();
    if (!list.length) return show('#watchlist-msg', 'Nothing here yet. Tap "+ Watchlist" on anything in Browse.');
    const ready = list.filter((i) => i.available);
    show('#watchlist-msg', `${ready.length} of ${list.length} are streaming now${status.services.length ? ' on your services' : ''}.`);
    renderGrid('#watchlist-grid', list);
    list.forEach((i) => !i.available && document.querySelector(`#watchlist-grid [data-key="${keyOf(i)}"]`)?.classList.add('dim'));
  } catch (e) { show('#watchlist-msg', e.message, true); }
}

let mineShow = 'love';
async function loadMine() {
  $('#mine-grid').innerHTML = '';
  show('#mine-msg', 'Loading…');
  try {
    const r = await api.titles(mineShow);
    const labels = { love: 'Loved', like: 'Liked', dislike: "Didn't like", want: 'Want to watch' };
    $('#mine-tabs').innerHTML = Object.entries(labels)
      .map(([k, l]) => `<button data-show="${k}" class="${k === mineShow ? 'on' : ''}">${l} (${r.counts[k]})</button>`).join('');
    show('#mine-msg', r.items.length ? '' : 'Nothing here yet.');
    renderGrid('#mine-grid', r.items);
  } catch (e) { show('#mine-msg', e.message, true); }
}
$('#mine-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-show]');
  if (b) { mineShow = b.dataset.show; loadMine(); }
});

// --- setup -------------------------------------------------------------------
async function loadProviders() {
  if (!status.hasKey) { $('#providers').innerHTML = ''; return; }
  try {
    const list = await api.providers(status.region);
    $('#providers').innerHTML = list.slice(0, 60).map((p) => `<label class="prov" title="${esc(p.name)}">
      <input type="checkbox" value="${p.id}" ${status.services.includes(p.id) ? 'checked' : ''}>
      ${p.logo ? `<img src="${IMG}/w92${p.logo}" alt="">` : ''}<span>${esc(p.name)}</span></label>`).join('');
    show('#settings-msg', '');
  } catch (e) { show('#settings-msg', e.message, true); }
}

function saveSettings() {
  const services = [...document.querySelectorAll('#providers input:checked')].map((i) => Number(i.value));
  api.settings({ services, includeRentBuy: $('#rentbuy').checked, minSeedRating: Number($('#minseed').value) });
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
  $('#key-card').classList.toggle('done', status.hasKey);
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

$('#reset').addEventListener('click', async () => {
  if (!confirm('Delete everything you marked and set up on this phone?')) return;
  api.reset();
  refresh();
  await loadProviders();
});

// --- tabs ------------------------------------------------------------------
function openTab(name) {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x.dataset.tab === name));
  document.querySelectorAll('main > section').forEach((s) => (s.hidden = s.id !== name));
  if (name === 'watchlist') loadWatchlist();
  if (name === 'mine') loadMine();
  window.scrollTo(0, 0);
}
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => openTab(b.dataset.tab)));
$('#go').addEventListener('click', loadRecs);

refresh();
loadCategories();
loadProviders();
if (!status.hasKey) openTab('setup');

// Ask the browser not to clear our storage (Safari otherwise can after a week
// of not opening the site, unless it's been added to the home screen).
navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
