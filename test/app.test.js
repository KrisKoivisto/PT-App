import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseCsv } from '../src/csv.js';
import { parseImdbCsv } from '../src/imdb.js';
import { createApp } from '../server.js';

const RATINGS = `Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors
tt0000001,10,2024-01-01,"Seed, The Movie",,https://x,movie,8.0,100,2000,"Drama, Sci-Fi",1000,2000-01-01,A
tt0000002,9,2024-01-02,Seed Show,,https://x,tvSeries,8.0,50,2010,"Drama, Crime",1000,2010-01-01,
tt0000003,3,2024-01-03,Bad One,,https://x,movie,4.0,90,2005,Comedy,1000,2005-01-01,B
tt0000004,8,2024-01-04,An Episode,,https://x,tvEpisode,8.0,50,2011,Drama,1000,2011-01-01,
`;
const WATCHLIST = `Position,Const,Created,Modified,Description,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors
1,tt0000010,2024-01-01,2024-01-01,,On Netflix,https://x,movie,7.0,100,2020,Drama,100,2020-01-01,A
2,tt0000011,2024-01-01,2024-01-01,,Nowhere,https://x,movie,7.0,100,2021,Drama,100,2021-01-01,A
`;

test('csv handles quotes, CRLF and BOM', () => {
  const rows = parseCsv('﻿a,b\r\n"x, ""y""",2\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, "y"', '2']]);
});

test('imdb ratings parse: skips episodes, detects kind', () => {
  const { kind, items } = parseImdbCsv(RATINGS);
  assert.equal(kind, 'ratings');
  assert.equal(items.length, 3);
  assert.equal(items[0].title, 'Seed, The Movie');
  assert.deepEqual(items[0].genres, ['Drama', 'Sci-Fi']);
  assert.equal(items[1].type, 'tv');
  assert.equal(parseImdbCsv(WATCHLIST).kind, 'watchlist');
  assert.throws(() => parseImdbCsv('a,b\n1,2'), /IMDb export/);
});

// --- mock TMDB -------------------------------------------------------------
const NETFLIX = { provider_id: 8, provider_name: 'Netflix', logo_path: '/n.jpg' };
const HULU = { provider_id: 15, provider_name: 'Hulu', logo_path: '/h.jpg' };
const detail = (id, name, imdb, flatrate, extra = {}) => ({
  id, title: name, name, release_date: '2020-05-01', overview: 'o', genres: [{ name: 'Drama' }],
  runtime: 100, vote_average: 8, vote_count: 500, external_ids: { imdb_id: imdb },
  'watch/providers': { results: { US: { flatrate } } }, ...extra,
});
const DB = {
  '/find/tt0000001': { movie_results: [{ id: 1, media_type: 'movie' }], tv_results: [] },
  '/find/tt0000002': { movie_results: [], tv_results: [{ id: 2, media_type: 'tv' }] },
  '/find/tt0000010': { movie_results: [{ id: 10, media_type: 'movie' }], tv_results: [] },
  '/find/tt0000011': { movie_results: [{ id: 11, media_type: 'movie' }], tv_results: [] },
  '/movie/1/recommendations': { results: [{ id: 20 }, { id: 21 }, { id: 1 }] },
  '/tv/2/recommendations': { results: [{ id: 20, media_type: 'movie' }, { id: 30, media_type: 'tv' }] },
  '/movie/1': detail(1, 'Seed, The Movie', 'tt0000001', [HULU]),
  '/movie/20': detail(20, 'Both Seeds Like Me', 'tt0000020', [NETFLIX]),
  '/movie/21': detail(21, 'On Hulu Only', 'tt0000021', [HULU]),
  '/tv/30': detail(30, 'Show Rec', 'tt0000030', [NETFLIX], { number_of_seasons: 3, runtime: undefined }),
  '/movie/10': detail(10, 'On Netflix', 'tt0000010', [NETFLIX]),
  '/movie/11': detail(11, 'Nowhere', 'tt0000011', []),
  '/search/multi': { results: [
    { id: 40, media_type: 'movie', title: 'Hand Picked', release_date: '2019-02-02', poster_path: '/p.jpg' },
    { id: 99, media_type: 'person', name: 'Some Actor' },
    { id: 41, media_type: 'tv', name: 'Hand Show', first_air_date: '2018-01-01' },
  ] },
  '/movie/40': detail(40, 'Hand Picked', 'tt0000040', [], { genres: [{ name: 'Science Fiction' }] }),
  '/movie/40/recommendations': { results: [{ id: 21 }, { id: 40 }] },
  '/tv/41': detail(41, 'Hand Show', null, [NETFLIX]),
  '/genre/movie/list': { genres: [{ id: 80, name: 'Crime' }, { id: 53, name: 'Thriller' }, { id: 9648, name: 'Mystery' }] },
  '/genre/tv/list': { genres: [{ id: 80, name: 'Crime' }, { id: 9648, name: 'Mystery' }] },
  '/discover/movie': { total_pages: 3, results: [{ id: 21, popularity: 50 }, { id: 1, popularity: 10 }] },
  '/discover/tv': { total_pages: 1, results: [{ id: 30, popularity: 80 }] },
  '/watch/providers/movie': { results: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.jpg', display_priorities: { US: 1 } }] },
  '/watch/providers/tv': { results: [{ provider_id: 15, provider_name: 'Hulu', logo_path: '/h.jpg', display_priorities: { US: 2 } }] },
};

const calls = [];
async function setup(key = 'k') {
  const mock = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    calls.push(u);
    const hit = DB[u.pathname];
    res.writeHead(hit ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(hit ?? { status_code: 34 }));
  });
  await new Promise((r) => mock.listen(0, r));
  const { server } = await createApp({
    dataDir: await mkdtemp(path.join(os.tmpdir(), 'ptapp-')),
    key,
    tmdbBase: `http://127.0.0.1:${mock.address().port}`,
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  return { call, close: () => { server.close(); mock.close(); } };
}

test('end to end: import, pick service, recommend, watchlist', async () => {
  const { call, close } = await setup();
  try {
    assert.equal((await call('POST', '/api/import', { csv: RATINGS })).body.count, 3);
    assert.equal((await call('POST', '/api/import', { csv: WATCHLIST })).body.kind, 'watchlist');

    const prov = await call('GET', '/api/providers?region=US');
    assert.deepEqual(prov.body.map((p) => p.name), ['Netflix', 'Hulu']);

    // No services chosen: everything unseen shows up, seed titles never do
    let r = (await call('GET', '/api/recommendations')).body.items;
    assert.deepEqual(r.map((i) => i.title).sort(), ['On Hulu Only', 'Show Rec', 'Both Seeds Like Me'].sort());
    assert.ok(!r.some((i) => i.imdbId === 'tt0000001'));
    // Recommended by both seeds ranks first
    assert.equal(r[0].title, 'Both Seeds Like Me');
    assert.deepEqual(r[0].because.sort(), ['Seed Show', 'Seed, The Movie']);

    await call('POST', '/api/settings', { services: [8] });
    r = (await call('GET', '/api/recommendations')).body.items;
    assert.deepEqual(r.map((i) => i.title).sort(), ['Both Seeds Like Me', 'Show Rec']);
    assert.equal(r.find((i) => i.title === 'Show Rec').seasons, 3);

    r = (await call('GET', '/api/recommendations?type=tv')).body.items;
    assert.deepEqual(r.map((i) => i.title), ['Show Rec']);

    const wl = (await call('GET', '/api/watchlist')).body.items;
    assert.deepEqual(wl.map((i) => [i.title, i.available]), [['On Netflix', true], ['Nowhere', false]]);

    const st = (await call('GET', '/api/status')).body;
    assert.equal(st.ratings, 3);
    assert.deepEqual(st.services, [8]);
  } finally { close(); }
});

test('rejects bad input and missing key', async () => {
  const { call, close } = await setup(null);
  try {
    assert.equal((await call('POST', '/api/import', { csv: 'nope' })).status, 500);
    assert.match((await call('GET', '/api/recommendations')).body.error, /TMDB_API_KEY/);
  } finally { close(); }
});

test('marking titles: reactions, reasons, watchlist, re-import keeps them', async () => {
  const { call, close } = await setup();
  try {
    // Search returns full cards with where-to-watch
    const found = (await call('GET', '/api/search?q=hand')).body.items;
    assert.deepEqual(found.map((f) => [f.title, f.type]), [['Hand Picked', 'movie'], ['Hand Show', 'tv']]);
    assert.deepEqual(found[1].stream.map((p) => p.name), ['Netflix']);
    assert.equal(found[0].mine.reaction, null);

    await call('POST', '/api/titles', { list: 'watchlist', type: 'movie', tmdbId: 40 });
    const loved = (await call('POST', '/api/titles', {
      list: 'ratings', type: 'movie', tmdbId: 40, reaction: 'love', reasons: ['Story', '  ', 5], note: ' great ',
    })).body;
    assert.equal(loved.rating, 10);
    assert.deepEqual(loved.mine, { reaction: 'love', reasons: ['Story'], note: 'great', want: false });

    let mine = (await call('GET', '/api/titles?show=love')).body;
    assert.deepEqual(mine.items.map((i) => i.title), ['Hand Picked']);
    assert.deepEqual(mine.counts, { love: 1, like: 0, dislike: 0, want: 0 }, 'rating takes it off the watchlist');

    // Recommendations work with no IMDb data at all
    const recs = (await call('GET', '/api/recommendations')).body.items;
    assert.deepEqual(recs.map((r) => r.title), ['On Hulu Only']);
    assert.deepEqual(recs[0].because, ['Hand Picked']);

    // Show without an IMDb id still works on the watchlist
    await call('POST', '/api/titles', { list: 'watchlist', type: 'tv', tmdbId: 41 });
    const wl = (await call('GET', '/api/watchlist')).body.items;
    assert.deepEqual(wl.map((w) => [w.title, w.mine.want]), [['Hand Show', true]]);

    // Changing a reaction replaces instead of duplicating; numeric ratings still work
    await call('POST', '/api/titles', { list: 'ratings', type: 'movie', tmdbId: 40, reaction: 'dislike' });
    mine = (await call('GET', '/api/titles?show=dislike')).body;
    assert.equal(mine.items.length, 1);
    assert.equal(mine.counts.love, 0);
    await call('POST', '/api/titles', { list: 'ratings', type: 'movie', tmdbId: 40, rating: 9 });
    assert.equal((await call('GET', '/api/titles?show=love')).body.items.length, 1);

    await call('POST', '/api/import', { csv: RATINGS });
    assert.equal((await call('GET', '/api/status')).body.ratings, 4);

    // IMDb-imported titles show their reaction on cards and can be cleared by imdb id
    const browse = (await call('GET', '/api/browse?category=crime&hideRated=0')).body.items;
    assert.equal(browse.find((i) => i.tmdbId === 1).mine.reaction, 'love');
    await call('POST', '/api/titles/remove', { list: 'ratings', type: 'movie', tmdbId: 1, imdbId: 'tt0000001' });
    assert.equal((await call('GET', '/api/status')).body.ratings, 3);

    assert.equal((await call('POST', '/api/titles', { list: 'ratings', type: 'movie', tmdbId: 40, rating: 11 })).status, 400);
    assert.equal((await call('POST', '/api/titles', { list: 'ratings', type: 'movie', tmdbId: 12345, rating: 5 })).status, 404);
  } finally { close(); }
});

test('browse: categories map to genres or keywords, mix movies and shows, hide rated', async () => {
  const { call, close } = await setup();
  try {
    const cats = (await call('GET', '/api/categories')).body;
    assert.equal(cats[0].name, 'True crime');

    calls.length = 0;
    let r = (await call('GET', '/api/browse?category=true-crime')).body;
    const disc = calls.filter((u) => u.pathname.startsWith('/discover/'));
    assert.equal(disc.length, 2);
    for (const u of disc) {
      assert.equal(u.searchParams.get('with_keywords'), '33722');
      assert.equal(u.searchParams.get('with_watch_providers'), null, 'not limited to services by default');
    }
    // Sorted by popularity across both types
    assert.deepEqual(r.items.map((i) => i.title), ['Show Rec', 'On Hulu Only', 'Seed, The Movie']);
    assert.equal(r.totalPages, 3);

    calls.length = 0;
    await call('GET', '/api/browse?category=thriller&type=movie&sort=top');
    const u = calls.find((x) => x.pathname === '/discover/movie');
    assert.equal(u.searchParams.get('with_genres'), '53|9648');
    assert.equal(u.searchParams.get('sort_by'), 'vote_average.desc');
    assert.ok(!calls.some((x) => x.pathname === '/discover/tv'));

    // Rated titles drop out; only-my-services passes providers to TMDB
    await call('POST', '/api/import', { csv: RATINGS });
    await call('POST', '/api/settings', { services: [8, 15] });
    calls.length = 0;
    r = (await call('GET', '/api/browse?category=crime&onlyMine=1')).body;
    assert.ok(!r.items.some((i) => i.tmdbId === 1));
    const d = calls.find((x) => x.pathname === '/discover/tv');
    assert.equal(d.searchParams.get('with_watch_providers'), '8|15');
    assert.equal(d.searchParams.get('watch_region'), 'US');
    assert.deepEqual(r.items.find((i) => i.title === 'Show Rec').services.map((p) => p.name), ['Netflix']);

    // Horror has no TV genre, so only movies are queried
    calls.length = 0;
    await call('GET', '/api/browse?category=horror');
    assert.ok(!calls.some((x) => x.pathname === '/discover/tv'));

    assert.equal((await call('GET', '/api/browse?category=nope')).status, 400);
  } finally { close(); }
});

test('dislikes push similar titles down', async () => {
  const { call, close } = await setup();
  try {
    await call('POST', '/api/titles', { list: 'ratings', type: 'movie', tmdbId: 40, reaction: 'like' });
    let recs = (await call('GET', '/api/recommendations')).body.items;
    assert.deepEqual(recs.map((r) => r.title), ['On Hulu Only']);
    const before = recs[0].score;

    // Seed's recs also include Hulu Only, so disliking Seed lowers it, but
    // one dislike doesn't cancel a like. Seed's other rec (20) only had
    // negative support, so it never shows.
    await call('POST', '/api/titles', { list: 'ratings', type: 'movie', tmdbId: 1, reaction: 'dislike' });
    recs = (await call('GET', '/api/recommendations')).body.items;
    assert.deepEqual(recs.map((r) => r.title), ['On Hulu Only']);
    assert.ok(recs[0].score < before);
    assert.deepEqual(recs[0].because, ['Hand Picked']);
  } finally { close(); }
});
