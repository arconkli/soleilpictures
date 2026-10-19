import { createContext } from 'react';

// Home's universe from fixtures instead of the database, for the dev-only
// sidebar QA harness (?sidebarqa=1&surface=home), so the real 3D universe —
// the names on its stars, a picked star's card, a search lighting what it
// finds — can be drawn, screenshotted and tested without a signed-in
// workspace. Only the harness provides it; with no provider (the app,
// production) HomeGraph reads the database exactly as before.
//   { graph: { nodes, links } }   — lib/graphData.js graphFromRows' result
export const GraphFixtureContext = createContext(null);
