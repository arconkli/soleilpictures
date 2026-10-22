// The reads a signed-in open makes before it can paint, as query builders over
// a Supabase client.
//
// Two callers build each of these: boardsApi.js and the hooks, when the app
// asks, and lib/bootPrefetch.js, which starts the same reads the moment there
// is a session, while the app is still downloading. Both build them here, so
// what was prefetched is exactly what the app would have asked for; a column
// added to one and not the other would hand the app a row missing it.
//
// Each returns the builder, unawaited. A builder is a thenable, not a promise:
// await it, or Promise.resolve() it, and never .catch() it.
//
// No imports: the entry chunk carries this.

export const tierQuery = (sb) => sb.rpc('get_my_tier');

// Writes when it has to: it creates a missing personal workspace and heals a
// missing root (0400). bootPrefetch only calls it for an account this device
// has opened before.
export const personalWorkspaceQuery = (sb, userId, name = 'Personal Workspace') =>
  sb.rpc('get_or_create_personal_workspace', { p_user_id: userId, p_name: name });

// Our own membership rows only: RLS also shows every co-member's row in a
// workspace we share, and each shared workspace appeared once per member.
export const membershipsQuery = (sb, userId) => sb
  .from('workspace_members')
  .select('workspace_id, role, created_at, workspaces(*)')
  .eq('user_id', userId)
  .order('created_at', { ascending: true });

export const rootBoardQuery = (sb, workspaceId) => sb
  .from('boards')
  .select('*')
  .eq('workspace_id', workspaceId)
  .is('parent_board_id', null)
  .is('deleted_at', null)
  .order('created_at', { ascending: true })
  .limit(1);

export const boardListQuery = (sb, workspaceId) => sb
  .from('boards')
  .select('*')
  .eq('workspace_id', workspaceId)
  .is('deleted_at', null)
  .order('created_at', { ascending: true });

export const sharedBoardsQuery = (sb) => sb.rpc('list_shared_boards');

export const boardStateQuery = (sb, boardId) => sb
  .from('board_state')
  .select('doc')
  .eq('board_id', boardId)
  .maybeSingle();

// Rows from a workspace_members read, as useAllWorkspaces hands them out.
export function membershipWorkspaces(rows) {
  return (rows || []).map((r) => ({ ...r.workspaces, _myRole: r.role, _joinedAt: r.created_at }));
}
