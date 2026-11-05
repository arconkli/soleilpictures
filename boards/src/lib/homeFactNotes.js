// The three fact notecards on the signed-out homepage. One source, two
// readers: the scroll animation (auth/SignInBackdrop.jsx) flies them in, and
// the plain-text fallback in index.html (<main id="seo-fallback">) carries the
// same words for crawlers and AI answers. homeFactNotes.test.mjs fails when
// index.html drifts, so a price or cap change in billingCopy.js has to be
// followed there.
//
// The FREE TO START numbers are copied from billingCopy.js on purpose: this
// module is in the sign-in entry chunk, and importing billingCopy there cost
// 7.4 KB brotli. homeFactNotes.test.mjs fails if the copy drifts.
export const HOME_FACT_NOTES = [
  {
    head: 'ANY FILE, ANY SIZE',
    title: 'Any file, any size',
    text: 'Drop video, audio, PDFs, RAW photos or any other file onto the canvas, at any size.',
  },
  {
    head: 'FREE TO START',
    title: 'Free to start',
    text: 'Free up to 25 cards or 5GB of files, whichever comes first. Creator is $25/mo for unlimited cards and a 1TB drive.',
  },
  {
    head: 'IN CHATGPT AND CLAUDE',
    title: 'In ChatGPT and Claude',
    text: 'Connect Clusters to ChatGPT or Claude and ask for a board. It draws the board right in the chat.',
  },
];
