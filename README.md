# What to Watch

A phone app that does two things:

1. **Tells you where something is streaming.** Search a title, an actor, or what it's about ("bank heist", "nurse who killed patients"), or browse a category. True crime splits into subcategories like Love gone wrong, Heists & robberies, and Con artists & scams. Every poster shows the services streaming it, with a green ring on the ones you have. Tap a poster for every way to watch it and the cast. Tap an actor for everything they're in.
2. **Keeps your list.** A watchlist, plus what you've seen and how you felt (Loved it, Liked it, Not for me), with quick reasons that fit the kind of show.

It doesn't log in to any streaming service.

**Open it:** https://kriskoivisto.github.io/PT-App/ (or [try it with sample data](https://kriskoivisto.github.io/PT-App/?demo))

## Getting started

1. Open the link on your phone and add it to your home screen (iPhone: Safari, Share, Add to Home Screen).
2. Tick the streaming services you have in Settings.

A TMDB key (TMDB is the movie database it looks things up in) is built in at `public/lib/config.js`, so nothing needs pasting. iPhones keep Safari, home screen apps and in-app browsers in separate storage, so a key saved in one wasn't seen by the others. If TMDB ever stops accepting the built-in key, the app says so and Settings takes a new one.

## Where your data lives

On your phone, in the browser's storage for this site. On iPhone, the home screen icon and Safari keep separate copies, so stick to the home screen icon. There's no server; the app talks straight to TMDB. Use Settings → Save backup now and then.

## How it's built

Plain HTML, CSS and JavaScript in `public/`, no build step and no dependencies.

- `public/app.js`: the screens
- `public/lib/api.js`: everything the app does, run in the browser
- `public/lib/browse.js`: categories, true crime subcategories, search
- `public/lib/titles.js`, `mine.js`, `reasons.js`: title data, your marks, reason lists
- `public/lib/tmdb.js`: TMDB client with caching
- `public/lib/demo.js`: made-up catalog for sample mode

TMDB has no true crime genre, so those categories use TMDB keywords. A subcategory is "tagged true crime AND tagged heist" (and so on), plus "based on a true story" crime titles and documentaries with those tags. Keyword ids were checked on themoviedb.org.

`npm start` serves it at http://localhost:3000. `npm test` runs the tests against a fake TMDB. Pushing to the branch runs the tests and publishes `public/` to GitHub Pages.

Streaming availability data comes from JustWatch via TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
