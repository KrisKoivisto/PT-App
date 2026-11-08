// Seasons of shows you've seen. Each show on your Seen list remembers the
// season you're caught up through (`through`) and any new season you said
// to skip (`skipped`); a season that aired after that is "new".

export const RECENT_DAYS = 183; // about six months
// Talk shows start a "season" every year; nobody's catching up on those.
// (Not News: TMDB files Dateline and 20/20 under News.)
export const ONGOING = ['Talk Show'];
const DAY = 24 * 60 * 60 * 1000;
const today = (now) => new Date(now).toISOString().slice(0, 10);

// The newest season that's started airing: { n, date } or null.
// TMDB's season list (season 0 is specials) comes from details().
export function lastAired(seasons, now = Date.now()) {
  const t = today(now);
  return (seasons ?? [])
    .filter((s) => s.n > 0 && s.date && s.date <= t)
    .sort((a, b) => b.n - a.n)[0] ?? null;
}

export const isRecent = (date, now = Date.now()) => !!date && now - Date.parse(date) <= RECENT_DAYS * DAY;

// For shows marked seen before the app tracked seasons: assume you'd seen
// everything that came out over six months ago, so a season from the last
// six months gets the "have you seen it?" check.
export function assumedThrough(seasons, now = Date.now()) {
  const last = lastAired(seasons, now);
  if (!last) return 0;
  if (!isRecent(last.date, now) || last.n === 1) return last.n;
  return Math.max(...(seasons ?? []).filter((s) => s.n > 0 && s.n < last.n && s.date && !isRecent(s.date, now)).map((s) => s.n), 0) || last.n - 1;
}

// What's new for one show you've seen: { from, to, date } or null.
export function newSeason(rating, seasons, now = Date.now()) {
  const last = lastAired(seasons, now);
  if (!last) return null;
  const through = Number.isInteger(rating.through) ? rating.through : assumedThrough(seasons, now);
  const skipped = Number.isInteger(rating.skipped) ? rating.skipped : 0;
  if (last.n <= Math.max(through, skipped)) return null;
  return { from: through + 1, to: last.n, date: last.date };
}
