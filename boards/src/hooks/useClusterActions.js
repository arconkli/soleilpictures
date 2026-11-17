// One action set for a cluster's menu, wherever the menu is. App.jsx provides
// it, each function bound to the handler App already has; a surface mounted
// without App (local/LocalBoardsApp.jsx) gets null and passes its own handlers.
// See ref/spec-step6-clusters-files.md §1.
//
//   open(id, via)           open the cluster (sidebar opener)
//   share(id, via)          open its Share panel (via 'shared_page' keeps that attribution)
//   copyLink(id)            copy its link
//   newInside(id)           make a cluster inside it
//   moveTo(id)              pick a cluster, then move it there (the one move path)
//   setTint(id, tint)       tint key, or null for neutral
//   pickColor(id, {x, y})   custom colour picker (ClusterCoverHost)
//   pickThumb(id)           custom thumbnail picker + crop (ClusterCoverHost)
//   resetThumb(id)          back to the auto thumbnail
//   isStarred(id) / toggleStar(id)
//   info(id)                the Info drawer
//   copy(id) / pasteInto(id) / canPaste()
//   opensInFiles(id) / setOpensInFiles(id, on)
//   remove(id)              delete, with the undo toast
//   removeFromList(id)      drop a shared cluster from my list
//   can(board)              { edit, isLastTop, sharedWithMe, canRemoveFromList }
//   canSend() / send(id, surface)   Send to… (offered only where SendHost is mounted)
import { createContext, useContext } from 'react';

export const ClusterActionsContext = createContext(null);

export function useClusterActions() {
  return useContext(ClusterActionsContext);
}
