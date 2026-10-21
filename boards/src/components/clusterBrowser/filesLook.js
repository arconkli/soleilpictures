import { createContext, useContext } from 'react';

// Which look the full Files page wears. 'sb' is direction A (the owner's
// pick, 2026-10-20): the sidebar's Files card grown full screen — its head,
// shelves, a classic table for List, a glass Info card, and Quick look's bar
// in islands; styles in filesPage.css under [data-look='sb']. null is the
// page production has. App provides it (the files sidebar on and the look's
// own hold open, lib/appHost.js), the QA harness too; ListSurface, the browser's
// parts and Quick look only read it, so nothing below App asks a hold, and
// Quick look follows through its portal.
export const FilesLookContext = createContext(null);

export function useFilesLook() {
  return useContext(FilesLookContext);
}
