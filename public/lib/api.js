import { createTmdb, pool } from './tmdb.js';
import { shape, matchServices } from './titles.js';
import { browse, search, detail, CATEGORIES, TRUE_CRIME_SUBS } from './browse.js';
import { REACTIONS, reactionOf, annotate } from './mine.js';

export const defaultProfile = () => ({ region: 'US', services: [], ratings: [], watchlist: [] });

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

// Everything the app does, with no server: the page calls these directly and
// talks to TMDB itself. `store` persists the profile, key and response cache
// (localStorage in the browser, memory in tests).
export function createApi({ store, base, fetchImpl }) {
  const profile = { ...defaultProfile(), ...(store.loadProfile() ?? {}) };
  const cache = store.cache;
  const make = (k) => (k ? createTmdb({ key: k, base, cache, fetchImpl }) : null);
  let tmdb = make(store.loadKey());

  const needKey = () => tmdb ?? (() => { throw fail('Add your TMDB key in Settings first.'); })();
  const save = () => store.saveProfile(profile);
  const done = (x) => { cache.save?.(); return x; };
  const reactionFor = (i) => i.reaction ?? reactionOf(i.rating);

  return {
    async setKey(k) {
      k = clean(k, 1000);
      if (!k) throw fail('Paste your key first.');
      const t = make(k);
      await t.verify(); // throws on a bad key
      tmdb = t;
      store.saveKey(k);
      return { ok: true };
    },

    status() {
      const counts = { want: profile.watchlist.length, love: 0, like: 0, dislike: 0 };
      for (const r of profile.ratings) {
        const k = reactionFor(r);
        if (k) counts[k]++;
      }
      return { hasKey: !!tmdb, region: profile.region, services: profile.services, counts };
    },

    providers: async (region = profile.region) => done(await needKey().providerList(region.toUpperCase())),

    settings(body) {
      if (typeof body.region === 'string' && /^[A-Za-z]{2}$/.test(body.region)) profile.region = body.region.toUpperCase();
      if (Array.isArray(body.services)) profile.services = body.services.map(Number).filter(Number.isInteger);
      save();
      return { ok: true };
    },

    categories: () => ({
      categories: CATEGORIES.map(({ key, name }) => ({ key, name })),
      trueCrime: TRUE_CRIME_SUBS.map(({ key, name }) => ({ key, name })),
    }),

    async browse(p = {}) {
      const r = await browse(needKey(), profile, {
        category: p.category,
        sub: p.sub || null,
        page: Math.max(1, Math.min(500, Number(p.page) || 1)),
        onlyMine: !!p.onlyMine,
      });
      return done({ ...r, items: annotate(profile, r.items) });
    },

    async search(q) {
      q = clean(q, 200);
      if (!q) return { suggestions: [], people: [], items: [], topic: null };
      const r = await search(needKey(), profile, q);
      return done({
        ...r,
        items: annotate(profile, r.items),
        topic: r.topic && { ...r.topic, items: annotate(profile, r.topic.items) },
      });
    },

    // Everything for the detail screen: the title, where to watch, and cast.
    async title(type, tmdbId) {
      const t = needKey();
      const [items, credits] = await Promise.all([
        detail(t, profile, [{ type, id: tmdbId }]),
        t.credits(type, tmdbId),
      ]);
      if (!items.length) throw fail('TMDB has no such title.', 404);
      return done({ ...annotate(profile, items)[0], cast: credits?.cast ?? [] });
    },

    // An actor (or director) and the titles they're known for.
    async person(id) {
      const t = needKey();
      const p = await t.person(id);
      if (!p) throw fail('TMDB has no such person.', 404);
      const items = await detail(t, profile, p.credits);
      const roles = new Map(p.credits.map((c) => [`${c.type}:${c.id}`, c.character]));
      return done({
        id: p.id, name: p.name, profile: p.profile, dept: p.dept,
        items: annotate(profile, items).map((i) => ({ ...i, role: roles.get(`${i.type}:${i.tmdbId}`) || '' })),
      });
    },

    // Your list: the watchlist, or what you've seen with a given reaction,
    // newest first, with where each one streams now.
    async list(show = 'want') {
      const src = show === 'want'
        ? profile.watchlist
        : profile.ratings.filter((i) => reactionFor(i) === show);
      const t = needKey();
      const wanted = new Set(profile.services);
      const items = (await pool(src.filter((i) => i.tmdbId).reverse(), 8, async (i) => {
        const d = await t.details(i.type, i.tmdbId);
        if (!d) return null;
        const item = shape(i.type, d, profile.region);
        return { ...item, services: matchServices(item, wanted) };
      })).filter(Boolean);
      return done({ items: annotate(profile, items) });
    },

    // Mark a title: on the watchlist, or seen with a reaction (and optional
    // reasons and note).
    async mark(body) {
      const { list, type, tmdbId } = body;
      if (!['ratings', 'watchlist'].includes(list) || !['movie', 'tv'].includes(type) || !Number.isInteger(tmdbId)) {
        throw fail('Bad title.');
      }
      if (list === 'ratings' && !REACTIONS[body.reaction]) throw fail('Pick how you felt about it.');
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
      };
      if (list === 'ratings') {
        item.reaction = body.reaction;
        item.reasons = (Array.isArray(body.reasons) ? body.reasons : [])
          .map((r) => clean(r, 40)).filter(Boolean).slice(0, 12);
        item.note = clean(body.note, 300);
      }
      const same = (i) => (i.tmdbId === tmdbId && i.type === type) || (item.imdbId && i.imdbId === item.imdbId);
      profile[list] = [...profile[list].filter((i) => !same(i)), item];
      // Seeing something takes it off the watchlist.
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

    // Backup: your list and settings, as JSON. The key isn't included.
    exportData: () => JSON.stringify({ app: 'what-to-watch', version: 1, profile }, null, 1),

    importData(text) {
      let data;
      try { data = JSON.parse(text); } catch { throw fail("That file isn't a backup from this app."); }
      if (data?.app !== 'what-to-watch' || !data.profile) throw fail("That file isn't a backup from this app.");
      const p = data.profile;
      Object.assign(profile, defaultProfile(), {
        region: typeof p.region === 'string' ? p.region : 'US',
        services: Array.isArray(p.services) ? p.services : [],
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

// Storage that never throws: some browsers (private windows, locked-down
// frames) refuse localStorage outright, and then the app runs from memory.
export function safeStorage() {
  try {
    const ls = globalThis.localStorage;
    ls.getItem('wtw.probe');
    return ls;
  } catch {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  }
}

// localStorage-backed store for the browser. The response cache is capped so
// it can't fill the ~5 MB quota; on a quota error it shrinks and tries again.
// `prefix` keeps sample mode's data apart from the real list.
export function browserStore(ls = safeStorage(), prefix = 'wtw.') {
  const k = (name) => prefix + name;
  const read = (name) => { try { return JSON.parse(ls.getItem(k(name))); } catch { return null; } };
  const write = (name, v) => { try { ls.setItem(k(name), JSON.stringify(v)); return true; } catch { return false; } };
  const remove = (name) => { try { ls.removeItem(k(name)); } catch {} };
  const cache = { data: read('cache') ?? {} };
  let timer;
  cache.save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const cap of [400, 150, 40, 0]) {
        const keep = Object.entries(cache.data).sort((a, b) => b[1].t - a[1].t).slice(0, cap);
        cache.data = Object.fromEntries(keep);
        if (write('cache', cache.data)) return;
      }
    }, 500);
  };
  return {
    cache,
    loadProfile: () => read('profile'),
    saveProfile: (p) => {
      if (!write('profile', p)) {
        // Make room by dropping the cache, then retry: the profile matters more.
        remove('cache');
        cache.data = {};
        if (!write('profile', p)) throw fail('Your phone ran out of storage for this app.');
      }
    },
    loadKey: () => { try { return ls.getItem(k('key')); } catch { return null; } },
    saveKey: (key) => { try { ls.setItem(k('key'), key); } catch {} },
  };
}
