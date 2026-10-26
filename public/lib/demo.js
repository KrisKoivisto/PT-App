// Sample mode: a stand-in for TMDB with a small made-up catalog, so the app
// can be tried without a key (and previewed where TMDB can't be reached).
// Every title here is invented.

const svg = (body, w, h) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const logo = (bg, label) => svg(
  `<rect width="64" height="64" rx="12" fill="${bg}"/><text x="32" y="41" font-family="Arial,sans-serif" font-weight="700" font-size="${label.length > 2 ? 17 : 24}" fill="#fff" text-anchor="middle">${label}</text>`,
  64, 64,
);

function poster(title, hue) {
  const words = title.split(' ');
  const lines = [];
  for (const w of words) {
    if (lines.length && (lines.at(-1) + ' ' + w).length <= 11) lines[lines.length - 1] += ' ' + w;
    else lines.push(w);
  }
  const text = lines.slice(0, 5).map((l, i) => `<text x="12" y="${150 + i * 20 - lines.length * 10}" font-family="Georgia,serif" font-size="17" font-weight="700" fill="#fff">${esc(l)}</text>`).join('');
  return svg(
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 45% 32%)"/><stop offset="1" stop-color="hsl(${hue} 50% 12%)"/></linearGradient></defs><rect width="185" height="278" fill="url(#g)"/>${text}<text x="12" y="22" font-family="Arial,sans-serif" font-size="10" letter-spacing="1.5" fill="#ffffffaa">SAMPLE</text>`,
    185, 278,
  );
}

function backdrop(hue) {
  return svg(
    `<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 40% 26%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 45% 8%)"/></linearGradient></defs><rect width="780" height="439" fill="url(#b)"/>`
    + Array.from({ length: 9 }, (_, i) => `<circle cx="${80 + i * 85}" cy="${120 + (i % 3) * 60}" r="${30 + (i % 4) * 14}" fill="#fff" opacity=".05"/>`).join(''),
    780, 439,
  );
}

function headshot(name, hue) {
  const initials = name.split(' ').map((w) => w[0]).join('');
  return svg(
    `<rect width="120" height="120" fill="hsl(${hue} 30% 38%)"/><circle cx="60" cy="48" r="22" fill="hsl(${hue} 25% 70%)"/><path d="M18 120c4-28 22-42 42-42s38 14 42 42z" fill="hsl(${hue} 25% 70%)"/><text x="60" y="114" font-family="Arial,sans-serif" font-weight="700" font-size="14" fill="#fff" text-anchor="middle">${initials}</text>`,
    120, 120,
  );
}

// Made-up people for the sample cast.
const PEOPLE = [
  { id: 901, name: 'Dana Whitlock', dept: 'Directing' },
  { id: 902, name: 'Marcus Bell', dept: 'Acting' },
  { id: 903, name: 'Ines Okafor', dept: 'Acting' },
  { id: 904, name: 'Ray Castellano', dept: 'Acting' },
  { id: 905, name: 'June Park', dept: 'Acting' },
  { id: 906, name: 'Theo Grant', dept: 'Acting' },
  { id: 907, name: 'Lena Sorensen', dept: 'Acting' },
  { id: 908, name: 'Caleb Moss', dept: 'Acting' },
  { id: 909, name: 'Priya Raman', dept: 'Acting' },
  { id: 910, name: 'Walt Hughes', dept: 'Acting' },
];
PEOPLE.forEach((p, i) => { p.profile = headshot(p.name, (i * 71) % 360); });
const person = new Map(PEOPLE.map((p) => [p.id, p]));

const P = {
  netflix: { provider_id: 8, provider_name: 'Netflix', logo_path: logo('#d81f26', 'N') },
  hulu: { provider_id: 15, provider_name: 'Hulu', logo_path: logo('#168f4a', 'hulu') },
  max: { provider_id: 1899, provider_name: 'Max', logo_path: logo('#1b3fd1', 'max') },
  peacock: { provider_id: 386, provider_name: 'Peacock', logo_path: logo('#222222', 'P') },
  prime: { provider_id: 9, provider_name: 'Prime Video', logo_path: logo('#1a86c8', 'pv') },
  apple: { provider_id: 350, provider_name: 'Apple TV+', logo_path: logo('#444444', 'tv+') },
};

const G = { crime: 80, doc: 99, comedy: 35, drama: 18, mystery: 9648, thriller: 53 };
const GENRE_NAMES = { 80: 'Crime', 99: 'Documentary', 35: 'Comedy', 18: 'Drama', 9648: 'Mystery', 53: 'Thriller' };

// Keyword ids match the real TMDB ones the app uses, plus two for the demo search.
const KEYWORDS = {
  33722: 'true crime', 9672: 'based on true story', 9716: 'stand-up comedy',
  10051: 'heist', 191845: 'bank heist', 15363: 'bank robbery', 642: 'robbery',
  199645: 'crime of passion', 365990: 'murder of wife', 931: 'jealousy',
  3202: 'con man', 10453: 'con artist', 4373: 'fraud', 159325: 'ponzi scheme',
  10714: 'serial killer', 6158: 'cult', 210662: 'cold case', 171989: 'wrongful conviction',
  1930: 'kidnapping', 10391: 'mafia', 10291: 'organized crime', 11734: 'police corruption',
  207240: 'murder trial', 2157: 'hacker', 9777: 'prison escape', 351: 'poison',
  500: 'nurse', 501: 'patient',
};

const TITLES = [
  { id: 101, type: 'movie', title: 'The Vault Under Fifth Street', year: 2023, genres: [G.doc, G.crime], kw: [33722, 10051, 191845], on: ['netflix'], pop: 92, vote: 7.6, runtime: 98, overview: 'Four friends tunnel into a bank vault over a holiday weekend. Two of them still disagree about who planned it.' },
  { id: 102, type: 'tv', title: 'Sweetheart, Interrupted', year: 2024, genres: [G.doc, G.crime], kw: [33722, 199645, 365990, 931], on: ['hulu', 'peacock'], pop: 88, vote: 7.9, seasons: 1, overview: 'A small-town marriage, a life insurance policy, and the neighbor who noticed the car was gone.' },
  { id: 103, type: 'movie', title: 'The Man Who Sold the Bridge', year: 2021, genres: [G.crime, G.drama], kw: [9672, 3202, 10453], on: ['max'], pop: 71, vote: 7.2, runtime: 121, overview: 'Based on the true story of a charming drifter who sold a city landmark three times before anyone checked.' },
  { id: 104, type: 'tv', title: 'Ponzi Kings', year: 2022, genres: [G.doc, G.crime], kw: [33722, 159325, 4373], on: ['netflix'], pop: 64, vote: 7.4, seasons: 2, overview: 'Retirees, a country club, and a fund that only ever went up. Until it didn\'t.' },
  { id: 105, type: 'tv', title: 'Night Shift: The Hospital Murders', year: 2023, genres: [G.doc, G.crime], kw: [33722, 10714, 500, 501], on: ['prime'], pop: 84, vote: 7.8, seasons: 1, overview: 'Patients kept dying on one nurse\'s shifts. It took a coworker\'s spreadsheet to prove it.' },
  { id: 106, type: 'movie', title: 'Inside the Compound', year: 2020, genres: [G.doc, G.crime], kw: [33722, 6158], on: ['max'], pop: 58, vote: 7.1, runtime: 104, overview: 'Former members of a desert commune describe how a book club turned into a cult.' },
  { id: 107, type: 'tv', title: 'Cold Trail', year: 2021, genres: [G.doc, G.crime], kw: [33722, 210662], on: ['peacock'], pop: 52, vote: 7.0, seasons: 3, overview: 'Each episode reopens a case that went quiet decades ago, with DNA the original detectives never had.' },
  { id: 108, type: 'movie', title: 'Twelve Years Innocent', year: 2022, genres: [G.doc, G.crime], kw: [33722, 171989, 207240], on: ['netflix', 'apple'], pop: 47, vote: 8.1, runtime: 96, overview: 'A man convicted on one witness\'s word, and the law students who spent five years proving she was wrong.' },
  { id: 109, type: 'movie', title: 'Getaway Driver', year: 2019, genres: [G.crime, G.drama], kw: [9672, 15363, 642], on: [], rent: ['prime', 'apple'], pop: 41, vote: 6.8, runtime: 112, overview: 'Based on the true story of the teenager who drove for a string of bank robberies, and never went inside.' },
  { id: 110, type: 'tv', title: 'Family Business', year: 2024, genres: [G.doc, G.crime], kw: [33722, 10391, 10291], on: ['hulu'], pop: 67, vote: 7.5, seasons: 1, overview: 'Three generations of a mob family, told by the one who testified.' },
  { id: 111, type: 'movie', title: 'Badge and Bribe', year: 2021, genres: [G.doc, G.crime], kw: [33722, 11734], on: ['prime'], pop: 33, vote: 6.9, runtime: 89, overview: 'An entire narcotics unit, a locker full of cash, and the rookie who wore a wire.' },
  { id: 112, type: 'tv', title: 'Heist Week', year: 2025, genres: [G.doc, G.crime], kw: [33722, 10051, 642], on: ['netflix'], pop: 79, vote: 7.3, seasons: 1, overview: 'Each night, a different real robbery, walked through by the people who pulled it off.' },
  { id: 113, type: 'movie', title: 'The Poisoner Next Door', year: 2024, genres: [G.doc, G.crime], kw: [33722, 351, 365990], on: ['hulu'], pop: 55, vote: 7.0, runtime: 92, overview: 'Two husbands, both "heart attacks", and a garden full of foxglove.' },
  { id: 114, type: 'movie', title: 'Laugh Track', year: 2023, genres: [G.comedy], kw: [], on: ['netflix'], pop: 74, vote: 6.9, runtime: 101, overview: 'A washed-up sitcom writer gets one more shot, on a show about a talking dog.' },
  { id: 115, type: 'tv', title: 'Small Town Secrets', year: 2022, genres: [G.drama, G.mystery], kw: [], on: ['hulu', 'max'], pop: 60, vote: 7.2, seasons: 2, overview: 'A reporter comes home to cover a fire and finds the whole town agreeing on a story that doesn\'t add up.' },
  { id: 116, type: 'movie', title: 'The Last Laugh Tour', year: 2024, genres: [G.comedy], kw: [9716], on: ['netflix'], pop: 38, vote: 7.7, runtime: 64, overview: 'A stand-up special recorded on the final night of a forty-city tour.' },
];
const CAST = {"101": [[901, "Narrator"], [904, "Self"], [908, "Self"]], "102": [[905, "Self"], [902, "Self"], [901, "Narrator"]], "103": [[902, "Victor Lane"], [907, "Agnes Lane"], [910, "Det. Harlan"], [906, "Mayor Pruitt"]], "104": [[909, "Self"], [910, "Self"]], "105": [[903, "Narrator"], [905, "Self"], [909, "Self"]], "106": [[907, "Self"], [901, "Narrator"]], "107": [[903, "Host"], [910, "Self"]], "108": [[906, "Self"], [909, "Self"], [901, "Narrator"]], "109": [[908, "Danny Ruiz"], [904, "Frank Ruiz"], [905, "Mona"], [902, "Agent Cole"]], "110": [[904, "Self"], [908, "Self"]], "111": [[906, "Self"], [903, "Narrator"]], "112": [[901, "Host"], [904, "Self"], [907, "Self"]], "113": [[905, "Narrator"], [907, "Self"]], "114": [[902, "Hal Benton"], [909, "Rosa"], [906, "The Dog (voice)"]], "115": [[907, "Claire Dunn"], [908, "Sheriff Webb"], [903, "Ruth Dunn"], [910, "Pastor Lyle"]], "116": [[906, "Self"]]};
TITLES.forEach((t, i) => {
  t.poster = poster(t.title, (i * 47) % 360);
  t.backdrop = backdrop((i * 47) % 360);
  t.cast = CAST[t.id] ?? [];
});

const byId = new Map(TITLES.map((t) => [`${t.type}:${t.id}`, t]));
const STOP = new Set(['the', 'and', 'who', 'with', 'about', 'that']);

function brief(t) {
  return {
    id: t.id, media_type: t.type, popularity: t.pop, vote_average: t.vote,
    [t.type === 'tv' ? 'name' : 'title']: t.title,
    [t.type === 'tv' ? 'first_air_date' : 'release_date']: `${t.year}-06-01`,
  };
}

function details(t) {
  return {
    ...brief(t),
    overview: t.overview,
    poster_path: t.poster,
    backdrop_path: t.backdrop,
    genres: t.genres.map((id) => ({ id, name: GENRE_NAMES[id] })),
    runtime: t.runtime ?? null,
    number_of_seasons: t.seasons ?? null,
    vote_count: 800,
    external_ids: { imdb_id: null },
    'watch/providers': {
      results: { US: { flatrate: t.on.map((k) => P[k]), rent: (t.rent ?? []).map((k) => P[k]) } },
    },
  };
}

// "a,b" = all of, "a|b" = any of, same as TMDB.
function matchesIds(spec, have) {
  if (!spec) return true;
  if (spec.includes(',')) return spec.split(',').every((x) => have.includes(Number(x)));
  return spec.split('|').some((x) => have.includes(Number(x)));
}

function discover(type, q) {
  if (Number(q.get('page') || 1) > 1) return { page: 2, total_pages: 1, results: [] };
  const providers = q.get('with_watch_providers')?.split('|').map(Number);
  let list = TITLES.filter((t) => t.type === type
    && matchesIds(q.get('with_keywords'), t.kw)
    && matchesIds(q.get('with_genres'), t.genres)
    && (!providers || t.on.some((k) => providers.includes(P[k].provider_id))));
  const sort = q.get('sort_by') ?? '';
  const key = sort.startsWith('vote') ? (t) => t.vote : sort.includes('date') ? (t) => t.year : (t) => t.pop;
  list = list.sort((a, b) => key(b) - key(a));
  return { page: 1, total_pages: 1, results: list.map(brief) };
}

function filmography(p) {
  return TITLES.filter((t) => t.cast.some(([id]) => id === p.id))
    .map((t) => ({ ...brief(t), character: t.cast.find(([id]) => id === p.id)[1], genre_ids: t.genres }));
}

function search(query) {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
  const hits = TITLES.filter((t) => words.some((w) => t.title.toLowerCase().includes(w)));
  const people = PEOPLE.filter((p) => words.some((w) => p.name.toLowerCase().includes(w))).map((p) => ({
    id: p.id, media_type: 'person', name: p.name, profile_path: p.profile, known_for_department: p.dept,
    known_for: filmography(p).slice(0, 3),
  }));
  return { results: [...hits.sort((a, b) => b.pop - a.pop).map(brief), ...people] };
}

function recommendations(t) {
  const anchors = new Set([33722, 9672]);
  const mine = t.kw.filter((k) => !anchors.has(k));
  const scored = TITLES.filter((o) => o !== t).map((o) => ({
    o,
    s: o.kw.filter((k) => mine.includes(k)).length * 3 + o.genres.filter((g) => t.genres.includes(g)).length,
  })).filter((x) => x.s > 0);
  return { results: scored.sort((a, b) => b.s - a.s || b.o.pop - a.o.pop).map((x) => brief(x.o)) };
}

function route(url) {
  const path = url.pathname.replace(/^\/3/, '');
  const q = url.searchParams;
  if (path === '/configuration') return {};
  if (path === '/watch/providers/movie' || path === '/watch/providers/tv') {
    return { results: Object.values(P).map((p, i) => ({ ...p, display_priorities: { US: i } })) };
  }
  if (path === '/genre/movie/list' || path === '/genre/tv/list') {
    return { genres: Object.entries(GENRE_NAMES).map(([id, name]) => ({ id: Number(id), name })) };
  }
  if (path === '/discover/movie' || path === '/discover/tv') return discover(path.split('/')[2], q);
  if (path === '/search/multi') return search(q.get('query') ?? '');
  if (path === '/search/keyword') {
    const term = (q.get('query') ?? '').toLowerCase();
    return { results: Object.entries(KEYWORDS).filter(([, n]) => n.includes(term)).map(([id, name]) => ({ id: Number(id), name })) };
  }
  if (path.startsWith('/find/')) return { movie_results: [], tv_results: [] };
  const pm = path.match(/^\/person\/(\d+)$/);
  if (pm) {
    const p = person.get(Number(pm[1]));
    return p && { id: p.id, name: p.name, profile_path: p.profile, known_for_department: p.dept, combined_credits: { cast: filmography(p) } };
  }
  const m = path.match(/^\/(movie|tv)\/(\d+)(\/recommendations|\/credits|\/aggregate_credits)?$/);
  const t = m && byId.get(`${m[1]}:${m[2]}`);
  if (!t) return null;
  if (m[3] === '/recommendations') return recommendations(t);
  if (m[3]) {
    return {
      cast: t.cast.map(([id, character]) => {
        const p = person.get(id);
        return m[3] === '/aggregate_credits'
          ? { id, name: p.name, profile_path: p.profile, roles: [{ character }] }
          : { id, name: p.name, profile_path: p.profile, character };
      }),
    };
  }
  return details(t);
}

export async function demoFetch(url) {
  const body = route(new URL(url));
  await new Promise((r) => setTimeout(r, 120)); // feel like a network call
  return new Response(JSON.stringify(body ?? { status_code: 34 }), {
    status: body ? 200 : 404,
    headers: { 'content-type': 'application/json' },
  });
}
