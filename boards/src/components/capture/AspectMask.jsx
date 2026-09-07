// AspectMask — letterbox guides for the shape you are actually shipping.
//
// A recording made on a 16:10 laptop and cropped to 9:16 for a Reel loses two
// thirds of its width, and you find out which third mattered after the take.
// This draws the crop before you shoot: everything outside the target aspect is
// dimmed, and an inset dashed rule marks the safe area where a platform's own
// chrome (captions, action rails, progress bars) will sit on top.
//
// Deliberately NOT a layout change. The app keeps its real viewport — masking
// the view rather than resizing it means what you see inside the frame is
// exactly what the app does at that size, with no reflow to second-guess. The
// reframe (Fit) is the tool that changes the content; this one only frames it.
import { createPortal } from 'react-dom';
import { ASPECTS } from '../../lib/captureAspect.js';

// A uniform 5% inset marking roughly where platform furniture (captions,
// action rails, progress bars) lands. It is a guide, not a spec — every
// platform's real safe area is asymmetric and none of them publish it stably.
// Keep anything load-bearing inside this and it survives all of them.
const SAFE_INSET = 0.05;

export function AspectMask({ aspect }) {
  const spec = ASPECTS.find(a => a.id === aspect);
  if (!spec || !spec.ratio) return null;

  // Solve the largest rect of the target ratio that fits the viewport, in
  // percentages, so the mask needs no resize listener at all.
  const style = {
    '--cap-ratio': String(spec.ratio),
    '--cap-safe': String(SAFE_INSET),
  };

  // Portalled to <body>, outside #root, for the same reason the HUD is: a
  // recording restricted to #root then films the app without the viewfinder
  // drawn over it. It is a guide for you, never part of the picture.
  return createPortal(
    <div className="capture-mask" style={style} aria-hidden="true" data-capture-aspect={spec.id}>
      <div className="capture-mask-frame">
        <div className="capture-mask-safe" />
        <span className="capture-mask-label">{spec.label}</span>
      </div>
    </div>,
    document.body,
  );
}
