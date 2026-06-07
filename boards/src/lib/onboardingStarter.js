// Starter cards seeded into a brand-new user's empty "Studio" root on first run
// (see the onboarding effect in App.jsx's Workspace). Stable `onb-` ids keep the
// seed idempotent (re-running m.set with the same ids overwrites, never
// duplicates); the `seed:true` flag is the durable, id-agnostic marker the
// "placed their own first card" detector + card_index sync use to ignore seeds
// (so the seeded "Ideas" board — whose card id is a real UUID — is excluded too).
//
// These are the floating-text NOTES only. The seed effect in App.jsx also creates
// a real nested "Ideas" board at runtime (it needs a DB-generated UUID) and adds
// its mirror card to the right of `onb-drag`, so a brand-new user immediately sees
// a board to drag the note into — the core "organize" AHA.
//
// Shared by the real seed (App.jsx) and the local first-run preview
// (LocalBoardsApp, ?local=1&onboard=1).
export const STARTER_CARDS = [
  {
    id: 'onb-welcome', kind: 'note', seed: true,
    html: '<p><strong>Welcome to your board.</strong></p><p>This is your canvas. Right-click anywhere, or use the + on the left, to add a note, board and more. Drag images and files straight in. ⌘Z undoes anything.</p>',
    x: 80, y: 80, w: 340, h: 190,
  },
  {
    id: 'onb-drag', kind: 'note', seed: true,
    html: '<p><strong>Try it:</strong> drag this note into the “Ideas” board →</p><p>It’s how you keep ideas together. Everything saves automatically.</p>',
    x: 80, y: 320, w: 300, h: 150,
  },
];
