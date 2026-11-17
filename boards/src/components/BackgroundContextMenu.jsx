// Background right-click menu (the canvas, a group, an arrow): CardContextMenu
// with no card and 'canvas' as the root its step-in's ‹ goes back to. A
// canvas, group or arrow menu never shows a "Linked from" row.

import { CardContextMenu } from './CardContextMenu.jsx';

// workspaceId, boardId and boardName are accepted (callers pass them) and unused.
export function BackgroundContextMenu({ workspaceId, boardId, boardName, ...rest }) { // eslint-disable-line no-unused-vars
  return <CardContextMenu {...rest} root="canvas" card={null} />;
}
