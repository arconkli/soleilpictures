import { createContext } from 'react';

// The activity tray (components/ActivityTray.jsx) tells the panels it holds
// whether it is folded, and how to fold it: { folded, fold(), open(), phone, touch }.
// Null outside a tray (ImportQaHarness mounts ImportTray on its own).
// Its own module so ImportTray and HeldUploadsBar can read it without an
// import cycle through ActivityTray, which draws with ImportTray's pieces.
export const ActivityTrayContext = createContext(null);
