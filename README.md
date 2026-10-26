# What to Watch

A small local web app that recommends movies and shows from your IMDb history and only shows what's streaming on the services you actually have.

## Setup

You need Node 20+ and a free TMDB key.

1. Get a key at https://www.themoviedb.org/settings/api (the v3 key or the v4 read token both work).
2. `cp .env.example .env` and paste the key in.
3. `npm start`, then open http://localhost:3000.

No dependencies to install.

## How it works

**Browse.** Pick a category (True crime, Comedy, Documentary and so on) or search for a title. Results show everything, wherever it streams, with the service logos on each card. Services you have get a green ring. Tap a logo for every way to watch it. Tick "Only my services" to narrow it down.

**Marking titles.** Every card, on every tab, has Loved it / Liked it / Didn't like / + Watchlist. Once you react, a row of quick reasons appears (Suspense, Too slow, and so on) plus an optional note. Click an active button again to undo. My titles lists everything you've marked, grouped by reaction.

Loved counts as 10, Liked as 8 and Didn't like as 3, the same scale IMDb uses. True crime, stand-up and "based on a true story" aren't TMDB genres, so those use TMDB keywords.

**IMDb (optional).** IMDb has no personal API, so the app reads the CSV exports. On IMDb, open Your Ratings (and your Watchlist), click the three dots, and choose Export. Upload them on the Setup tab. Importing again replaces the last import but keeps titles you added by hand.

**Streaming apps.** Netflix, Disney+, Max and the others don't offer a way to read your account. Instead you tick the services you pay for, and availability comes from TMDB's watch-provider data, which is supplied by JustWatch. Pick your country first, since catalogs differ.

**For you.** Titles you loved or liked are seeds. For each one the app pulls TMDB's recommendations and scores a candidate higher the more of your favorites point to it. Titles you didn't like count against their look-alikes. It nudges by how much you like each genre, drops anything you've already rated, and filters to your services. Your reasons are saved and shown, but they don't change the scoring yet.

**Watchlist tab.** Shows which of your IMDb watchlist titles are streaming on your services right now.

Everything is stored in `data/` on your machine. Nothing is sent anywhere except lookups to TMDB.

## Tests

`npm test` runs the parser tests and an end-to-end test against a mock TMDB server.

## Limits

- Availability is only as good as JustWatch's data, and it doesn't include deep links into the apps.
- The server binds to localhost and has no login. Don't expose it to a network.
- Episodes, shorts and games in your IMDb export are ignored.
