import { pool } from './tmdb.js';
import { seenSet, isSeen } from './titles.js';
import { detail, matchesKind } from './browse.js';
import { cleanView, applyView, discoverParams } from './filters.js';
import { GENERIC, moodFactor, isMood, isBroad, idf } from './similar.js';
import { scoreOf } from './mine.js';

const MIN_VOTES = { movie: 50, tv: 15 };
const TYPES = { all: ['movie', 'tv'], movie: ['movie'], show: ['tv'], limited: ['tv'] };
const TV_TYPE = { show: { with_type: '0|1|3|4|5|6' }, limited: { with_type: '2' } };
const REAL = [33722, 9672]; // true crime, based on true story
const isReal = (x) => (x.keywords ?? []).some((k) => REAL.includes(k.id));
const isDoc = (x) => (x.genres ?? []).some((g) => (g.name ?? g) === 'Documentary');

// Suggestions from your ratings. It works like More like this, once for each
// title you rated: a candidate earns points for being like something you
// rated high (more for +10 than +2) and loses points for being like
// something you rated low. "Like" means sharing that title's central story
// tags, not just a stray one: Mindhunter is tagged "prison", but a prison
// movie isn't like Mindhunter unless it's also about profiling killers.
export async function forYou(tmdb, profile, { limit = 30 } = {}) {
  const rated = profile.ratings
    .map((r) => ({ r, s: scoreOf(r) }))
    .filter((x) => x.s && x.r.tmdbId)
    .sort((a, b) => Math.abs(b.s) - Math.abs(a.s))
    .slice(0, 40);
  if (!rated.some((x) => x.s > 0)) return { items: [], reason: 'no-likes' };

  const ratedDetails = await pool(rated, 8, ({ r }) => tmdb.details(r.type, r.tmdbId, profile.region));
  const titles = rated.map(({ r, s }, i) => {
    const d = ratedDetails[i];
    if (!d) return null;
    const tags = (d.keywords ?? []).filter((k) => !GENERIC.test(k.name));
    // What it's about, for searching: no moods, no "new jersey".
    const story = tags.filter((k) => moodFactor(k) === 1);
    const genres = (d.genres ?? []).map((g) => g.name);
    // "Drama" is half of everything; a crime drama has to match on crime.
    const gate = genres.length > 1 ? genres.filter((g) => g !== 'Drama') : genres;
    const gateIds = (d.genres ?? []).filter((g) => gate.includes(g.name)).map((g) => g.id);
    return { s, title: d.title ?? d.name ?? r.title, tags, story, ids: new Set(tags.map((k) => k.id)), genres: new Set(genres), gate: new Set(gate), gateIds, doc: isDoc(d), real: isReal(d) };
  }).filter(Boolean);
  // The six you rated highest drive the search; everything you rated still counts.
  const liked = titles.filter((t) => t.s > 0).slice(0, 6);
  const disliked = titles.filter((t) => t.s < 0);

  const view = cleanView(profile.view);
  const types = TYPES[profile.kind] ?? TYPES.all;
  const paramsFor = (t, extra) => ({
    ...discoverParams(view, t, profile), // your services, rating, release filters and country
    ...(TV_TYPE[profile.kind] && t === 'tv' ? TV_TYPE[profile.kind] : {}),
    ...extra,
    sort_by: 'vote_count.desc',
    'vote_count.gte': Math.max(MIN_VOTES[t], view.rating ? 50 : 0),
  });

  // 1. Every story tag of what you liked: candidates, and how rare the tag is.
  const cands = new Map();
  const add = (t, x, hits) => {
    const key = `${t}:${x.id}`;
    const c = cands.get(key) ?? { type: t, id: x.id, hits: new Set(), genreIds: x.genre_ids ?? [] };
    hits.forEach((h) => c.hits.add(h));
    cands.set(key, c);
  };
  const tagList = [...new Map(liked.flatMap((t, n) => t.story.slice(0, n < 3 ? 18 : 8)).map((k) => [k.id, k])).values()];
  const total = new Map();
  await pool(tagList.flatMap((k) => types.map((t) => [k, t])), 8, async ([k, t]) => {
    const r = await tmdb.discover(t, paramsFor(t, { with_keywords: String(k.id) }));
    total.set(k.id, (total.get(k.id) ?? 0) + (r?.total_results ?? 0));
    for (const x of (r?.results ?? []).slice(0, 20)) add(t, x, [k.id]);
  });
  const rar = (id) => (total.has(id) ? idf(total.get(id)) : 1.5);

  // 2. Pairs of tags from your top three, starting from their rarest story
  // tags: finds lesser-known titles a single tag's top 20 misses.
  const pairs = [];
  const seenPair = new Set();
  for (const t of liked.slice(0, 3)) {
    const story = t.story.slice(0, 18);
    const anchors = [...story].filter((k) => (total.get(k.id) ?? 0) >= 8).sort((a, b) => rar(b.id) - rar(a.id)).slice(0, 2);
    for (const a of anchors) {
      story.filter((b) => b.id !== a.id).slice(0, 4).forEach((b) => {
        const key = [a.id, b.id].sort().join();
        if (!seenPair.has(key)) { seenPair.add(key); pairs.push([a.id, b.id]); }
      });
    }
  }
  await pool(pairs.flatMap((p) => types.map((t) => [p, t])), 8, async ([p, t]) => {
    const r = await tmdb.discover(t, paramsFor(t, { with_keywords: p.join(',') }));
    for (const x of r?.results ?? []) add(t, x, p);
  });

  // 3. Shortlist by the tags we know they share, then look at each in full.
  // A tag on two of your favorites ("cult" on Tiger King and Wild Wild
  // Country) counts for more than one only a single favorite has; and
  // something in the right genres beats something that isn't.
  const pullOf = new Map();
  for (const t of liked) for (const k of t.tags) pullOf.set(k.id, (pullOf.get(k.id) ?? 0) + t.s / 10);
  const okGenre = (c) => liked.some((t) => c.genreIds.some((g) => t.gateIds.includes(g)));
  const pre = (c) => [...c.hits].reduce((sum, h) => sum + rar(h) * (pullOf.get(h) ?? 0), 0) * (1 + 0.5 * (c.hits.size - 1)) * (okGenre(c) ? 1 : 0.3);
  const skip = seenSet([...profile.ratings, ...profile.watchlist, ...(profile.maybe ?? []), ...(profile.passed ?? [])]);
  const shortlist = [...cands.values()].filter((c) => !isSeen(skip, { type: c.type, tmdbId: c.id })).sort((a, b) => pre(b) - pre(a)).slice(0, 72);
  let items = (await detail(tmdb, profile, shortlist)).filter((i) => !isSeen(skip, i) && matchesKind(i, profile.kind));
  items = applyView(items, view, profile, { sort: false });

  // How central each tag is to each rated title's story: candidates carrying
  // a central tag ("serial killer") share that title's other tags too;
  // ones carrying an incidental tag ("prison") share nothing else.
  const sharedWith = (i, t) => (i.keywords ?? []).filter((k) => t.ids.has(k.id));
  for (const t of titles) {
    t.central = new Map();
    for (const k of t.tags) {
      const withK = items.filter((i) => i.keywords?.some((x) => x.id === k.id));
      const avg = withK.length ? withK.reduce((sum, i) => sum + sharedWith(i, t).length - 1, 0) / withK.length : 0;
      t.central.set(k.id, Math.min(1.5, 0.25 + avg / 2));
    }
  }

  // How much a candidate is like one rated title (0 if not really).
  const like = (i, t) => {
    const shared = sharedWith(i, t);
    const story = shared.filter((k) => !isMood(k));
    const w = (k) => rar(k.id) * moodFactor(k) * (t.central.get(k.id) ?? 0.5);
    // Two story tags in common, and one of them has to be specific: "true
    // crime" plus "detective" is half of TMDB, "true crime" plus "nurse" isn't.
    const specific = story.filter((k) => !isBroad(k) && !REAL.includes(k.id));
    if (story.length < 2 || !specific.length || story.reduce((sum, k) => sum + w(k), 0) < 0.8) return 0;
    const sameGenre = (i.genres ?? []).filter((g) => t.genres.has(g)).length;
    let v = (shared.reduce((sum, k) => sum + w(k), 0) + 0.25 * sameGenre) / (1 + (i.keywords?.length ?? 0) / 60);
    // A doc about the same kind of case counts; otherwise the genre has to match.
    if (isDoc(i) !== t.doc) v *= 0.85;
    else if (!(i.genres ?? []).some((g) => t.gate.has(g))) return 0;
    if (t.real && !isReal(i)) v *= 0.45; // real cases go with real cases
    return v;
  };

  // Genres you only rated low (a -7 comedy) push all of that genre back a bit.
  const genreWeight = new Map();
  for (const t of titles) for (const g of t.genres) genreWeight.set(g, (genreWeight.get(g) ?? 0) + t.s / 10);

  const scored = items.map((i) => {
    const pulls = liked.map((t) => ({ t, v: (t.s / 10) * like(i, t) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    if (!pulls.length) return null;
    const pull = pulls[0].v + 0.25 * pulls.slice(1).reduce((sum, x) => sum + x.v, 0);
    const push = disliked.reduce((sum, t) => sum + (-t.s / 10) * like(i, t), 0);
    const genrePush = 0.15 * (i.genres ?? []).reduce((sum, g) => sum + Math.min(0, genreWeight.get(g) ?? 0), 0);
    return { ...i, match: pull - push + genrePush, because: { title: pulls[0].t.title, score: pulls[0].t.s } };
  }).filter(Boolean);

  // Real matches only: still ahead after the push back, and close to the best.
  const best = Math.max(0, ...scored.map((x) => x.match));
  const list = scored
    .filter((x) => x.match > 0 && x.match >= best * 0.35)
    .sort((a, b) => b.match - a.match)
    .slice(0, limit);
  return { items: list };
}
