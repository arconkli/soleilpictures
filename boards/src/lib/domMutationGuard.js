// domMutationGuard.js — survive DOM that something other than React rewrote.
//
// Google Translate, Grammarly-style extensions and some in-app browsers swap
// the text nodes React rendered for their own <font> wrappers (or move them).
// React still holds the originals, so the next commit that removes or
// re-orders one calls removeChild / insertBefore on a node that is no longer
// that parent's child, the browser throws "Failed to execute 'removeChild' on
// 'Node': The node to be removed is not a child of this node", and the whole
// subtree goes to an error boundary. In production that took down /pricing
// (the red crash panel) and canvas panes (SurfaceErrorBoundary remounts).
//
// The well-known guard (facebook/react#11538): when the parent no longer owns
// the node, skip the operation instead of throwing. The node React wanted
// gone is already out of this parent, and the rest of the commit carries on.
// It reports ONCE per page load so we can see how often it saves a page.
//
// Takes the Node constructor as an argument so node --test can exercise it
// with a fake prototype (there is no DOM in the test runner).

export function installDomMutationGuard(NodeCtor, onMismatch) {
  const proto = NodeCtor && NodeCtor.prototype;
  if (!proto || typeof proto.removeChild !== 'function' || typeof proto.insertBefore !== 'function') return false;
  // Idempotent: HMR or a second entry must not wrap the wrapper.
  if (proto.removeChild.__soleilDomGuard) return false;

  const origRemoveChild = proto.removeChild;
  const origInsertBefore = proto.insertBefore;
  let reported = false;
  const report = (op) => {
    if (reported) return;
    reported = true;
    try { onMismatch?.(op); } catch (_) { /* the reporter must never throw into a commit */ }
  };

  function removeChild(child) {
    if (child && child.parentNode !== this) {
      report('removeChild');
      return child;
    }
    return origRemoveChild.apply(this, arguments);
  }
  function insertBefore(newNode, referenceNode) {
    // A null reference node means "append", which can never mismatch.
    if (referenceNode && referenceNode.parentNode !== this) {
      report('insertBefore');
      return newNode;
    }
    return origInsertBefore.apply(this, arguments);
  }
  removeChild.__soleilDomGuard = true;
  insertBefore.__soleilDomGuard = true;
  proto.removeChild = removeChild;
  proto.insertBefore = insertBefore;
  return true;
}
