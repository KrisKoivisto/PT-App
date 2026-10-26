import { parseImdbCsv } from './imdb.js';
import { createTmdb, pool } from './tmdb.js';
import { recommend, availableWatchlist, genreAffinity, shape, matchServices } from './recommend.js';
import { browse, search, CATEGORIES, TRUE_CRIME_SUBS } from './browse.js';
import { REACTIONS, reactionOf, annotate } from './mine.js';

export const defaultProfile = () => ({
  region: 'US',
  services: [],
  includeRentBuy: false,
  minSeedRating: 8,
  ratings: [],
  watchlist: [],
});

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// Everything the app does, with no server: the page calls these directly and
// talks to TMDB itself. `store` persists the profile, key and response cache
// (localStorage in the browser, memory in tests).
export function createApi({ store, base, fetchImpl }) {
  const profile = { ...defaultProfile(), ...(store.loadProfile() ?? {}) };
  const cache = store.cache;
  let key = store.loadKey();
  const make = (k) => (k ? createTmdb({ key: k, base, cache, fetchImpl }) : null);
  let tmdb = make(key);

  const needKey = () => tmdb ?? (() => { throw fail('Add your TMDB key in Setup first.'); })();
  const save = () => store.saveProfile(profile);
  const done = (x) => { cache.save?.(); return x; };

  return {
    hasKey: () => !!tmdb,

    async setKey(k) {
      k = String(k ?? '').trim();
      if (!k) throw fail('Paste your key first.');
      const t = make(k);
      await t.verify(); // throws on a bad key
      key = k;
      tmdb = t;
      store.saveKey(k);
      return { ok: true };
    },

    status: () => ({
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

    providers: async (region = profile.region) => done(await needKey().providerList(region.toUpperCase())),

    settings(body) {
      if (typeof body.region === 'string' && /^[A-Za-z]{2}$/.test(body.region)) profile.region = body.region.toUpperCase();
      if (Array.isArray(body.services)) profile.services = body.services.map(Number).filter(Number.isInteger);
      if (typeof body.includeRentBuy === 'boolean') profile.includeRentBuy = body.includeRentBuy;
      if (Number.isFinite(body.minSeedRating)) profile.minSeedRating = Math.min(10, Math.max(1, body.minSeedRating));
      save();
      return { ok: true };
    },

    importCsv(csv) {
      const { kind, items } = parseImdbCsv(String(csv ?? ''));
      // Re-importing replaces the last import (IMDb exports are always the full
      // list) but keeps titles marked in the app that the file doesn't cover.
      const ids = new Set(items.map((i) => i.imdbId));
      const keep = profile[kind].filter((i) => i.source === 'manual' && !ids.has(i.imdbId));
      profile[kind] = [...items, ...keep];
      save();
      return { kind, count: items.length };
    },

    categories: () => ({
      categories: CATEGORIES.map(({ key, name }) => ({ key, name })),
      trueCrime: TRUE_CRIME_SUBS.map(({ key, name }) => ({ key, name })),
    }),

    async browse(p = {}) {
      const r = await browse(needKey(), profile, {
        category: p.category,
        sub: p.sub || null,
        type: ['movie', 'tv'].includes(p.type) ? p.type : 'all',
        sort: p.sort || 'popular',
        page: Math.max(1, Math.min(500, Number(p.page) || 1)),
        onlyMine: !!p.onlyMine,
        hideRated: p.hideRated !== false,
      });
      return done({ ...r, items: annotate(profile, r.items) });
    },

    async search(q) {
      q = String(q ?? '').trim();
      if (!q) return { suggestions: [], items: [], topic: null };
      const r = await search(needKey(), profile, q);
      return done({
        ...r,
        items: annotate(profile, r.items),
        topic: r.topic && { ...r.topic, items: annotate(profile, r.topic.items) },
      });
    },

    // Titles marked in the app, grouped by reaction, with where to watch.
    async titles(show = 'love') {
      const list = show === 'want'
        ? profile.watchlist.filter((i) => i.tmdbId)
        : profile.ratings.filter((i) => i.tmdbId && (i.reaction ?? reactionOf(i.rating)) === show);
      const t = needKey();
      const wanted = new Set(profile.services);
      const items = (await pool(list.slice().reverse(), 8, async (i) => {
        const d = await t.details(i.type, i.tmdbId);
        if (!d) return null;
        const item = shape(i.type, d, profile.region);
        return { ...item, services: matchServices(item, wanted, profile.includeRentBuy) };
      })).filter(Boolean);
      const counts = { love: 0, like: 0, dislike: 0, want: profile.watchlist.length };
      for (const r of profile.ratings) {
        const k = r.reaction ?? reactionOf(r.rating);
        if (k) counts[k]++;
      }
      return done({ items: annotate(profile, items), counts });
    },

    async mark(body) {
      const { list, type, tmdbId } = body;
      const reaction = REACTIONS[body.reaction] ? body.reaction : null;
      const rating = reaction ? REACTIONS[reaction] : Number(body.rating);
      if (!['ratings', 'watchlist'].includes(list) || !['movie', 'tv'].includes(type) || !Number.isInteger(tmdbId)) {
        throw fail('Bad title.');
      }
      if (list === 'ratings' && !(Number.isInteger(rating) && rating >= 1 && rating <= 10)) {
        throw fail('Rating must be 1 to 10.');
      }
      const d = await needKey().details(type, tmdbId);
      if (!d) throw fail('TMDB has no such title.', 404);
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
      if (list === 'ratings') {
        item.reaction = reaction ?? reactionOf(rating);
        item.reasons = (Array.isArray(body.reasons) ? body.reasons : [])
          .filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim().slice(0, 40)).slice(0, 12);
        item.note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
      }
      // Replace an existing entry for the same title, imported or not.
      const same = (i) => (i.tmdbId === tmdbId && i.type === type) || (item.imdbId && i.imdbId === item.imdbId);
      profile[list] = [...profile[list].filter((i) => !same(i)), item];
      // Rating something means you've watched it.
      if (list === 'ratings') profile.watchlist = profile.watchlist.filter((i) => !same(i));
      save();
      return done(annotate(profile, [item])[0]);
    },

    unmark({ list, type, tmdbId, imdbId }) {
      if (!['ratings', 'watchlist'].includes(list)) throw fail('Bad list.');
      profile[list] = profile[list].filter((i) => !((i.tmdbId === tmdbId && i.type === type) || (imdbId && i.imdbId === imdbId)));
      save();
      return { ok: true };
    },

    async recommendations({ type = 'all', genre = null } = {}) {
      const r = await recommend(needKey(), profile, { type, genre });
      return done({ ...r, items: annotate(profile, r.items) });
    },

    async watchlist() {
      const items = await availableWatchlist(needKey(), profile);
      return done({ items: annotate(profile, items) });
    },

    // Backup: everything you've marked, as JSON. The key isn't included.
    exportData: () => JSON.stringify({ app: 'what-to-watch', version: 1, profile }, null, 1),

    importData(text) {
      let data;
      try { data = JSON.parse(text); } catch { throw fail("That file isn't a backup from this app."); }
      if (data?.app !== 'what-to-watch' || !data.profile) throw fail("That file isn't a backup from this app.");
      const p = data.profile;
      Object.assign(profile, defaultProfile(), {
        region: typeof p.region === 'string' ? p.region : 'US',
        services: Array.isArray(p.services) ? p.services : [],
        includeRentBuy: !!p.includeRentBuy,
        minSeedRating: Number.isFinite(p.minSeedRating) ? p.minSeedRating : 8,
        ratings: Array.isArray(p.ratings) ? p.ratings : [],
        watchlist: Array.isArray(p.watchlist) ? p.watchlist : [],
      });
      save();
      return { ratings: profile.ratings.length, watchlist: profile.watchlist.length };
    },

    reset() {
      Object.assign(profile, defaultProfile());
      save();
      return { ok: true };
    },
  };
}

// localStorage-backed store for the browser. The response cache is capped so
// it can't fill the ~5 MB quota; on a quota error it shrinks and tries again.
export function browserStore(ls = localStorage) {
  const read = (k) => { try { return JSON.parse(ls.getItem(k)); } catch { return null; } };
  const write = (k, v) => { try { ls.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const cache = { data: read('wtw.cache') ?? {} };
  let timer;
  cache.save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const cap of [400, 150, 40, 0]) {
        const keep = Object.entries(cache.data).sort((a, b) => b[1].t - a[1].t).slice(0, cap);
        cache.data = Object.fromEntries(keep);
        if (write('wtw.cache', cache.data)) return;
      }
    }, 500);
  };
  return {
    cache,
    loadProfile: () => read('wtw.profile'),
    saveProfile: (p) => {
      if (!write('wtw.profile', p)) {
        // Make room by dropping the cache, then retry: the profile matters more.
        ls.removeItem('wtw.cache');
        cache.data = {};
        if (!write('wtw.profile', p)) throw fail('Your phone ran out of storage for this app.');
      }
    },
    loadKey: () => ls.getItem('wtw.key'),
    saveKey: (k) => ls.setItem('wtw.key', k),
  };
}
