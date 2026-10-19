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
