import { createPortal } from 'react-dom';
import { GridLayoutThumb } from './GridLayoutThumb.jsx';
import './templateAddedPrompt.css';

// "Grid template added" — now put it on the board.
//
// The gap this closes: adding a template from /templates used to end at a toast
// reading "open the grid tool to use it". That is an instruction to go and find
// the thing you just asked for, in a panel you have never opened, on a rail you
// may not have noticed. The template was in the library and the person was on a
// blank canvas, one step apart, and nothing bridged them.
//
// So the toast confirms and disappears, and THIS stays: a preview of exactly what
// was added, and one button that arms it for placing. It sits under the toast
// stack rather than inside it because a toast is transient by contract and this
// must outlive it — you might be signing in, reading, or looking somewhere else
// when it lands.
//
// Two states, because arming is not placing:
//   idle    "Place it on this board"     — the offer
//   armed   "Click anywhere to place it" — the tool is live, waiting for a point
// The armed copy matters: picking a template arms the canvas rather than dropping
// a card, which is the panel's own behaviour, and without the line there is no
// visible answer to "I clicked it, what happened".

export function TemplateAddedPrompt({ template, armed, onPlace, onDismiss }) {
  if (!template?.tree || typeof document === 'undefined') return null;

  // Portaled to <body> for the same reason the templates panel is: it must not
  // inherit a stacking context or an overflow clip from whichever pane happens
  // to be rendering it.
  //
  // stopPropagation is LOAD-BEARING, and the reason is the portal.
  // A React portal bubbles events through the REACT tree, not the DOM tree — so
  // although this renders under <body>, its pointerdown still reaches
  // CanvasSurface's onBackgroundPointerDown. With the grid tool armed (which is
  // exactly the state this prompt puts you in) that handler placed a card at the
  // dismiss button. Worse, the placement re-rendered and unmounted the prompt
  // before its own click fired, so pressing × BOTH dropped a grid nobody asked
  // for AND never ran the dismiss. Same guard the matrix control and the card
  // chrome already use in CanvasSurface.
  return createPortal(
    <div
      className={`tpladd${armed ? ' is-armed' : ''}`}
      role="status"
      aria-live="polite"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="tpladd-shot" aria-hidden="true">
        <GridLayoutThumb tree={template.tree} title={template.name} size={template.size} />
      </span>
      <span className="tpladd-text">
        <span className="tpladd-name">{template.name}</span>
        <span className="tpladd-sub">
          {armed ? 'Click anywhere to place it' : 'Added to your templates'}
        </span>
      </span>
      {!armed && (
        <button type="button" className="tpladd-go" onClick={onPlace}>
          Place it
        </button>
      )}
      <button
        type="button"
        className="tpladd-x"
        aria-label={armed ? 'Cancel placing this template' : 'Dismiss'}
        onClick={onDismiss}
      >
        ×
      </button>
    </div>,
    document.body,
  );
}
