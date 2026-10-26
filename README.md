# What to Watch

A small local web app that recommends movies and shows from your IMDb history and only shows what's streaming on the services you actually have.

## Setup

You need Node 20+ and a free TMDB key.

1. Get a key at https://www.themoviedb.org/settings/api (the v3 key or the v4 read token both work).
2. `cp .env.example .env` and paste the key in.
3. `npm start`, then open http://localhost:3000.

No dependencies to install.

## How it works

**Adding titles by hand.** On the My titles tab, search for anything you've watched and give it a 1 to 10 rating, or mark it "Want to watch". This is all the app needs, so IMDb is optional. Rating a watchlist title moves it off the watchlist.

**IMDb (optional).** IMDb has no personal API, so the app reads the CSV exports. On IMDb, open Your Ratings (and your Watchlist), click the three dots, and choose Export. Upload them on the Setup tab. Importing again replaces the last import but keeps titles you added by hand.

**Streaming apps.** Netflix, Disney+, Max and the others don't offer a way to read your account. Instead you tick the services you pay for, and availability comes from TMDB's watch-provider data, which is supplied by JustWatch. Pick your country first, since catalogs differ.

**Recommendations.** Titles you rated 8+ (adjustable) are seeds. For each one the app pulls TMDB's recommendations, scores a candidate higher the more of your favorites point to it, nudges it by how much you like its genres, drops anything you've already rated, and filters to your services.

**Watchlist tab.** Shows which of your IMDb watchlist titles are streaming on your services right now.

Everything is stored in `data/` on your machine. Nothing is sent anywhere except lookups to TMDB.

## Tests

`npm test` runs the parser tests and an end-to-end test against a mock TMDB server.

## Limits

- Availability is only as good as JustWatch's data, and it doesn't include deep links into the apps.
- The server binds to localhost and has no login. Don't expose it to a network.
- Episodes, shorts and games in your IMDb export are ignored.
