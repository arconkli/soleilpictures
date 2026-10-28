// featureEvents.js — what each feature on its way to production records, so
// none ships blind (2026-10-20).
//
// Messages shipped its engine without one event and nobody noticed until an
// audit. This map is the check that catches the next one. For every hold in
// lib/appHost.js featureFlags(), plus the features that already shipped
// without one, it names the EV keys that say someone SAW it (exposure), USED
// it (action), what came of it (outcome) and how it FAILED (failure).
// featureEvents.test.mjs fails when:
//   * a hold has no entry here;
//   * a feature open in production (its hold returns true, or it has none)
//     lacks an exposure or an outcome;
//   * a listed key is not in EV, or nothing in src emits it.
// A hold that is still closed may say `unmeasured`, with why, instead. The
// test then fails the day it opens.
//
// session_context records every hold for every session (its ff map), so it is
// every feature's denominator. It is listed as the exposure only where the
// feature is the session itself, a change to how the canvas draws or feels,
// and session_summary (frame stats, gesture counters) is then the outcome,
// read split by ff. Server-side, check_instrumentation() (0472) watches the
// same events arrive once they ship.
import { EV } from './analyticsEvents.js';

export const FEATURE_EVENTS = Object.freeze({
  // The Files sidebar, home of every file. Home v2 is its Home.
  sidebarFiles: {
    exposure: [EV.HOME_VIEW],
    action: [EV.FILES_OPEN, EV.FILES_SEARCH, EV.FILES_STAR, EV.FILES_MOVE, EV.FILES_PUT, EV.FILES_DELETE, EV.HOME_CLUSTER_ACTION],
    outcome: [EV.FILES_MOVE, EV.FILES_PUT, EV.FILES_OPEN],
    failure: [EV.FILES_MOVE, EV.FILES_DELETE],
  },
  // The full Files page as the sidebar's Files card grown full screen.
  filesPageLook: {
    exposure: [EV.LIST_BROWSER_VIEW],
    action: [EV.FILES_DOCK, EV.LIST_ADD_FILES],
    outcome: [EV.LIST_ADD_FILES, EV.VIEW_MODE_SWITCH],
    failure: [],
  },
  // Every toolbar in one language: how the bars look and answer, so the
  // session is its exposure and its summary the outcome, as boardGround's.
  toolbarLook: {
    exposure: [EV.SESSION_CONTEXT],
    action: [],
    outcome: [EV.SESSION_SUMMARY],
    failure: [],
  },
  // The doc editor's frame: one row of tools, the side panel's comments,
  // find and elements, and how a new doc starts. Most people who place a doc
  // never write in it, so doc_edit split by ff.docLook is what it's for.
  docLook: {
    exposure: [EV.SESSION_CONTEXT],
    action: [EV.COMMENT_CREATE, EV.COMMENT_RESOLVE],
    outcome: [EV.DOC_EDIT],
    failure: [],
  },
  // A whole folder tree or zip becomes clusters, waiting when it won't fit.
  bulkImport: {
    exposure: [EV.IMPORT_PREFLIGHT],
    action: [EV.IMPORT_JOB],
    outcome: [EV.FOLDER_IMPORT],
    failure: [EV.FOLDER_IMPORT, EV.IMPORT_JOB],
  },
  // Setup screens before the canvas, the link-first invite, the tips and the re-ask.
  workspaceSetup: {
    exposure: [EV.SETUP_STEP, EV.SETUP_TIPS, EV.INVITE_REASK],
    action: [EV.SETUP_STEP, EV.WORKSPACE_LINK_CREATED, EV.WORKSPACE_LINK_SHARED],
    outcome: [EV.SETUP_DONE, EV.WORKSPACE_LINK_CLAIM_RESULT, EV.JOINER_LANDED],
    failure: [EV.SETUP_ERROR],
  },
  // The painted canvas ground and the wheel glide: how the canvas draws and feels.
  boardGround: {
    exposure: [EV.SESSION_CONTEXT],
    action: [],
    outcome: [EV.SESSION_SUMMARY],
    failure: [],
  },
  // Offers to make a cluster, and the rail's Cluster tool.
  clusterNudges: {
    exposure: [EV.CLUSTER_NUDGE, EV.CLUSTER_TOOL_HINT],
    action: [EV.CLUSTER_NUDGE, EV.CARDS_MOVE],
    outcome: [EV.CLUSTER_CREATE],
    failure: [EV.CLUSTER_CREATE_FAIL, EV.CARDS_MOVE_FAIL],
  },
  // Hold to select, the lift, pinch and two-finger pan on phones and tablets.
  touchPass: {
    exposure: [EV.SESSION_CONTEXT, EV.MOBILE_LIFT_HINT_SHOWN],
    action: [EV.TOUCH_SELECT],
    outcome: [EV.TOUCH_SELECT, EV.SESSION_SUMMARY],
    failure: [EV.MOBILE_LIFT_CANCELLED],
  },
  // Sharing one file (/f/): the dialog, and the person it reaches.
  fileShares: {
    exposure: [EV.FILE_SHARE_OPEN],
    action: [EV.FILE_SHARE_ACCESS_SET, EV.FILE_SHARE_PEOPLE_ADD, EV.FILE_SHARE_PERSON_SET, EV.FILE_SHARE_LINK_COPY],
    outcome: [EV.FILE_SHARE_VIEW, EV.FILE_SHARE_DOWNLOAD],
    failure: [EV.FILE_SHARE_FAIL],
  },
  // The Shared page: what was shared with you, and by you.
  sharedFiles: {
    exposure: [EV.SHARED_PAGE_VIEW],
    action: [EV.SHARED_FILE_OPEN, EV.SHARED_FILE_HIDE],
    outcome: [EV.SHARED_FILE_SAVE, EV.SHARED_FILE_SHORTCUT],
    failure: [EV.SHARED_FILE_SAVE, EV.SHARED_FILE_SHORTCUT],
  },
  // A document shared like a file: the same dialog and page, with kind 'doc'.
  docShares: {
    exposure: [EV.FILE_SHARE_OPEN],
    action: [EV.FILE_SHARE_ACCESS_SET, EV.FILE_SHARE_PEOPLE_ADD, EV.FILE_SHARE_PERSON_SET, EV.FILE_SHARE_LINK_COPY],
    outcome: [EV.FILE_SHARE_VIEW],
    failure: [EV.FILE_SHARE_FAIL],
  },
  templateStore: {
    unmeasured: 'The template shop (pages/TemplateSharePage.jsx) records nothing yet. Before it opens: its page seen, and a template taken.',
  },
  scheduleCreation: {
    unmeasured: 'Schedule is deprecated (owner, 2026-10-18) and is not meant to open.',
  },
  scoutConnect: {
    unmeasured: 'Connecting Scout (settings/ConnectionsTab.jsx) records nothing yet, and the bot has never run.',
  },
  // The 10-editor limit: the share panel's note, Members' "People who can
  // edit", and the notices. The server logs editor_limit_viewer_fallback
  // (0521) in the statement that writes its notice.
  editorLimit: {
    exposure: [EV.EDITOR_LIMIT_SEEN],
    action: [EV.EDITOR_LIMIT_ASK_SENT, EV.EDITOR_LIMIT_SEE_WHO, EV.EDITOR_LIMIT_MAKE_ROOM, EV.EDITOR_LIMIT_NOTICE_OPEN],
    outcome: [EV.EDITOR_LIMIT_MAKE_ROOM, EV.EDITOR_LIMIT_ASK_SENT],
    failure: [EV.EDITOR_LIMIT_REFUSED],
  },

  // The Team plan: the setup, its checkout and the return from Stripe. The
  // server also logs team_created, team_joined, team_seat_viewer_fallback and
  // team_closed.
  teams: {
    exposure: [EV.TEAM_SETUP_OPEN],
    action: [EV.TEAM_CHECKOUT_START],
    outcome: [EV.TEAM_READY],
    failure: [EV.TEAM_CHECKOUT_FAILED],
  },
  // The Team card on both pricing pages (auth/useTeamPricingCard.js): every
  // pricing view shows it since the launch. Talk to us is its own page
  // (auth/TalkToUsPage.jsx), whose request is kept or isn't.
  teamPricing: {
    exposure: [EV.PRICING_VIEW, EV.TEAM_TALK_VIEW],
    action: [EV.PRICING_TEAM_START, EV.PRICING_TEAM_TALK],
    outcome: [EV.PRICING_TEAM_START, EV.TEAM_TALK_SENT],
    failure: [EV.TEAM_TALK_FAILED],
  },

  // Shipped without a hold.
  messages: {
    exposure: [EV.MSG_PANEL, EV.MSG_CONV_OPEN],
    action: [EV.MSG_SEND, EV.MSG_ACTION, EV.MSG_SEARCH],
    outcome: [EV.MSG_SEND],
    failure: [EV.MSG_SEND],
  },

  // Connecting an app or AI assistant by OAuth (pages/OAuthConsentPage.jsx),
  // the way into the API and the MCP server. The server logs the grant itself
  // (oauth_consent_granted, 0224); admin_mcp_funnel follows each client from
  // registration to its first call and first write.
  oauthConnect: {
    exposure: [EV.OAUTH_AUTHORIZE_VIEW],
    action: [EV.OAUTH_CONSENT_ALLOWED, EV.OAUTH_CONSENT_DENIED],
    outcome: [EV.OAUTH_CONSENT_ALLOWED],
    failure: [EV.OAUTH_AUTHORIZE_ERROR],
  },
  // A draft made in an AI chat without an account (P3b), kept on its keep
  // page. Held by the Worker (lib/mcpDrafts.js DRAFTS_HELD), not featureFlags():
  // until it opens, production's keep pages all answer 'unknown'.
  mcpDrafts: {
    exposure: [EV.KEEP_PAGE_VIEW],
    action: [EV.KEEP_CODE_SENT],
    outcome: [EV.KEEP_KEPT],
    failure: [EV.KEEP_FAILED],
  },
  // A board an AI without the Clusters app wrote into a /make link (or as
  // text), shown and then kept. No hold: the promote is the gate.
  makeLink: {
    exposure: [EV.MAKE_PAGE_VIEW],
    action: [EV.MAKE_CODE_SENT],
    outcome: [EV.MAKE_KEPT],
    failure: [EV.MAKE_FAILED],
  },
});
