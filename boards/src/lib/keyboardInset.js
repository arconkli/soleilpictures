// How much of the bottom of the window the on-screen keyboard covers.
//
// iOS Safari and Chrome on Android lay the keyboard over the page instead of
// resizing it: window.innerHeight stays put while the visual viewport shrinks
// (and, on iOS, scrolls). So anything placed from innerHeight or pinned to the
// bottom (a find bar, a popover's floor) sits under the keyboard. Subtract
// this. Zero with no keyboard, with no visualViewport, and on a desktop, where
// nothing covers the window. ToolOptionsBar's lift does the same sum.
export function keyboardInset(win = typeof window !== 'undefined' ? window : null) {
  const vv = win?.visualViewport;
  // Pinch-zoomed, the visual viewport is small because of the zoom: leave
  // the page where it is.
  if (!vv || (vv.scale || 1) > 1.01) return 0;
  return Math.max(0, Math.round(win.innerHeight - vv.height - vv.offsetTop));
}
