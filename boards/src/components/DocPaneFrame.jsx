import { setActivePane } from '../lib/activePane.js';
import { SurfaceErrorBoundary } from './SurfaceErrorBoundary.jsx';

// A doc that takes a whole pane of the workspace (lib/docPanes.js): docked in
// the split pane ('split'), or opened beside the docked one in the main pane's
// place ('beside'), over the board, which stays as it was underneath.
//
// It claims the keyboard for its pane on a press and on the pointer coming in,
// the way the board surfaces do. The canvas listens at the window and stands
// down only while another pane is active, so without the claim ⌘Z pressed in
// the doc undid the board behind it; the doc's own ⌘Z answers only in its pane
// (lib/overlayRouting.js). A crash stays in the pane; `cardId` clears a held one.
export function DocPaneFrame({ pane, cardId, children }) {
  const claim = () => setActivePane(pane);
  return (
    <div className={`surface-wrap is-doc-pane ${pane === 'beside' ? 'is-doc-beside' : 'is-split'}`}
         data-doc-pane={pane}
         onPointerDownCapture={claim}
         onPointerEnter={claim}>
      <SurfaceErrorBoundary resetKey={cardId}>{children}</SurfaceErrorBoundary>
    </div>
  );
}
