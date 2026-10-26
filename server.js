import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseImdbCsv } from './src/imdb.js';
import { createTmdb } from './src/tmdb.js';
import { recommend, availableWatchlist, genreAffinity } from './src/recommend.js';
import { JsonFile, defaultProfile } from './src/store.js';

const root = path.dirname(fileURLToPath(import.meta.url));

async function loadEnvFile() {
  try {
    for (const line of (await readFile(path.join(root, '.env'), 'utf8')).split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {}
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

export async function createApp({ dataDir = path.join(root, 'data'), key = process.env.TMDB_API_KEY, tmdbBase } = {}) {
  const profileFile = new JsonFile(path.join(dataDir, 'profile.json'), defaultProfile());
  const cache = new JsonFile(path.join(dataDir, 'cache.json'), {});
  const profile = await profileFile.load();
  Object.assign(profile, { ...defaultProfile(), ...profile });
  await cache.load();
  const tmdb = key ? createTmdb({ key, base: tmdbBase, cache }) : null;

  const needKey = () => {
    if (!tmdb) throw Object.assign(new Error('Set TMDB_API_KEY in .env first (see README).'), { status: 400 });
    return tmdb;
  };

  const routes = {
    'GET /api/status': async () => ({
      hasKey: !!tmdb,
      region: profile.region,
      services: profile.services,
      includeRentBuy: profile.includeRentBuy,
      minSeedRating: profile.minSeedRating,
      ratings: profile.ratings.length,
      watchlist: profile.watchlist.length,
      topGenres: Object.entries(genreAffinity(profile.ratings))
        .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g),
    }),

    'GET /api/providers': async (req, url) => {
      const region = (url.searchParams.get('region') || profile.region).toUpperCase();
      return needKey().providerList(region);
    },

    'POST /api/settings': async (req, url, body) => {
      if (typeof body.region === 'string' && /^[A-Za-z]{2}$/.test(body.region)) profile.region = body.region.toUpperCase();
      if (Array.isArray(body.services)) profile.services = body.services.map(Number).filter(Number.isInteger);
      if (typeof body.includeRentBuy === 'boolean') profile.includeRentBuy = body.includeRentBuy;
      if (Number.isFinite(body.minSeedRating)) profile.minSeedRating = Math.min(10, Math.max(1, body.minSeedRating));
      await profileFile.save();
      return { ok: true };
    },

    'POST /api/import': async (req, url, body) => {
      const { kind, items } = parseImdbCsv(String(body.csv ?? ''));
      // Re-importing replaces the last import (IMDb exports are always the full
      // list) but keeps titles added by hand that the file doesn't cover.
      const ids = new Set(items.map((i) => i.imdbId));
      const keep = profile[kind].filter((i) => i.source === 'manual' && !ids.has(i.imdbId));
      profile[kind] = [...items, ...keep];
      await profileFile.save();
      return { kind, count: items.length };
    },

    'GET /api/search': async (req, url) => {
      const q = (url.searchParams.get('q') || '').trim();
      return q ? needKey().search(q) : [];
    },

    'GET /api/titles': async () => ({
      ratings: profile.ratings.filter((i) => i.source === 'manual'),
      watchlist: profile.watchlist.filter((i) => i.source === 'manual'),
    }),

    'POST /api/titles': async (req, url, body) => {
      const { list, type, tmdbId } = body;
      const rating = Number(body.rating);
      if (!['ratings', 'watchlist'].includes(list) || !['movie', 'tv'].includes(type) || !Number.isInteger(tmdbId)) {
        throw Object.assign(new Error('Bad title.'), { status: 400 });
      }
      if (list === 'ratings' && !(Number.isInteger(rating) && rating >= 1 && rating <= 10)) {
        throw Object.assign(new Error('Rating must be 1 to 10.'), { status: 400 });
      }
      const d = await needKey().details(type, tmdbId);
      if (!d) throw Object.assign(new Error('TMDB has no such title.'), { status: 404 });
      const item = {
        imdbId: d.external_ids?.imdb_id || null,
        tmdbId,
        type,
        title: d.title ?? d.name,
        year: Number((d.release_date ?? d.first_air_date ?? '').slice(0, 4)) || null,
        genres: (d.genres ?? []).map((g) => g.name),
        poster: d.poster_path ?? null,
        rating: list === 'ratings' ? rating : null,
        source: 'manual',
      };
      // Replace an existing entry for the same title, imported or not.
      const same = (i) => (i.tmdbId === tmdbId && i.type === type) || (item.imdbId && i.imdbId === item.imdbId);
      profile[list] = [...profile[list].filter((i) => !same(i)), item];
      // Rating something means you've watched it.
      if (list === 'ratings') profile.watchlist = profile.watchlist.filter((i) => !same(i));
      await Promise.all([profileFile.save(), cache.save()]);
      return item;
    },

    'POST /api/titles/remove': async (req, url, body) => {
      const { list, type, tmdbId } = body;
      if (!['ratings', 'watchlist'].includes(list)) throw Object.assign(new Error('Bad list.'), { status: 400 });
      profile[list] = profile[list].filter((i) => !(i.tmdbId === tmdbId && i.type === type));
      await profileFile.save();
      return { ok: true };
    },

    'GET /api/recommendations': async (req, url) => {
      const type = url.searchParams.get('type') || 'all';
      const genre = url.searchParams.get('genre') || null;
      const r = await recommend(needKey(), profile, { type, genre });
      await cache.save();
      return r;
    },

    'GET /api/watchlist': async () => {
      const items = await availableWatchlist(needKey(), profile);
      await cache.save();
      return { items };
    },

    'DELETE /api/profile': async () => {
      Object.assign(profile, defaultProfile());
      await profileFile.save();
      return { ok: true };
    },
  };

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 20e6) throw Object.assign(new Error('Upload too large.'), { status: 413 });
      chunks.push(c);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
    catch { throw Object.assign(new Error('Bad JSON.'), { status: 400 }); }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    try {
      const handler = routes[`${req.method} ${url.pathname}`];
      if (handler) {
        // Requiring JSON on writes blocks cross-site form posts.
        if (req.method === 'POST' && !String(req.headers['content-type']).startsWith('application/json')) {
          return send(415, { error: 'Send JSON.' });
        }
        const body = req.method === 'POST' ? await readBody(req) : null;
        return send(200, await handler(req, url, body));
      }
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const file = path.join(root, 'public', rel);
        if (!file.startsWith(path.join(root, 'public') + path.sep)) return send(403, 'no', 'text/plain');
        try {
          return send(200, await readFile(file), MIME[path.extname(file)] ?? 'application/octet-stream');
        } catch { return send(404, 'Not found', 'text/plain'); }
      }
      send(404, { error: 'Not found' });
    } catch (e) {
      send(e.status ?? 500, { error: e.message });
    }
  });

  return { server, profile };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await loadEnvFile();
  const { server } = await createApp({ tmdbBase: process.env.TMDB_BASE_URL });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '127.0.0.1', () => {
    console.log(`http://localhost:${port}`);
    if (!process.env.TMDB_API_KEY) console.log('No TMDB_API_KEY set. Copy .env.example to .env and add one.');
  });
}
