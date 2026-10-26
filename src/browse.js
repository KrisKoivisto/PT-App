import { pool } from './tmdb.js';
import { shape, matchServices, seenSet, isSeen } from './recommend.js';

// Genres are looked up by name because movie and TV ids differ. TMDB has no
// genre for things like true crime, so those use keyword ids (checked on
// themoviedb.org/search/keyword).
export const CATEGORIES = [
  { key: 'true-crime', name: 'True crime', keywords: [33722] },
  { key: 'crime', name: 'Crime', movie: ['Crime'], tv: ['Crime'] },
  { key: 'documentary', name: 'Documentary', movie: ['Documentary'], tv: ['Documentary'] },
  { key: 'comedy', name: 'Comedy', movie: ['Comedy'], tv: ['Comedy'] },
  { key: 'standup', name: 'Stand-up', keywords: [9716] },
  { key: 'drama', name: 'Drama', movie: ['Drama'], tv: ['Drama'] },
  { key: 'thriller', name: 'Thriller & mystery', movie: ['Thriller', 'Mystery'], tv: ['Mystery'] },
  { key: 'action', name: 'Action & adventure', movie: ['Action', 'Adventure'], tv: ['Action & Adventure'] },
  { key: 'scifi', name: 'Sci-fi & fantasy', movie: ['Science Fiction', 'Fantasy'], tv: ['Sci-Fi & Fantasy'] },
  { key: 'horror', name: 'Horror', movie: ['Horror'] },
  { key: 'romance', name: 'Romance', movie: ['Romance'] },
  { key: 'true-story', name: 'Based on a true story', keywords: [9672] },
  { key: 'history', name: 'History & war', movie: ['History', 'War'], tv: ['War & Politics'] },
  { key: 'animation', name: 'Animation', movie: ['Animation'], tv: ['Animation'] },
  { key: 'family', name: 'Family & kids', movie: ['Family'], tv: ['Family', 'Kids'] },
  { key: 'reality', name: 'Reality', tv: ['Reality'] },
];

const CONCURRENCY = 8;
const today = () => new Date().toISOString().slice(0, 10);

// Discover params for one media type, or null if the category has none.
async function categoryParams(tmdb, cat, type) {
  if (cat.keywords) return { with_keywords: cat.keywords.join('|') };
  if (!cat[type]) return null;
  const all = await tmdb.genres(type);
  const ids = all.filter((g) => cat[type].includes(g.name)).map((g) => g.id);
  return ids.length ? { with_genres: ids.join('|') } : null;
}

const SORTS = {
  popular: { movie: { sort_by: 'popularity.desc' }, tv: { sort_by: 'popularity.desc' }, field: (r) => r.popularity },
  top: {
    movie: { sort_by: 'vote_average.desc', 'vote_count.gte': 300 },
    tv: { sort_by: 'vote_average.desc', 'vote_count.gte': 150 },
    field: (r) => r.vote_average,
  },
  new: {
    movie: () => ({ sort_by: 'primary_release_date.desc', 'primary_release_date.lte': today(), 'vote_count.gte': 10 }),
    tv: () => ({ sort_by: 'first_air_date.desc', 'first_air_date.lte': today(), 'vote_count.gte': 10 }),
    field: (r) => Date.parse(r.release_date ?? r.first_air_date ?? 0) || 0,
  },
};

// Turn bare TMDB results into full items with where-to-watch.
async function detail(tmdb, profile, list) {
  const rows = await pool(list, CONCURRENCY, async ({ type, id }) => {
    const d = await tmdb.details(type, id);
    if (!d) return null;
    const item = shape(type, d, profile.region);
    return { ...item, services: matchServices(item, new Set(profile.services), profile.includeRentBuy) };
  });
  return rows.filter(Boolean);
}

export async function browse(tmdb, profile, { category, type = 'all', sort = 'popular', page = 1, onlyMine = false, hideRated = true }) {
  const cat = CATEGORIES.find((c) => c.key === category);
  if (!cat) throw Object.assign(new Error('Unknown category.'), { status: 400 });
  const s = SORTS[sort] ?? SORTS.popular;
  const types = type === 'all' ? ['movie', 'tv'] : [type];

  const where = {};
  if (onlyMine && profile.services.length) {
    where.watch_region = profile.region;
    where.with_watch_providers = profile.services.join('|');
    where.with_watch_monetization_types = profile.includeRentBuy ? 'flatrate|free|ads|rent|buy' : 'flatrate|free|ads';
  }

  let totalPages = 0;
  const found = [];
  await Promise.all(types.map(async (t) => {
    const params = await categoryParams(tmdb, cat, t);
    if (!params) return;
    const sortParams = typeof s[t] === 'function' ? s[t]() : s[t];
    const r = await tmdb.discover(t, { ...params, ...sortParams, ...where, page });
    totalPages = Math.max(totalPages, Math.min(r?.total_pages ?? 0, 500));
    for (const x of r?.results ?? []) found.push({ type: t, id: x.id, rank: s.field(x) });
  }));

  // Mix movies and shows by the chosen sort.
  found.sort((a, b) => b.rank - a.rank);
  let items = await detail(tmdb, profile, found);
  if (hideRated) {
    const seen = seenSet(profile.ratings);
    items = items.filter((i) => !isSeen(seen, i));
  }
  return { items, page, totalPages, category: cat.name };
}

export async function search(tmdb, profile, q) {
  const hits = await tmdb.search(q);
  return detail(tmdb, profile, hits.map((h) => ({ type: h.type, id: h.tmdbId })));
}
