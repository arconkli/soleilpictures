// worker-drafts.js — clearing up after drafts (P3b, 0705): the cron's reaper.
//
// A draft is a real auth user (lib/apiAuth.js createDraftAuthUser) with a
// workspace of its own. mcp_draft_reap (0705) does the database's half: a
// draft nobody kept loses its workspace once it runs out (its files are
// tombstoned for the R2 sweep), and both kinds hand back their auth user.
// This deletes those users, which only Auth's admin API can do. A kept
// draft's workspace already belongs to its keeper (_mcp_draft_hand_over), so
// deleting the identity takes nothing of theirs: every row that still names
// it either went with the workspace or sets null.
//
// Before deleting, it reads the user back and checks it is this draft's:
// the address only drafts use, for this draft's id (lib/mcpDrafts.js
// draftEmail), and the draft mark in its metadata. A user that fails the
// check is left alone and reported. Nothing a row says can point this at a
// person's account.
//
// Deleting the user sets mcp_drafts.user_id null (on delete set null), which
// is what tells mcp_draft_reap a draft is done; until then it hands the row
// back on the next run, so a failed delete is retried, never lost. Hourly, a
// few at a time: each draft is two calls to Auth, and the subrequests are
// shared with the rest of the run.
//
// Dependencies arrive as a parameter so workerDrafts.test.mjs can drive it
// without a network.

import { scoutRpc } from './lib/scoutDb.js';
import { getAuthUser, deleteAuthUser } from './lib/apiAuth.js';
import { draftEmail } from './lib/mcpDrafts.js';
import { jobFailed } from './lib/workerErrors.js';

export const REAP_LIMIT = 25;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_DEPS = {
  reap: (env, limit) => scoutRpc(env, 'mcp_draft_reap', { p_limit: limit }),
  getUser: getAuthUser,
  deleteUser: deleteAuthUser,
  report: (env, error, phase) => jobFailed(env, 'mcp_drafts', error, phase),
};

// Is this auth user the identity of that draft, and nothing else?
export function isDraftIdentity(user, draftId) {
  return !!user && UUID_RE.test(String(draftId || ''))
    && String(user.email || '').toLowerCase() === draftEmail(String(draftId).toLowerCase())
    && user.user_metadata?.draft === true;
}

export async function runDraftReap(env, deps = DEFAULT_DEPS) {
  if (!env?.SUPABASE_SERVICE_ROLE_KEY) return { skipped: 'no service key' };
  const rows = await deps.reap(env, REAP_LIMIT);
  const out = { reaped: 0, kept: 0, expired: 0, deleted: 0, gone: 0, refused: 0, failed: 0 };
  let firstFailure = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    out.reaped += 1;
    if (r.outcome === 'kept') out.kept += 1;
    else if (r.outcome === 'expired') out.expired += 1;
    if (!r.user_id) { out.gone += 1; continue; }
    if (!UUID_RE.test(String(r.user_id))) { out.refused += 1; continue; }
    let user;
    try {
      user = await deps.getUser(env, r.user_id);
    } catch (e) {
      out.failed += 1;
      firstFailure ||= e;
      continue;
    }
    if (!user) { out.gone += 1; continue; }
    if (!isDraftIdentity(user, r.draft_id)) {
      // Never deleted: a row that names anything but its own draft identity
      // is a bug to look at, not an account to remove.
      out.refused += 1;
      await deps.report(env, new Error(`draft ${r.draft_id} names a user that is not its identity`), 'check');
      continue;
    }
    if (await deps.deleteUser(env, r.user_id)) out.deleted += 1;
    else { out.failed += 1; firstFailure ||= new Error(`draft ${r.draft_id}: the delete was refused`); }
  }
  // One report for the run's failures; the rows come back next time.
  if (firstFailure) await deps.report(env, firstFailure, `delete (${out.failed} failed)`);
  return out;
}
