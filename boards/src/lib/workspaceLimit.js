// workspaceLimit.js — at most 10 workspaces of your own on Free and Creator
// (0856). Pure, no imports, so it runs in node and costs the main bundle little.

// Equals _workspace_limit() in 0856, pinned by workspaceLimitMigration.test.mjs.
export const WORKSPACE_LIMIT = 10;
// create_workspace_with_root raises with this hint (42501) at the limit.
export const WORKSPACE_LIMIT_HINT = 'workspace_limit';
// The switcher starts saying the count from here.
export const WORKSPACE_NEAR_AT = 8;

// Workspaces the person owns outside a team: created_by them, no org_id. Takes
// the boot rows ({ workspace_id, role, created_at, workspaces: {...} }) or the
// flattened workspace rows useAllWorkspaces keeps.
export function ownPersonalCount(list, userId) {
  if (!Array.isArray(list) || !userId) return 0;
  let n = 0;
  for (const row of list) {
    const w = row && typeof row === 'object' && 'workspaces' in row ? row.workspaces : row;
    if (w && w.created_by === userId && !w.org_id) n += 1;
  }
  return n;
}

// 'room' below 8, 'near' at 8-9, 'full' at exactly the limit, 'over' above it.
export function workspaceLimitStage(n) {
  if (n > WORKSPACE_LIMIT) return 'over';
  if (n === WORKSPACE_LIMIT) return 'full';
  if (n >= WORKSPACE_NEAR_AT) return 'near';
  return 'room';
}

// supabase-js keeps the hint on the error; a wrapper that re-threw a plain Error
// keeps only the message, which the database starts with "workspace limit reached".
export function isWorkspaceLimitError(e) {
  if (e?.hint === WORKSPACE_LIMIT_HINT) return true;
  const msg = e?.message ?? e?.error?.message ?? e?.cause?.message;
  return typeof msg === 'string' && msg.startsWith('workspace limit reached');
}

// The N in "you have N workspaces of your own", else null.
export function workspaceCountFromError(e) {
  const msg = e?.message ?? e?.error?.message ?? e?.cause?.message;
  const m = typeof msg === 'string' ? msg.match(/you have (\d+) workspaces/) : null;
  return m ? Number(m[1]) : null;
}

// The switcher's quiet line: '' below 8; at 10 or more it adds the way out.
export function workspaceCountLine(n, { teams = true, mixed = false } = {}) {
  if (!(n >= WORKSPACE_NEAR_AT)) return '';
  const line = mixed
    ? `${n} of ${WORKSPACE_LIMIT} of your own`
    : `${n} of ${WORKSPACE_LIMIT} workspaces`;
  return n >= WORKSPACE_LIMIT && teams ? `${line} · Team has no limit` : line;
}
