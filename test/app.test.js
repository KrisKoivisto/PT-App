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
  '/watch/providers/movie': { results: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.jpg', display_priorities: { US: 1 } }] },
  '/watch/providers/tv': { results: [{ provider_id: 15, provider_name: 'Hulu', logo_path: '/h.jpg', display_priorities: { US: 2 } }] },
};

async function setup(key = 'k') {
  const mock = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
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

test('manual titles: search, rate, watchlist, survive an IMDb re-import', async () => {
  const { call, close } = await setup();
  try {
    const found = (await call('GET', '/api/search?q=hand')).body;
    assert.deepEqual(found.map((f) => [f.title, f.type, f.year]), [['Hand Picked', 'movie', 2019], ['Hand Show', 'tv', 2018]]);

    // Recommendations work with no IMDb data at all
    assert.equal((await call('POST', '/api/titles', { list: 'watchlist', type: 'movie', tmdbId: 40 })).status, 200);
    const rated = (await call('POST', '/api/titles', { list: 'ratings', type: 'movie', tmdbId: 40, rating: 9 })).body;
    assert.equal(rated.imdbId, 'tt0000040');
    let titles = (await call('GET', '/api/titles')).body;
    assert.equal(titles.ratings.length, 1);
    assert.equal(titles.watchlist.length, 0, 'rating a title takes it off the watchlist');

    const recs = (await call('GET', '/api/recommendations')).body.items;
    assert.deepEqual(recs.map((r) => r.title), ['On Hulu Only']);
    assert.deepEqual(recs[0].because, ['Hand Picked']);

    // Show without an IMDb id still works on the watchlist
    await call('POST', '/api/titles', { list: 'watchlist', type: 'tv', tmdbId: 41 });
    const wl = (await call('GET', '/api/watchlist')).body.items;
    assert.deepEqual(wl.map((w) => w.title), ['Hand Show']);

    // Re-rating replaces instead of duplicating
    await call('POST', '/api/titles', { list: 'ratings', type: 'movie', tmdbId: 40, rating: 7 });
    titles = (await call('GET', '/api/titles')).body;
    assert.deepEqual(titles.ratings.map((r) => r.rating), [7]);

    await call('POST', '/api/import', { csv: RATINGS });
    assert.equal((await call('GET', '/api/status')).body.ratings, 4);

    await call('POST', '/api/titles/remove', { list: 'ratings', type: 'movie', tmdbId: 40 });
    assert.equal((await call('GET', '/api/status')).body.ratings, 3);

    assert.equal((await call('POST', '/api/titles', { list: 'ratings', type: 'movie', tmdbId: 40, rating: 11 })).status, 400);
    assert.equal((await call('POST', '/api/titles', { list: 'ratings', type: 'movie', tmdbId: 12345, rating: 5 })).status, 404);
  } finally { close(); }
});
