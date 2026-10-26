# What to Watch

A phone app for finding where a movie or show is streaming, and keeping your own list of what you've seen and what you thought of it.

It doesn't log in to any streaming service. It's a guide and a personal checklist.

**Open it:** https://kriskoivisto.github.io/PT-App/

## Getting started

1. Open the link on your phone.
2. Setup asks for a free TMDB key once (TMDB is the movie database it looks things up in). The steps are on that screen.
3. Tick the streaming services you have.
4. Add it to your home screen. iPhone: Safari, Share, Add to Home Screen. Android: Chrome menu, Add to Home screen.

## What it does

**Search.** Type a title, an actor, or what it's about ("bank heist", "nurse who killed patients"). You get matching titles, titles for any person that matches, and, for descriptions, titles tagged with those topics. If your words match a category, there's a shortcut to it.

**Categories.** True crime, Documentary, Comedy, Stand-up and so on. True crime splits further: Love gone wrong, Heists & robberies, Con artists & scams, Serial killers, Cults, Cold cases, Wrongfully convicted, Missing & kidnapped, Mob & cartels, Crooked cops, In the courtroom, White-collar crime, Hackers, Prison breaks, Stalkers, Hitmen & murder for hire, Poisonings.

**Where to watch.** Every card shows the logos of the services streaming it. Your services get a green ring. Tap a logo for every way to watch it, rent and buy included.

**Your list.** Every card has Loved it / Liked it / Didn't like / + Watchlist, with quick reasons and an optional note. My titles shows them grouped. For you recommends from what you loved and liked, and pushes down things like what you didn't.

## Where your data lives

On your phone, in the browser's storage for this site. Nothing goes to a server of ours (there isn't one). The app talks straight to TMDB.

Use Setup → Save backup now and then. Clearing Safari's website data, or switching phones, wipes it otherwise.

## How it's built

Plain HTML, CSS and JavaScript in `public/`, no build step and no dependencies.

- `public/lib/api.js`: everything the app does, run in the browser
- `public/lib/browse.js`: categories, true crime subcategories, search
- `public/lib/recommend.js`: recommendations
- `public/lib/tmdb.js`: TMDB client with caching

TMDB has no true crime genre, so categories like that use TMDB keywords. A true crime subcategory is "tagged true crime AND tagged heist" (and so on), plus "based on a true story" crime titles and documentaries with those tags. Keyword ids were checked on themoviedb.org.

`npm start` serves it at http://localhost:3000 for testing. `npm test` runs the tests against a fake TMDB.

Pushing to the main branch runs the tests and publishes `public/` to GitHub Pages (`.github/workflows/deploy.yml`).

Streaming availability data comes from JustWatch via TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
