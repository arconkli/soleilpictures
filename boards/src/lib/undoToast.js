// The house delete → "Undo" toast, hardened.
//
// A plain feedback.toast({ action: { onClick: () => mutators.undo() } })
// undoes whatever is newest at click time — if the user did anything else
// inside the toast window, the click silently reverts the WRONG action.
// When the undo target is an UndoManager step, pass { undoManager, stackItem }
// (capture stackItem = undoManager.undoStack.at(-1) right after the mutation):
// the click only fires onUndo while that exact item is still top-of-stack,
// and otherwise explains instead of misfiring.
//
// Closure-based inverses (soft-delete restores, server ops) omit
// undoManager/stackItem — they are order-independent by construction.
export function undoToast(feedback, {
  message,
  type = 'info',
  ttl = 6000,
  undoManager = null,
  stackItem = null,
  onUndo,
  supersededMessage = 'The board changed since — press ⌘Z to step back instead.',
}) {
  if (!feedback?.toast || !message) return;
  feedback.toast({
    type,
    message,
    ttl,
    action: {
      label: 'Undo',
      onClick: () => {
        if (undoManager && stackItem) {
          const top = undoManager.undoStack[undoManager.undoStack.length - 1];
          if (top !== stackItem) {
            feedback.toast({ type: 'info', message: supersededMessage });
            return;
          }
        }
        onUndo?.();
      },
    },
  });
}
