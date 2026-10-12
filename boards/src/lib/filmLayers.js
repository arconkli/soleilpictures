// The film player's own overlays — its menus and the shortcut sheet — while
// they're open. The modal guard's stack (isTopModal) already tells the player
// and Quick look to leave the keys to whatever is on top; this is the same
// answer for a build whose guard is still the plain counter, and it costs
// nothing where the stack exists. A menu handles its own keys, so anything
// behind it stands down while one is open.
let open = 0;

export function pushFilmLayer() {
  open += 1;
  let done = false;
  return () => { if (!done) { done = true; open = Math.max(0, open - 1); } };
}

export function filmLayerOpen() {
  return open > 0;
}
