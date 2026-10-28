import { brand } from './titles.js';

const TTL = 3 * 24 * 60 * 60 * 1000;

// TMDB client. Accepts either the v3 api key or the v4 read-access token (a JWT,
// much longer than a 32-char key). Responses are cached on disk via `cache`.
export function createTmdb({ key, base = 'https://api.themoviedb.org/3', cache, fetchImpl = fetch }) {
  const isToken = key && key.length > 40;

  // `shrink` trims a big response before it's cached, so cast lists and
  // filmographies don't eat the phone's storage.
  async function get(pathname, params = {}, shrink = (v) => v, tag = '') {
    const url = new URL(base + pathname);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (!isToken) url.searchParams.set('api_key', key);
    const cacheKey = pathname + '?' + [...url.searchParams].filter(([k]) => k !== 'api_key').join('&') + tag;

    const hit = cache?.data[cacheKey];
    if (hit && Date.now() - hit.t < TTL) return hit.v;

    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, {
        headers: isToken ? { Authorization: `Bearer ${key}` } : {},
      });
      if (res.status === 429 && attempt < 4) {
        const wait = Number(res.headers.get('retry-after')) || 1 + attempt;
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      if (res.status === 404) return null;
      if (res.status === 401) throw new Error('TMDB rejected the API key.');
      if (!res.ok) throw new Error(`TMDB ${res.status} on ${pathname}`);
      const v = shrink(await res.json());
      if (cache) cache.data[cacheKey] = { t: Date.now(), v };
      return v;
    }
  }

  return {
    // Titles first, then the best-known work of any people that match
    // (search "Ted Bundy" or an actor and you get what they're in). People
    // come back separately too, so they can be shown with their photos.
    async search(query) {
      const r = await get('/search/multi', { query, include_adult: 'false' });
      const people = (r?.results ?? []).filter((x) => x.media_type === 'person')
        .map((x) => ({ id: x.id, name: x.name, profile: x.profile_path ?? null, dept: x.known_for_department ?? null }));
      const out = [];
      const seen = new Set();
      const add = (x) => {
        const k = `${x.media_type}:${x.id}`;
        if ((x.media_type === 'movie' || x.media_type === 'tv') && !seen.has(k)) {
          seen.add(k);
          out.push({ tmdbId: x.id, type: x.media_type });
        }
      };
      const results = r?.results ?? [];
      results.forEach(add);
      for (const p of results.filter((x) => x.media_type === 'person')) (p.known_for ?? []).forEach(add);
      return { titles: out.slice(0, 16), people: people.slice(0, 8) };
    },

    // Top-billed cast with photos. TV uses aggregate credits so long-running
    // shows list their regulars, not just the latest season.
    credits(type, id) {
      const path = type === 'tv' ? `/tv/${id}/aggregate_credits` : `/movie/${id}/credits`;
      return get(path, {}, (r) => ({
        cast: (r?.cast ?? []).slice(0, 16).map((c) => ({
          id: c.id,
          name: c.name,
          character: c.character ?? c.roles?.[0]?.character ?? '',
          profile: c.profile_path ?? null,
        })),
      }));
    },

    // A person and what they're known for, best-known first. Guest spots
    // (talk shows, news, a TV episode or two) are dropped, and fame is ranked
    // by vote count: popularity puts a one-line Simpsons cameo above a lead.
    person(id) {
      return get(`/person/${id}`, { append_to_response: 'combined_credits' }, (r) => {
        const seen = new Set();
        const credits = (r?.combined_credits?.cast ?? [])
          .filter((c) => (c.media_type === 'movie' || c.media_type === 'tv')
            && !(c.genre_ids ?? []).some((g) => g === 10767 || g === 10763)
            && !(c.media_type === 'tv' && (c.episode_count ?? 0) < 3))
          .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0))
          .filter((c) => { const k = `${c.media_type}:${c.id}`; return !seen.has(k) && seen.add(k); })
          .slice(0, 30)
          .map((c) => ({ type: c.media_type, id: c.id, character: c.character ?? '' }));
        return r && { id: r.id, name: r.name, profile: r.profile_path ?? null, dept: r.known_for_department ?? null, credits };
      });
    },

    async keywords(query) {
      const r = await get('/search/keyword', { query });
      return r?.results ?? [];
    },

    // Cheap call that fails with 401 on a bad key.
    verify: () => get('/configuration'),

    recommendations: (type, id) => get(`/${type}/${id}/recommendations`),

    discover: (type, params) => get(`/discover/${type}`, { include_adult: 'false', ...params }),

    async genres(type) {
      const r = await get(`/genre/${type}/list`);
      return r?.genres ?? [];
    },

    // Details, where to watch and the IMDb id in one request. TMDB sends
    // streaming data for every country (30-75 KB a title), so only `region`
    // is kept; otherwise the cache would outgrow the phone's storage.
    details: (type, id, region = 'US') =>
      get(`/${type}/${id}`, { append_to_response: 'watch/providers,external_ids,keywords' }, (d) => d && {
        id: d.id, title: d.title, name: d.name, release_date: d.release_date, first_air_date: d.first_air_date,
        overview: d.overview, poster_path: d.poster_path, backdrop_path: d.backdrop_path, genres: d.genres,
        runtime: d.runtime, episode_run_time: d.episode_run_time, number_of_seasons: d.number_of_seasons,
        vote_average: d.vote_average, vote_count: d.vote_count, type: d.type,
        external_ids: { imdb_id: d.external_ids?.imdb_id ?? null },
        // Movies send keywords.keywords, TV sends keywords.results.
        keywords: (d.keywords?.keywords ?? d.keywords?.results ?? []).map((k) => ({ id: k.id, name: k.name })),
        'watch/providers': { results: { [region]: d['watch/providers']?.results?.[region] } },
      }, `#${region}#2`),

    async providerList(region) {
      const [m, t] = await Promise.all([
        get('/watch/providers/movie', { watch_region: region }),
        get('/watch/providers/tv', { watch_region: region }),
      ]);
      // One entry per brand, shown under its plain name ("HBO Max", not
      // "HBO Max Amazon Channel") when TMDB has one.
      const variant = (n) => /channel$|with ads$/i.test(n);
      const all = [...(m?.results ?? []), ...(t?.results ?? [])]
        .map((p) => ({ id: p.provider_id, name: p.provider_name, logo: p.logo_path, priority: p.display_priorities?.[region] ?? p.display_priority ?? 999 }))
        .sort((a, b) => Number(variant(a.name)) - Number(variant(b.name)) || a.priority - b.priority);
      const byBrand = new Map();
      for (const p of all) if (!byBrand.has(brand(p.name))) byBrand.set(brand(p.name), p);
      return [...byBrand.values()].sort((a, b) => a.priority - b.priority);
    },
  };
}

// Run fn over items with limited concurrency, preserving order.
export async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
