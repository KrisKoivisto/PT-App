const TTL = 3 * 24 * 60 * 60 * 1000;

// TMDB client. Accepts either the v3 api key or the v4 read-access token (a JWT,
// much longer than a 32-char key). Responses are cached on disk via `cache`.
export function createTmdb({ key, base = 'https://api.themoviedb.org/3', cache, fetchImpl = fetch }) {
  const isToken = key && key.length > 40;

  async function get(pathname, params = {}) {
    const url = new URL(base + pathname);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (!isToken) url.searchParams.set('api_key', key);
    const cacheKey = pathname + '?' + [...url.searchParams].filter(([k]) => k !== 'api_key').join('&');

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
      const v = await res.json();
      if (cache) cache.data[cacheKey] = { t: Date.now(), v };
      return v;
    }
  }

  return {
    // imdb id -> { id, type } or null
    async find(imdbId, type) {
      const r = await get(`/find/${imdbId}`, { external_source: 'imdb_id' });
      const movie = r?.movie_results?.[0];
      const tv = r?.tv_results?.[0];
      const [hit, kind] = type === 'tv' ? (tv ? [tv, 'tv'] : [movie, 'movie']) : (movie ? [movie, 'movie'] : [tv, 'tv']);
      return hit ? { id: hit.id, type: kind } : null;
    },

    async search(query) {
      const r = await get('/search/multi', { query, include_adult: 'false' });
      return (r?.results ?? [])
        .filter((x) => x.media_type === 'movie' || x.media_type === 'tv')
        .slice(0, 12)
        .map((x) => ({
          tmdbId: x.id,
          type: x.media_type,
          title: x.title ?? x.name,
          year: Number((x.release_date ?? x.first_air_date ?? '').slice(0, 4)) || null,
          poster: x.poster_path,
        }));
    },

    recommendations: (type, id) => get(`/${type}/${id}/recommendations`),

    // details + providers + imdb id in one request
    details: (type, id) =>
      get(`/${type}/${id}`, { append_to_response: 'watch/providers,external_ids' }),

    async providerList(region) {
      const [m, t] = await Promise.all([
        get('/watch/providers/movie', { watch_region: region }),
        get('/watch/providers/tv', { watch_region: region }),
      ]);
      const byId = new Map();
      for (const p of [...(m?.results ?? []), ...(t?.results ?? [])]) {
        if (!byId.has(p.provider_id)) {
          byId.set(p.provider_id, {
            id: p.provider_id,
            name: p.provider_name,
            logo: p.logo_path,
            priority: p.display_priorities?.[region] ?? p.display_priority ?? 999,
          });
        }
      }
      return [...byId.values()].sort((a, b) => a.priority - b.priority);
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
