// Workspace roles as the client sees them (workspace_members.role).
//
//   owner    — workspaces.created_by. Everything, including delete + transfer.
//   coowner  — 0391. Runs the workspace like the owner (people, roles, every
//              share and link, name, icon) but cannot delete it, hand it over,
//              or touch the owner. Limits still bill to the owner.
//   editor   — adds and changes content; manages only shares/links they made.
//   viewer   — reads, comments, votes.
//   admin    — reserved (0318); writes, manages nothing.
//   service  — API service accounts.
//
// The server is the authority (can_manage_workspace); these only decide what
// the UI offers.

export const WORKSPACE_ROLE_LABEL = {
  owner: 'Owner',
  coowner: 'Co-owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
  service: 'Service account',
};

// People, roles, every share and link, name and icon.
export function canManageWorkspace(role) {
  return role === 'owner' || role === 'coowner';
}

// Content and card defaults.
export function canWriteWorkspace(role) {
  return role === 'owner' || role === 'coowner' || role === 'admin' || role === 'editor' || role === 'service';
}

// The roles a manager can move another member between (never 'owner': that
// is transfer, which only the owner can do).
export const ASSIGNABLE_ROLES = ['coowner', 'editor', 'viewer'];
