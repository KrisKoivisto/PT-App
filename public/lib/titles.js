// A TMDB title in the shape the app uses, with where to watch it in `region`.
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

// Services the user has that stream this title.
export function matchServices(item, wanted) {
  const seen = new Set();
  return [...item.stream, ...item.free].filter((p) => wanted.has(p.id) && !seen.has(p.id) && seen.add(p.id));
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
