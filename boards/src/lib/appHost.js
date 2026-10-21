// Which build is this, and what is it allowed to offer?
//
// Split out of stagingRedirect.js so a component can ask "am I on production"
// without dragging supabase.js into its chunk — stagingRedirect imports the
// client to call get_staging_redirect(), and CanvasSurface has no business
// pulling that in to decide whether to render a menu item. The two host
// predicates are the whole of what other code actually needs; stagingRedirect
// re-exports them so its existing callers (StagingBanner) are unchanged.

import { templateStoreOpenOn } from './templatePaths.js';

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
// The schedule hold: retired, it never opens on production
//
// Schedule is retired, not being rebuilt (owner, 2026-10-18: "we NO LONGER
// have the schedule feature"; 2026-10-20: everything related to it stays off
// production). This hold never lifts, so it is not one of the holds the sidebar
// release flips. Existing cards keep rendering: this gates CREATION only
// (buildAddActions, the rail's + menu, and the shoot-day minting path behind
// onAddShootDay). CanvasSurface's render dispatch is deliberately untouched.
// scheduleRetired.test.mjs fails if the body below changes, or if any way to
// make a schedule card stops asking it.
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
// 127.0.0.1 through ?local=1) working with no test changes. onPreviewHost was
// there to keep a rebuild reviewable on the preview deploy; there is no rebuild
// now, and the body stays as it is because the tests read it as the hold.
export function scheduleCreationAllowed() {
  return import.meta.env.DEV || onPreviewHost();
}

// ---------------------------------------------------------------------------
// The Scout hold
//
// Settings → Connections offers a connect code to text to Soleil Scout — and
// Scout's bot has never run, so on production that code would send people to
// text a line nothing answers. Production used to hold the section out with a
// production-only commit, which meant production could never simply BE main:
// every promote had to remember to re-apply it, and a promote that didn't would
// have shipped the dead code. The hold lives here instead, in the same
// allowlist shape as the schedule hold and for the same reasons — local dev and
// the preview deploy keep the section reviewable, every other origin (the
// native shells included) is closed until someone opens it on purpose.
export function scoutConnectAllowed() {
  return import.meta.env.DEV || onPreviewHost();
}

// ---------------------------------------------------------------------------
// The sidebar-files hold
//
// The sidebar is becoming the home of every file: clusters unfold into shelves
// of everything in them, and the Board · Files pill goes away. It is built on
// main in slices, and other sessions promote all of main to production, so
// every piece of it asks this first. Same allowlist shape as the holds above:
// the preview deploy sees it, and every other origin, the native shells
// included, is closed until the release flips it — in the same commit as the
// docs that describe it. Unlike them it REPLACES what's there (the Search
// button, the old tree), and other sessions run the real app's specs on the
// dev server, so on dev it is opt-in: localStorage soleil.dev.sidebarFiles = '1'
// (the sidebar's own specs set it). DEV is a build-time constant, so the
// production bundle never reads the flag.
export const SIDEBAR_FILES_DEV_FLAG = 'soleil.dev.sidebarFiles';
export function sidebarFilesAllowed() {
  if (onPreviewHost()) return true;
  if (!import.meta.env.DEV) return false;
  try { return window.localStorage.getItem(SIDEBAR_FILES_DEV_FLAG) === '1'; } catch (_) { return false; }
}

// Bulk import (lib/importJob.js): a whole folder tree or zip export becomes
// clusters, its files land in Files, and an import bigger than the plan brings
// what fits while the rest waits. Its files land in the sidebar's Files, so it
// opens only where that does; on dev it is opt-in on top, localStorage
// soleil.dev.bulkImport = '1'. Everywhere else a dropped folder keeps today's
// path until the release flips this with its docs.
export const BULK_IMPORT_DEV_FLAG = 'soleil.dev.bulkImport';
export function bulkImportAllowed() {
  if (!sidebarFilesAllowed()) return false;
  if (onPreviewHost()) return true;
  if (!import.meta.env.DEV) return false;
  try { return window.localStorage.getItem(BULK_IMPORT_DEV_FLAG) === '1'; } catch (_) { return false; }
}

// First-run setup (lib/workspaceSetup.js): a new signup names their workspace,
// says who it's for and invites people before the canvas, then gets tips for
// the sidebar. It launches with the sidebar's release (owner, 2026-10-20), so
// it opens only where that does; on dev it is opt-in on top, localStorage
// soleil.dev.workspaceSetup = '1' (its own specs set it), because other
// sessions' specs sign up fresh users and would land on the setup steps.
export const WORKSPACE_SETUP_DEV_FLAG = 'soleil.dev.workspaceSetup';
export function workspaceSetupAllowed() {
  if (!sidebarFilesAllowed()) return false;
  if (onPreviewHost()) return true;
  if (!import.meta.env.DEV) return false;
  try { return window.localStorage.getItem(WORKSPACE_SETUP_DEV_FLAG) === '1'; } catch (_) { return false; }
}

// The board's ground drawn on a canvas in step with the camera, and a mouse
// wheel's zoom that glides (lib/canvasGround.js). It was held until the
// sidebar release; the hold was lifted on 2026-10-21, so it is on everywhere.
// The function stays because callers and the feature-flag list import it.
export function boardGroundAllowed() {
  return true;
}

// ---------------------------------------------------------------------------
// The cluster-nudges hold
//
// Making clusters the obvious way to organize: the "+ New cluster" button after
// the breadcrumb, the Cluster tool's folder icon and hover card, "New cluster
// from N cards", the empty-Studio line, the Studio bar and the second-idea
// offer. Built on main in slices while other sessions promote main to
// production, so every piece asks this first. The preview deploy sees it; every
// other origin, the native shells included, is closed until the release flips
// it in the same commit as the docs (and the migration that makes clusters
// free). Like the sidebar hold it is opt-in on dev, because other sessions run
// the real app's specs on the dev server and the button and the bar move
// things they click: localStorage soleil.dev.clusterNudges = '1' (this
// feature's own specs set it). DEV is a build-time constant, so the production
// bundle never reads the flag.
export const CLUSTER_NUDGES_DEV_FLAG = 'soleil.dev.clusterNudges';
export function clusterNudgesAllowed() {
  if (onPreviewHost()) return true;
  if (!import.meta.env.DEV) return false;
  try { return window.localStorage.getItem(CLUSTER_NUDGES_DEV_FLAG) === '1'; } catch (_) { return false; }
}

// ---------------------------------------------------------------------------
// The touch-gestures hold
//
// New things a finger does (owner, 2026-10-20): hold empty canvas then drag to
// select cards, "Select…" in the hold menu, and Files that open on a tap and
// select from a hold. They change what a finger already does on production, so
// they wait for the owner to try them on a real iPad, then ship in one commit
// with their docs. Same allowlist shape as the holds above; opt-in on dev,
// localStorage soleil.dev.touchPass = '1' (the touch specs set it), because
// other sessions' touch specs pan the canvas with the finger this replaces.
export const TOUCH_PASS_DEV_FLAG = 'soleil.dev.touchPass';
export function touchPassAllowed() {
  if (onPreviewHost()) return true;
  if (!import.meta.env.DEV) return false;
  try { return window.localStorage.getItem(TOUCH_PASS_DEV_FLAG) === '1'; } catch (_) { return false; }
}

// ---------------------------------------------------------------------------
// The full Files page's new look
//
// The ⤢ / F page as the sidebar's Files card grown full screen (the owner's
// pick "A", 2026-10-20, with List as a classic Finder table): its head,
// shelves, table, Info card and Quick look's bar, and the sidebar's Files
// card folding to its bar while the page is open. The files sidebar ships
// first with today's page, so this waits behind its own hold until the owner
// has seen it. Opt-in on dev with localStorage soleil.dev.filesPageLook = '1'
// (its spec runs on the QA harness, which picks the look itself). Nothing in
// ListSurface or Quick look asks it: App reads it and hands the look down
// (components/clusterBrowser/filesLook.js).
export const FILES_PAGE_LOOK_DEV_FLAG = 'soleil.dev.filesPageLook';
export function filesPageLookAllowed() {
  if (!sidebarFilesAllowed()) return false;
  if (!import.meta.env.DEV) return false;
  try { return window.localStorage.getItem(FILES_PAGE_LOOK_DEV_FLAG) === '1'; } catch (_) { return false; }
}

// ---------------------------------------------------------------------------
// The file-sharing hold
//
// Sharing one file on its own (/f/<token>): the share dialog's entry points
// and the notification rows ask this first. It was held to DEV || preview
// (the allowlist shape of the holds above) until the release, which shipped it
// with the docs that describe it (docs/collaborate/sharing). It stays the one
// switch: hold it again here, and every entry point closes together.
export function fileSharesAllowed() {
  return true;
}

// ---------------------------------------------------------------------------
// The Shared page hold
//
// What happens to a file once it is shared (owner, 2026-10-18): the Shared
// page (with me / by me), the viewer the bell opens inside the app, Save a
// copy and shortcuts. Held to DEV || preview, the allowlist shape above, until
// the release that ships its docs.
export function sharedFilesAllowed() {
  return import.meta.env.DEV || onPreviewHost();
}

// ---------------------------------------------------------------------------
// The doc-sharing hold
//
// One doc shared on its own, to read or edit together (owner, 2026-10-18):
// the doc's Share button and menu rows, the dialog's view / edit roles, and
// the shared doc on /f/ and inside the app. It runs on the party's live rooms
// (party/doc.ts), so it needs VITE_USE_PARTYKIT too. Held to DEV || preview,
// the allowlist shape above, until the release that ships its docs.
export function docSharesAllowed() {
  return (import.meta.env.DEV || onPreviewHost()) && import.meta.env.VITE_USE_PARTYKIT === 'true';
}

// ---------------------------------------------------------------------------
// The template store hold
//
// The rule itself, and what "the store" covers, is in lib/templatePaths.js,
// because the Worker has to obey it too. This is the client half: the dev
// server (and the Playwright suite on it) always has the store, and otherwise
// it is open only where templateStoreOpenOn says so — the preview deploy.
// templateStoreOpenOn is handed window.location.hostname rather than a
// localhost exception: the native shells load from capacitor://localhost, and
// "localhost" would open the hold inside the shipped app.
export function templateStoreAllowed() {
  return import.meta.env.DEV
    || (typeof window !== 'undefined' && templateStoreOpenOn(window.location.hostname));
}

// ---------------------------------------------------------------------------
// Every hold at once
//
// Which of the holds above are open here, read once a session into the
// session_context row (sessionContext.js), so a row says which features that
// session was offered without anyone mapping builds to flags by hand. A new
// hold goes in this list too: sessionContext.test.mjs fails naming any
// exported *Allowed() that is missing from it.
export function featureFlags() {
  const holds = {
    sidebarFiles: sidebarFilesAllowed,
    filesPageLook: filesPageLookAllowed,
    bulkImport: bulkImportAllowed,
    workspaceSetup: workspaceSetupAllowed,
    boardGround: boardGroundAllowed,
    clusterNudges: clusterNudgesAllowed,
    touchPass: touchPassAllowed,
    fileShares: fileSharesAllowed,
    sharedFiles: sharedFilesAllowed,
    docShares: docSharesAllowed,
    templateStore: templateStoreAllowed,
    scheduleCreation: scheduleCreationAllowed,
    scoutConnect: scoutConnectAllowed,
  };
  const out = {};
  for (const k of Object.keys(holds)) {
    try { out[k] = !!holds[k](); } catch (_) { out[k] = false; }
  }
  return out;
}
