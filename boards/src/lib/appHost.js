// Which build is this, and what is it allowed to offer?
//
// Split out of stagingRedirect.js so a component can ask "am I on production"
// without dragging supabase.js into its chunk — stagingRedirect imports the
// client to call get_staging_redirect(), and CanvasSurface has no business
// pulling that in to decide whether to render a menu item. The two host
// predicates are the whole of what other code actually needs; stagingRedirect
// re-exports them so its existing callers (StagingBanner) are unchanged.

// The one place the production hostname is written down.
export const PROD_HOST = 'clusters.soleilpictures.com';

export function onProdHost() {
  return typeof window !== 'undefined' && window.location.hostname === PROD_HOST;
}
// Cloudflare Workers preview deployments. Every push to main gets one, and an
// eligible admin is auto-redirected here by maybeRedirectToLatest().
export function onPreviewHost() {
  return typeof window !== 'undefined' && /\.workers\.dev$/i.test(window.location.hostname);
}

// ---------------------------------------------------------------------------
// The schedule hold
//
// The schedule/calendar card is being rebuilt, and until it lands nobody should
// be able to create a new one on production. Existing cards keep rendering —
// this gates CREATION only (buildAddActions, the rail's + menu, and the
// shoot-day minting path behind onAddShootDay). CanvasSurface's render dispatch
// is deliberately untouched.
//
// ALLOWLIST, NOT DENYLIST. The obvious spelling is `!onProdHost()`, and it
// leaks: capacitor.config.ts sets `server: undefined` for a production build, so
// the shipped iOS/Android shell loads from capacitor://localhost and would test
// FALSE for the prod hostname — the hold would be open in the native app. Any
// future custom domain or Pages alias has the same hole. Naming the two places
// the feature IS allowed fails safe instead: a new origin is closed until
// someone opens it on purpose.
//
// import.meta.env.DEV is a build-time constant, so the production bundle cannot
// take that branch at all — the same literal guard the dev-only QA harnesses in
// main.jsx use. It also keeps local dev and the Playwright suite (which runs on
// 127.0.0.1 through ?local=1) working with no test changes. onPreviewHost keeps
// the rebuild reviewable on the preview deploy, which is a production build.
export function scheduleCreationAllowed() {
  return import.meta.env.DEV || onPreviewHost();
}
