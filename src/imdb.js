import { parseCsvObjects } from './csv.js';

const MOVIE_TYPES = new Set(['movie', 'tvMovie', 'video', 'tvSpecial', 'documentary']);
const TV_TYPES = new Set(['tvSeries', 'tvMiniSeries']);

// IMDb's export has two shapes. Ratings has "Your Rating"; watchlists and
// custom lists don't. Columns are matched by name so reordering is harmless.
export function parseImdbCsv(text) {
  const rows = parseCsvObjects(text);
  if (!rows.length) throw new Error('That file has no rows.');
  if (!('Const' in rows[0])) {
    throw new Error('This does not look like an IMDb export (no "Const" column).');
  }

  const kind = 'Your Rating' in rows[0] ? 'ratings' : 'watchlist';
  const items = [];
  for (const r of rows) {
    if (!/^tt\d+$/.test(r.Const)) continue;
    const type = MOVIE_TYPES.has(r['Title Type']) ? 'movie' : TV_TYPES.has(r['Title Type']) ? 'tv' : null;
    if (!type) continue; // episodes, games, shorts
    const rating = Number(r['Your Rating']);
    items.push({
      imdbId: r.Const,
      title: r.Title,
      year: Number(r.Year) || null,
      type,
      genres: r.Genres ? r.Genres.split(',').map((g) => g.trim()).filter(Boolean) : [],
      rating: kind === 'ratings' && rating >= 1 && rating <= 10 ? rating : null,
      imdbRating: Number(r['IMDb Rating']) || null,
    });
  }
  return { kind, items };
}
