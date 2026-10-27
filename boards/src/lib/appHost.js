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
// The sidebar is the home of every file: Home, Messages and the clusters on
// one card, the shown cluster's files (and Recent, Starred) on the other, and
// the Board · Files pill gone. It was built on main in slices behind this hold
// (DEV opt-in, the preview deploy); the hold was lifted for the sidebar release
// on 2026-10-21, with the docs that describe it (docs/clusters/sidebar), so it
// is on everywhere. The function stays because callers, the holds that open
// only where it does (bulk import, workspace setup) and featureFlags() ask it.
// SIDEBAR_FILES_DEV_FLAG is no longer read; it stays exported for the dev
// harnesses and specs that still set it, which is harmless.
export const SIDEBAR_FILES_DEV_FLAG = 'soleil.dev.sidebarFiles';
export function sidebarFilesAllowed() {
  return true;
}

// Bulk import (lib/importJob.js): a whole folder tree or zip export becomes
// clusters, its files land in Files, and an import bigger than the plan brings
// what fits while the rest waits. It was held to where the sidebar's Files
// opened (the preview, and dev behind localStorage soleil.dev.bulkImport), and
// was lifted for the sidebar release on 2026-10-21 with the docs that describe
// it (docs/clusters#importing-folders-and-zips). It stays the one switch: hold
// it again here, and a dropped folder goes back to the old path (lib/folderImport).
export function bulkImportAllowed() {
  return true;
}

// First-run setup (lib/workspaceSetup.js): a new signup names their workspace,
// says who it's for and invites people before the canvas, then gets tips for
// the sidebar. It launches with the sidebar's release (owner, 2026-10-20); it
// was held to the preview and a dev opt-in, and the hold was lifted with the
// docs that describe it (docs/getting-started, docs/sharing). Who sees it is
// still lib/workspaceSetup.js's to say: accounts made from SETUP_EPOCH on, in
// arm B of the workspace_setup test. WORKSPACE_SETUP_DEV_FLAG is no longer
// read; it stays exported for the ?setupqa harness that still sets it.
export const WORKSPACE_SETUP_DEV_FLAG = 'soleil.dev.workspaceSetup';
// lifted 2026-10-21 for the sidebar release
export function workspaceSetupAllowed() {
  return true;
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
// the breadcrumb, the Cluster tool's folder icon and hover card, C, "New
// cluster from N cards", the empty-Studio line, the Studio bar and the
// second-idea offer. Every piece asks this first.
// Lifted 2026-10-21 for the sidebar release; kept because callers and the feature-flag list import it.
export function clusterNudgesAllowed() {
  return true;
}

// ---------------------------------------------------------------------------
// The touch-gestures hold
//
// New things a finger does (owner, 2026-10-20): hold empty canvas then drag to
// select cards, "Select…" in the hold menu, and Files that open on a tap and
// select from a hold. They were held to the preview and a dev opt-in; the hold
// was lifted for the sidebar release with the docs that describe them
// (docs/account/mobile, docs/canvas, docs/clusters/list-view, docs/files), so
// they are on everywhere. TOUCH_PASS_DEV_FLAG is no longer read; it stays
// exported for the touch specs that still set it, which is harmless.
export const TOUCH_PASS_DEV_FLAG = 'soleil.dev.touchPass';
// lifted 2026-10-21 for the sidebar release
export function touchPassAllowed() {
  return true;
}

// ---------------------------------------------------------------------------
// The 10-editor limit
//
// Free and Creator can have at most 10 people who can edit (owner,
// 2026-10-20); a group that needs more buys a Team. The real switch is the
// server's, app_config.editor_limit (0520): off until launch, with a list of
// test accounts. This hold keeps the app's side of it closed until the Team
// plan launches with it: the share panel's count, "Ask the owner", the
// joined-as-viewer toast, and "Join as an editor" no longer saying "free".
// Open on preview, where the owner tries it on their own account (listed in
// test_owner_ids; for anyone else the server says it's off and nothing new
// shows but the dropped "free"), closed on production until the Team plan
// launches with it, opt-in on dev with localStorage soleil.dev.editorLimit = '1'.
export const EDITOR_LIMIT_DEV_FLAG = 'soleil.dev.editorLimit';
export function editorLimitAllowed() {
  if (onPreviewHost()) return true;
  if (!import.meta.env.DEV) return false;
  try { return window.localStorage.getItem(EDITOR_LIMIT_DEV_FLAG) === '1'; } catch (_) { return false; }
}

// ---------------------------------------------------------------------------
// The Team plan
//
// Teams, seats and team workspaces (0522, 0530-0535). Open on the preview host
// and in dev; closed on production until the plan launches with its docs. The
// server's own switch (app_config.teams_open) still refuses creating a team
// before then.
export function teamsAllowed() {
  return onPreviewHost() || !!import.meta.env.DEV;
}

// The Team card on both pricing pages, signed in and signed out. It follows
// teamsAllowed() (the preview host now, production at launch), except on dev,
// where it is opt-in (localStorage soleil.dev.teamPricing = '1', or Settings ›
// Preview's sample team) so the pricing specs keep reading production's two
// cards until the launch shows the third.
export const TEAM_PRICING_DEV_FLAG = 'soleil.dev.teamPricing';
export function teamPricingAllowed() {
  if (!import.meta.env.DEV) return teamsAllowed();
  try { return window.localStorage.getItem(TEAM_PRICING_DEV_FLAG) === '1'; } catch (_) { return false; }
}

// ---------------------------------------------------------------------------
// The full Files page's new look
//
// The ⤢ / F page as the sidebar's Files card grown full screen (the owner's
// pick "A", 2026-10-20, with List as a classic Finder table): its head,
// shelves, table, Info card and Quick look's bar, and the sidebar's Files
// card folding to its bar while the page is open. It was held to the preview
// and a dev opt-in until the owner had seen it, and was lifted for the sidebar
// release on 2026-10-21 with the docs that describe it (docs/clusters/list-view,
// docs/clusters/sidebar). It stays the one switch: hold it again here, and the
// page and Quick look go back to the look before it. Nothing in ListSurface or
// Quick look asks it: App reads it and hands the look down
// (components/clusterBrowser/filesLook.js).
export function filesPageLookAllowed() {
  return true;
}

// ---------------------------------------------------------------------------
// The toolbar look
//
// Every toolbar in one language (the owner's pick "A · Islands", 2026-10-21):
// the sidebar's glass under each bar, 32px buttons (44 under a finger), a gold
// tint and ring on what's on, one tooltip with the shortcut's keys in caps,
// and Phosphor icons where text glyphs stood. It was held to the preview and
// a dev opt-in until the owner had tried it, and was lifted on 2026-10-25
// with the docs that describe it (docs/canvas#selection). The bars it
// replaced are gone, so there is nothing to switch back to: it stays
// `return true;` for session_context's record, as every lifted hold does, and
// main.jsx marks <html data-tb="a"> without asking (the look's CSS keys on it).
export function toolbarLookAllowed() {
  return true;
}

// ---------------------------------------------------------------------------
// The doc editor's look
//
// The owner's pick "A + C's side panel" (2026-10-21): one row of tools over
// the page, the rest under ⋯, and a side panel where a doc's comments, find
// across its pages and a screenplay's elements live; with the start of a new
// doc, tables that grow, a reader's Find, zoom and Export, and its own row on
// a phone's keyboard. It was held to the preview and a dev opt-in until the
// owner had tried it, and was lifted on 2026-10-24 with the docs that
// describe it (docs/documents). The editor it replaced is gone from the
// clusters (a doc shared on its own, fileShare/DocShareView.jsx, still opens
// in it), so there is nothing to switch back to: it stays `return true;` for
// session_context's record, as every lifted hold does, and main.jsx marks
// <html data-doc-look="a"> without asking (the look's CSS keys on it).
export function docLookAllowed() {
  return true;
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
// copy and shortcuts. It was held to DEV || preview, the allowlist shape
// above, and was lifted for the sidebar release on 2026-10-21 with the docs
// that describe it (docs/collaborate/sharing). It stays the one switch: hold
// it again here, and every entry point closes together.
export function sharedFilesAllowed() {
  return true;
}

// ---------------------------------------------------------------------------
// The doc-sharing hold
//
// One doc shared on its own, to read or edit together (owner, 2026-10-18):
// the doc's Share button and menu rows, the dialog's view / edit roles, and
// the shared doc on /f/ and inside the app. It runs on the party's live rooms
// (party/doc.ts). It was held to DEV || preview with VITE_USE_PARTYKIT, and
// was lifted with the docs that describe it (docs/collaborate/sharing#sharing-a-doc).
export function docSharesAllowed() {
  // Lifted 2026-10-21 for the sidebar release; realtime comes from VITE_USE_PARTYKIT, which the promote build gets from .env.local.
  return true;
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
    toolbarLook: toolbarLookAllowed,
    docLook: docLookAllowed,
    bulkImport: bulkImportAllowed,
    workspaceSetup: workspaceSetupAllowed,
    boardGround: boardGroundAllowed,
    clusterNudges: clusterNudgesAllowed,
    touchPass: touchPassAllowed,
    editorLimit: editorLimitAllowed,
    teams: teamsAllowed,
    teamPricing: teamPricingAllowed,
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
