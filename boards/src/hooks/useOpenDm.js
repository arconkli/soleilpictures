// Centralized "click this user → open a DM with them" callback.
// Provided by App.jsx; consumed by any avatar / presence dot / member
// chip that wants to be clickable.

import { createContext, useContext } from 'react';

export const OpenDmContext = createContext(/** @type {(userId: string) => void} */(null));

export function useOpenDm() {
  return useContext(OpenDmContext);
}

// Messages panel state for surfaces that COVER the workspace chrome and so
// can't rely on the sidebar row — currently the doc-card overlay, which is
// portaled to <body> and z-indexed above everything. React context crosses
// portals, so this works without prop-drilling through CanvasSurface.
//   { unread: number, open: boolean, toggle: () => void }
export const MessagesUiContext = createContext(null);

export function useMessagesUi() {
  return useContext(MessagesUiContext);
}
