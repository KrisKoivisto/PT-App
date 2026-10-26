const $ = (s) => document.querySelector(s);
const IMG = 'https://image.tmdb.org/t/p';
const REGIONS = {
  US: 'United States', CA: 'Canada', GB: 'United Kingdom', AU: 'Australia', NZ: 'New Zealand',
  IE: 'Ireland', DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy', NL: 'Netherlands',
  SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland', BR: 'Brazil', MX: 'Mexico',
  IN: 'India', JP: 'Japan', KR: 'South Korea',
};

let status;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function card(it) {
  const where = it.services?.length ? it.services : [...it.stream, ...it.free];
  const meta = [it.year, it.type === 'tv' ? (it.seasons ? `${it.seasons} season${it.seasons > 1 ? 's' : ''}` : 'Show') : it.runtime ? `${it.runtime} min` : null, it.genres.slice(0, 3).join(', ')].filter(Boolean).join(' · ');
  return `<article class="item">
    ${it.poster ? `<img loading="lazy" src="${IMG}/w342${it.poster}" alt="">` : '<div class="noposter"></div>'}
    <div class="body">
      <h3>${it.imdbId ? `<a href="https://www.imdb.com/title/${it.imdbId}/" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title)}</h3>
      <p class="meta">${esc(meta)}</p>
      <p class="over">${esc(it.overview)}</p>
      ${it.because?.length ? `<p class="because">Because you liked ${it.because.map(esc).join(', ')}</p>` : ''}
      <div class="logos">${where.map((p) => p.logo ? `<img title="${esc(p.name)}" src="${IMG}/w45${p.logo}" alt="${esc(p.name)}">` : `<span>${esc(p.name)}</span>`).join('')}</div>
    </div>
  </article>`;
}

function show(id, msg, isErr) {
  const el = $(id);
  el.textContent = msg;
  el.className = 'msg' + (isErr ? ' err' : '');
}

async function loadRecs() {
  $('#foryou-grid').innerHTML = '';
  show('#foryou-msg', 'Working. The first run can take a minute while it looks things up.');
  try {
    const q = new URLSearchParams({ type: $('#type').value });
    if ($('#genre').value.trim()) q.set('genre', $('#genre').value.trim());
    const r = await api('/api/recommendations?' + q);
    if (r.reason === 'no-seeds') return show('#foryou-msg', `Nothing rated ${status.minSeedRating}+ yet. Rate a few favorites on the My titles tab.`);
    if (!r.items.length) return show('#foryou-msg', status.services.length ? 'Nothing matched your services. Try a different filter, or turn on rent/buy.' : 'No results.');
    show('#foryou-msg', status.services.length ? '' : 'No services selected, so these are not filtered by what you can stream.');
    $('#foryou-grid').innerHTML = r.items.map(card).join('');
  } catch (e) { show('#foryou-msg', e.message, true); }
}

async function loadWatchlist() {
  $('#watchlist-grid').innerHTML = '';
  show('#watchlist-msg', 'Checking…');
  try {
    const { items } = await api('/api/watchlist');
    if (!items.length) return show('#watchlist-msg', 'Nothing here yet. Add titles on the My titles tab, or import your IMDb watchlist in Setup.');
    const ready = items.filter((i) => i.available);
    show('#watchlist-msg', `${ready.length} of ${items.length} are streaming now${status.services.length ? ' on your services' : ''}.`);
    $('#watchlist-grid').innerHTML = items.map((i) => `<div class="${i.available ? '' : 'dim'}">${card(i)}</div>`).join('');
  } catch (e) { show('#watchlist-msg', e.message, true); }
}

async function loadProviders() {
  if (!status.hasKey) return show('#settings-msg', 'Add TMDB_API_KEY to .env and restart to pick services.', true);
  try {
    const list = await api('/api/providers?region=' + status.region);
    $('#providers').innerHTML = list.slice(0, 60).map((p) => `<label class="prov" title="${esc(p.name)}">
      <input type="checkbox" value="${p.id}" ${status.services.includes(p.id) ? 'checked' : ''}>
      ${p.logo ? `<img src="${IMG}/w92${p.logo}" alt="">` : ''}<span>${esc(p.name)}</span></label>`).join('');
  } catch (e) { show('#settings-msg', e.message, true); }
}

async function saveSettings() {
  const services = [...document.querySelectorAll('#providers input:checked')].map((i) => Number(i.value));
  await api('/api/settings', { method: 'POST', body: { services, includeRentBuy: $('#rentbuy').checked, minSeedRating: Number($('#minseed').value) } });
  await refresh();
}

function renderStatus() {
  $('#region').innerHTML = Object.entries(REGIONS).map(([c, n]) => `<option value="${c}" ${c === status.region ? 'selected' : ''}>${n}</option>`).join('');
  $('#rentbuy').checked = status.includeRentBuy;
  $('#minseed').innerHTML = [10, 9, 8, 7, 6].map((n) => `<option ${n === status.minSeedRating ? 'selected' : ''}>${n}</option>`).join('');
  $('#taste').textContent = status.ratings ? `${status.ratings} ratings and ${status.watchlist} watchlist titles imported.${status.topGenres.length ? ' You rate these highest: ' + status.topGenres.join(', ') + '.' : ''}` : 'Nothing imported yet.';
  $('#genres').innerHTML = status.topGenres.map((g) => `<option value="${esc(g)}">`).join('');
}

async function refresh() {
  status = await api('/api/status');
  renderStatus();
}

document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('main > section').forEach((s) => (s.hidden = s.id !== b.dataset.tab));
  if (b.dataset.tab === 'watchlist') loadWatchlist();
  if (b.dataset.tab === 'mine') loadMine();
}));

$('#go').addEventListener('click', loadRecs);
$('#rentbuy').addEventListener('change', saveSettings);
$('#minseed').addEventListener('change', saveSettings);
$('#providers').addEventListener('change', saveSettings);
$('#region').addEventListener('change', async () => {
  await api('/api/settings', { method: 'POST', body: { region: $('#region').value, services: [] } });
  await refresh();
  await loadProviders();
});

document.querySelectorAll('[data-import]').forEach((input) => input.addEventListener('change', async () => {
  const file = input.files[0];
  if (!file) return;
  try {
    const r = await api('/api/import', { method: 'POST', body: { csv: await file.text() } });
    show('#import-msg', `Imported ${r.count} ${r.kind === 'ratings' ? 'rated titles' : 'watchlist titles'}.`);
    await refresh();
  } catch (e) { show('#import-msg', e.message, true); }
  input.value = '';
}));

$('#reset').addEventListener('click', async () => {
  if (!confirm('Delete imported ratings, watchlist and settings?')) return;
  await api('/api/profile', { method: 'DELETE' });
  await refresh();
  await loadProviders();
});

// --- My titles ---------------------------------------------------------------
const ratingSelect = (val) => `<select data-rate><option value="">Rate</option>${[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => `<option ${n === val ? 'selected' : ''}>${n}</option>`).join('')}</select>`;

function row(t, controls) {
  return `<div class="row" data-type="${t.type}" data-id="${t.tmdbId}">
    ${t.poster ? `<img src="${IMG}/w92${t.poster}" alt="">` : '<div class="noposter"></div>'}
    <div class="name"><b>${esc(t.title)}</b> <span class="meta">${t.year ?? ''} · ${t.type === 'tv' ? 'Show' : 'Movie'}</span></div>
    <div class="ctl">${controls}</div>
  </div>`;
}

async function loadMine() {
  try {
    const { ratings, watchlist } = await api('/api/titles');
    $('#mine-ratings').innerHTML = ratings.length
      ? ratings.slice().reverse().map((t) => row(t, `${ratingSelect(t.rating)}<button data-remove="ratings">Remove</button>`)).join('')
      : '<p class="msg">Nothing rated here yet.</p>';
    $('#mine-watchlist').innerHTML = watchlist.length
      ? watchlist.slice().reverse().map((t) => row(t, `${ratingSelect(null)}<button data-remove="watchlist">Remove</button>`)).join('')
      : '<p class="msg">Nothing added here yet.</p>';
  } catch (e) { show('#search-msg', e.message, true); }
}

$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (!q) return;
  try {
    const results = await api('/api/search?q=' + encodeURIComponent(q));
    show('#search-msg', results.length ? '' : 'No matches.');
    $('#results').innerHTML = results.map((t) => row(t, `${ratingSelect(null)}<button data-want>Want to watch</button>`)).join('');
  } catch (err) { show('#search-msg', err.message, true); }
});

// One handler for every row: search results and both lists.
async function onRow(e) {
  const r = e.target.closest('.row');
  if (!r) return;
  const ref = { type: r.dataset.type, tmdbId: Number(r.dataset.id) };
  try {
    if (e.type === 'change' && e.target.matches('[data-rate]') && e.target.value) {
      const t = await api('/api/titles', { method: 'POST', body: { ...ref, list: 'ratings', rating: Number(e.target.value) } });
      show('#search-msg', `Rated ${t.title} ${t.rating}/10.`);
    } else if (e.type === 'click' && e.target.matches('[data-want]')) {
      const t = await api('/api/titles', { method: 'POST', body: { ...ref, list: 'watchlist' } });
      show('#search-msg', `Added ${t.title} to your watchlist.`);
    } else if (e.type === 'click' && e.target.matches('[data-remove]')) {
      await api('/api/titles/remove', { method: 'POST', body: { ...ref, list: e.target.dataset.remove } });
    } else return;
    await Promise.all([loadMine(), refresh()]);
  } catch (err) { show('#search-msg', err.message, true); }
}
$('#mine').addEventListener('change', onRow);
$('#mine').addEventListener('click', onRow);

await refresh();
await loadProviders();
if (!status.hasKey) document.querySelector('[data-tab=setup]').click();
else if (!status.ratings) document.querySelector('[data-tab=mine]').click();
