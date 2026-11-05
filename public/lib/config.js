// Built-in TMDB key, so the app works wherever it's opened (Safari, the home
// screen icon, a link inside another app) without pasting a key in each one.
// It only reads public movie data. If TMDB ever switches it off, make a new
// one at https://www.themoviedb.org/settings/api and replace it here, or paste
// one in the app's Settings (that overrides this on that phone).
export const BUILT_IN_KEY = '4267aff20072e7d10ef6fad0cfa317d4';

// TMDB's "API Read Access Token" for the same account. Only used to sign you
// in to TMDB so your list can sync between devices (see lib/sync.js).
export const BUILT_IN_READ_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI0MjY3YWZmMjAwNzJlN2QxMGVmNmZhZDBjZmEzMTdkNCIsIm5iZiI6MTc5MzA4NTA2Ny4zNzYsInN1YiI6IjZhZTA0ZThiMDFhYmFhYTQ4MmQ1ODc1MiIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.pX_zO5vrubs0btKefGty7u6cRhsf3rqrV9ZiWLOgC5c';
