// Centralized "click this user → open a DM with them" callback.
// Provided by App.jsx; consumed by any avatar / presence dot / member
// chip that wants to be clickable.

import { createContext, useContext } from 'react';

export const OpenDmContext = createContext(/** @type {(userId: string) => void} */(null));

export function useOpenDm() {
  return useContext(OpenDmContext);
}
