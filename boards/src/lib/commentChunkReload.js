// When a comment chunk cannot be fetched (commentParts, CanvasCommentPins and
// whatever else comments/commentPartsLazy.jsx puts behind its boundary):
// whether to reload the page for it.
//
// A reload is the one way a browser fetches a failed import() again, and what
// a deploy that replaced the chunk needs. It is also what swaps an open
// cluster for the browser's error page when the network is dead, and what
// reloads the app on every press when a chunk keeps failing. So it happens
// only when all three hold:
//   stale           the error is a chunk that could not be fetched, not a bug
//   reachable       this site answered a small request just now
//                   (navigator.onLine says yes on wifi with no internet)
//   !reloadedBefore no comment chunk has reloaded this tab on this build yet
// and never inside the ten seconds main.jsx and lib/lazyWithReload.js share.
// Otherwise the error goes to the caller's boundary, which shows nothing and,
// on a press, says so.
//
// "Once" is once per build (lib/buildInfo.js): the tab remembers which build
// it reloaded from. A reload that lands on a newer build starts with a clean
// slate, so the deploy after that one can reload the tab again; a reload that
// lands on the same build (the chunk is broken, not replaced) is the last.

import { looksLikeStaleChunk, reloadedRecently, reloadIfStaleChunk } from './lazyWithReload.js';
import { unwatchedFetch } from './netWatch.js';
import { BUILD_SHA } from './buildInfo.js';

export function shouldReloadForCommentChunk({ stale, reachable, reloadedBefore }) {
  return !!stale && !!reachable && !reloadedBefore;
}

// Has this tab reloaded from the build it is running now? `kept` is what the
// tab remembers (the build it last reloaded from), `build` the one running.
export function reloadedOnBuild(kept, build) {
  return !!kept && kept === String(build || 'dev');
}

const KEY = 'soleil:comment-chunk-reloaded';
const PROBE_MS = 4000;
let mem = '';   // where the tab's storage is refused

const browser = {
  reloadedBefore() {
    let kept = mem;
    try { kept = sessionStorage.getItem(KEY) || mem; } catch (_) { /* private mode */ }
    return reloadedOnBuild(kept, BUILD_SHA);
  },
  markReloaded() {
    mem = String(BUILD_SHA || 'dev');
    try { sessionStorage.setItem(KEY, mem); } catch (_) { /* private mode */ }
  },
  // A file every deploy serves, asked for past every cache. No answer inside
  // four seconds, or a refusal, is a dead or captive network. Asked with the
  // fetch from before lib/netWatch.js: a probe that fails is an answer, not
  // an error to report.
  probe() {
    const stop = new AbortController();
    const t = setTimeout(() => stop.abort(), PROBE_MS);
    return unwatchedFetch()('/robots.txt', { method: 'HEAD', cache: 'no-store', signal: stop.signal })
      .then((r) => r.ok, () => false)
      .finally(() => clearTimeout(t));
  },
  recently: reloadedRecently,
  reload: (err) => reloadIfStaleChunk(err, 'Lazy'),
};

// Asking again without a reload (the pins, when the browser is back online or
// the tab is looked at again). A browser answers a second import() of an
// address that failed with the same failure, without fetching it, so the
// chunk is asked for at its own address with a query added: a new address to
// the browser, the same file to the server, and the modules it imports are
// the ones already loaded. The address is the one the first failure named.
// Chromium and Firefox name it; WebKit does not ("Importing a module script
// failed."), and there the failure stands until the page is reloaded.
export function chunkAddress(err) {
  return (/https?:\/\/[^\s?#]+/.exec(String((err && err.message) || '')) || [''])[0];
}
// (only ever this site's own address: the message is the browser's, but it is
// still text)
export function importAgain(err, n) {
  const at = chunkAddress(err);
  const ours = typeof location !== 'undefined' && at.startsWith(`${location.origin}/`);
  return ours ? import(/* @vite-ignore */ `${at}?again=${n}`) : Promise.reject(err);
}

// The catch of a comment chunk's import(). Reloads (and never settles, so
// what is showing stays put meanwhile) or throws the error on.
export async function recoverCommentChunk(err, env = browser) {
  const stale = looksLikeStaleChunk(err);
  const reloadedBefore = env.reloadedBefore();
  // only asked when its answer decides it
  const reachable = stale && !reloadedBefore && await env.probe();
  if (!shouldReloadForCommentChunk({ stale, reachable, reloadedBefore }) || env.recently()) throw err;
  env.markReloaded();
  if (!env.reload(err)) throw err;
  return new Promise(() => {});
}
