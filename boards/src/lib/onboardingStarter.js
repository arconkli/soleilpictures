// Starter cards seeded into a brand-new user's empty "Studio" root on first run
// (see the onboarding effect in App.jsx's Workspace). Stable `onb-` ids keep the
// seed idempotent (re-running m.set with the same ids overwrites, never
// duplicates); the `seed:true` flag is the durable, id-agnostic marker the
// "placed their own first card" detector + card_index sync use to ignore seeds
// (so the seeded "Ideas" board — whose card id is a real UUID — is excluded too).
//
// These are the floating-text NOTES only. The seed effect in App.jsx also creates
// a real nested "Ideas" board at runtime (it needs a DB-generated UUID) and adds
// its mirror card next to `onb-drag`, so a brand-new user immediately sees a
// board to drag the note into — the core "organize" AHA.
//
// Layout + copy ADAPT to the device. The bulk of new users arrive on a phone:
// the desktop spread (content spanning x:80–750) auto-fits to ~35% zoom on a
// ~390px canvas — unreadable — so phones get a single readable column with the
// "Ideas" board stacked directly BELOW the drag note. Copy is touch-aware too:
// "right-click" means nothing on a phone (no right mouse button), so touch
// devices are told to long-press / tap the +; the drag arrow flips → to ↓ when
// the board sits below instead of to the right.
//
// Shared by the real seed (App.jsx) and the local first-run preview
// (LocalBoardsApp, ?local=1&onboard=1).

// Keep in sync with useBreakpoint.js / breakpoints.css.
const PHONE_MAX = 640;

function mq(query) {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia(query).matches;
  } catch (_) { return false; }
}

const isNarrow = () => mq(`(max-width: ${PHONE_MAX}px)`);
const isTouch = () => mq('(hover: none) and (pointer: coarse)');

// Desktop layout — the original wide spread (note left, Ideas board to its right).
const DESKTOP = {
  welcome: { x: 80, y: 80, w: 340, h: 190 },
  drag: { x: 80, y: 320, w: 300, h: 150 },
  board: { x: 470, y: 320, w: 280, h: 200 },
};

// Phone layout — a single ~300px-wide column. To keep the first screen focused on
// the AHA, phones get ONE combined intro+drag note with the Ideas board directly
// below it (a short downward drag), instead of the desktop welcome+drag+board trio.
// The responsive auto-fit in CanvasSurface frames this column at ~1x on a ~390px
// phone (it uses a small fit margin below 640px), so the note reads at full size.
const PHONE = {
  note:  { x: 24, y: 72,  w: 300, h: 188 },
  board: { x: 24, y: 288, w: 300, h: 188 },
};

function welcomeHtml(touch) {
  return touch
    ? '<p><strong>Welcome to your board.</strong></p><p>This is your canvas. Tap the <strong>+</strong> on the left, or long-press anywhere, to add a note, board and more. Drag images and files straight in.</p>'
    : '<p><strong>Welcome to your board.</strong></p><p>This is your canvas. Right-click anywhere, or use the + on the left, to add a note, board and more. Drag images and files straight in. ⌘Z undoes anything.</p>';
}

function dragHtml(narrow) {
  return narrow
    ? '<p><strong>Try it:</strong> drag this note down into the “Ideas” board ↓</p><p>It’s how you keep ideas together. Everything saves automatically.</p>'
    : '<p><strong>Try it:</strong> drag this note into the “Ideas” board →</p><p>It’s how you keep ideas together. Everything saves automatically.</p>';
}

// Phone: one combined welcome + drag instruction, so the first screen is just this
// note and the Ideas board below it.
function phoneIntroHtml() {
  return '<p><strong>Welcome 👋</strong></p><p>Drag this note down into the “Ideas” board ↓ — it’s how you keep ideas together. Everything saves automatically.</p>';
}

function buildCards(layout, narrow, touch) {
  return [
    { id: 'onb-welcome', kind: 'note', seed: true, html: welcomeHtml(touch), ...layout.welcome },
    { id: 'onb-drag', kind: 'note', seed: true, html: dragHtml(narrow), ...layout.drag },
  ];
}

// The starter NOTES, positioned + worded for the CURRENT device. Prefer this
// over the static STARTER_CARDS so the seed adapts to phones. Phones get a SINGLE
// combined note (keeping the stable `onb-drag` id so nest-detection + first-card
// semantics are unchanged); desktop keeps the welcome + drag pair.
export function getStarterCards() {
  if (isNarrow()) {
    return [{ id: 'onb-drag', kind: 'note', seed: true, html: phoneIntroHtml(), ...PHONE.note }];
  }
  return buildCards(DESKTOP, false, isTouch());
}

// The tutorial "Ideas" board mirror card (real seed only — App.jsx). seed:true
// keeps it out of card_placed / activation / card_index. Position tracks the
// device layout so it stays inside the phone column (below the drag note).
export function getStarterTutorialCard(id) {
  const layout = isNarrow() ? PHONE : DESKTOP;
  return { id, kind: 'board', seed: true, ...layout.board };
}

// Back-compat static array (desktop layout). Prefer getStarterCards().
export const STARTER_CARDS = buildCards(DESKTOP, false, false);

// ── Welcome showcase (welcome_showcase experiment, arm B) ────────────────────
// A curated "look what you can build" moodboard seeded onto the new user's root
// when they're bucketed into arm B — modeled on the Clusters Logo brand board,
// but built from PUBLIC assets. (We can't clone the real board's cards: its
// images are r2:<key> objects in the OWNER's workspace, and cross-workspace
// reads are RLS/ref-count gated, so a clone would render broken images for every
// new user.) Public /clusters-logo-*.webp + /signin-*.webp resolve as-is via
// resolveSrc (lib/r2.js) for everyone.
//
// Every card is seed:true (so it NEVER counts as the user's own first card /
// activation — see firstValueTrigger.isSeedCard) AND showcase:true (the flag the
// one-click "Clear & try it yourself" banner targets to remove exactly the demo
// cards — see ShowcaseBanner + CanvasSurface). Laid out clear of the onb-drag
// note + Ideas board so the proven nest AHA still reads. Theme-aware logo;
// lighter single-column stack on phones. No emoji in any copy.
const SHOWCASE_DESKTOP = {
  logo:    { x: 80,  y: 70,  w: 300, h: 170 },
  welcome: { x: 410, y: 70,  w: 340, h: 170 },
  still1:  { x: 800, y: 70,  w: 220, h: 165 },
  still2:  { x: 800, y: 255, w: 220, h: 165 },
  palette: { x: 800, y: 440, w: 220, h: 120 },
  how:     { x: 80,  y: 560, w: 340, h: 210 },
};
const SHOWCASE_PHONE = {
  logo:   { x: 24, y: 504, w: 300, h: 150 },
  still1: { x: 24, y: 670, w: 300, h: 200 },
  how:    { x: 24, y: 886, w: 300, h: 210 },
};

const SOLEIL_SWATCHES = [
  { name: 'Soleil', hex: '#ffa500' },
  { name: 'Ink',    hex: '#0a0a0c' },
  { name: 'Stone',  hex: '#525258' },
  { name: 'Paper',  hex: '#f5f5f5' },
];

function showcaseWelcomeHtml() {
  return '<p><strong>Welcome to Soleil Clusters</strong></p><p>Your infinite visual canvas. This is a quick demo of what you can make — clear it whenever you’re ready and start your own.</p>';
}

function showcaseHowHtml() {
  return '<p><strong>How it works</strong></p><ul><li>Double-click anywhere to add a note</li><li>Drag images &amp; files straight in</li><li>Group ideas into boards — try dragging a note into the “Ideas” board</li><li>⌘Z undoes anything</li></ul>';
}

// The curated showcase flair. `theme` ('light'|'dark') picks the logo variant;
// the device split mirrors getStarterCards (phones get a lighter stack).
export function getShowcaseCards({ theme = 'dark' } = {}) {
  const logoSrc = theme === 'light' ? '/clusters-logo-light.webp' : '/clusters-logo-dark.webp';
  const base = { seed: true, showcase: true };
  if (isNarrow()) {
    const L = SHOWCASE_PHONE;
    return [
      { id: 'sc-logo',   kind: 'image', ...base, src: logoSrc,               ...L.logo },
      { id: 'sc-still1', kind: 'image', ...base, src: '/signin-yahweh.webp', ...L.still1 },
      { id: 'sc-how',    kind: 'note',  ...base, html: showcaseHowHtml(),    ...L.how },
    ];
  }
  const L = SHOWCASE_DESKTOP;
  return [
    { id: 'sc-logo',    kind: 'image',   ...base, src: logoSrc,                        ...L.logo },
    { id: 'sc-welcome', kind: 'note',    ...base, html: showcaseWelcomeHtml(),         ...L.welcome },
    { id: 'sc-still1',  kind: 'image',   ...base, src: '/signin-yahweh.webp',          ...L.still1 },
    { id: 'sc-still2',  kind: 'image',   ...base, src: '/signin-losttime-still1.webp', ...L.still2 },
    { id: 'sc-palette', kind: 'palette', ...base, title: 'Soleil palette', swatches: SOLEIL_SWATCHES, ...L.palette },
    { id: 'sc-how',     kind: 'note',    ...base, html: showcaseHowHtml(),             ...L.how },
  ];
}

// True for the curated welcome-showcase flair cards. The one-click clear targets
// exactly these (not the user's own cards, not the onb-drag note / Ideas board).
export function isShowcaseCard(card) {
  return !!(card && card.showcase === true);
}
