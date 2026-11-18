// When each legal document last changed, as the sitemap's lastmod.
//
// The documents carry the date as the words people read ("November 10, 2026",
// auth/legalContent.js). The Worker cannot bundle 46KB of legal prose for the
// sake of three dates, so the same dates live here as ISO days, and
// legalDates.test.mjs holds the two to each other: change a document's date
// and the test says which of these to change. Every document has one, so every
// legal page gets a lastmod.
export const LEGAL_UPDATED = {
  privacy: '2026-11-18',
  terms: '2026-11-17',
  cookies: '2026-11-05',
};
