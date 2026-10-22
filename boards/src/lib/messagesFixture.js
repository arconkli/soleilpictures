import { createContext } from 'react';

// Messages from fixtures instead of the database, for the dev-only sidebar QA
// harness (?sidebarqa=1&messages=1), so the real MessagesPanel can be drawn
// and screenshotted without a signed-in account. Only the harness provides
// it; with no provider (the app, production) useConversationList and
// useMessageThread read the database exactly as before.
//   { conversations, participants, counts,   — useConversationList's rows
//     messages: { [conversationId]: rows },   — useMessageThread's rows
//     typing: { [conversationId]: { [userId]: ts } } }
export const MessagesFixtureContext = createContext(null);
