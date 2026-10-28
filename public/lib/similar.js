import { pool } from './tmdb.js';
import { seenSet, isSeen } from './titles.js';
import { detail, matchesKind } from './browse.js';

// Tags that describe the production, not the story.
const GENERIC = /^(\d{4}s|based on (novel or book|comic|short story|play or musical|tv series|video game)|woman director|duringcreditsstinger|aftercreditsstinger|sequel|remake|miniseries|anime|live action remake|female protagonist|male protagonist|lgbt|lgbtq)$/i;

// TMDB's mood tags ("riveting", "cynical"). They say how a title feels, not
// what it's about, so they count for a little, never a match on their own.
const MOODS = new Set(('absurd admiring adoring aggressive ambivalent amused angry antagonistic anxious apathetic appreciative arrogant '
  + 'audacious awestruck bewildered bold callous cautionary celebratory cheerful comforting compassionate complicated cynical defiant '
  + 'depressing determined didactic disheartening dramatic earnest empathetic enchant enthusiastic excited exhilarated familiar frantic '
  + 'hopeful horrified humorous informative inspirational intense introspective joyful joyous malicious melancholy mean spirited mocking '
  + 'nostalgic optimistic philosophical playful provocative psychotic reflective regretful relaxed respectful riveting romantic sarcastic '
  + 'scared sentimental serious sincere somber suspenseful sympathetic tense thoughtful thought provoking tragic urgent vibrant whimsical witty '
  + 'investigative biographical candid powerful harsh hostile wary vindictive shocking disturbing gripping dark').match(/[a-z]+(?: (?:spirited|provoking))?/g));
const isMood = (k) => MOODS.has(k.name.toLowerCase());

// Settings and broad themes ("new jersey", "friendship") are true of the
// title but rarely why you'd want another one like it.
const BROAD = new Set(['friendship', 'love', 'family', 'death', 'money', 'police', 'small town', 'new york city', 'london, england', 'paris, france', 'los angeles, california',
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana',
  'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska',
  'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania',
  'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming']);
const isBroad = (k) => BROAD.has(k.name.toLowerCase());
const moodFactor = (k) => (isMood(k) ? 0.15 : isBroad(k) ? 0.35 : 1);

// How specific a tag is: "nurse" is on a few hundred well-known titles,
// "murder" on thousands. Rare shared tags are what make two titles alike.
const idf = (total) => Math.log(1 + 2000 / (total + 5));

const MIN_VOTES = { movie: 50, tv: 15 };
const other = (t) => (t === 'movie' ? 'tv' : 'movie');

// Titles that share this one's specific tags, best match first, each with the
// shared tags that earned it a place. TMDB's own "similar" list is mostly
// genre overlap (it puts The Devil Wears Prada next to The Good Nurse), so
// this builds the list from tags instead and drops anything that only
// vaguely matches.
export async function moreLikeThis(tmdb, profile, type, id, { limit = 20 } = {}) {
  const src = await tmdb.details(type, id, profile.region);
  if (!src) throw Object.assign(new Error('TMDB has no such title.'), { status: 404 });
  const tags = (src.keywords ?? []).filter((k) => !GENERIC.test(k.name)).slice(0, 12);
  // Genre names: the source comes straight from TMDB ({id, name}), the
  // candidates are app items, which keep just the name.
  const genres = new Set((src.genres ?? []).map((g) => g.name));

  // candidate key -> { type, id, hits: Set(tag id), rec }
  const cands = new Map();
  const add = (t, x, tagIds = [], rec = false) => {
    if (t === type && x.id === id) return;
    const k = `${t}:${x.id}`;
    const c = cands.get(k) ?? { type: t, id: x.id, hits: new Set(), rec: false };
    tagIds.forEach((h) => c.hits.add(h));
    c.rec ||= rec;
    cands.set(k, c);
  };
  const find = (t, ids) => tmdb.discover(t, { with_keywords: ids.join(','), sort_by: 'vote_count.desc', 'vote_count.gte': MIN_VOTES[t] });

  // 1. Each tag on its own, same kind of title: candidates, and how rare the tag is.
  const weight = new Map();
  const total = new Map();
  await pool(tags, 8, async (k) => {
    const r = await find(type, [k.id]);
    total.set(k.id, r?.total_results ?? 0);
    weight.set(k.id, idf(r?.total_results ?? 0) * moodFactor(k));
    for (const x of (r?.results ?? []).slice(0, 20)) add(type, x, [k.id]);
  });
  const rare = [...tags].filter((k) => weight.get(k.id) > 0.6).sort((a, b) => weight.get(b.id) - weight.get(a.id));

  // 2. The rarest tags across the other kind too (a true-crime film's
  // docuseries), and the three rarest paired with every other tag. A title
  // with two of them ("nurse" + "serial killer") is the strongest signal, and
  // pairing reaches lesser-known titles a single tag's top 20 would miss.
  // Pairs start from tags rare enough to mean something but on enough titles
  // (8+) to turn up more: a tag on three films ("insulin") already gave all it
  // has. Each start tag gets its share of the searches.
  const story = tags.filter((k) => moodFactor(k) === 1);
  const anchors = rare.filter((k) => moodFactor(k) === 1 && total.get(k.id) >= 8).slice(0, 3);
  const seenPair = new Set();
  const pairs = anchors.flatMap((a) => story.filter((b) => b.id !== a.id).map((b) => [a, b])
    .filter(([x, y]) => { const key = [x.id, y.id].sort().join(); return !seenPair.has(key) && seenPair.add(key); })
    .slice(0, 6));
  await Promise.all([
    ...rare.slice(0, 4).map(async (k) => {
      const r = await find(other(type), [k.id]);
      for (const x of (r?.results ?? []).slice(0, 20)) add(other(type), x, [k.id]);
    }),
    pool(pairs.flatMap((pair) => ['movie', 'tv'].map((t) => [pair, t])), 8, async ([pair, t]) => {
      const r = await find(t, pair.map((k) => k.id));
      for (const x of r?.results ?? []) add(t, x, pair.map((k) => k.id));
    }),
    tmdb.recommendations(type, id).then((r) => (r?.results ?? []).forEach((x) => add(x.media_type ?? type, x, [], true))),
  ]);

  // 3. Shortlist by the tags we already know they share (sharing two counts
  // for a lot more than one), then look at each candidate's full tag list.
  const pre = (c) => [...c.hits].reduce((s, h) => s + (weight.get(h) ?? 0.5), 0) * (1 + 0.5 * (c.hits.size - 1)) + (c.rec ? 0.4 : 0);
  const skip = seenSet([...profile.ratings, ...profile.watchlist, ...(profile.passed ?? [])]);
  const shortlist = [...cands.values()].sort((a, b) => pre(b) - pre(a)).slice(0, 60);
  const items = (await detail(tmdb, profile, shortlist)).filter((i) => !isSeen(skip, i));

  const tagIds = new Set(tags.map((k) => k.id));
  const sharedOf = (i) => (i.keywords ?? []).filter((k) => tagIds.has(k.id));

  // How central each tag is to the story: titles carrying a central tag
  // ("serial killer") also share this title's other tags; titles carrying an
  // incidental one ("heart disease", "new jersey") share nothing else.
  const central = new Map();
  for (const k of tags) {
    const withK = items.filter((i) => i.keywords?.some((x) => x.id === k.id));
    const others = withK.map((i) => sharedOf(i).length - 1);
    const avg = others.length ? others.reduce((a, b) => a + b, 0) / others.length : 0;
    central.set(k.id, Math.min(1.5, 0.25 + avg / 2));
  }
  const w = (k) => (weight.get(k.id) ?? 0.5) * (central.get(k.id) ?? 0.5);

  const recs = new Set(shortlist.filter((c) => c.rec).map((c) => `${c.type}:${c.id}`));
  const isDoc = (x) => (x.genres ?? []).some((g) => (g.name ?? g) === 'Documentary');
  // Real cases go with real cases: if this one is true crime or based on a
  // true story, made-up stories rank well below ones that are too.
  const REAL = [33722, 9672];
  const isReal = (x) => (x.keywords ?? []).some((k) => REAL.includes(k.id));
  const srcReal = isReal(src);
  const scored = items.map((i) => {
    const shared = sharedOf(i);
    const tagScore = shared.reduce((s, k) => s + w(k), 0);
    const sameGenre = (i.genres ?? []).filter((g) => genres.has(g)).length;
    // A title with 80 tags matches anything a little; don't let that win.
    const spread = 1 + (i.keywords?.length ?? 0) / 60;
    let score = (tagScore + 0.25 * sameGenre + (recs.has(`${i.type}:${i.tmdbId}`) ? 0.4 : 0)) / spread;
    // A comedy that happens to have a nurse in it isn't like The Good Nurse.
    // A documentary about the same case is, though, so the genre rule only
    // applies between two dramas (or two docs).
    if (isDoc(i) !== isDoc(src)) score *= 0.85;
    else if (!sameGenre) score = 0;
    if (srcReal && !isReal(i)) score *= 0.45;
    const story = shared.filter((k) => !isMood(k));
    const because = [...story.filter((k) => !isBroad(k)).sort((a, b) => w(b) - w(a)), ...story.filter(isBroad), ...shared.filter(isMood)].slice(0, 3).map((k) => k.name);
    return { ...i, score, because, storyWeight: story.reduce((s, k) => s + w(k), 0), storyCount: story.length };
  });

  // Only real matches: a meaningful shared-tag weight, and close to the best.
  const best = Math.max(0, ...scored.map((s) => s.score));
  const list = scored
    .filter((s) => matchesKind(s, profile.kind))
    // Two shared story tags at least: moods alone never make a match.
    .filter((s) => s.score > 0 && s.storyCount >= 2 && s.storyWeight >= 0.8 && s.score >= best * 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return { title: src.title ?? src.name, items: list };
}
