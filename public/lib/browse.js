import { pool } from './tmdb.js';
import { shape, matchServices, seenSet, isSeen } from './titles.js';

// Keyword ids below were checked on themoviedb.org/search/keyword.
const KW = { trueCrime: 33722, trueStory: 9672 };
const GENRE = { crime: 80, documentary: 99 };

// Genres are looked up by name because movie and TV ids differ. TMDB has no
// genre for things like true crime, so those use keywords.
export const CATEGORIES = [
  { key: 'true-crime', name: 'True crime', keywords: [KW.trueCrime], aliases: ['true crime', 'truecrime'] },
  { key: 'crime', name: 'Crime', movie: ['Crime'], tv: ['Crime'] },
  { key: 'documentary', name: 'Documentary', movie: ['Documentary'], tv: ['Documentary'], aliases: ['documentary', 'documentaries', 'docuseries', 'doc'] },
  { key: 'comedy', name: 'Comedy', movie: ['Comedy'], tv: ['Comedy'], aliases: ['comedy', 'comedies', 'funny'] },
  { key: 'standup', name: 'Stand-up', keywords: [9716], aliases: ['stand-up', 'standup', 'stand up', 'comedian'] },
  { key: 'drama', name: 'Drama', movie: ['Drama'], tv: ['Drama'] },
  { key: 'thriller', name: 'Thriller & mystery', movie: ['Thriller', 'Mystery'], tv: ['Mystery'], aliases: ['thriller', 'thrillers', 'mystery', 'mysteries', 'suspense'] },
  { key: 'action', name: 'Action & adventure', movie: ['Action', 'Adventure'], tv: ['Action & Adventure'], aliases: ['action', 'adventure'] },
  { key: 'scifi', name: 'Sci-fi & fantasy', movie: ['Science Fiction', 'Fantasy'], tv: ['Sci-Fi & Fantasy'], aliases: ['sci-fi', 'scifi', 'science fiction', 'fantasy'] },
  { key: 'horror', name: 'Horror', movie: ['Horror'], aliases: ['horror', 'scary'] },
  { key: 'romance', name: 'Romance', movie: ['Romance'], aliases: ['romance', 'romantic', 'rom-com', 'romcom'] },
  { key: 'true-story', name: 'Based on a true story', keywords: [KW.trueStory], aliases: ['true story', 'based on a true story', 'real story', 'biopic'] },
  { key: 'history', name: 'History & war', movie: ['History', 'War'], tv: ['War & Politics'], aliases: ['history', 'historical', 'war'] },
  { key: 'animation', name: 'Animation', movie: ['Animation'], tv: ['Animation'], aliases: ['animation', 'animated', 'cartoon', 'anime'] },
  { key: 'family', name: 'Family & kids', movie: ['Family'], tv: ['Family', 'Kids'], aliases: ['family', 'kids', 'children'] },
  { key: 'reality', name: 'Reality', tv: ['Reality'], aliases: ['reality', 'reality tv'] },
];

// True crime, split by what the case is about.
export const TRUE_CRIME_SUBS = [
  { key: 'love', name: 'Love gone wrong', keywords: [199645, 365990, 164494, 931], aliases: ['lover', 'lovers', 'quarrel', 'passion', 'jealous', 'jealousy', 'affair', 'cheating', 'husband', 'wife', 'spouse', 'marriage'] },
  { key: 'heist', name: 'Heists & robberies', keywords: [10051, 191845, 15363, 642], aliases: ['heist', 'heists', 'robbery', 'robberies', 'bank', 'robber', 'theft', 'steal', 'stole', 'jewel'] },
  { key: 'con', name: 'Con artists & scams', keywords: [3202, 10453, 4373, 159325], aliases: ['con', 'conman', 'con man', 'con artist', 'scam', 'scammer', 'fraud', 'grifter', 'grift', 'swindle', 'impostor', 'imposter', 'ponzi'] },
  { key: 'serial', name: 'Serial killers', keywords: [10714, 234906, 17987], aliases: ['serial', 'serial killer', 'killer', 'killers', 'spree'] },
  { key: 'cult', name: 'Cults', keywords: [6158, 162766], aliases: ['cult', 'cults', 'sect'] },
  { key: 'cold', name: 'Cold cases', keywords: [210662], aliases: ['cold case', 'unsolved'] },
  { key: 'wrongful', name: 'Wrongfully convicted', keywords: [171989, 12662], aliases: ['wrongful', 'wrongly', 'innocent', 'exonerated', 'convicted'] },
  { key: 'missing', name: 'Missing & kidnapped', keywords: [156091, 1930, 10941], aliases: ['missing', 'kidnapped', 'kidnapping', 'abduction', 'disappeared', 'disappearance', 'vanished'] },
  { key: 'mob', name: 'Mob & cartels', keywords: [10391, 10291, 10175], aliases: ['mob', 'mafia', 'mobster', 'gangster', 'cartel', 'cartels', 'organized crime'] },
  { key: 'cops', name: 'Crooked cops', keywords: [11734], aliases: ['cop', 'cops', 'police', 'corrupt', 'corruption'] },
  { key: 'court', name: 'In the courtroom', keywords: [207240, 33519, 11038], aliases: ['trial', 'court', 'courtroom', 'lawyer', 'jury'] },
  { key: 'whitecollar', name: 'White-collar crime', keywords: [174075, 163072, 226550], aliases: ['white collar', 'white-collar', 'embezzlement', 'corporate', 'wall street'] },
  { key: 'hackers', name: 'Hackers', keywords: [2157, 157239], aliases: ['hacker', 'hackers', 'hacking', 'cyber'] },
  { key: 'prison', name: 'Prison breaks', keywords: [9777], aliases: ['prison', 'escape', 'jailbreak', 'prison break'] },
  { key: 'stalkers', name: 'Stalkers', keywords: [6844], aliases: ['stalker', 'stalking', 'obsession'] },
  { key: 'hitmen', name: 'Hitmen & murder for hire', keywords: [2708], aliases: ['hitman', 'hit man', 'murder for hire', 'contract killer'] },
  { key: 'poison', name: 'Poisonings', keywords: [351], aliases: ['poison', 'poisoned', 'poisoning'] },
];

const CONCURRENCY = 8;

// Discover param sets for one media type. Several sets get merged, which is
// how a true crime subcategory works: TMDB can AND or OR keywords but not
// both at once, so "true crime AND (heist OR robbery)" is one call per pair.
async function querySets(tmdb, cat, sub, type) {
  if (sub) {
    const sets = [];
    for (const k of sub.keywords) {
      sets.push({ with_keywords: `${KW.trueCrime},${k}` });
      sets.push({ with_keywords: `${KW.trueStory},${k}`, with_genres: GENRE.crime });
    }
    sets.push({ with_keywords: sub.keywords.join('|'), with_genres: GENRE.documentary });
    return sets;
  }
  if (cat.keywords) return [{ with_keywords: cat.keywords.join('|') }];
  if (!cat[type]) return [];
  const all = await tmdb.genres(type);
  const ids = all.filter((g) => cat[type].includes(g.name)).map((g) => g.id);
  return ids.length ? [{ with_genres: ids.join('|') }] : [];
}

// Turn bare TMDB ids into full items with where-to-watch.
export async function detail(tmdb, profile, list) {
  const rows = await pool(list, CONCURRENCY, async ({ type, id }) => {
    const d = await tmdb.details(type, id, profile.region);
    if (!d) return null;
    const item = shape(type, d, profile.region);
    return { ...item, services: matchServices(item, profile) };
  });
  return rows.filter(Boolean);
}

// The quick toggle: everything, movies, ongoing shows, or limited series.
// TMDB types TV as Scripted, Miniseries, Documentary, Reality and so on;
// discover takes them as numbers (2 is Miniseries).
export const KINDS = ['all', 'movie', 'show', 'limited'];
const KIND_QUERY = {
  all: [['movie', {}], ['tv', {}]],
  movie: [['movie', {}]],
  show: [['tv', { with_type: '0|1|3|4|5|6' }]],
  limited: [['tv', { with_type: '2' }]],
};
export function matchesKind(item, kind = 'all') {
  if (kind === 'movie') return item.type === 'movie';
  if (kind === 'show') return item.type === 'tv' && item.tvType !== 'Miniseries';
  if (kind === 'limited') return item.type === 'tv' && item.tvType === 'Miniseries';
  return true;
}

export async function browse(tmdb, profile, { category, sub = null, page = 1, onlyMine = false }) {
  const cat = CATEGORIES.find((c) => c.key === category);
  if (!cat) throw Object.assign(new Error('Unknown category.'), { status: 400 });
  const subcat = sub && category === 'true-crime' ? TRUE_CRIME_SUBS.find((s) => s.key === sub) : null;
  if (sub && !subcat) throw Object.assign(new Error('Unknown subcategory.'), { status: 400 });

  const where = {};
  if (onlyMine && profile.services.length) {
    where.watch_region = profile.region;
    where.with_watch_providers = profile.services.join('|');
    where.with_watch_monetization_types = 'flatrate|free|ads';
  }

  const calls = [];
  for (const [t, kindParams] of KIND_QUERY[profile.kind] ?? KIND_QUERY.all) {
    for (const params of await querySets(tmdb, cat, subcat, t)) {
      calls.push({ t, params: { ...params, ...kindParams, sort_by: 'popularity.desc', ...where, page } });
    }
  }

  let totalPages = 0;
  const byKey = new Map();
  await pool(calls, CONCURRENCY, async ({ t, params }) => {
    const r = await tmdb.discover(t, params);
    totalPages = Math.max(totalPages, Math.min(r?.total_pages ?? 0, 500));
    for (const x of r?.results ?? []) byKey.set(`${t}:${x.id}`, { type: t, id: x.id, rank: x.popularity ?? 0 });
  });

  // Movies and shows mixed, most popular first, minus anything you've
  // already marked (seen, bookmarked or passed).
  const found = [...byKey.values()].sort((a, b) => b.rank - a.rank);
  const seen = seenSet([...profile.ratings, ...profile.watchlist, ...(profile.passed ?? [])]);
  const items = (await detail(tmdb, profile, found)).filter((i) => !isSeen(seen, i));
  return { items, page, totalPages, category: cat.name, sub: subcat?.name ?? null };
}

// --- search ------------------------------------------------------------------
// Filler words, plus generic people-words ("woman", "guy") that match huge,
// unrelated tags and drown out the specific ones.
const STOP = new Set(('a an and are about at be by for from has have he her his how i in is it its me movie movies my of on or one show shows series she that the their them there they this to was were what when where which who with about '
  + 'guy guys man men woman women girl girls boy boys lady person people someone somebody').split(' '));

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9' -]/g, ' ').replace(/\s+/g, ' ').trim();
const hasPhrase = (q, phrase) => ` ${q} `.includes(` ${phrase} `);

// Categories and subcategories whose name or aliases appear in the query.
export function matchCategories(q) {
  const n = norm(q);
  const out = [];
  for (const c of CATEGORIES) {
    if ([c.name.toLowerCase(), ...(c.aliases ?? [])].some((a) => hasPhrase(n, a))) out.push({ category: c.key, label: c.name });
  }
  for (const s of TRUE_CRIME_SUBS) {
    if ([s.name.toLowerCase(), ...s.aliases].some((a) => hasPhrase(n, a))) {
      out.push({ category: 'true-crime', sub: s.key, label: `True crime › ${s.name}` });
    }
  }
  return out.slice(0, 6);
}

// How people describe a crime vs. how TMDB tags it ("killed" -> murder).
const SYNONYMS = {
  kill: 'murder', killed: 'murder', kills: 'murder', killing: 'murder', killings: 'murder',
  murdered: 'murder', murders: 'murder', murdering: 'murder', murderer: 'murder',
  robbed: 'robbery', rob: 'robbery', robs: 'robbery', stole: 'theft', stolen: 'theft', steal: 'theft',
  scam: 'fraud', scammed: 'fraud', scams: 'fraud', conned: 'con man',
  kidnapped: 'kidnapping', abducted: 'kidnapping', poisoned: 'poison', poisoning: 'poison',
  disappeared: 'disappearance', vanished: 'disappearance', cheating: 'infidelity', cheated: 'infidelity',
};

// Words from a half-remembered description -> TMDB keywords, matched
// exactly so "nurse" finds the nurse tag and not "nursery". Singular forms
// are tried first: TMDB has "patient" on far more titles than "patients".
async function topicKeywords(tmdb, q) {
  const exact = async (word) => {
    const forms = [...new Set([SYNONYMS[word], word.replace(/ies$/, 'y'), word.replace(/s$/, ''), word].filter(Boolean))];
    for (const f of forms) {
      const hit = (await tmdb.keywords(f)).find((k) => k.name.toLowerCase() === f);
      if (hit) return hit;
    }
    return null;
  };
  const n = norm(q);
  const whole = n.split(' ').length > 1 ? await exact(n) : null;
  if (whole) return [whole];
  const words = [...new Set(n.split(' ').filter((w) => w.length >= 3 && !STOP.has(w)))].slice(0, 4);
  const found = (await Promise.all(words.map(exact))).filter(Boolean);
  return [...new Map(found.map((k) => [k.id, k])).values()];
}

// Pick-n-of combinations, largest first.
const combos = (list, size) => (size === 0 ? [[]] : list.flatMap((x, i) => combos(list.slice(i + 1), size - 1).map((c) => [x, ...c])));

// Titles tagged with all of the keywords; if that finds nothing, drop one
// keyword at a time (never below two, unless there was only one).
async function topicTitles(tmdb, kws) {
  for (let size = kws.length; size >= Math.min(2, kws.length); size--) {
    const found = new Map();
    let used = [];
    for (const set of combos(kws, size)) {
      const params = { with_keywords: set.map((k) => k.id).join(','), sort_by: 'popularity.desc' };
      const before = found.size;
      await Promise.all(['movie', 'tv'].map(async (t) => {
        const r = await tmdb.discover(t, params);
        for (const x of (r?.results ?? []).slice(0, 10)) found.set(`${t}:${x.id}`, { type: t, id: x.id, rank: x.popularity ?? 0 });
      }));
      if (found.size > before) used = [...new Set([...used, ...set])];
    }
    if (found.size) return { kws: used, list: [...found.values()].sort((a, b) => b.rank - a.rank) };
  }
  return null;
}

export async function search(tmdb, profile, q) {
  const suggestions = matchCategories(q);
  const { titles, people } = await tmdb.search(q);
  const all = await detail(tmdb, profile, titles.map((h) => ({ type: h.type, id: h.tmdbId })));
  const items = all.filter((i) => matchesKind(i, profile.kind));

  // Plot-ish searches ("nurse who killed patients") rarely match a title, so
  // also try them as topics. Skip when the query is clearly a title.
  let topic = null;
  const meaningful = norm(q).split(' ').filter((w) => w.length >= 3 && !STOP.has(w));
  if (items.length < 6 || meaningful.length >= 2) {
    const kws = await topicKeywords(tmdb, q);
    const hit = kws.length ? await topicTitles(tmdb, kws) : null;
    if (hit) {
      const have = new Set(items.map((i) => `${i.type}:${i.tmdbId}`));
      const list = hit.list.filter((f) => !have.has(`${f.type}:${f.id}`)).slice(0, 12);
      const topicItems = (await detail(tmdb, profile, list)).filter((i) => matchesKind(i, profile.kind));
      if (topicItems.length) topic = { label: hit.kws.map((k) => k.name).join(' + '), items: topicItems };
    }
  }
  // How many title matches the Movies/Shows/Limited toggle hid, so the app can say so.
  return { suggestions, people, items, topic, hiddenByKind: all.length - items.length };
}
