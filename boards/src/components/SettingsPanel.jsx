// Settings panel — one panel, two doors.
//
// It used to be two: an "Account" modal behind the avatar and a "Settings"
// modal behind the cog, both rendered from this same component with a `mode`
// prop that filtered the tabs. The split claimed to be you-vs-workspace and
// wasn't — Theme and Display write profiles.settings.ui and are as personal as
// anything gets, yet they lived behind the button labelled "Workspace
// settings", while the workspace's own icon was buried three sections into a
// tab called Defaults. And there was no route from one modal to the other.
//
// So: one panel, one rail grouped into You / This workspace, opened from both
// places at the tab that entry point is about. That also fixes the phone,
// where the bottom nav's Settings tab reached the workspace modal only and
// could not get to your profile, your plan, or sign out at all.
//
// This file is the SHELL only — portal, header, rail, pane. Each tab's body
// lives in components/settings/. Keep the file at this path: the docs surface
// gate reads TABS straight out of it (scripts/lib/publicSurface.mjs).
//
// Settings persist via the merge_*_settings RPCs, which do an atomic
// jsonb || patch so two clients can save different keys at once.
import { Suspense, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { lazyWithReload } from '../lib/lazyWithReload.js';
import { X, ChevronLeft, ChevronRight } from '../lib/icons.js';
import { Icon } from './Icon.jsx';
import { useFeedback } from './AppFeedback.jsx';
import { useBreakpoint } from '../hooks/useBreakpoint.js';
import { SettingsSaveProvider, useSettingsSaveState, SettingsSavedFlash } from './settings/saveState.jsx';
import { ProfileTab } from './settings/ProfileTab.jsx';
import { AppearanceTab } from './settings/AppearanceTab.jsx';
import { NotificationsTab } from './settings/NotificationsTab.jsx';
import { ConnectionsTab } from './settings/ConnectionsTab.jsx';
import { BillingTab } from './settings/BillingTab.jsx';
import { InviteTab } from './settings/InviteTab.jsx';
import { WorkspaceGeneralTab, CardDefaultsTab } from './settings/WorkspaceTab.jsx';
import { DocsTab } from './settings/DocsTab.jsx';
// Lazy so nobody but an admin who opens the tab ever downloads it — the same
// reason AdminPage is lazy in TierRouter.
const CaptureTab = lazyWithReload(() => import('./settings/CaptureTab.jsx').then(m => ({ default: m.CaptureTab })));

// `group` decides which heading a tab sits under. Ids are load-bearing beyond
// this file — `?settings=billing` is the Stripe Customer Portal's return_url
// and `invite` is deep-linked from five surfaces — so they stay put even where
// the label moved.
const TABS = [
  { id: 'profile',       label: 'Profile',        group: 'you' },
  { id: 'appearance',    label: 'Appearance',     group: 'you' },
  { id: 'notifications', label: 'Notifications',  group: 'you' },
  { id: 'connections',   label: 'Connections',    group: 'you' },
  { id: 'billing',       label: 'Plan & billing', group: 'you' },
  { id: 'invite',        label: 'Invite & earn',  group: 'you' },
  { id: 'general',       label: 'General',        group: 'workspace' },
  { id: 'defaults',      label: 'Card defaults',  group: 'workspace' },
  { id: 'docs',          label: 'Documentation',  group: 'help' },
];

// Admin-only tabs, appended to the rail at render time for tier === 'admin'.
//
// A SEPARATE constant on purpose, and it must stay separate. The docs surface
// gate finds the settings tabs by indexOf-ing the TABS declaration above and
// bracket-matching only that literal — so anything declared here is invisible
// to it, the surface hash never moves, and `npm test` stays green with no
// docs:accept. (Which is also why this comment does not spell the needle out
// verbatim: an exact copy of it sitting above the real declaration would
// capture the extractor and hash the wrong thing.) That is the
// honest reading of the rule as well as the convenient one: the gate exists so
// a surface a signed-out visitor or a crawler can reach stays documented, and a
// tab no non-admin can render is not one. Keep this BELOW the TABS literal so
// even the indexOf ordering is unambiguous.
//
// If you ever add a tab here that real users can see, it belongs in TABS and it
// needs a docs page. That is the whole distinction.
const ADMIN_TABS = [
  { id: 'capture', label: 'Capture', group: 'admin' },
];

const GROUPS = [
  { id: 'you',       label: 'You' },
  { id: 'workspace', label: 'This workspace' },
  { id: 'help',      label: 'Help' },
  { id: 'admin',     label: 'Admin' },
];

// Tabs that merged into another one. A stale deep-link should land somewhere
// sensible rather than falling through to Profile.
const TAB_ALIASES = {
  theme: 'appearance',
  display: 'appearance',
  scout: 'connections',
  api: 'connections',
};

// `tabs` is passed in rather than closed over because the admin rail is longer
// than TABS — a deep link to ?settings=capture must resolve for an admin and
// fall through to null for everyone else.
function resolveTab(id, tabs) {
  if (!id) return null;
  const mapped = TAB_ALIASES[id] || id;
  return tabs.some(t => t.id === mapped) ? mapped : null;
}

export function SettingsPanel({
  open, onClose,
  user, onSignOut,
  workspaceId, workspaceName, onWorkspacesChanged,
  onSaved,
  // Settings hook output — passed in so the panel and the rest of the
  // app share one source of truth and refresh together.
  role, refresh, workspaceSettings, mySettings,
  // Opens the WorkspaceRecoveryModal (catastrophic rewind). Wired into the
  // workspace General tab as a low-key entry for owners. The primary entry
  // point is the top-of-app alert banner that fires automatically when a
  // mass-delete is detected; this is the manual fallback.
  onOpenRecovery,
  // Which tab this open is about. The avatar sends 'profile', the cog sends
  // 'general', the phone's bottom nav sends nothing (and gets the list).
  initialTab = null,
  // tier === 'admin'. Appends ADMIN_TABS to the rail. The UI gate is cosmetic
  // — every admin capability behind it is gated server-side — but Capture is
  // pure client-side staging, so this IS its gate, and captureState refuses to
  // do anything until App arms it from the same tier read.
  isAdmin = false,
}) {
  const feedback = useFeedback();
  // `stacked` mirrors `mobileShell` in App.jsx, which is exactly what the media
  // query at the foot of styles.css switches on. They MUST agree: the CSS
  // stacks the rail above the pane, and only the is-list / is-detail class
  // below decides which of the two you can see. Keying this off isPhone alone
  // left a touch tablet in portrait with both rendered and no way between them.
  const { isPhone, isTablet, isTouch } = useBreakpoint();
  const stacked = isPhone || (isTablet && isTouch);
  const { save, saving, savedAt } = useSettingsSaveState();
  const tabs = isAdmin ? [...TABS, ...ADMIN_TABS] : TABS;
  // Only headings that actually have a tab under them. Without this a
  // non-admin gets a bare "Admin" label with nothing beneath it.
  const groups = GROUPS.filter(g => tabs.some(t => t.group === g.id));
  const [tab, setTab] = useState(() => resolveTab(initialTab, tabs) || TABS[0].id);
  // Phone only: the rail is a list screen and a tab is a detail screen pushed
  // on top of it. Opening with no initialTab means "show me settings", which
  // is the list; opening with one means "take me here".
  const [detail, setDetail] = useState(!!resolveTab(initialTab, tabs));
  const railRefs = useRef({});

  // Adjust-state-during-render rather than an effect. The panel stays mounted
  // across close/reopen, so an effect would paint one frame of whichever tab
  // was open last before snapping to the one this open is about.
  const [sync, setSync] = useState({ open, tab: initialTab });
  if (open !== sync.open || initialTab !== sync.tab) {
    const fresh = !sync.open;
    setSync({ open, tab: initialTab });
    if (open) {
      const t = resolveTab(initialTab, tabs);
      if (t) { setTab(t); setDetail(true); }
      else if (fresh) setDetail(false);
    }
  }

  if (!open) return null;

  // Falls back through `tabs`, so an admin who dropped tier mid-session lands
  // on Profile rather than on a header for a tab that no longer exists.
  const current = tabs.find(t => t.id === tab) || tabs[0];

  const selectTab = (id) => { setTab(id); setDetail(true); };

  // Up/Down moves the selection itself rather than a separate highlight —
  // the rail has one active state, so a roving highlight you then have to
  // press Enter on would be inventing a mode the design doesn't show.
  const onRailKeyDown = (e) => {
    const i = tabs.findIndex(t => t.id === tab);
    let next = null;
    if (e.key === 'ArrowDown') next = tabs[Math.min(tabs.length - 1, i + 1)];
    else if (e.key === 'ArrowUp') next = tabs[Math.max(0, i - 1)];
    else if (e.key === 'Home') next = tabs[0];
    else if (e.key === 'End') next = tabs[tabs.length - 1];
    if (!next) return;
    e.preventDefault();
    setTab(next.id);
    railRefs.current[next.id]?.focus();
  };

  const signOut = async () => {
    const ok = await feedback.confirm({
      title: 'Sign out',
      message: `Sign out of ${user?.email || 'this account'}?`,
      confirmLabel: 'Sign out',
    });
    if (ok) { onClose?.(); onSignOut?.(); }
  };

  const showBack = stacked && detail;

  return createPortal(
    <div className="settings-bg" onMouseDown={onClose}>
      <div className="settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-head">
          {showBack && (
            <button type="button" className="settings-back"
                    onClick={() => setDetail(false)} aria-label="Back to settings">
              <Icon as={ChevronLeft} size={16} />
            </button>
          )}
          <span className="settings-title">{showBack ? current.label : 'Settings'}</span>
          <span style={{ flex: 1 }} />
          <SettingsSavedFlash saving={saving} savedAt={savedAt} />
          <button type="button" className="settings-x"
                  onClick={onClose} aria-label="Close">
            <Icon as={X} size={14} />
          </button>
        </div>
        <div className={`settings-body${stacked ? (detail ? ' is-detail' : ' is-list') : ''}`}>
          <nav className="settings-tabs" role="tablist" aria-label="Settings"
               aria-orientation="vertical" onKeyDown={onRailKeyDown}>
            {groups.map(g => (
              <div key={g.id} className="settings-tabs-group">
                <span className="settings-tabs-grouplabel" role="presentation">{g.label}</span>
                {tabs.filter(t => t.group === g.id).map(t => (
                  <button key={t.id}
                          type="button"
                          role="tab"
                          id={`settings-tab-${t.id}`}
                          aria-selected={tab === t.id}
                          aria-controls="settings-pane"
                          tabIndex={tab === t.id ? 0 : -1}
                          ref={(el) => { railRefs.current[t.id] = el; }}
                          className={`settings-tab ${tab === t.id ? 'is-active' : ''}`}
                          onClick={() => selectTab(t.id)}>
                    <span>{t.label}</span>
                    {/* Disclosure chevron is a list-screen affordance, so it is
                        rendered rather than CSS-hidden — Icon sets an inline
                        display:block that a stylesheet rule cannot outrank. */}
                    {stacked && <Icon as={ChevronRight} size={13} className="settings-tab-chev" />}
                  </button>
                ))}
              </div>
            ))}
            {onSignOut && (
              <div className="settings-tabs-foot">
                <button type="button" className="settings-tab settings-tab-signout"
                        onClick={signOut}>Sign out</button>
              </div>
            )}
          </nav>
          <div className="settings-pane" id="settings-pane" role="tabpanel"
               aria-labelledby={`settings-tab-${tab}`}>
            <SettingsSaveProvider value={save}>
              {tab === 'profile' && (
                <ProfileTab user={user} workspaceId={workspaceId} onSaved={onSaved} />
              )}
              {tab === 'appearance' && (
                <AppearanceTab mySettings={mySettings} refresh={refresh} />
              )}
              {tab === 'notifications' && (
                <NotificationsTab user={user} />
              )}
              {tab === 'connections' && (
                <ConnectionsTab user={user} />
              )}
              {tab === 'billing' && (
                <BillingTab user={user} />
              )}
              {tab === 'invite' && (
                <InviteTab user={user} />
              )}
              {tab === 'general' && (
                <WorkspaceGeneralTab workspaceId={workspaceId}
                                     workspaceName={workspaceName}
                                     user={user}
                                     role={role}
                                     workspaceSettings={workspaceSettings}
                                     refresh={refresh}
                                     onWorkspacesChanged={onWorkspacesChanged}
                                     onOpenRecovery={onOpenRecovery} />
              )}
              {tab === 'defaults' && (
                <CardDefaultsTab workspaceId={workspaceId}
                                 role={role}
                                 workspaceSettings={workspaceSettings}
                                 refresh={refresh} />
              )}
              {tab === 'docs' && (
                <DocsTab />
              )}
              {/* isAdmin is re-checked here, not just in the rail: a tier that
                  drops while the panel is open must not leave the pane rendering. */}
              {tab === 'capture' && isAdmin && (
                <Suspense fallback={null}><CaptureTab /></Suspense>
              )}
            </SettingsSaveProvider>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
