// capRefusal — which refused cards a card-cap refusal may take back.
//
// syncCardIndex only learns that the cap trigger refused a card after the card
// is already on the canvas. Taking it back is right for exactly one kind of
// card: one this tab placed moments ago, through a cap gate that let it in on a
// stale count. The cap wall then says where it went.
//
// Every other refused card is existing work, and deleting it destroys work with
// no way back (the withdrawal is off the undo stack on purpose). Cases:
//   - a card placed while the account was paid whose 10-second sync never ran
//     before the tab closed. The first sync after the paid period ends refuses
//     it, and that sync used to delete it.
//   - a card brought back by undo or version history, at the limit
//   - a card moved in from another cluster before the source released its count
//   - a card a collaborator placed
// Those stay on the canvas, uncounted, and the next sync retries them once
// there is room.
//
// The ledger records "placed by this tab, through the cap gate, just now".
// Anything that isn't in it is kept.
//
// Interim by design: when card_index becomes a derived table
// (docs/superpowers/specs/2026-09-29-card-index-derived-table-design.md,
// Phase C), the client no longer writes card_index, nothing is refused at
// insert, and this whole path goes away.

// A refusal for a card this tab placed normally arrives on the next sync,
// about ten seconds later. Five minutes covers a slow network with room to
// spare. Anything older (a tab left open, offline, across a plan change)
// counts as existing work.
export const WITHDRAW_WINDOW_MS = 5 * 60 * 1000;

export function createPlacementLedger({ windowMs = WITHDRAW_WINDOW_MS, now = () => Date.now() } = {}) {
  const placed = new Map();   // card id → when this tab placed it through the gate

  const prune = () => {
    const cutoff = now() - windowMs;
    for (const [id, at] of placed) if (at < cutoff) placed.delete(id);
  };

  return {
    // Record cards this tab just placed while the cap gate applied.
    note(ids) {
      const at = now();
      for (const id of ids || []) if (id != null && id !== '') placed.set(String(id), at);
      prune();
    },

    // Split refused items into the ones to take back and the ones to keep.
    // `idOf` reads the card id off an item (syncCardIndex passes rows).
    // A withdrawn id leaves the ledger: its card is about to be deleted.
    split(items, idOf = (x) => x) {
      prune();
      const withdraw = [];
      const keep = [];
      for (const item of items || []) {
        const id = String(idOf(item));
        if (placed.has(id)) { withdraw.push(item); placed.delete(id); }
        else keep.push(item);
      }
      return { withdraw, keep };
    },

    clear() { placed.clear(); },

    get size() { prune(); return placed.size; },
  };
}
