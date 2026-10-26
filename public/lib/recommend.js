import { pool } from './tmdb.js';

const SEED_LIMIT = 30;
const CANDIDATE_LIMIT = 90;
const CONCURRENCY = 8;

const ALIASES = {
  'sci-fi': ['science fiction'],
  'action & adventure': ['action', 'adventure'],
  'sci-fi & fantasy': ['science fiction', 'fantasy'],
  'war & politics': ['war'],
  reality: ['reality-tv'],
  talk: ['talk-show'],
};

export function normGenres(names = []) {
  const out = new Set();
  for (const n of names) {
    const k = n.toLowerCase();
    for (const g of ALIASES[k] ?? [k]) out.add(g);
  }
  return out;
}

// How much the user likes each genre relative to their average rating.
export function genreAffinity(ratings) {
  const rated = ratings.filter((r) => r.rating);
  if (!rated.length) return {};
  const overall = rated.reduce((s, r) => s + r.rating, 0) / rated.length;
  const sums = {};
  for (const r of rated) {
    for (const g of normGenres(r.genres)) {
      (sums[g] ??= { total: 0, n: 0 });
      sums[g].total += r.rating;
      sums[g].n++;
    }
  }
  const out = {};
  for (const [g, { total, n }] of Object.entries(sums)) {
    if (n >= 3) out[g] = Math.max(-2, Math.min(2, total / n - overall));
  }
  return out;
}

export function shape(type, d, region) {
  const p = d['watch/providers']?.results?.[region] ?? {};
  const pick = (list) => (list ?? []).map((x) => ({ id: x.provider_id, name: x.provider_name, logo: x.logo_path }));
  return {
    tmdbId: d.id,
    imdbId: d.external_ids?.imdb_id ?? null,
    type,
    title: d.title ?? d.name,
    year: Number((d.release_date ?? d.first_air_date ?? '').slice(0, 4)) || null,
    overview: d.overview,
    poster: d.poster_path,
    backdrop: d.backdrop_path ?? null,
    genres: (d.genres ?? []).map((g) => g.name),
    runtime: d.runtime ?? d.episode_run_time?.[0] ?? null,
    seasons: d.number_of_seasons ?? null,
    voteAverage: d.vote_average,
    voteCount: d.vote_count,
    stream: pick(p.flatrate),
    free: pick([...(p.free ?? []), ...(p.ads ?? [])]),
    rentBuy: pick([...(p.rent ?? []), ...(p.buy ?? [])]),
    link: p.link ?? null,
  };
}

// Services the user has that carry this title.
export function matchServices(item, wanted, includeRentBuy) {
  const pool = [...item.stream, ...item.free, ...(includeRentBuy ? item.rentBuy : [])];
  const seen = new Set();
  return pool.filter((p) => wanted.has(p.id) && !seen.has(p.id) && seen.add(p.id));
}

// Titles added in the app already carry a TMDB id; IMDb imports need a lookup.
export async function resolve(tmdb, item) {
  if (item.tmdbId) return { ...item, tmdbType: item.type };
  const hit = await tmdb.find(item.imdbId, item.type);
  return hit ? { ...item, tmdbId: hit.id, tmdbType: hit.type } : null;
}

export function seenSet(items) {
  const s = new Set();
  for (const r of items) {
    if (r.imdbId) s.add(r.imdbId);
    if (r.tmdbId) s.add(`${r.type}:${r.tmdbId}`);
  }
  return s;
}

export const isSeen = (seen, item) =>
  (item.imdbId && seen.has(item.imdbId)) || (item.tmdbId && seen.has(`${item.type}:${item.tmdbId}`));

export async function recommend(tmdb, profile, { type = 'all', genre = null, limit = 30 } = {}) {
  const wanted = new Set(profile.services);
  const rated = profile.ratings;
  const seen = seenSet(rated);
  const affinity = genreAffinity(rated);

  const seeds = rated
    .filter((r) => r.rating >= profile.minSeedRating)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, SEED_LIMIT);
  if (!seeds.length) return { items: [], reason: 'no-seeds' };
  // Things you didn't like push their look-alikes down.
  const disliked = rated.filter((r) => r.rating && r.rating <= 4).slice(0, SEED_LIMIT / 2);

  const resolved = (await pool([...seeds, ...disliked], CONCURRENCY, (s) => resolve(tmdb, s))).filter(Boolean);

  // candidate key -> accumulated seed support
  const cands = new Map();
  await pool(resolved, CONCURRENCY, async (seed) => {
    const r = await tmdb.recommendations(seed.tmdbType, seed.tmdbId);
    const results = r?.results ?? [];
    const w = (seed.rating - 5) / 5;
    results.forEach((c, i) => {
      const t = c.media_type ?? seed.tmdbType;
      if (t !== 'movie' && t !== 'tv') return;
      const k = `${t}:${c.id}`;
      const e = cands.get(k) ?? { type: t, id: c.id, score: 0, because: [] };
      e.score += w * (1 - i / 40);
      if (w > 0) e.because.push(seed.title);
      cands.set(k, e);
    });
  });

  const top = [...cands.values()]
    .filter((c) => c.score > 0 && (type === 'all' || c.type === type))
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATE_LIMIT);

  const detailed = await pool(top, CONCURRENCY, async (c) => {
    const d = await tmdb.details(c.type, c.id);
    return d ? { c, item: shape(c.type, d, profile.region) } : null;
  });

  const out = [];
  for (const row of detailed) {
    if (!row) continue;
    const { c, item } = row;
    if (isSeen(seen, item)) continue;
    if (genre && !normGenres(item.genres).has(genre.toLowerCase())) continue;

    let services = [];
    if (wanted.size) {
      services = matchServices(item, wanted, profile.includeRentBuy);
      if (!services.length) continue;
    }

    const g = [...normGenres(item.genres)];
    const genreBonus = g.length ? g.reduce((s, x) => s + (affinity[x] ?? 0), 0) / g.length : 0;
    const quality = item.voteCount >= 200 ? (item.voteAverage - 6.5) * 0.4 : 0;
    out.push({
      ...item,
      services,
      because: [...new Set(c.because)].slice(0, 3),
      score: Math.round((c.score * 3 + genreBonus + quality) * 100) / 100,
    });
  }

  out.sort((a, b) => b.score - a.score);
  return { items: out.slice(0, limit) };
}

// Watchlist titles that are streaming on the user's services right now.
export async function availableWatchlist(tmdb, profile) {
  const wanted = new Set(profile.services);
  const seen = seenSet(profile.ratings);
  const todo = profile.watchlist.filter((w) => !isSeen(seen, w));

  const rows = await pool(todo, CONCURRENCY, async (w) => {
    const hit = await resolve(tmdb, w);
    if (!hit) return null;
    const d = await tmdb.details(hit.tmdbType, hit.tmdbId);
    if (!d) return null;
    const item = shape(hit.tmdbType, d, profile.region);
    const services = wanted.size ? matchServices(item, wanted, profile.includeRentBuy) : [];
    const anywhere = item.stream.length + item.free.length > 0;
    return { ...item, services, available: wanted.size ? services.length > 0 : anywhere };
  });

  return rows.filter(Boolean).sort((a, b) => Number(b.available) - Number(a.available));
}
