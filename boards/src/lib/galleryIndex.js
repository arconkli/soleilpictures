// galleryIndex.js — what the admin Surface Gallery can show, and how to find it.
//
// PURE DATA AND PURE FUNCTIONS. No imports, no JSX, no React, no DOM. That is
// deliberate: `node --test` cannot import JSX, and this is the half worth
// testing (ids unique, groups real, search ranking correct). The renderers and
// their fabricated props live next door in components/gallery/entries.jsx,
// keyed by the ids below, and galleryIndex.test.mjs scans that file as text to
// prove the two halves never drift apart.
//
// ── Why every VARIANT is its own entry ─────────────────────────────────────
// "The trial screen" is not a component, it is PricingModal with a particular
// tier shape. A list of components would make the owner's actual question
// ("does the trial offer look right?") unanswerable. So each visually distinct
// state gets its own id, label and keywords, and search returns states rather
// than files.
//
// ── The four kinds ─────────────────────────────────────────────────────────
// Forcing every surface through one mechanism is what would make this fake.
// Each surface is listed under the kind that can show it HONESTLY:
//
//   'overlay'  the real component, fabricated props, mounted in the host.
//   'toast'    fired through the real useFeedback() API; the list stays open.
//   'route'    a real screen — opened at its real URL in a new tab, because
//              these render before AuthGate and own the whole document.
//   'insitu'   cannot be faked. The row states the surface, why, and the
//              exact recipe. Listed rather than hidden, so searching "empty
//              board" answers the question instead of returning nothing.

export const GALLERY_GROUPS = Object.freeze([
  { id: 'upgrade',    label: 'Upgrade & billing' },
  { id: 'onboarding', label: 'Onboarding & first run' },
  { id: 'sharing',    label: 'Sharing & collaboration' },
  { id: 'prompts',    label: 'Prompts & asks' },
  { id: 'toasts',     label: 'Toasts & dialogs' },
  { id: 'settings',   label: 'Settings' },
  { id: 'modals',     label: 'Modals & panels' },
  { id: 'states',     label: 'Empty & error states' },
  { id: 'mobile',     label: 'Mobile' },
  { id: 'screens',    label: 'Full screens' },
]);

export const GALLERY_KINDS = Object.freeze(['overlay', 'toast', 'route', 'insitu']);

// Entry shape: { id, label, group, kind, keywords, note?, url?, param? }
//   note   — required for 'insitu': the recipe for seeing it for real.
//   url    — required for 'route'.
//   param  — for a route needing an id the gallery cannot invent; the row
//            renders an input and substitutes it for the ':' segment.
export const GALLERY_ENTRIES = Object.freeze([
  // ── Upgrade & billing ────────────────────────────────────────────────────
  { id: 'pricing-modal', label: 'Creator pricing', group: 'upgrade', kind: 'overlay',
    keywords: 'upgrade paywall price plan creator monthly annual buy checkout modal' },
  { id: 'pricing-modal-trial', label: 'Creator pricing — trial offer', group: 'upgrade', kind: 'overlay',
    keywords: 'trial free 14 days try creator offer eligible invitation upgrade price' },
  { id: 'pricing-modal-trialed', label: 'Creator pricing — trial already used', group: 'upgrade', kind: 'overlay',
    keywords: 'trial used already trialed ineligible upgrade price get creator' },
  { id: 'pricing-modal-trial-refused', label: 'Creator pricing — trial refused by server', group: 'upgrade', kind: 'overlay',
    keywords: 'trial refused not available error fallback buy anyway upgrade' },
  { id: 'pricing-modal-cap-hit', label: 'Cap wall', group: 'upgrade', kind: 'overlay',
    keywords: 'cap wall limit blocked full refused cards hit 50 100 upgrade paywall' },
  { id: 'pricing-modal-first-value', label: 'First-value upgrade modal', group: 'upgrade', kind: 'overlay',
    keywords: 'first value upgrade modal see creator banner follow on' },
  { id: 'pricing-modal-storage', label: 'Storage gate', group: 'upgrade', kind: 'overlay',
    keywords: 'storage gate upload blocked file size quota gb upgrade' },
  { id: 'first-value-banner', label: 'First-value banner', group: 'upgrade', kind: 'overlay',
    keywords: 'first value banner see creator not now frosted prompt price' },
  { id: 'first-value-banner-trial', label: 'First-value banner — trial offer', group: 'upgrade', kind: 'overlay',
    keywords: 'first value banner trial free days try creator invitation body of work' },
  { id: 'upgrade-pill-plain', label: 'Upgrade pill — plain', group: 'upgrade', kind: 'overlay',
    keywords: 'chip pill get creator upgrade corner button' },
  { id: 'upgrade-pill-count', label: 'Upgrade pill — with count and price', group: 'upgrade', kind: 'overlay',
    keywords: 'chip pill count price get creator 25 50 cards pressure' },
  { id: 'upgrade-pill-urgent', label: 'Upgrade pill — near the cap', group: 'upgrade', kind: 'overlay',
    keywords: 'chip pill urgent near cap cards left warning gold price' },
  { id: 'upgrade-pill-trial', label: 'Upgrade pill — trial offer', group: 'upgrade', kind: 'overlay',
    keywords: 'chip pill trial free days invitation body of work no price' },
  { id: 'import-cap-dialog', label: 'Import preflight — over the cap', group: 'upgrade', kind: 'overlay',
    keywords: 'import preflight folder drop cap dialog take partial upgrade files' },
  { id: 'import-cap-dialog-full', label: 'Import preflight — nothing fits', group: 'upgrade', kind: 'overlay',
    keywords: 'import preflight full none fit cap dialog blocked upgrade' },
  { id: 'billing-demo', label: 'Billing — free plan', group: 'upgrade', kind: 'overlay',
    keywords: 'billing settings plan demo free card count upgrade creator' },
  { id: 'billing-paid', label: 'Billing — paying', group: 'upgrade', kind: 'overlay',
    keywords: 'billing settings paid active renews manage portal storage meter' },
  { id: 'billing-trialing', label: 'Billing — on trial', group: 'upgrade', kind: 'overlay',
    keywords: 'billing trial trialing first charge date amount manage cancel' },
  { id: 'billing-trial-canceled', label: 'Billing — trial canceled', group: 'upgrade', kind: 'overlay',
    keywords: 'billing trial canceled ends not charged note' },
  { id: 'billing-canceled', label: 'Billing — subscription canceled', group: 'upgrade', kind: 'overlay',
    keywords: 'billing canceled cancel at period end resubscribe note' },
  { id: 'billing-grant', label: 'Billing — complimentary access', group: 'upgrade', kind: 'overlay',
    keywords: 'billing grant comp complimentary access no end date' },
  { id: 'billing-admin', label: 'Billing — admin', group: 'upgrade', kind: 'overlay',
    keywords: 'billing admin unlimited no subscription needed' },

  // ── Onboarding & first run ───────────────────────────────────────────────
  { id: 'coachmark', label: 'Onboarding coachmark', group: 'onboarding', kind: 'overlay',
    keywords: 'coachmark onboarding hint first run tip start' },
  { id: 'coachmark-tutorial', label: 'Onboarding coachmark — with tutorial board', group: 'onboarding', kind: 'overlay',
    keywords: 'coachmark tutorial board onboarding hint variant' },
  { id: 'coachmark-escalated', label: 'Onboarding coachmark — escalated', group: 'onboarding', kind: 'overlay',
    keywords: 'coachmark escalated stuck onboarding hint second try' },
  { id: 'tour-desktop', label: 'Onboarding tour — desktop', group: 'onboarding', kind: 'overlay',
    keywords: 'tour onboarding steps desktop walkthrough coach bubble' },
  { id: 'tour-mobile', label: 'Onboarding tour — mobile step', group: 'onboarding', kind: 'overlay',
    keywords: 'tour mobile add photos onboarding phone step lite' },
  { id: 'tour-project', label: 'Onboarding tour — project first', group: 'onboarding', kind: 'overlay',
    keywords: 'tour project first intent onboarding step variant' },
  { id: 'empty-board-panel', label: 'Empty board tile panel', group: 'onboarding', kind: 'insitu',
    keywords: 'empty board tiles panel first board paste drop hero cluster grid note',
    note: 'Inline JSX inside CanvasSurface, which needs ~55 props and a live Y.Doc. Create a new cluster and open it — the panel is what you land on. For the first-board variants run a dev build at /?local=1&reset=1&blank=1&firstboard=references (also moodboard, storyboard).' },
  { id: 'depth-dock', label: 'Depth dock', group: 'onboarding', kind: 'insitu',
    keywords: 'depth dock add images pick several prompt canvas nudge',
    note: 'Inline JSX inside CanvasSurface. Shows on a board holding 1-5 genuine cards. Place one image on a new cluster and it appears; the predicate is shouldShowDepthDock in lib/depthDock.js.' },
  { id: 'mix-prompt', label: 'Mix prompt', group: 'onboarding', kind: 'insitu',
    keywords: 'mix prompt add a note say what this is image heavy canvas nudge',
    note: 'Inline JSX inside CanvasSurface, and it must also win the upsell slot. Place 3+ images and no text on a cluster; the predicate is shouldPromptMix in lib/mixPrompt.js. It beats the depth dock where both are eligible.' },

  // ── Sharing & collaboration ──────────────────────────────────────────────
  { id: 'share-modal', label: 'Share panel', group: 'sharing', kind: 'overlay',
    keywords: 'share modal panel link access people invite collaborate public' },
  { id: 'share-modal-invite', label: 'Share panel — invite link', group: 'sharing', kind: 'overlay',
    keywords: 'share invite link section collaborate editor viewer' },
  { id: 'public-topbar-signed-out', label: 'Share page bar — signed out', group: 'sharing', kind: 'overlay',
    keywords: 'public share page topbar try clusters free cta signed out' },
  { id: 'public-topbar-remix', label: 'Share page bar — make a copy', group: 'sharing', kind: 'overlay',
    keywords: 'public share page topbar remix make a copy cta signed out' },
  { id: 'public-topbar-signed-in', label: 'Share page bar — save a copy', group: 'sharing', kind: 'overlay',
    keywords: 'public share page topbar save a copy signed in cta remix' },
  { id: 'public-topbar-open', label: 'Share page bar — open Clusters', group: 'sharing', kind: 'overlay',
    keywords: 'public share page topbar open clusters signed in cta' },
  { id: 'join-editor', label: 'Join invite — editor', group: 'sharing', kind: 'overlay',
    keywords: 'join invite board editor accept card link collaborate' },
  { id: 'join-viewer', label: 'Join invite — viewer', group: 'sharing', kind: 'overlay',
    keywords: 'join invite board viewer accept card link collaborate' },
  { id: 'share-prompt', label: 'Share prompt', group: 'sharing', kind: 'overlay',
    keywords: 'share prompt send it to someone dwell nudge banner' },

  // ── Prompts & asks ───────────────────────────────────────────────────────
  { id: 'return-reason-ask', label: 'Return reason ask', group: 'prompts', kind: 'overlay',
    keywords: 'return reason ask what brings you back feedback chips survey' },
  { id: 'return-reason-probe', label: 'Return reason ask — follow-up probe', group: 'prompts', kind: 'overlay',
    keywords: 'return reason probe thanks textarea send skip feedback' },
  { id: 'return-reason-receipt', label: 'Return reason ask — receipt', group: 'prompts', kind: 'overlay',
    keywords: 'return reason receipt read thank you feedback confirmation' },
  { id: 'referral-nudge', label: 'Invite nudge', group: 'prompts', kind: 'overlay',
    keywords: 'referral invite nudge collaborate earn free cards prompt' },
  { id: 'feedback-button', label: 'Feedback button', group: 'prompts', kind: 'overlay',
    keywords: 'feedback button floating bug idea report send' },

  // ── Toasts & dialogs ─────────────────────────────────────────────────────
  { id: 'toast-near-cap', label: 'Toast — near the cap', group: 'toasts', kind: 'toast',
    keywords: 'toast near cap warning cards left see creator price invite' },
  { id: 'toast-near-cap-trial', label: 'Toast — near the cap, trial offer', group: 'toasts', kind: 'toast',
    keywords: 'toast near cap trial free days try creator invite warning' },
  { id: 'toast-cap-rehit', label: 'Toast — cards did not fit', group: 'toasts', kind: 'toast',
    keywords: 'toast cap rehit did not fit limit see creator warning' },
  { id: 'toast-referral-reward', label: 'Toast — referral reward', group: 'toasts', kind: 'toast',
    keywords: 'toast referral reward bonus cards invite more success' },
  { id: 'toast-share-ask', label: 'Toast — share ask', group: 'toasts', kind: 'toast',
    keywords: 'toast share ask looking good send copy link' },
  { id: 'toast-manage-access', label: 'Toast — manage access', group: 'toasts', kind: 'toast',
    keywords: 'toast manage access share link created' },
  { id: 'toast-reveal-grids', label: 'Toast — power reveal, grids', group: 'toasts', kind: 'toast',
    keywords: 'toast power reveal grids tip discover' },
  { id: 'toast-reveal-group', label: 'Toast — power reveal, group', group: 'toasts', kind: 'toast',
    keywords: 'toast power reveal group tip discover' },
  { id: 'toast-reveal-list', label: 'Toast — power reveal, list view', group: 'toasts', kind: 'toast',
    keywords: 'toast power reveal list drive view tip discover' },
  { id: 'toast-reveal-docs', label: 'Toast — power reveal, docs', group: 'toasts', kind: 'toast',
    keywords: 'toast power reveal docs tip discover' },
  { id: 'toast-reveal-palette', label: 'Toast — power reveal, command palette', group: 'toasts', kind: 'toast',
    keywords: 'toast power reveal palette command k tip discover' },
  { id: 'toast-success', label: 'Toast — success', group: 'toasts', kind: 'toast',
    keywords: 'toast success green check saved' },
  { id: 'toast-error', label: 'Toast — error', group: 'toasts', kind: 'toast',
    keywords: 'toast error red failed problem alert' },
  { id: 'toast-info', label: 'Toast — info', group: 'toasts', kind: 'toast',
    keywords: 'toast info neutral notice' },
  { id: 'toast-undo', label: 'Toast — undo', group: 'toasts', kind: 'toast',
    keywords: 'toast undo delete deleted action convention' },
  { id: 'dialog-confirm', label: 'Confirm dialog', group: 'toasts', kind: 'toast',
    keywords: 'confirm dialog yes cancel modal question' },
  { id: 'dialog-confirm-danger', label: 'Confirm dialog — destructive', group: 'toasts', kind: 'toast',
    keywords: 'confirm dialog danger destructive delete red modal' },
  { id: 'dialog-confirm-typed', label: 'Confirm dialog — type to confirm', group: 'toasts', kind: 'toast',
    keywords: 'confirm dialog type to confirm text gate delete danger' },
  { id: 'dialog-prompt', label: 'Prompt dialog', group: 'toasts', kind: 'toast',
    keywords: 'prompt dialog input rename text suggestions' },
  { id: 'dialog-delete-account', label: 'Confirm dialog — delete account', group: 'toasts', kind: 'toast',
    keywords: 'delete account confirm permanently danger settings' },

  // ── Settings ─────────────────────────────────────────────────────────────
  { id: 'settings-profile', label: 'Settings — Profile', group: 'settings', kind: 'overlay',
    keywords: 'settings profile name avatar account' },
  { id: 'settings-appearance', label: 'Settings — Appearance', group: 'settings', kind: 'overlay',
    keywords: 'settings appearance theme dark light accent font display' },
  { id: 'settings-notifications', label: 'Settings — Notifications', group: 'settings', kind: 'overlay',
    keywords: 'settings notifications email prefs' },
  { id: 'settings-connections', label: 'Settings — Connections', group: 'settings', kind: 'overlay',
    keywords: 'settings connections api tokens scout integrations mcp' },
  { id: 'settings-billing', label: 'Settings — Plan & billing', group: 'settings', kind: 'overlay',
    keywords: 'settings billing plan subscription upgrade portal storage' },
  { id: 'settings-invite', label: 'Settings — Invite & earn', group: 'settings', kind: 'overlay',
    keywords: 'settings invite earn referral code bonus cards' },
  { id: 'settings-general', label: 'Settings — Workspace general', group: 'settings', kind: 'overlay',
    keywords: 'settings workspace general name rename delete recovery' },
  { id: 'settings-members', label: 'Settings — Members', group: 'settings', kind: 'overlay',
    keywords: 'settings members workspace roles invite owner editor viewer' },
  { id: 'settings-defaults', label: 'Settings — Card defaults', group: 'settings', kind: 'overlay',
    keywords: 'settings card defaults workspace note colour size' },
  { id: 'settings-docs', label: 'Settings — Documentation', group: 'settings', kind: 'overlay',
    keywords: 'settings documentation docs help registry' },
  { id: 'settings-capture', label: 'Settings — Capture (admin)', group: 'settings', kind: 'overlay',
    keywords: 'settings capture admin screenshot recording staging clean' },
  { id: 'delete-account-panel', label: 'Delete account panel', group: 'settings', kind: 'overlay',
    keywords: 'delete account panel impact workspaces transferred danger settings' },

  // ── Modals & panels ──────────────────────────────────────────────────────
  { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'modals', kind: 'overlay',
    keywords: 'shortcuts keyboard help overlay question mark keys' },
  { id: 'command-palette', label: 'Command palette', group: 'modals', kind: 'overlay',
    keywords: 'command palette cmd k search jump commands' },
  { id: 'command-palette-pick', label: 'Command palette — pick a cluster', group: 'modals', kind: 'overlay',
    keywords: 'command palette pick board cluster move chooser' },
  { id: 'trash-modal', label: 'Trash', group: 'modals', kind: 'overlay',
    keywords: 'trash deleted clusters restore modal recycle' },
  { id: 'custom-fonts', label: 'Custom fonts', group: 'modals', kind: 'overlay',
    keywords: 'custom fonts upload typeface modal' },
  { id: 'save-template', label: 'Save as template', group: 'modals', kind: 'overlay',
    keywords: 'save template grid layout dialog publish' },
  { id: 'template-added', label: 'Template added prompt', group: 'modals', kind: 'overlay',
    keywords: 'template added place prompt armed grid' },
  { id: 'thumbnail-crop', label: 'Thumbnail crop', group: 'modals', kind: 'overlay',
    keywords: 'thumbnail crop cluster cover image modal' },
  { id: 'image-edit', label: 'Image adjustments', group: 'modals', kind: 'overlay',
    keywords: 'image edit adjust brightness contrast crop modal photo' },
  { id: 'image-lightbox', label: 'Image lightbox', group: 'modals', kind: 'overlay',
    keywords: 'image lightbox full screen photo viewer zoom' },
  { id: 'waitlist-modal', label: 'Waitlist', group: 'modals', kind: 'overlay',
    keywords: 'waitlist modal request access signup' },
  { id: 'workspace-recovery', label: 'Workspace recovery', group: 'modals', kind: 'overlay',
    keywords: 'workspace recovery rewind mass delete restore modal' },
  { id: 'showcase-banner', label: 'Showcase banner', group: 'modals', kind: 'overlay',
    keywords: 'showcase banner preview clear demo' },
  { id: 'staging-banner', label: 'Staging banner', group: 'modals', kind: 'insitu',
    keywords: 'staging banner preview host environment dev',
    note: 'Self-gates on the hostname via onPreviewHost() / onProdHost(), so it returns null anywhere else. It is visible on the preview deploy by definition — open the preview URL.' },

  // ── Empty & error states ─────────────────────────────────────────────────
  { id: 'not-found', label: 'Page not found', group: 'states', kind: 'overlay',
    keywords: '404 not found missing page error' },
  { id: 'empty-state', label: 'Empty state', group: 'states', kind: 'overlay',
    keywords: 'empty state nothing here placeholder icon action' },
  { id: 'home-empty', label: 'Home empty state', group: 'states', kind: 'overlay',
    keywords: 'home empty no clusters yet placeholder' },
  { id: 'splash-loading', label: 'Splash loading', group: 'states', kind: 'overlay',
    keywords: 'splash loading boot spinner auth gate' },
  { id: 'app-error', label: 'App error boundary', group: 'states', kind: 'overlay',
    keywords: 'error boundary crash app broke copy error reset reload' },
  { id: 'surface-error', label: 'Surface error boundary', group: 'states', kind: 'overlay',
    keywords: 'error boundary surface cluster view glitch reload' },
  { id: 'admin-skeleton-table', label: 'Admin skeleton — table', group: 'states', kind: 'overlay',
    keywords: 'admin skeleton loading table placeholder shimmer' },
  { id: 'admin-skeleton-cards', label: 'Admin skeleton — cards', group: 'states', kind: 'overlay',
    keywords: 'admin skeleton loading cards placeholder shimmer' },
  { id: 'admin-skeleton-chart', label: 'Admin skeleton — chart', group: 'states', kind: 'overlay',
    keywords: 'admin skeleton loading chart placeholder shimmer' },
  { id: 'admin-error', label: 'Admin error', group: 'states', kind: 'overlay',
    keywords: 'admin error retry failed load dashboard' },
  { id: 'admin-empty', label: 'Admin empty', group: 'states', kind: 'overlay',
    keywords: 'admin empty nothing yet dashboard placeholder' },
  { id: 'chart-placeholder', label: 'Chart placeholder', group: 'states', kind: 'overlay',
    keywords: 'chart placeholder not enough data small n admin' },

  // ── Mobile ───────────────────────────────────────────────────────────────
  { id: 'sheet-full', label: 'Sheet — full', group: 'mobile', kind: 'overlay',
    keywords: 'sheet bottom phone full modal drawer mobile' },
  { id: 'sheet-half', label: 'Sheet — half', group: 'mobile', kind: 'overlay',
    keywords: 'sheet bottom phone half modal drawer mobile snap' },
  { id: 'mobile-drawer', label: 'Mobile drawer', group: 'mobile', kind: 'overlay',
    keywords: 'drawer mobile side menu swipe phone sidebar' },
  { id: 'mobile-bottom-nav', label: 'Mobile bottom nav', group: 'mobile', kind: 'overlay',
    keywords: 'bottom nav mobile tabs phone create puck' },

  // ── Full screens ─────────────────────────────────────────────────────────
  { id: 'screen-pricing', label: 'Pricing page', group: 'screens', kind: 'route', url: '/pricing',
    keywords: 'pricing page public plans creator price screen route' },
  { id: 'screen-checkout-success', label: 'Checkout success', group: 'screens', kind: 'route', url: '/pricing/success',
    keywords: 'checkout success paid thank you activated screen route' },
  { id: 'screen-explore', label: 'Explore', group: 'screens', kind: 'route', url: '/explore',
    keywords: 'explore browse public clusters gallery screen route' },
  { id: 'screen-docs', label: 'Documentation', group: 'screens', kind: 'route', url: '/docs',
    keywords: 'docs documentation help public screen route' },
  { id: 'screen-docs-plans', label: 'Documentation — plans', group: 'screens', kind: 'route', url: '/docs/account/plans',
    keywords: 'docs plans billing trial pricing page account screen route' },
  { id: 'screen-changelog', label: 'Changelog', group: 'screens', kind: 'route', url: '/changelog',
    keywords: 'changelog releases updates public screen route' },
  { id: 'screen-legal-privacy', label: 'Privacy policy', group: 'screens', kind: 'route', url: '/legal/privacy',
    keywords: 'legal privacy policy screen route' },
  { id: 'screen-legal-terms', label: 'Terms', group: 'screens', kind: 'route', url: '/legal/terms',
    keywords: 'legal terms of service screen route' },
  { id: 'screen-legal-cookies', label: 'Cookie policy', group: 'screens', kind: 'route', url: '/legal/cookies',
    keywords: 'legal cookies policy screen route' },
  { id: 'screen-resume', label: 'Resume link', group: 'screens', kind: 'route', url: '/resume',
    keywords: 'resume link email return token screen route' },
  { id: 'screen-scout', label: 'Scout', group: 'screens', kind: 'route', url: '/scout',
    keywords: 'scout bot ingest landing screen route' },
  { id: 'screen-oauth', label: 'OAuth consent', group: 'screens', kind: 'route', url: '/oauth/authorize',
    keywords: 'oauth authorize consent api mcp token screen route' },
  { id: 'screen-vs-pureref', label: 'Comparison — PureRef', group: 'screens', kind: 'route', url: '/vs/pureref',
    keywords: 'vs pureref comparison seo landing marketing screen route' },
  { id: 'screen-best', label: 'Listicle', group: 'screens', kind: 'route', url: '/best/moodboard-apps',
    keywords: 'best listicle seo landing marketing screen route' },
  { id: 'screen-templates', label: 'Templates', group: 'screens', kind: 'route', url: '/templates',
    keywords: 'templates shop seo landing marketing screen route' },
  { id: 'screen-share', label: 'Public share page', group: 'screens', kind: 'route', url: '/share/:token', param: 'share token',
    keywords: 'share page public board token viewer screen route' },
  { id: 'screen-public-board', label: 'Public cluster page', group: 'screens', kind: 'route', url: '/c/:slug', param: 'slug',
    keywords: 'public cluster board slug discoverable screen route' },
  { id: 'screen-template', label: 'Shared template page', group: 'screens', kind: 'route', url: '/t/:id', param: 'template id',
    keywords: 'template share page screen route' },
  { id: 'screen-admin', label: 'Admin dashboard', group: 'screens', kind: 'route', url: '/admin',
    keywords: 'admin dashboard analytics deck metrics screen route' },
]);

// ── Search ────────────────────────────────────────────────────────────────
// Substring over label + keywords, ranked exact > prefix > contains, the same
// shape CommandPalette.jsx uses (boardRank at :69). No fuzzy matcher: there
// isn't one in lib/, and a list this size with hand-written keywords does not
// need one. An empty query returns everything in registry order, so the list
// doubles as the full inventory.

function rank(label, keywords, lq) {
  const t = String(label || '').toLowerCase();
  if (t === lq) return 0;
  if (t.startsWith(lq)) return 1;
  if (t.includes(lq)) return 2;
  if (String(keywords || '').toLowerCase().includes(lq)) return 3;
  return 4;
}

export function searchGallery(entries, q) {
  const list = Array.isArray(entries) ? entries : [];
  const lq = String(q || '').trim().toLowerCase();
  if (!lq) return list.slice();
  const hits = [];
  for (let i = 0; i < list.length; i += 1) {
    const e = list[i];
    const r = rank(e.label, e.keywords, lq);
    if (r < 4) hits.push({ e, r, i });
  }
  // Stable: equal rank keeps registry order, so results never jump around as
  // you type past a tie.
  hits.sort((a, b) => (a.r - b.r) || (a.i - b.i));
  return hits.map((h) => h.e);
}

// Group the (already filtered) entries for rendering, dropping empty headings —
// the same shape SettingsPanel.jsx:139 uses for the admin rail.
export function groupGallery(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return GALLERY_GROUPS
    .map((g) => ({ ...g, entries: list.filter((e) => e.group === g.id) }))
    .filter((g) => g.entries.length > 0);
}

export function findEntry(id) {
  if (!id) return null;
  return GALLERY_ENTRIES.find((e) => e.id === id) || null;
}

// The route URL with its ':param' segment replaced. Returns null when the entry
// needs a param and none was given, so the caller can ask instead of opening a
// URL with a literal ':token' in it.
export function routeUrl(entry, param) {
  if (!entry || entry.kind !== 'route' || !entry.url) return null;
  if (!entry.param) return entry.url;
  const v = String(param || '').trim();
  if (!v) return null;
  return entry.url.replace(/:[a-z]+$/i, encodeURIComponent(v));
}
