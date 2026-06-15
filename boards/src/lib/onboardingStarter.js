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
// Arm B clones the REAL "Clusters Logo" brand board onto the new user's root (see
// lib/showcaseClone.js + the prepare_showcase RPC + App.jsx seed effect) — the
// cloned cards are stamped seed:true (excluded from activation / card_placed, per
// firstValueTrigger.isSeedCard) + showcase:true. isShowcaseCard is the flag the
// one-click "Clear & try it yourself" banner targets to remove exactly the demo
// cards (see ShowcaseBanner + CanvasSurface).
export function isShowcaseCard(card) {
  return !!(card && card.showcase === true);
}
