// Lightweight index of the listicle pages ("N Best X" roundups) for surfaces
// that only need paths + link labels (SeoLandingPage related-links footer,
// ExplorePage hub nav). Deliberately does NOT import seoListicles.js — that
// registry carries multi-thousand-word page prose which must stay out of the
// landing/explore chunks. A node test (seoListicles.test.mjs) asserts this
// index matches the registry so the two files cannot drift.
export const SEO_LISTICLE_INDEX = [
  {
    path: '/best/pureref-alternatives',
    h1: 'The 10 Best PureRef Alternatives in 2026',
    navLabel: 'Best PureRef Alternatives',
  },
  {
    path: '/best/milanote-alternatives',
    h1: 'The 12 Best Milanote Alternatives in 2026',
    navLabel: 'Best Milanote Alternatives',
  },
  {
    path: '/best/mood-board-apps',
    h1: 'The 12 Best Mood Board Apps in 2026',
    navLabel: 'Best Mood Board Apps',
  },
];
