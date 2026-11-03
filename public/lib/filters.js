import { brand } from './titles.js';

// Sort and filter choices for Find. Categories turn them into TMDB discover
// parameters; search and More like this apply them to results already loaded.
export const SORTS = { popular: 'Popular now', top: 'Top rated', newest: 'Newest', oldest: 'Oldest' };
export const RATINGS = [0, 6, 7, 8];
export const RELEASED = { any: 'Any time', year: 'Past year', five: 'Last 5 years', ten: 'Last 10 years', classic: 'Before 2000' };

// where: 'any' (no streaming filter), 'mine' (your services), or 'pick'
// (the services in `picks`, each { id, name, brand }).
export const defaultView = () => ({ sort: 'popular', where: 'any', picks: [], rating: 0, released: 'any' });

export function cleanView(v = {}) {
  const d = defaultView();
  return {
    sort: SORTS[v.sort] ? v.sort : d.sort,
    where: ['any', 'mine', 'pick'].includes(v.where) ? v.where : d.where,
    picks: Array.isArray(v.picks)
      ? v.picks.filter((p) => Number.isInteger(p?.id)).slice(0, 20)
        .map((p) => ({ id: p.id, name: String(p.name ?? p.brand ?? '').slice(0, 40), brand: brand(String(p.name ?? p.brand ?? '')) }))
      : [],
    rating: RATINGS.includes(v.rating) ? v.rating : d.rating,
    released: RELEASED[v.released] ? v.released : d.released,
  };
}

const iso = (d) => d.toISOString().slice(0, 10);
const yearsAgo = (n, now) => { const d = new Date(now); d.setFullYear(d.getFullYear() - n); return d; };

export function dateRange(released, now = new Date()) {
  if (released === 'year') return { gte: iso(yearsAgo(1, now)), lte: iso(now) };
  if (released === 'five') return { gte: iso(yearsAgo(5, now)), lte: iso(now) };
  if (released === 'ten') return { gte: iso(yearsAgo(10, now)), lte: iso(now) };
  if (released === 'classic') return { lte: '1999-12-31' };
  return { lte: iso(now) }; // never list things that aren't out yet
}

// Streaming services the view asks for, as ids (for TMDB) and brands (to match
// ad tiers and add-on channels of the same service).
export function wantedServices(view, profile) {
  if (view.where === 'mine') return { ids: profile.services ?? [], brands: profile.serviceBrands ?? [] };
  if (view.where === 'pick') return { ids: view.picks.map((p) => p.id), brands: view.picks.map((p) => p.brand) };
  return null;
}

// Vote floors keep a 10/10 from three votes off the top of "Top rated".
const MIN_VOTES = { movie: { top: 200, rated: 50, oldest: 30, newest: 5 }, tv: { top: 50, rated: 20, oldest: 15, newest: 5 } };

export function discoverParams(view, type, profile, now = new Date()) {
  const date = type === 'movie' ? 'primary_release_date' : 'first_air_date';
  const floor = MIN_VOTES[type];
  const p = {};
  if (view.sort === 'top') Object.assign(p, { sort_by: 'vote_average.desc', 'vote_count.gte': floor.top });
  else if (view.sort === 'newest') Object.assign(p, { sort_by: `${date}.desc`, 'vote_count.gte': floor.newest });
  else if (view.sort === 'oldest') Object.assign(p, { sort_by: `${date}.asc`, 'vote_count.gte': floor.oldest });
  else p.sort_by = 'popularity.desc';

  if (view.rating) {
    p['vote_average.gte'] = view.rating;
    p['vote_count.gte'] = Math.max(p['vote_count.gte'] ?? 0, floor.rated);
  }
  const range = dateRange(view.released, now);
  if (range.gte) p[`${date}.gte`] = range.gte;
  if (range.lte) p[`${date}.lte`] = range.lte;

  const svc = wantedServices(view, profile);
  if (svc?.ids.length) {
    Object.assign(p, { watch_region: profile.region, with_watch_providers: svc.ids.join('|'), with_watch_monetization_types: 'flatrate|free|ads' });
  } else {
    // Categories only list things you can watch in your country somehow
    // (streaming, free, or rent/buy): no foreign shows with nowhere to see them.
    Object.assign(p, { watch_region: profile.region, with_watch_monetization_types: 'flatrate|free|ads|rent|buy' });
  }
  return p;
}

// For merging movies and shows from separate discover calls, and for sorting
// search results: the value each sort orders by (higher first).
const dateOf = (x) => Date.parse(x.release_date ?? x.first_air_date ?? x.releaseDate ?? '') || 0;
export function rankOf(sort) {
  if (sort === 'top') return (x) => x.vote_average ?? x.voteAverage ?? 0;
  if (sort === 'newest') return dateOf;
  if (sort === 'oldest') return (x) => -(dateOf(x) || Infinity);
  return (x) => x.popularity ?? 0;
}

// Filter (and optionally sort) app items client-side.
export function applyView(items, view, profile, { sort = true, now = new Date() } = {}) {
  const svc = wantedServices(view, profile);
  const range = dateRange(view.released, now);
  const out = items.filter((i) => {
    if (svc) {
      const on = [...(i.stream ?? []), ...(i.free ?? [])];
      if (!on.some((p) => svc.ids.includes(p.id) || svc.brands.includes(brand(p.name)))) return false;
    }
    if (view.rating && !((i.voteAverage ?? 0) >= view.rating && (i.voteCount ?? 0) >= 20)) return false;
    if (view.released !== 'any') {
      const d = i.releaseDate ?? '';
      if (!d || (range.gte && d < range.gte) || (range.lte && d > range.lte)) return false;
    }
    return true;
  });
  if (!sort) return out;
  const rank = rankOf(view.sort);
  return out.sort((a, b) => rank(b) - rank(a));
}

// One line summing up what's on, e.g. "Top rated · Netflix, Hulu · 7+".
export function describeView(view, serviceName = (p) => p.name || p.brand) {
  const bits = [SORTS[view.sort]];
  if (view.where === 'mine') bits.push('My services');
  if (view.where === 'pick' && view.picks.length) bits.push(view.picks.map(serviceName).join(', '));
  if (view.rating) bits.push(`${view.rating}+ rating`);
  if (view.released !== 'any') bits.push(RELEASED[view.released]);
  return bits.join(' · ');
}

export const activeFilters = (view) =>
  (view.sort !== 'popular') + (view.where !== 'any') + (view.rating > 0) + (view.released !== 'any');
