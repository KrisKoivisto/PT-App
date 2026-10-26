// Quick reactions map onto the 1-10 scale IMDb uses, so both kinds of data
// feed the same recommender. Like sits at the default seed cutoff (8).
export const REACTIONS = { love: 10, like: 8, dislike: 3 };

export const reactionOf = (rating) =>
  rating >= 9 ? 'love' : rating >= 7 ? 'like' : rating && rating <= 5 ? 'dislike' : null;

const keys = (i) => [i.imdbId, i.tmdbId && `${i.type}:${i.tmdbId}`].filter(Boolean);

function index(list) {
  const m = new Map();
  for (const i of list) for (const k of keys(i)) m.set(k, i);
  return m;
}

// Attach what the user has said about each title, for the buttons on cards.
export function annotate(profile, items) {
  const rated = index(profile.ratings);
  const want = index(profile.watchlist);
  return items.map((it) => {
    const k = keys(it);
    const r = k.map((x) => rated.get(x)).find(Boolean);
    return {
      ...it,
      mine: {
        reaction: r ? r.reaction ?? reactionOf(r.rating) : null,
        reasons: r?.reasons ?? [],
        note: r?.note ?? '',
        want: k.some((x) => want.has(x)),
      },
    };
  });
}
