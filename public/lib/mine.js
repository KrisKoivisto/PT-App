// "Seen it" is one tap; how you felt about it is optional on top.
export const REACTIONS = { seen: 'Seen it', love: 'Loved it', like: 'Liked it', dislike: 'Not for me' };

// Lists saved by earlier versions stored a 1-10 rating instead of a reaction.
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
  const passed = index(profile.passed ?? []);
  return items.map((it) => {
    const k = keys(it);
    const r = k.map((x) => rated.get(x)).find(Boolean);
    return {
      ...it,
      mine: {
        reaction: r ? r.reaction ?? reactionOf(r.rating) ?? 'seen' : null,
        reasons: r?.reasons ?? [],
        note: r?.note ?? '',
        want: k.some((x) => want.has(x)),
        passed: k.some((x) => passed.has(x)),
      },
    };
  });
}
