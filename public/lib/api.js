import { createTmdb, pool } from './tmdb.js';
import { shape, matchServices, brand } from './titles.js';
import { browse, search, detail, CATEGORIES, subsOf, KINDS } from './browse.js';
import { moreLikeThis } from './similar.js';
import { cleanView, defaultView } from './filters.js';
import { createSync, encodeSeen, REMOTE_OF } from './sync.js';
import { REACTIONS, annotate } from './mine.js';

export const defaultProfile = () => ({ region: 'US', kind: 'all', view: defaultView(), services: [], serviceBrands: [], ratings: [], watchlist: [], passed: [] });
const LISTS = ['ratings', 'watchlist', 'passed'];

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

// Everything the app does, with no server: the page calls these directly and
// talks to TMDB itself. `store` persists the profile, key and response cache
// (localStorage in the browser, memory in tests). A key pasted in Settings
// wins over `builtInKey`. With `readToken`, the list syncs through the
// user's TMDB account (see sync.js).
export function createApi({ store, base, fetchImpl, builtInKey = null, readToken = null, syncBase }) {
  const profile = { ...defaultProfile(), ...(store.loadProfile() ?? {}) };
  const cache = store.cache;
  const make = (k) => (k ? createTmdb({ key: k, base, cache, fetchImpl }) : null);
  let tmdb = make(store.loadKey() || builtInKey);

  const needKey = () => tmdb ?? (() => { throw fail('Add your TMDB key in Settings first.'); })();
  const save = () => store.saveProfile(profile);

  // --- sync through TMDB -----------------------------------------------------------
  const sync = readToken && store.loadSync
    ? createSync({ readToken, base: syncBase, fetchImpl, store: { load: store.loadSync, save: store.saveSync } })
    : null;
  const prefsOf = () => ({ region: profile.region, services: profile.services, serviceBrands: profile.serviceBrands, kind: profile.kind, view: profile.view });
  const queuePrefs = () => sync?.signedIn && sync.queue({ kind: 'prefs', prefs: prefsOf() });
  // The remote side of marking a title: same moves as the local lists.
  function queueMark(list, item) {
    if (!sync?.signedIn) return;
    const others = { ratings: ['watchlist', 'passed'], passed: ['watchlist', 'ratings'], watchlist: ['passed'] }[list];
    sync.queue(
      { kind: 'add', list: REMOTE_OF[list], item, comment: list === 'ratings' ? encodeSeen(item) : undefined },
      ...others.map((l) => ({ kind: 'remove', list: REMOTE_OF[l], item })),
    );
  }
  // Replace the local lists with what's on TMDB (after sending local changes).
  function adopt(remote) {
    profile.watchlist = remote.watchlist;
    profile.ratings = remote.ratings;
    profile.passed = remote.passed;
    const p = remote.prefs;
    if (p && typeof p === 'object' && Object.keys(p).length) {
      if (typeof p.region === 'string') profile.region = p.region;
      if (Array.isArray(p.services)) profile.services = p.services;
      if (Array.isArray(p.serviceBrands)) profile.serviceBrands = p.serviceBrands;
      if (KINDS.includes(p.kind)) profile.kind = p.kind;
      if (p.view) profile.view = cleanView(p.view);
    }
    save();
  }
  const done = (x) => { cache.save?.(); return x; };

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
      const counts = { want: profile.watchlist.length, seen: profile.ratings.length, passed: profile.passed.length };
      return { hasKey: !!tmdb, ownKey: !!store.loadKey(), kind: profile.kind, view: cleanView(profile.view), region: profile.region, services: profile.services, serviceBrands: profile.serviceBrands, counts };
    },

    providers: async (region = profile.region) => done(await needKey().providerList(region.toUpperCase())),

    settings(body) {
      if (typeof body.region === 'string' && /^[A-Za-z]{2}$/.test(body.region)) profile.region = body.region.toUpperCase();
      if (KINDS.includes(body.kind)) profile.kind = body.kind;
      if (body.view && typeof body.view === 'object') profile.view = cleanView(body.view);
      if (Array.isArray(body.services)) {
        profile.services = body.services.map(Number).filter(Number.isInteger);
        // Names too, so "Netflix Standard with Ads" counts when you ticked Netflix.
        profile.serviceBrands = (Array.isArray(body.serviceNames) ? body.serviceNames : []).map((n) => brand(String(n))).filter(Boolean);
      }
      save();
      queuePrefs();
      return { ok: true };
    },

    categories: () => ({
      categories: CATEGORIES.map(({ key, name }) => ({ key, name })),
      // Subcategories for each category that has them.
      subs: Object.fromEntries(CATEGORIES.map((c) => [c.key, subsOf(c.key).map(({ key, name }) => ({ key, name }))]).filter(([, l]) => l.length)),
    }),

    async browse(p = {}) {
      const r = await browse(needKey(), profile, {
        category: p.category,
        sub: p.sub || null,
        page: Math.max(1, Math.min(500, Number(p.page) || 1)),
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

    // Titles that are about the same things as this one (see similar.js).
    async similar(type, tmdbId) {
      const r = await moreLikeThis(needKey(), profile, type, tmdbId);
      return done({ ...r, items: annotate(profile, r.items) });
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

    // Your list: bookmarked, seen, or passed, newest first, with where each
    // one streams now.
    async list(show = 'want') {
      const src = { want: profile.watchlist, seen: profile.ratings, passed: profile.passed }[show];
      if (!src) throw fail('Unknown list.');
      const t = needKey();
      const items = (await pool(src.filter((i) => i.tmdbId).reverse(), 8, async (i) => {
        const d = await t.details(i.type, i.tmdbId, profile.region);
        if (!d) return null;
        const item = shape(i.type, d, profile.region);
        return { ...item, services: matchServices(item, profile) };
      })).filter(Boolean);
      return done({ items: annotate(profile, items) });
    },

    // Mark a title: bookmarked (watchlist), seen (with an optional reaction,
    // reasons and note), or passed. Seen and passed rule each other out, and
    // either one takes a title off the watchlist.
    async mark(body) {
      const { list, type, tmdbId } = body;
      if (!LISTS.includes(list) || !['movie', 'tv'].includes(type) || !Number.isInteger(tmdbId)) {
        throw fail('Bad title.');
      }
      if (list === 'ratings' && !REACTIONS[body.reaction]) throw fail('Pick how you felt about it.');
      const d = await needKey().details(type, tmdbId, profile.region);
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
      const drop = { ratings: ['watchlist', 'passed'], passed: ['watchlist', 'ratings'], watchlist: ['passed'] }[list];
      for (const l of drop) profile[l] = profile[l].filter((i) => !same(i));
      save();
      queueMark(list, item);
      return done(annotate(profile, [item])[0]);
    },

    unmark({ list, type, tmdbId, imdbId }) {
      if (!LISTS.includes(list)) throw fail('Bad list.');
      const gone = profile[list].filter((i) => (i.tmdbId === tmdbId && i.type === type) || (imdbId && i.imdbId === imdbId));
      profile[list] = profile[list].filter((i) => !gone.includes(i));
      save();
      if (sync?.signedIn) for (const i of gone) if (i.tmdbId) sync.queue({ kind: 'remove', list: REMOTE_OF[list], item: i });
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
        serviceBrands: Array.isArray(p.serviceBrands) ? p.serviceBrands : [],
        ratings: Array.isArray(p.ratings) ? p.ratings : [],
        watchlist: Array.isArray(p.watchlist) ? p.watchlist : [],
        passed: Array.isArray(p.passed) ? p.passed : [],
      });
      save();
      return { ratings: profile.ratings.length, watchlist: profile.watchlist.length, passed: profile.passed.length };
    },

    reset() {
      // Deleting your list deletes it everywhere you're signed in.
      if (sync?.signedIn) {
        for (const l of ['watchlist', 'ratings', 'passed']) {
          for (const i of profile[l]) if (i.tmdbId) sync.queue({ kind: 'remove', list: REMOTE_OF[l], item: i });
        }
      }
      Object.assign(profile, defaultProfile());
      save();
      return { ok: true };
    },

    sync: {
      status: () => ({ available: !!sync, signedIn: !!sync?.signedIn, waiting: !!sync?.waiting, lastSync: sync?.lastSync ?? null, pending: sync?.pendingChanges ?? 0 }),
      startSignIn: (returnUrl) => sync.startSignIn(returnUrl),

      // Finishes sign-in once approved, then merges this device's list with
      // what's already on TMDB: nothing on either side is lost.
      async finishSignIn() {
        if (!(await sync.finishSignIn())) return false;
        const remote = await sync.pull();
        const has = (l, i) => remote[l].some((r) => r.tmdbId === i.tmdbId && r.type === i.type);
        for (const l of ['watchlist', 'ratings', 'passed']) {
          for (const i of profile[l]) if (i.tmdbId && !has(l, i)) queueMark(l, i);
        }
        const remotePrefs = remote.prefs && Object.keys(remote.prefs).length;
        if (!remotePrefs) queuePrefs();
        await sync.flush();
        adopt(await sync.pull());
        return true;
      },

      // Send this device's changes, then take what's on TMDB.
      async now() {
        if (!sync?.signedIn) return false;
        await sync.flush();
        adopt(await sync.pull());
        return true;
      },
      // Just send changes (after a tap), without reloading the lists.
      push: () => (sync?.signedIn ? sync.flush() : Promise.resolve()),
      signOut: () => sync.signOut(),
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
    loadSync: () => read('sync'),
    saveSync: (v) => write('sync', v),
    saveKey: (key) => { try { ls.setItem(k('key'), key); } catch {} },
  };
}
