// Which shell a device gets, from useBreakpoint's flags. One rule, read by
// App, LocalBoardsApp, CanvasSurface and the QA harnesses, so a harness can't
// draw a tablet in a way App never does.
//
// mobileShell: phones, plus touch tablets up to 1024px wide (a portrait iPad,
// a 1024-wide landscape one, a landscape phone): the drawer, the bottom nav and
// the add sheet. A touch iPad in wide landscape is desktop-width, so it keeps
// the desktop layout, with a finger for a pointer.
// coarse: a finger is the pointer (hover: none and pointer: coarse), at any
// width; it sizes targets and picks the touch gestures.
export function shellOf({ isPhone = false, isTablet = false, isTouch = false } = {}) {
  return { mobileShell: !!(isPhone || (isTablet && isTouch)), coarse: !!isTouch };
}
