// documentTitle — the single owner of document.title in the signed-in app.
//
// Two things want to write the tab title: the cluster you are looking at, and
// the unread badge. Until now only the badge wrote it, and it recovered its own
// base by reading document.title back out and stripping its prefix off — which
// works exactly as long as nothing else ever writes. The moment a second writer
// exists that recovery is a race: whichever effect ran last wins and the other
// half is silently gone, with no error anywhere. That is the same failure mode
// the theme store was consolidated to fix (see lib/theme.js).
//
// So neither caller touches document.title. Each sets its own half here and
// this module composes them. composeTitle is pure so the rule is node-testable.
//
// Scope is the signed-in app. PublicBoardView sets its own title directly and
// is left alone deliberately: it is a separate top-level surface that never
// mounts alongside App, so there is no second writer to race with.

const SUFFIX = 'Soleil Clusters';

// Whatever index.html shipped, captured at import — before anything has had a
// chance to overwrite it. Surfaces with no name of their own (the home graph)
// fall back to it rather than to an empty tab.
const served = (typeof document !== 'undefined') ? document.title : null;

let base = null;   // current cluster / tag name, or null for "no name here"
let badge = '';    // '(3) ' / '(@2) ' / ''

// The whole rule, in one place. A named surface gets "<name> — Soleil Clusters";
// an unnamed one keeps the served marketing title, which is still the right
// thing for a tab someone parked on the home graph.
export function composeTitle({ base: b, badge: g, served: s } = {}) {
  const body = b ? `${b} — ${SUFFIX}` : (s || SUFFIX);
  return `${g || ''}${body}`;
}

function apply() {
  if (typeof document === 'undefined') return;
  document.title = composeTitle({ base, badge, served });
}

// null / '' / whitespace all mean "this surface has no name" — collapsing them
// here keeps every caller from having to.
export function setBaseTitle(next) {
  const v = (next && String(next).trim()) || null;
  if (v === base) return;
  base = v;
  apply();
}

export function setTitleBadge(next) {
  const v = next || '';
  if (v === badge) return;
  badge = v;
  apply();
}
