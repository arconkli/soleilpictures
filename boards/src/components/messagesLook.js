import { createContext, useContext } from 'react';

// Which look Messages wears. 'card' is the files sidebar's: the sidebar's
// glass card, a find line, and the thread in bubbles (preview only, behind
// sidebarFilesAllowed(); styles in messagesCard.css under body[data-sb-files]).
// null is the drawer production has. App provides it around MessagesPanel; the
// panel portals to <body>, and context follows a portal.
export const MessagesLookContext = createContext(null);

export function useMessagesLook() {
  return useContext(MessagesLookContext);
}

// A cluster a message carries or names, as the card look draws it: its name,
// the cluster it sits in, how many cards and its cover. App provides a lookup
// over its boards (the QA harness its own); without one a cluster is its name.
//   (boardId) → { name, parentName, cards, thumbKey, bust } | null
export const MessagesBoardsContext = createContext(null);

export function useMessagesBoard(boardId) {
  const lookup = useContext(MessagesBoardsContext);
  return boardId && lookup ? lookup(boardId) : null;
}
