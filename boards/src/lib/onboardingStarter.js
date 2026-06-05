// Starter cards seeded into a brand-new user's empty "Studio" root on first run
// (see the onboarding effect in App.jsx's Workspace). Stable `onb-` ids keep the
// seed idempotent (re-running m.set with the same ids overwrites, never
// duplicates) and let the "placed their own first card" detector ignore them.
// Plain notes — they render as floating text, matching the product's aesthetic.
//
// Shared by the real seed (App.jsx) and the local first-run preview
// (LocalBoardsApp, ?local=1&onboard=1) so both render the identical board.
export const STARTER_CARDS = [
  {
    id: 'onb-welcome', kind: 'note',
    html: '<p><strong>Welcome to your board.</strong></p><p>This is your canvas. Right-click anywhere, or use the + on the left, to add a note, board and more. You can also drag images and files straight in. ⌘Z undoes anything.</p>',
    x: 80, y: 90, w: 340, h: 200,
  },
  {
    id: 'onb-try', kind: 'note',
    html: '<p>Try it now: right-click the canvas, or hit the + on the left, to add your first note.</p>',
    x: 80, y: 300, w: 280, h: 120,
  },
  {
    id: 'onb-tip', kind: 'note',
    html: '<p><strong>Tip:</strong> drop a board inside a board to nest ideas. Everything saves automatically.</p>',
    x: 430, y: 90, w: 300, h: 170,
  },
];
