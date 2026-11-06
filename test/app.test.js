import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApi, browserStore } from '../public/lib/api.js';
import { matchCategories } from '../public/lib/browse.js';
import { demoFetch } from '../public/lib/demo.js';
import { reasonsFor, kindOf } from '../public/lib/reasons.js';
import { discoverParams, applyView, cleanView, describeView, activeFilters } from '../public/lib/filters.js';
import { createServer } from '../server.js';
import { encodeSeen, decodeSeen } from '../public/lib/sync.js';
import { scoreOf } from '../public/lib/mine.js';

// --- fake TMDB ------------------------------------------------------------------
const NETFLIX = { provider_id: 8, provider_name: 'Netflix', logo_path: '/n.jpg' };
const HULU = { provider_id: 15, provider_name: 'Hulu', logo_path: '/h.jpg' };
const detail = (id, name, imdb, flatrate, extra = {}) => ({
  id, title: name, name, release_date: '2020-05-01', overview: 'o', genres: [{ name: 'Documentary' }, { name: 'Crime' }],
  runtime: 100, vote_average: 8, vote_count: 500, poster_path: `/p${id}.jpg`, backdrop_path: `/b${id}.jpg`,
  external_ids: { imdb_id: imdb },
  'watch/providers': { results: { US: { flatrate, rent: [HULU], link: 'https://tmdb/watch' } } }, ...extra,
});
const DB = {
  '/configuration': (u) => (u.searchParams.get('api_key') === 'bad' ? 401 : { images: {} }),
  '/movie/1': detail(1, 'Vault Job', 'tt1', [NETFLIX]),
  '/movie/2': detail(2, 'Con Man', 'tt2', [HULU]),
  '/tv/3': detail(3, 'Cold Trail', 'tt3', [NETFLIX], { number_of_seasons: 2, runtime: undefined }),
  '/movie/4': detail(4, 'Nowhere Doc', 'tt4', []),
  '/movie/1/credits': { cast: [{ id: 90, name: 'Ann Lee', character: 'Self', profile_path: '/a.jpg' }, ...Array.from({ length: 30 }, (_, i) => ({ id: 100 + i, name: `Extra ${i}`, character: '' }))] },
  '/tv/3/aggregate_credits': { cast: [{ id: 91, name: 'Bo Ray', roles: [{ character: 'Host' }], profile_path: null }] },
  '/person/90': { id: 90, name: 'Ann Lee', profile_path: '/a.jpg', known_for_department: 'Acting', combined_credits: { cast: [
    { id: 1, media_type: 'movie', character: 'Self', popularity: 5, vote_count: 900 },
    { id: 3, media_type: 'tv', character: 'Host', popularity: 9, vote_count: 400, episode_count: 12 },
    { id: 77, media_type: 'tv', character: 'Herself', popularity: 50, vote_count: 5000, genre_ids: [10767], episode_count: 9 }, // talk show
    { id: 78, media_type: 'tv', character: 'Herself (voice)', popularity: 90, vote_count: 9000, episode_count: 1 }, // one-off cameo
    { id: 1, media_type: 'movie', character: 'dup', popularity: 1, vote_count: 900 },
  ] } },
  '/search/multi': (u) => ({ results: u.searchParams.get('query') === 'ann lee'
    ? [{ id: 90, media_type: 'person', name: 'Ann Lee', profile_path: '/a.jpg', known_for_department: 'Acting', known_for: [{ id: 1, media_type: 'movie' }] }]
    : [{ id: 1, media_type: 'movie' }, { id: 3, media_type: 'tv' }] }),
  '/search/keyword': (u) => ({ results: {
    nurse: [{ id: 500, name: 'nurse' }, { id: 502, name: 'nursery' }],
    killed: [{ id: 9, name: 'killer' }],
    murder: [{ id: 9826, name: 'murder' }, { id: 386821, name: 'murders' }],
    patient: [{ id: 501, name: 'patient' }],
  }[u.searchParams.get('query')] ?? [] }),
  '/genre/movie/list': { genres: [{ id: 80, name: 'Crime' }, { id: 53, name: 'Thriller' }, { id: 9648, name: 'Mystery' }] },
  '/genre/tv/list': { genres: [{ id: 80, name: 'Crime' }, { id: 9648, name: 'Mystery' }] },
  // Topic keywords (500 nurse, 501 patient, 9826 murder): only Con Man is
  // tagged nurse + patient, and nothing has all three.
  '/discover/movie': (u) => {
    const kw = u.searchParams.get('with_keywords') ?? '';
    if (/\b(500|501|9826)\b/.test(kw)) return { total_pages: 1, results: kw === '500,501' ? [{ id: 2, popularity: 5 }] : [] };
    return { total_pages: 3, results: [{ id: 1, popularity: 50 }, { id: 2, popularity: 10 }] };
  },
  '/discover/tv': (u) => (/\b(500|501|9826)\b/.test(u.searchParams.get('with_keywords') ?? '')
    ? { total_pages: 0, results: [] }
    : { total_pages: 1, results: [{ id: 3, popularity: 80 }] }),
  '/watch/providers/movie': { results: [{ ...NETFLIX, display_priorities: { US: 1 } }] },
  '/watch/providers/tv': { results: [{ ...HULU, display_priorities: { US: 2 } }] },
};

const calls = [];
const memStore = (key) => {
  const saved = { key, profile: null };
  return {
    saved, cache: { data: {} },
    loadProfile: () => saved.profile, saveProfile: (p) => { saved.profile = structuredClone(p); },
    loadKey: () => saved.key, saveKey: (k) => { saved.key = k; },
  };
};

async function setup(key = 'k', builtInKey = null) {
  const mock = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    calls.push(u);
    let hit = DB[u.pathname];
    if (typeof hit === 'function') hit = hit(u);
    const code = typeof hit === 'number' ? hit : hit ? 200 : 404;
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(code === 200 ? hit : { status_code: 34 }));
  });
  await new Promise((r) => mock.listen(0, r));
  const store = memStore(key);
  const api = createApi({ store, base: `http://127.0.0.1:${mock.address().port}`, builtInKey });
  return { api, store, base: `http://127.0.0.1:${mock.address().port}`, close: () => mock.close() };
}

// --- finding where to watch ----------------------------------------------------------
test('a title shows where it streams, rent/buy, and top-billed cast', async () => {
  const { api, close } = await setup();
  try {
    api.settings({ services: [8] });
    const t = await api.title('movie', 1);
    assert.equal(t.title, 'Vault Job');
    assert.deepEqual(t.stream.map((p) => p.name), ['Netflix']);
    assert.deepEqual(t.services.map((p) => p.name), ['Netflix'], 'marked as one of yours');
    assert.deepEqual(t.rentBuy.map((p) => p.name), ['Hulu']);
    assert.equal(t.backdrop, '/b1.jpg');
    assert.equal(t.cast.length, 16, 'cast trimmed before caching');
    assert.deepEqual(t.cast[0], { id: 90, name: 'Ann Lee', character: 'Self', profile: '/a.jpg' });

    const show = await api.title('tv', 3);
    assert.deepEqual(show.cast[0], { id: 91, name: 'Bo Ray', character: 'Host', profile: null });
    assert.equal(show.seasons, 2);
  } finally { close(); }
});

test('an actor page lists what they are known for, minus guest spots and repeats', async () => {
  const { api, close } = await setup();
  try {
    const p = await api.person(90);
    assert.equal(p.name, 'Ann Lee');
    // Best known (most votes) first; talk shows and one-episode cameos dropped
    assert.deepEqual(p.items.map((i) => [i.title, i.role]), [['Vault Job', 'Self'], ['Cold Trail', 'Host']]);
  } finally { close(); }
});

test('categories: genres by name, keywords for true crime, movies and shows mixed', async () => {
  const { api, close } = await setup();
  try {
    const { categories, subs } = api.categories();
    assert.equal(categories[0].name, 'True crime');
    assert.ok(subs['true-crime'].some((c) => c.name === 'Heists & robberies'));
    assert.ok(subs.horror.some((c) => c.name === 'Haunted houses'));
    assert.equal(subs.standup, undefined, 'stand-up has no subcategories');

    calls.length = 0;
    let r = await api.browse({ category: 'true-crime' });
    for (const u of calls.filter((x) => x.pathname.startsWith('/discover/'))) {
      assert.equal(u.searchParams.get('with_keywords'), '33722');
      assert.equal(u.searchParams.get('with_watch_providers'), null, 'any service by default');
      assert.equal(u.searchParams.get('with_watch_monetization_types'), 'flatrate|free|ads|rent|buy', 'but only things you can watch here');
      assert.equal(u.searchParams.get('watch_region'), 'US');
    }
    assert.deepEqual(r.items.map((i) => i.title), ['Cold Trail', 'Vault Job', 'Con Man']);
    assert.equal(r.totalPages, 3);

    calls.length = 0;
    await api.browse({ category: 'thriller' });
    assert.equal(calls.find((x) => x.pathname === '/discover/movie').searchParams.get('with_genres'), '53|9648');

    calls.length = 0;
    await api.browse({ category: 'horror' });
    assert.ok(!calls.some((x) => x.pathname === '/discover/tv'), 'no TV horror genre, so only movies');

    // Only my services passes them to TMDB; seen titles drop out
    api.settings({ services: [8, 15] });
    await api.mark({ list: 'ratings', type: 'movie', tmdbId: 1, reaction: 'love' });
    calls.length = 0;
    api.settings({ view: { where: 'mine' } });
    r = await api.browse({ category: 'crime' });
    const d = calls.find((x) => x.pathname === '/discover/tv');
    assert.equal(d.searchParams.get('with_watch_providers'), '8|15');
    assert.equal(d.searchParams.get('watch_region'), 'US');
    assert.ok(!r.items.some((i) => i.tmdbId === 1));

    await assert.rejects(api.browse({ category: 'nope' }), /Unknown category/);
  } finally { close(); }
});

test('true crime subcategory: true crime AND each topic, plus true-story crime and docs', async () => {
  const { api, close } = await setup();
  try {
    calls.length = 0;
    const r = await api.browse({ category: 'true-crime', sub: 'heist' });
    assert.equal(r.sub, 'Heists & robberies');
    const disc = calls.filter((u) => u.pathname === '/discover/movie').map((u) => [u.searchParams.get('with_keywords'), u.searchParams.get('with_genres')]);
    assert.equal(disc.length, 9);
    assert.deepEqual(disc.find(([k]) => k === '33722,10051'), ['33722,10051', null]);
    assert.deepEqual(disc.find(([k]) => k === '9672,10051'), ['9672,10051', '80']);
    assert.deepEqual(disc.find(([, g]) => g === '99'), ['10051|191845|15363|642', '99']);
    assert.deepEqual(r.items.map((i) => i.tmdbId), [3, 1, 2], 'each title once');
    await assert.rejects(api.browse({ category: 'true-crime', sub: 'nope' }), /Unknown subcategory/);
  } finally { close(); }
});

test('search: titles, people with photos, plot words as topics, category shortcuts', async () => {
  const { api, close } = await setup();
  try {
    let r = await api.search('ann lee');
    assert.deepEqual(r.people, [{ id: 90, name: 'Ann Lee', profile: '/a.jpg', dept: 'Acting' }]);
    assert.deepEqual(r.items.map((i) => i.title), ['Vault Job']);

    calls.length = 0;
    r = await api.search('nurse who killed patients');
    const tried = calls.filter((u) => u.pathname === '/discover/movie').map((u) => u.searchParams.get('with_keywords'));
    assert.deepEqual(tried, ['500,9826,501', '500,9826', '500,501', '9826,501']);
    // "killed" maps to the murder tag and "patients" to patient. No title has
    // all three, so it falls back to the best pair; "nursery" never matches.
    assert.equal(r.topic.label, 'nurse + patient');
    assert.deepEqual(r.topic.items.map((i) => i.title), ['Con Man']);

    assert.deepEqual((await api.search('  ')).items, []);
    assert.deepEqual(matchCategories('that bank heist doc').map((s) => s.label), ['Documentary', 'True crime › Heists & robberies', 'Crime › Heists']);
    assert.deepEqual(matchCategories("lover's quarrel").map((s) => s.label), ['True crime › Love gone wrong']);
    assert.deepEqual(matchCategories('con man').map((s) => s.label), ['True crime › Con artists & scams']);
    assert.deepEqual(matchCategories('the staircase'), []);
  } finally { close(); }
});

// --- your list ---------------------------------------------------------------------
test('one-tap marks: seen, bookmark, pass, and how they replace each other', async () => {
  const { api, store, close } = await setup();
  try {
    api.settings({ services: [8] });
    let m = (await api.mark({ list: 'watchlist', type: 'tv', tmdbId: 3 })).mine;
    assert.deepEqual([m.want, m.reaction, m.passed], [true, null, false]);
    await api.mark({ list: 'watchlist', type: 'movie', tmdbId: 4 });
    const list = (await api.list('want')).items;
    assert.deepEqual(list.map((i) => [i.title, i.services.length]), [['Nowhere Doc', 0], ['Cold Trail', 1]], 'newest first, with your services');

    // Seen it: one tap, no rating needed; takes it off the bookmarks
    m = (await api.mark({ list: 'ratings', type: 'tv', tmdbId: 3, reaction: 'seen' })).mine;
    assert.deepEqual([m.reaction, m.want, m.passed], ['seen', false, false]);
    assert.deepEqual(api.status().counts, { want: 1, maybe: 0, seen: 1, passed: 0 });

    // How was it (optional) with reasons; replaces, never duplicates
    m = (await api.mark({ list: 'ratings', type: 'tv', tmdbId: 3, reaction: 'love', reasons: ['Gripping case', ' ', 5], note: ' wow ' })).mine;
    assert.deepEqual(m, { reaction: 'love', reasons: ['Gripping case'], note: 'wow', score: 8, scored: false, want: false, maybe: false, passed: false });
    assert.equal(store.saved.profile.ratings.length, 1);

    // Pass undoes seen and bookmark; bookmarking undoes pass
    m = (await api.mark({ list: 'passed', type: 'tv', tmdbId: 3 })).mine;
    assert.deepEqual([m.reaction, m.want, m.passed], [null, false, true]);
    m = (await api.mark({ list: 'passed', type: 'movie', tmdbId: 4 })).mine;
    assert.deepEqual([m.want, m.passed], [false, true]);
    assert.deepEqual(api.status().counts, { want: 0, maybe: 0, seen: 0, passed: 2 });
    assert.deepEqual((await api.list('passed')).items.map((i) => i.title), ['Nowhere Doc', 'Cold Trail']);
    m = (await api.mark({ list: 'watchlist', type: 'movie', tmdbId: 4 })).mine;
    assert.deepEqual([m.want, m.passed], [true, false]);

    api.unmark({ list: 'passed', type: 'tv', tmdbId: 3 });
    assert.deepEqual(api.status().counts, { want: 1, maybe: 0, seen: 0, passed: 0 });

    await assert.rejects(api.mark({ list: 'ratings', type: 'movie', tmdbId: 1 }), /how you felt/);
    await assert.rejects(api.mark({ list: 'ratings', type: 'movie', tmdbId: 12345, reaction: 'seen' }), /no such title/);
    await assert.rejects(api.mark({ list: 'nope', type: 'movie', tmdbId: 1 }), /Bad title/);
    await assert.rejects(api.list('nope'), /Unknown list/);
  } finally { close(); }
});

test('seen and passed titles drop out of categories, but not search', async () => {
  const { api, close } = await setup();
  try {
    await api.mark({ list: 'ratings', type: 'movie', tmdbId: 1, reaction: 'seen' });
    await api.mark({ list: 'passed', type: 'tv', tmdbId: 3 });
    const r = await api.browse({ category: 'true-crime' });
    assert.deepEqual(r.items.map((i) => i.title), ['Con Man']);
    const s = await api.search('vault');
    assert.ok(s.items.some((i) => i.title === 'Vault Job' && i.mine.reaction === 'seen'));
  } finally { close(); }
});

test('Gotta watch and Maybe: one or the other, and seen or passed clears both', async () => {
  const { api, close } = await setup();
  try {
    let m = (await api.mark({ list: 'maybe', type: 'movie', tmdbId: 1 })).mine;
    assert.deepEqual([m.want, m.maybe], [false, true]);
    assert.deepEqual((await api.list('maybe')).items.map((i) => i.title), ['Vault Job']);
    m = (await api.mark({ list: 'watchlist', type: 'movie', tmdbId: 1 })).mine;
    assert.deepEqual([m.want, m.maybe], [true, false], 'Gotta watch replaces Maybe');
    m = (await api.mark({ list: 'maybe', type: 'movie', tmdbId: 1 })).mine;
    assert.deepEqual([m.want, m.maybe], [false, true], 'and the other way round');
    m = (await api.mark({ list: 'ratings', type: 'movie', tmdbId: 1, reaction: 'seen' })).mine;
    assert.deepEqual([m.reaction, m.want, m.maybe], ['seen', false, false], 'seeing it clears both');
    await api.mark({ list: 'maybe', type: 'tv', tmdbId: 3 });
    m = (await api.mark({ list: 'passed', type: 'tv', tmdbId: 3 })).mine;
    assert.deepEqual([m.maybe, m.passed], [false, true], 'passing clears Maybe');
    assert.deepEqual(api.status().counts, { want: 0, maybe: 0, seen: 1, passed: 1 });

    // Maybe titles drop out of categories like any other mark
    await api.mark({ list: 'maybe', type: 'movie', tmdbId: 2 });
    const r = await api.browse({ category: 'true-crime' });
    assert.ok(!r.items.some((i) => i.tmdbId === 2));
  } finally { close(); }
});

test('lists saved by older versions still count as seen', () => {
  const store = memStore('k');
  store.saved.profile = { ratings: [{ tmdbId: 1, type: 'movie', rating: 9 }, { tmdbId: 2, type: 'movie', rating: 6 }], watchlist: [] };
  const api = createApi({ store, base: 'http://127.0.0.1:1' });
  assert.deepEqual(api.status().counts, { want: 0, maybe: 0, seen: 2, passed: 0 });
});

test('built-in key works with nothing saved, so no setup is needed', async () => {
  const { api, store, close } = await setup(null, 'built-in');
  try {
    assert.deepEqual([api.status().hasKey, api.status().ownKey], [true, false]);
    assert.equal((await api.title('movie', 1)).title, 'Vault Job');
    assert.equal(calls.at(-1).searchParams.get('api_key'), 'built-in');
    await api.setKey('mine');
    assert.equal(store.saved.key, 'mine');
    assert.equal(api.status().ownKey, true);
    await api.title('movie', 2);
    assert.equal(calls.at(-1).searchParams.get('api_key'), 'mine', 'a pasted key wins');
  } finally { close(); }
});

test('key check, backup and restore', async () => {
  const { api, store, close } = await setup(null);
  try {
    assert.equal(api.status().hasKey, false);
    await assert.rejects(api.search('x'), /TMDB key/);
    await assert.rejects(api.setKey('bad'), /rejected/);
    assert.equal(store.saved.key, null);
    await api.setKey('  good  ');
    assert.equal(store.saved.key, 'good');
    await api.mark({ list: 'ratings', type: 'movie', tmdbId: 1, reaction: 'like', reasons: ['Bingeable'] });

    const backup = api.exportData();
    assert.ok(!backup.includes('good'), 'the key stays out of backups');
    api.reset();
    assert.equal(api.status().counts.seen, 0);
    assert.deepEqual(api.importData(backup), { ratings: 1, watchlist: 0, maybe: 0, passed: 0 });
    assert.equal(store.saved.profile.ratings[0].reasons[0], 'Bingeable');
    assert.throws(() => api.importData('{"hello":1}'), /backup/);
  } finally { close(); }
});

test('browser store: your list wins over the cache when storage is full', () => {
  const data = new Map();
  const ls = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      const used = [...data].reduce((n, [key, val]) => n + (key === k ? 0 : val.length), 0);
      if (used + v.length > 1000) throw new Error('QuotaExceededError');
      data.set(k, v);
    },
    removeItem: (k) => data.delete(k),
  };
  ls.setItem('wtw.cache', JSON.stringify({ x: { t: 1, v: 'y'.repeat(900) } }));
  const store = browserStore(ls);
  store.saveProfile({ ratings: ['z'.repeat(300)] });
  assert.ok(data.get('wtw.profile'));
  assert.equal(data.get('wtw.cache'), undefined);
  assert.throws(() => store.saveProfile({ ratings: ['z'.repeat(2000)] }), /storage/);
});

// --- the rest -------------------------------------------------------------------------
test('reasons fit the kind of title', () => {
  const tc = { genres: ['Documentary', 'Crime'] };
  assert.equal(kindOf(tc), 'truecrime');
  assert.ok(reasonsFor(tc, 'love').includes('Gripping case'));
  assert.ok(reasonsFor(tc, 'dislike').includes('Too graphic'));
  assert.equal(reasonsFor(tc, 'dislike').at(-1), "Didn't finish");
  assert.equal(kindOf({ genres: ['Comedy'] }), 'comedy');
  assert.equal(kindOf({ genres: ['Comedy', 'Romance'] }), 'romance');
  assert.equal(kindOf({ genres: ['Crime', 'Drama'] }), 'crime');
  assert.equal(kindOf({ genres: ['Sci-Fi & Fantasy', 'Drama'] }), 'spectacle');
  assert.equal(kindOf({ genres: ['Animation', 'Comedy'] }), 'family');
  assert.equal(kindOf({ genres: [] }), 'drama');
  // An old pick from another list still shows so it can be turned off
  assert.ok(reasonsFor({ genres: ['Comedy'] }, 'like', ['Story']).includes('Story'));
});

test('sample mode works end to end with no network', async () => {
  const api = createApi({ store: memStore('sample'), fetchImpl: demoFetch });
  api.settings({ services: [8, 15] });

  let r = await api.search('bank heist');
  assert.deepEqual(r.suggestions.map((x) => x.label), ['True crime › Heists & robberies', 'Crime › Heists']);
  assert.deepEqual(r.items.map((i) => i.title), ['Heist Week']);

  r = await api.browse({ category: 'true-crime', sub: 'heist' });
  assert.deepEqual(r.items.map((i) => i.title), ['The Vault Under Fifth Street', 'Heist Week', 'Getaway Driver']);
  assert.deepEqual(r.items[0].services.map((p) => p.name), ['Netflix']);

  const t = await api.title('tv', 102);
  assert.ok(t.cast.length >= 2 && t.cast[0].profile.startsWith('data:'));
  const p = await api.person(t.cast[0].id);
  assert.ok(p.items.some((i) => i.tmdbId === 102));

  r = await api.search('castellano');
  assert.deepEqual(r.people.map((x) => x.name), ['Ray Castellano']);
});

test('Movies / Shows / Limited series toggle', async () => {
  const api = createApi({ store: memStore('sample'), fetchImpl: demoFetch });
  const titles = async (kind) => {
    api.settings({ kind });
    return (await api.browse({ category: 'true-crime' })).items.map((i) => `${i.type}:${i.tvType ?? '-'}`);
  };
  assert.ok((await titles('all')).some((t) => t.startsWith('movie')) && (await titles('all')).some((t) => t.startsWith('tv')));
  assert.ok((await titles('movie')).every((t) => t.startsWith('movie')));
  assert.deepEqual([...new Set(await titles('limited'))], ['tv:Miniseries']);
  const shows = await titles('show');
  assert.ok(shows.length && shows.every((t) => t.startsWith('tv') && t !== 'tv:Miniseries'));
  assert.equal(api.status().kind, 'show');

  // Search keeps to the toggle too, and says how many it hid
  api.settings({ kind: 'movie' });
  const r = await api.search('heist');
  assert.ok(r.items.every((i) => i.type === 'movie'));
  assert.equal(r.hiddenByKind, 1, 'Heist Week is a show');
  api.settings({ kind: 'nonsense' });
  assert.equal(api.status().kind, 'movie', 'ignores unknown kinds');
});

test('more like this: shared story tags, best first, nothing vague, nothing you marked', async () => {
  const api = createApi({ store: memStore('sample'), fetchImpl: demoFetch });
  let r = await api.similar('movie', 101); // The Vault Under Fifth Street: true crime, heist, bank heist
  assert.equal(r.title, 'The Vault Under Fifth Street');
  assert.equal(r.items[0].title, 'Heist Week');
  assert.deepEqual(r.items[0].because.sort(), ['heist', 'true crime']);
  assert.ok(!r.items.some((i) => ['Laugh Track', 'The Last Laugh Tour', 'Small Town Secrets'].includes(i.title)), 'no unrelated titles');
  assert.ok(r.items.every((i) => i.because.length >= 2), 'every match shares at least two story tags');

  await api.mark({ list: 'passed', type: 'tv', tmdbId: 112 });
  r = await api.similar('movie', 101);
  assert.ok(!r.items.some((i) => i.title === 'Heist Week'), 'marked titles are left out');

  api.settings({ kind: 'movie' });
  r = await api.similar('tv', 102);
  assert.ok(r.items.every((i) => i.type === 'movie'));
});

test('sort and filter become the right TMDB queries for categories', async () => {
  const { api, close } = await setup();
  try {
    const now = new Date('2026-10-31T12:00:00Z');
    const profile = { region: 'US', services: [8], serviceBrands: ['netflix'] };
    let p = discoverParams(cleanView({ sort: 'top', rating: 7, released: 'five' }), 'movie', profile, now);
    assert.deepEqual(p, {
      sort_by: 'vote_average.desc', 'vote_count.gte': 200, 'vote_average.gte': 7,
      'primary_release_date.gte': '2021-10-31', 'primary_release_date.lte': '2026-10-31',
      watch_region: 'US', with_watch_monetization_types: 'flatrate|free|ads|rent|buy',
    });
    p = discoverParams(cleanView({ sort: 'newest', where: 'pick', picks: [{ id: 8, name: 'Netflix' }, { id: 1899, name: 'HBO Max' }] }), 'tv', profile, now);
    assert.equal(p.sort_by, 'first_air_date.desc');
    assert.equal(p['first_air_date.lte'], '2026-10-31', 'nothing that is not out yet');
    assert.equal(p.with_watch_providers, '8|1899');
    p = discoverParams(cleanView({ sort: 'oldest', released: 'classic' }), 'tv', profile, now);
    assert.deepEqual([p.sort_by, p['first_air_date.lte'], p['first_air_date.gte']], ['first_air_date.asc', '1999-12-31', undefined]);

    // Movies and shows from separate calls merge in the chosen order
    api.settings({ view: { sort: 'top' } });
    calls.length = 0;
    const r = await api.browse({ category: 'true-crime' });
    assert.ok(calls.filter((u) => u.pathname.startsWith('/discover/')).every((u) => u.searchParams.get('sort_by') === 'vote_average.desc'));
    assert.equal(r.items.length, 3);
    assert.equal(api.status().view.sort, 'top');
    api.settings({ view: { sort: 'loudest', rating: 9.5, where: 'nowhere' } });
    assert.deepEqual(api.status().view, cleanView({}), 'junk falls back to defaults');
  } finally { close(); }
});

test('filters apply to search results; sorting only when you pick one', () => {
  const now = new Date('2026-10-31T12:00:00Z');
  const item = (title, extra) => ({ title, stream: [], free: [], voteAverage: 7, voteCount: 100, popularity: 1, releaseDate: '2020-01-01', ...extra });
  const items = [
    item('Old Netflix', { stream: [{ id: 1796, name: 'Netflix Standard with Ads' }], releaseDate: '1995-05-05', voteAverage: 8.4, popularity: 5 }),
    item('New Hulu', { stream: [{ id: 15, name: 'Hulu' }], releaseDate: '2026-01-01', voteAverage: 6.1, popularity: 50 }),
    item('Rated by three', { stream: [{ id: 8, name: 'Netflix' }], voteAverage: 9.9, voteCount: 3, popularity: 9 }),
  ];
  const profile = { services: [8], serviceBrands: ['netflix'] };
  const titles = (v, opts) => applyView(items, cleanView(v), profile, { now, ...opts }).map((i) => i.title);

  assert.deepEqual(titles({ where: 'mine' }, { sort: false }), ['Old Netflix', 'Rated by three'], 'ad tier counts as Netflix');
  assert.deepEqual(titles({ rating: 7 }), ['Old Netflix'], 'a 9.9 from three votes is not a 7+');
  assert.deepEqual(titles({ released: 'year' }), ['New Hulu']);
  assert.deepEqual(titles({ released: 'classic' }), ['Old Netflix']);
  assert.deepEqual(titles({ sort: 'newest' }), ['New Hulu', 'Rated by three', 'Old Netflix']);
  assert.deepEqual(titles({ sort: 'oldest' }), ['Old Netflix', 'Rated by three', 'New Hulu']);
  assert.deepEqual(titles({ sort: 'top' }), ['Rated by three', 'Old Netflix', 'New Hulu']);
  assert.deepEqual(titles({ sort: 'popular' }), ['New Hulu', 'Rated by three', 'Old Netflix']);

  const v = cleanView({ sort: 'top', where: 'pick', picks: [{ id: 8, name: 'Netflix' }], rating: 7, released: 'five' });
  assert.equal(describeView(v, (p) => p.brand === 'netflix' ? 'Netflix' : p.brand), 'Top rated · Netflix · 7+ rating · Last 5 years');
  assert.equal(activeFilters(v), 4);
  assert.equal(activeFilters(cleanView({})), 0);
});

test('every category but stand-up has subcategories, queried as genre AND topic', async () => {
  const { api, close } = await setup();
  try {
    calls.length = 0;
    let r = await api.browse({ category: 'thriller', sub: 'spy' });
    assert.equal(r.sub, 'Spies');
    let u = calls.find((x) => x.pathname === '/discover/movie');
    assert.deepEqual([u.searchParams.get('with_genres'), u.searchParams.get('with_keywords')], ['53|9648', '470|5265']);

    // Keyword category + keyword sub: one AND call per keyword
    calls.length = 0;
    await api.browse({ category: 'true-story', sub: 'music' });
    assert.deepEqual(calls.filter((x) => x.pathname === '/discover/movie').map((x) => x.searchParams.get('with_keywords')).sort(), ['9672,283297', '9672,4048']);
    // Keyword category + genre sub
    calls.length = 0;
    await api.browse({ category: 'true-story', sub: 'crime' });
    u = calls.find((x) => x.pathname === '/discover/movie');
    assert.deepEqual([u.searchParams.get('with_keywords'), u.searchParams.get('with_genres')], ['9672', '80']);

    await assert.rejects(api.browse({ category: 'crime', sub: 'heist-of-the-century' }), /Unknown subcategory/);
    assert.deepEqual(matchCategories('haunted house movie').map((x) => x.label), ['Horror › Haunted houses']);
    assert.ok(matchCategories('time travel').some((x) => x.label === 'Sci-fi & fantasy › Time travel'));
  } finally { close(); }
});

// --- sync between devices ------------------------------------------------------------
// A fake TMDB v4 (sign-in and lists) shared by two "devices".
async function fakeTmdbAccount() {
  const lists = new Map(); // id -> { name, description, public, items: [{media_type, id, ...}], comments: {} }
  let nextList = 100;
  let approved = false;
  const READ = 'read-token';
  const USER = 'user-token';
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    let body = '';
    for await (const c of req) body += c;
    const data = body ? JSON.parse(body) : {};
    const auth = (req.headers.authorization ?? '').replace('Bearer ', '');
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const p = u.pathname;
    if (p === '/4/auth/request_token' && req.method === 'POST') return auth === READ ? send(200, { success: true, request_token: 'rt-1' }) : send(401, {});
    if (p === '/4/auth/access_token' && req.method === 'POST') {
      if (auth !== READ) return send(401, {});
      return approved ? send(200, { success: true, access_token: USER, account_id: 'acct-1' })
        : send(422, { success: false, status_code: 41, status_message: "This request token hasn't been approved by the user." });
    }
    if (p === '/4/auth/access_token' && req.method === 'DELETE') return send(200, { success: true });
    if (auth !== USER) return send(401, { success: false, status_code: 3 });
    if (p === '/4/account/acct-1/lists') {
      return send(200, { page: 1, total_pages: 1, results: [...lists].map(([id, l]) => ({ id, name: l.name, description: l.description })) });
    }
    if (p === '/4/list' && req.method === 'POST') {
      const id = nextList++;
      lists.set(id, { name: data.name, description: data.description ?? '', public: data.public, items: [], comments: {} });
      return send(201, { success: true, id });
    }
    const m = p.match(/^\/4\/list\/(\d+)(\/items)?$/);
    const l = m && lists.get(Number(m[1]));
    if (!l) return send(404, { success: false, status_code: 34 });
    if (!m[2] && req.method === 'GET') {
      const page = Number(u.searchParams.get('page') ?? 1);
      const results = l.items.slice((page - 1) * 2, page * 2); // 2 per page, to exercise paging
      return send(200, { results, comments: Object.fromEntries(results.map((x) => [`${x.media_type}:${x.id}`, l.comments[`${x.media_type}:${x.id}`] ?? null])),
        description: l.description, page, total_pages: Math.max(1, Math.ceil(l.items.length / 2)), public: l.public });
    }
    if (!m[2] && req.method === 'PUT') { l.description = data.description; return send(200, { success: true }); }
    const key = (x) => `${x.media_type}:${x.media_id}`;
    if (req.method === 'POST') {
      for (const x of data.items) if (!l.items.some((i) => `${i.media_type}:${i.id}` === key(x))) l.items.push({ media_type: x.media_type, id: x.media_id, title: `T${x.media_id}`, name: `T${x.media_id}`, poster_path: `/p${x.media_id}.jpg` });
      return send(200, { success: true });
    }
    if (req.method === 'PUT') { for (const x of data.items) l.comments[key(x)] = x.comment; return send(200, { success: true }); }
    if (req.method === 'DELETE') {
      l.items = l.items.filter((i) => !data.items.some((x) => key(x) === `${i.media_type}:${i.id}`));
      return send(200, { success: true });
    }
    send(404, {});
  });
  await new Promise((r) => server.listen(0, r));
  return { lists, approve: () => { approved = true; }, base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

const device = (tmdbBase, syncBase) => {
  const store = memStore('k');
  let syncState = null;
  store.loadSync = () => syncState;
  store.saveSync = (v) => { syncState = structuredClone(v); };
  return { store, api: createApi({ store, base: tmdbBase, readToken: 'read-token', syncBase }) };
};

test('sync: phone and computer share one list through the TMDB account', async () => {
  const { base: tmdbBase, close } = await setup();
  const acct = await fakeTmdbAccount();
  try {
    const phone = device(tmdbBase, acct.base).api;
    const computer = device(tmdbBase, acct.base).api;

    // The phone already has a list before signing in
    await phone.mark({ list: 'watchlist', type: 'tv', tmdbId: 3 });
    await phone.mark({ list: 'ratings', type: 'movie', tmdbId: 1, reaction: 'love', reasons: ['Gripping case'], note: 'wow' });
    phone.settings({ services: [8], serviceNames: ['Netflix'], kind: 'limited' });

    // Sign in: waits for approval, then merges
    await phone.sync.startSignIn('https://app/?tmdb-approved=1');
    assert.equal(phone.sync.status().waiting, true);
    assert.equal(await phone.sync.finishSignIn(), false, 'not approved yet');
    acct.approve();
    assert.equal(await phone.sync.finishSignIn(), true);
    assert.equal(phone.sync.status().signedIn, true);
    const names = [...acct.lists.values()].map((l) => l.name).sort();
    assert.deepEqual(names, ['What to Watch · Bookmarked', 'What to Watch · Maybe', 'What to Watch · Passed', 'What to Watch · Seen', 'What to Watch · Settings']);
    assert.ok([...acct.lists.values()].every((l) => l.public === false), 'private lists');

    // The computer signs in and gets everything, including how it was and the services
    await computer.sync.startSignIn('https://app/');
    assert.equal(await computer.sync.finishSignIn(), true);
    assert.deepEqual(computer.status().counts, { want: 1, maybe: 0, seen: 1, passed: 0 });
    const seen = (await computer.list('seen')).items[0];
    assert.equal(seen.title, 'Vault Job');
    assert.deepEqual(seen.mine, { reaction: 'love', reasons: ['Gripping case'], note: 'wow', score: 8, scored: false, want: false, maybe: false, passed: false });
    assert.deepEqual([computer.status().services, computer.status().kind], [[8], 'limited']);
    assert.equal(acct.lists.size, 5, 'the computer reused the same lists');

    // Changes on the computer show up on the phone after a sync
    await computer.mark({ list: 'passed', type: 'tv', tmdbId: 3 }); // passing takes it off Bookmarked too
    await computer.mark({ list: 'ratings', type: 'movie', tmdbId: 1, reaction: 'dislike' });
    await computer.sync.push();
    await phone.sync.now();
    assert.deepEqual(phone.status().counts, { want: 0, maybe: 0, seen: 1, passed: 1 });
    assert.equal((await phone.list('seen')).items[0].mine.reaction, 'dislike');

    // Maybe syncs too, and moving a title from Maybe to Gotta watch carries over
    await computer.mark({ list: 'maybe', type: 'movie', tmdbId: 2 });
    await computer.sync.push();
    await phone.sync.now();
    assert.equal(phone.status().counts.maybe, 1);
    await phone.mark({ list: 'watchlist', type: 'movie', tmdbId: 2 });
    await phone.sync.push();
    await computer.sync.now();
    assert.deepEqual([computer.status().counts.want, computer.status().counts.maybe], [1, 0]);
    computer.unmark({ list: 'watchlist', type: 'movie', tmdbId: 2 });
    await computer.sync.push();
    await phone.sync.now();

    // Unmarking and deleting carry over too
    phone.unmark({ list: 'passed', type: 'tv', tmdbId: 3 });
    await phone.sync.push();
    await computer.sync.now();
    assert.equal(computer.status().counts.passed, 0);
    computer.reset();
    await computer.sync.push();
    await phone.sync.now();
    assert.deepEqual(phone.status().counts, { want: 0, maybe: 0, seen: 0, passed: 0 });

    // Changes made while TMDB can't be reached wait and go later
    acct.close();
    await phone.mark({ list: 'watchlist', type: 'movie', tmdbId: 2 });
    await assert.rejects(phone.sync.push());
    assert.equal(phone.sync.status().pending, 3, 'kept for later (add to Gotta watch, take off Maybe and Passed)');

    await phone.sync.signOut();
    assert.equal(phone.sync.status().signedIn, false);
  } finally { close(); acct.close(); }
});

test('static server serves the app and nothing outside it', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let res = await fetch(base + '/');
    assert.match(await res.text(), /What to Watch/);
    res = await fetch(base + '/lib/api.js');
    assert.equal(res.headers.get('content-type'), 'text/javascript');
    res = await fetch(base + '/manifest.webmanifest');
    assert.equal((await res.json()).display, 'standalone');
    res = await fetch(base + '/%2e%2e/package.json');
    assert.ok([403, 404].includes(res.status));
  } finally { server.close(); }
});

test('ratings go from -10 to 10, and old loved/liked/not for me carry over', async () => {
  const api = createApi({ store: memStore('sample'), fetchImpl: demoFetch });
  let m = (await api.mark({ list: 'ratings', type: 'movie', tmdbId: 101, score: 9 })).mine;
  assert.equal(m.score, 9);
  assert.equal(m.scored, true);
  assert.equal(m.reaction, 'love');
  m = (await api.mark({ list: 'ratings', type: 'movie', tmdbId: 101, score: -3, reasons: ['Too slow'] })).mine;
  assert.equal(m.reaction, 'dislike');
  assert.deepEqual(m.reasons, ['Too slow']);
  m = (await api.mark({ list: 'ratings', type: 'movie', tmdbId: 101, score: 0 })).mine;
  assert.equal(m.score, 0);
  assert.equal(m.reaction, 'seen');
  for (const bad of [11, -11, 3.5, '7']) {
    await assert.rejects(api.mark({ list: 'ratings', type: 'movie', tmdbId: 101, score: bad }), /-10 to 10/);
  }
  // Clearing the rating keeps it as seen.
  m = (await api.mark({ list: 'ratings', type: 'movie', tmdbId: 101, reaction: 'seen' })).mine;
  assert.equal(m.score, null);
  assert.equal(m.reaction, 'seen');

  // Ratings from before the scale count as roughly +8, +5 and -5.
  assert.equal(scoreOf({ reaction: 'love' }), 8);
  assert.equal(scoreOf({ reaction: 'like' }), 5);
  assert.equal(scoreOf({ reaction: 'dislike' }), -5);
  assert.equal(scoreOf({ reaction: 'seen' }), null);
  assert.equal(scoreOf({ reaction: 'love', score: 10 }), 10);

  // The score rides along in the synced Seen list.
  assert.equal(decodeSeen(encodeSeen({ reaction: 'dislike', score: -7, reasons: ['x'] })).score, -7);
  assert.equal(decodeSeen(encodeSeen({ reaction: 'like' })).score, undefined);
});

test('for you: built from your ratings, high pulls in, low pushes away', async () => {
  const api = createApi({ store: memStore('sample'), fetchImpl: demoFetch });
  assert.equal((await api.forYou()).reason, 'no-likes');
  await api.mark({ list: 'ratings', type: 'movie', tmdbId: 114, score: -6 });
  assert.equal((await api.forYou()).reason, 'no-likes', 'only dislikes is not enough to go on');

  await api.mark({ list: 'ratings', type: 'movie', tmdbId: 101, score: 9 }); // bank heist doc
  let r = await api.forYou();
  assert.equal(r.items[0].title, 'Heist Week');
  assert.deepEqual(r.items[0].because, { title: 'The Vault Under Fifth Street', score: 9 });
  assert.ok(!r.items.some((i) => [101, 114].includes(i.tmdbId) && i.type === 'movie'), 'nothing you already rated');
  assert.ok(!r.items.some((i) => ['Laugh Track', 'The Last Laugh Tour', 'Small Town Secrets'].includes(i.title)), 'nothing unrelated');
  const alone = r.items[0].match;

  // Hating a robbery movie pulls Heist Week (also a robbery) down.
  await api.mark({ list: 'ratings', type: 'movie', tmdbId: 109, score: -10 });
  r = await api.forYou();
  assert.ok((r.items.find((i) => i.title === 'Heist Week')?.match ?? 0) < alone);

  // Marked titles drop off; the toggle applies.
  await api.mark({ list: 'maybe', type: 'tv', tmdbId: 112 });
  assert.ok(!(await api.forYou()).items.some((i) => i.title === 'Heist Week'));
  api.settings({ kind: 'movie' });
  assert.ok((await api.forYou()).items.every((i) => i.type === 'movie'));
});
