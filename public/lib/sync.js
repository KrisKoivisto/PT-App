// Sync between devices through the user's own TMDB account: their marks live
// in four private lists on TMDB, so the phone and the computer see the same
// list. No server of ours, no new account.
//
//   What to Watch · Bookmarked   watchlist
//   What to Watch · Seen         seen, with how it was in each item's comment
//   What to Watch · Passed       passed
//   What to Watch · Settings     empty; its description holds services etc.
//
// Sign-in is TMDB's own: we make a request token, the user approves it on
// themoviedb.org, and we trade it for an access token (polling until they do).

const NAMES = {
  want: 'What to Watch · Bookmarked',
  seen: 'What to Watch · Seen',
  passed: 'What to Watch · Passed',
  settings: 'What to Watch · Settings',
};
export const REMOTE_OF = { watchlist: 'want', ratings: 'seen', passed: 'passed' };

const fail = (message, code) => Object.assign(new Error(message), { code });

// How the "Seen" comment stores how it was: short keys keep it small.
export const encodeSeen = (i) => JSON.stringify({ r: i.reaction ?? 'seen', w: i.reasons?.length ? i.reasons : undefined, n: i.note || undefined });
export function decodeSeen(comment) {
  try {
    const c = JSON.parse(comment);
    return { reaction: c.r ?? 'seen', reasons: Array.isArray(c.w) ? c.w : [], note: typeof c.n === 'string' ? c.n : '' };
  } catch {
    return { reaction: 'seen', reasons: [], note: '' };
  }
}

export function createSync({ readToken, store, base = 'https://api.themoviedb.org', fetchImpl = fetch }) {
  // store: load()/save(obj) for { accessToken, accountId, lists, pending, queue, lastSync }
  let state = { lists: {}, queue: [], ...(store.load() ?? {}) };
  const save = () => store.save(state);

  async function call(method, path, body, token = state.accessToken) {
    const res = await fetchImpl(base + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json;charset=utf-8' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw fail('TMDB signed this device out. Sign in again to keep syncing.', 'signed-out');
    if (!res.ok || data.success === false) throw fail(data.status_message || `TMDB said ${res.status}`, data.status_code);
    return data;
  }

  // --- sign in / out ---------------------------------------------------------------
  async function startSignIn(returnUrl) {
    const r = await call('POST', '/4/auth/request_token', { redirect_to: returnUrl }, readToken);
    state.pending = { token: r.request_token, at: Date.now() };
    save();
    return `https://www.themoviedb.org/auth/access?request_token=${encodeURIComponent(r.request_token)}`;
  }

  // True once signed in; false while TMDB is still waiting for the approval.
  async function finishSignIn() {
    state = { lists: {}, queue: [], ...(store.load() ?? {}) }; // another tab may have finished it
    if (state.accessToken) return true;
    if (!state.pending) return false;
    if (Date.now() - state.pending.at > 15 * 60 * 1000) { // TMDB's request tokens last 15 minutes
      delete state.pending;
      save();
      throw fail('That sign-in link expired. Tap Sign in with TMDB again.', 'expired');
    }
    try {
      const r = await call('POST', '/4/auth/access_token', { request_token: state.pending.token }, readToken);
      Object.assign(state, { accessToken: r.access_token, accountId: r.account_id, lists: {} });
      delete state.pending;
      save();
      return true;
    } catch (e) {
      if (e.code === 41) return false; // not approved yet
      throw e;
    }
  }

  async function signOut() {
    if (state.accessToken) {
      try { await call('DELETE', '/4/auth/access_token', { access_token: state.accessToken }, readToken); } catch {}
    }
    state = { lists: {}, queue: [] };
    save();
  }

  // --- lists -----------------------------------------------------------------------
  async function ensureLists() {
    const want = Object.keys(NAMES);
    if (want.every((k) => state.lists[k])) return state.lists;
    const found = {};
    for (let page = 1, pages = 1; page <= pages; page++) {
      const r = await call('GET', `/4/account/${state.accountId}/lists?page=${page}`);
      pages = r.total_pages ?? 1;
      for (const l of r.results ?? []) {
        const k = want.find((x) => NAMES[x] === l.name);
        if (k && !found[k]) found[k] = l.id;
      }
    }
    for (const k of want) {
      if (!found[k]) {
        const r = await call('POST', '/4/list', {
          name: NAMES[k], iso_639_1: 'en', iso_3166_1: 'US', public: false,
          description: k === 'settings' ? '{}' : 'Kept in sync by the What to Watch app.',
        });
        found[k] = r.id;
      }
    }
    state.lists = found;
    save();
    return found;
  }

  async function readList(id) {
    const items = [];
    let comments = {};
    let description = '';
    for (let page = 1, pages = 1; page <= pages; page++) {
      const r = await call('GET', `/4/list/${id}?page=${page}`);
      pages = r.total_pages ?? 1;
      items.push(...(r.results ?? []));
      comments = { ...comments, ...(r.comments ?? {}) };
      description = r.description ?? description;
    }
    return { items, comments, description };
  }

  const toLocal = (x) => ({
    tmdbId: x.id,
    type: x.media_type === 'tv' ? 'tv' : 'movie',
    imdbId: null,
    title: x.title ?? x.name ?? '',
    year: Number((x.release_date ?? x.first_air_date ?? '').slice(0, 4)) || null,
    genres: [],
    poster: x.poster_path ?? null,
  });

  // Everything on TMDB, in the app's own shape.
  async function pull() {
    const ids = await ensureLists();
    const [want, seen, passed, settings] = await Promise.all(['want', 'seen', 'passed', 'settings'].map((k) => readList(ids[k])));
    let prefs = null;
    try { prefs = JSON.parse(settings.description || '{}'); } catch {}
    state.lastSync = Date.now();
    save();
    return {
      watchlist: want.items.map(toLocal),
      ratings: seen.items.map((x) => ({ ...toLocal(x), ...decodeSeen(seen.comments[`${x.media_type}:${x.id}`]) })),
      passed: passed.items.map(toLocal),
      prefs,
    };
  }

  // --- changes ---------------------------------------------------------------------
  // Each mark becomes queued operations, kept on the device until TMDB has
  // them, so nothing is lost offline or if the app closes mid-sync.
  function queue(...ops) {
    for (const op of ops) {
      if (op.kind === 'prefs') state.queue = state.queue.filter((q) => q.kind !== 'prefs'); // only the latest matters
      state.queue.push(op);
    }
    save();
  }

  let flushing = null;
  function flush() {
    flushing ??= (async () => {
      try {
        const ids = await ensureLists();
        while (state.queue.length) {
          const op = state.queue[0];
          const item = op.item && [{ media_type: op.item.type, media_id: op.item.tmdbId }];
          if (op.kind === 'add') {
            await call('POST', `/4/list/${ids[op.list]}/items`, { items: item }).catch((e) => {
              if (!/already|exists/i.test(e.message)) throw e; // re-adding is fine
            });
            if (op.comment) await call('PUT', `/4/list/${ids[op.list]}/items`, { items: [{ ...item[0], comment: op.comment }] });
          } else if (op.kind === 'remove') {
            await call('DELETE', `/4/list/${ids[op.list]}/items`, { items: item }).catch((e) => {
              if (e.code !== 34) throw e; // already gone is fine
            });
          } else if (op.kind === 'prefs') {
            await call('PUT', `/4/list/${ids.settings}`, { description: JSON.stringify(op.prefs) });
          }
          state.queue.shift();
          save();
        }
      } finally {
        flushing = null;
      }
    })();
    return flushing;
  }

  return {
    get signedIn() { return !!state.accessToken; },
    get waiting() { return !!state.pending; },
    get lastSync() { return state.lastSync ?? null; },
    get pendingChanges() { return state.queue.length; },
    startSignIn, finishSignIn, signOut, pull, queue, flush,
  };
}
