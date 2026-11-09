// A sub-cluster belongs to its parent's workspace. Inside a cluster shared
// with an invited editor the parent lives in the owner's workspace, not the
// editor's current one, so a child made with the current workspace id landed
// where nobody could see it. The fallback is for a parent not in the map yet.
export function workspaceForChild(boards, parentId, fallbackWorkspaceId) {
  return boards?.[parentId]?.workspace_id || fallbackWorkspaceId;
}
