// eventEnv.js — which build sent an analytics row, and the marks that carries.
//
// A preview deploy is a production build writing to the production database,
// so every row a teammate made testing the next release counted as someone
// using this one, and a fresh test account made on a preview counted as an
// external signup, inside the workspace_setup 50/50 as well. Now a row from a
// preview deploy or a dev build says so: it carries synthetic_reason, and the
// divert trigger (0470) moves it to analytics_events_synthetic instead of
// storing it. set_first_source gets the env too, so a brand-new account made
// on one joins internal_accounts.
//
// Production rows carry nothing, so everything the live table keeps is prod.
// Never `synthetic: true`: the trigger reads that as 'qa_harness' and the build
// would be lost. The native shell loads from capacitor://localhost, which is
// neither a dev build nor a workers.dev host, so it is prod, as it should be.
// One caveat: onPreviewHost() also matches production's own *.workers.dev
// alias, so a visit there reads as preview. Nothing links to it.
//
// A production build served from this machine or the local network (`vite
// preview`, a benchmark, a performance trace) marks nothing here either. The
// server marks its rows 'dev' from the request's Origin instead
// (request_is_local(), 0476), which also reaches builds made before that.

import { onPreviewHost } from './appHost.js';

// The trigger's list must take each of these (eventEnv.test.mjs reads it).
export const DIVERTED_ENVS = ['preview', 'dev'];

export function eventEnv(dev) {
  if (dev) return 'dev';
  return onPreviewHost() ? 'preview' : 'prod';
}

// The props every row from this build carries, or null on production.
export function envMarks(env) {
  return DIVERTED_ENVS.includes(env) ? { env, synthetic_reason: env } : null;
}

// What set_first_source receives: the first-touch bag, plus the env off
// production. The server never stores the env (0470).
export function firstSourcePayload(src, env) {
  const base = src && typeof src === 'object' ? src : {};
  return DIVERTED_ENVS.includes(env) ? { ...base, env } : base;
}
