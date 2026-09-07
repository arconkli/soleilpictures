// captureMutatorGuard — stop a staged layout leaking into the real document.
//
// The phone reframe is ephemeral: it substitutes geometry into the cards array
// on its way to the canvas and never writes. That holds right up until somebody
// DRAGS a card while it is on. The canvas would then commit a position derived
// from the fake layout into the real Y.Doc — which broadcasts to every
// collaborator and persists — and the one promise this feature makes ("it never
// touches your desktop layout") would be broken by the feature itself.
//
// So while a reframe is active, geometry writes are refused at the mutator
// boundary. Every gesture funnels through this object — drag release, resize
// release, multi-resize, align, distribute, tidy, paste — so one wrapper covers
// all of them without touching a single gesture handler.
//
// ── Fails CLOSED, deliberately ─────────────────────────────────────────────
// Anything not named below becomes a no-op. The alternative — pass unknown
// methods through so a newly-added mutator keeps working — trades a silent,
// persistent corruption of somebody's real board against a button that does
// nothing for the duration of a shoot. The second is noticed immediately and
// costs nothing; the first is noticed weeks later, if ever. A staging mode
// whose contract is "writes nothing" should not have an escape hatch that
// opens itself whenever someone adds a method.
//
// If a new mutator genuinely needs to work mid-capture, add it here. That is a
// one-line, obvious change, which is the point.

// Written by a gesture, meaningless once the layout underneath is synthetic.
const GEOMETRY_KEYS = ['x', 'y', 'w', 'h', 'rotation'];

// Take a patch, keep everything that isn't geometry.
function stripGeometry(patch) {
  if (!patch || typeof patch !== 'object') return patch;
  let touched = false;
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (GEOMETRY_KEYS.includes(k)) { touched = true; continue; }
    out[k] = v;
  }
  // Identity when nothing was stripped, so a content-only edit is not even
  // reallocated on its way through.
  return touched ? out : patch;
}

const isEmpty = (o) => !o || Object.keys(o).length === 0;

// Content edits, with geometry removed from the patch. Typing in a note,
// recolouring a card and editing a doc all stay live during a shoot — those are
// the things worth filming.
const PATCH_GUARDED = new Set(['updateCard', 'updateCardSilent']);

// Everything else that may run untouched. Nothing here writes x/y/w/h.
const ALLOWED = new Set([
  // Stacking order is not geometry — z carries no position.
  'bringToFront', 'sendToBack', 'bringForward', 'sendBackward',
  // Appearance.
  'setBoardBgColor', 'setBoardCover', 'setGridTextStyle', 'pinCellStyle', 'unpinCellStyle',
  // Naming and grouping metadata (createGroup/addToGroup are NOT here — they
  // change what moves as a unit, which changes the reframe under your hands).
  'renameGroup', 'setGroupOutline',
  // Filling a grid cell edits content inside an existing box.
  'setGridCellContent', 'clearGridCellContent',
]);

/**
 * Wrap a mutators object for the duration of a reframe.
 *
 * Non-function values (undoManager, canUndo, canRedo …) pass through by
 * reference — wrapping those would break every consumer that reads them.
 */
export function guardCaptureMutators(mutators) {
  if (!mutators || typeof mutators !== 'object') return mutators;
  const out = {};
  for (const [name, value] of Object.entries(mutators)) {
    if (typeof value !== 'function') { out[name] = value; continue; }

    if (name === 'updateCards') {
      // [{ id, patch }] — strip each patch, drop entries left with nothing.
      out[name] = (updates) => {
        if (!Array.isArray(updates)) return undefined;
        const kept = updates
          .map(u => (u && u.patch ? { ...u, patch: stripGeometry(u.patch) } : u))
          .filter(u => !isEmpty(u?.patch));
        if (!kept.length) return undefined;
        return value(kept);
      };
      continue;
    }

    if (PATCH_GUARDED.has(name)) {
      out[name] = (id, patch) => {
        const next = stripGeometry(patch);
        if (isEmpty(next)) return undefined;
        return value(id, next);
      };
      continue;
    }

    if (ALLOWED.has(name)) { out[name] = value; continue; }

    out[name] = () => undefined;
  }
  return out;
}

export { GEOMETRY_KEYS };
