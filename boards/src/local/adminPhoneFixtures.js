// adminPhoneFixtures.js — a fake postsApi for the phone panel in the dev-only
// admin preview (?adminpreview=1&phone=1). Made-up posts with drawn slides; no
// real content, address or topic. Dev builds only (AdminPreviewHarness).
import { localDate } from '../lib/phonePanel.js';

const day = (back) => localDate(new Date(Date.now() - back * 86400000));
const COLORS = ['#3b3f5c', '#5c3b4a', '#3b5c4f', '#5c533b', '#40405a', '#4f3b5c'];

const post = (n, slides, extra = {}) => ({
  n,
  postAt: extra.postAt || '16:10',
  hook: extra.hook || `Sample hook for post ${n}`,
  twin: '',
  caption: extra.caption || `Sample caption for post ${n}.\n\n#moodboard #filmmaking`,
  pin: extra.pin || '',
  slides: Array.from({ length: slides }, (_, i) => `${n}-${i + 1}.jpg`),
});

export const PHONE_DAYS = [
  {
    date: day(0),
    note: 'At 72 h: #4 490 (0.6×), #5 929 (1.2×), #6 533 (0.7×), #7 1.3k (1.7×), #8 592 (0.8×), #9 1k (1.3×).',
    kind: '',
    posts: [post(14, 6, { hook: 'Five shots that make a scene feel expensive' }), post(15, 4, { postAt: '20:10', pin: 'Sample pinned comment' })],
  },
  { date: day(1), note: '', kind: '', posts: [post(10, 3), post(11, 3), post(12, 3), post(13, 3)] },
  { date: day(3), note: '', kind: '', posts: [post(8, 3), post(9, 3)] },
];

function slideFile(name) {
  const n = Number(name.split('-')[0]) || 0;
  const i = Number(name.split('-')[1]?.split('.')[0]) || 1;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="960"><rect width="540" height="960" fill="${COLORS[(n + i) % COLORS.length]}"/><text x="270" y="500" font-family="sans-serif" font-size="64" fill="#fff" text-anchor="middle">#${n} · ${i}</text></svg>`;
  return new File([svg], name.replace(/\.jpg$/, '.svg'), { type: 'image/svg+xml' });
}

export function makePhonePostsApi() {
  const posted = [];
  return {
    days: async () => structuredClone(PHONE_DAYS),
    posted: async () => [...posted],
    markPosted: async (n) => { posted.push(Number(n)); window.__phonePosted = [...posted]; },
    slide: async (_date, file) => slideFile(file),
  };
}
