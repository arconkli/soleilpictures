// Settings panel — tabbed home for everything user/workspace-scoped.
// Workspace defaults are editable by editors AND owners, read-only for
// viewers. Per-user defaults are always editable (it's your account).
// Settings persist via the merge_*_settings RPCs which do atomic
// jsonb || patch so two clients can save different keys at once.
//
// This file is the SHELL only — portal, header, tab rail, pane. Each tab's
// body lives in components/settings/. Keep the file at this path: the docs
// surface gate reads TABS straight out of it (scripts/lib/publicSurface.mjs).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from '../lib/icons.js';
import { Icon } from './Icon.jsx';
import { useFeedback } from './AppFeedback.jsx';
import { ProfileTab } from './settings/ProfileTab.jsx';
import { ScoutTab, ApiTab } from './settings/ConnectionsTab.jsx';
import { InviteTab } from './settings/InviteTab.jsx';
import { BillingTab } from './settings/BillingTab.jsx';
import { NotificationsTab } from './settings/NotificationsTab.jsx';
import { DefaultsTab } from './settings/WorkspaceTab.jsx';
import { ThemeTab, DisplayTab } from './settings/AppearanceTab.jsx';

const TABS = [
  { id: 'profile',       label: 'Profile' },
  { id: 'scout',         label: 'Scout' },
  { id: 'api',           label: 'API' },
  { id: 'invite',        label: 'Invite & earn' },
  { id: 'billing',       label: 'Billing' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'defaults',      label: 'Defaults' },
  { id: 'theme',         label: 'Theme' },
  { id: 'display',       label: 'Display' },
];

export function SettingsPanel({
  open, onClose,
  user, onSignOut,
  workspaceId, workspaceName, onWorkspacesChanged,
  onSaved,
  // 'account' = avatar-style identity modal (Profile / Billing / Notifications + sign out).
  // 'workspace' = the cog-style settings (Defaults / Theme / Display).
  // 'full' = legacy / dev — show every tab in one panel.
  mode = 'full',
  // Settings hook output — passed in so the panel and the rest of the
  // app share one source of truth and refresh together.
  defaults, role, refresh, workspaceSettings, mySettings,
  // Opens the WorkspaceRecoveryModal (catastrophic rewind). Wired into
  // the Defaults tab as a low-key entry for owners. Primary entry point
  // for recovery is the top-of-app alert banner that fires automatically
  // when a mass-delete is detected; this is the manual fallback.
  onOpenRecovery,
  initialTab = null,
}) {
  // Filter tabs by mode + pick the first as default.
  //   account   = personal identity stuff (Profile + Billing + Notifications)
  //   workspace = cog-style settings (Defaults/Theme/Display)
  //   full      = every tab
  // Scout is personal identity (which phone is bound to WHICH account), not a
  // workspace setting — so it lives with Profile/Billing, not with
  // Defaults/Theme/Display.
  const ACCOUNT_TABS = new Set(['profile', 'scout', 'api', 'invite', 'billing', 'notifications']);
  const visibleTabs = mode === 'account'
    ? TABS.filter(t => ACCOUNT_TABS.has(t.id))
    : mode === 'workspace'
      ? TABS.filter(t => !ACCOUNT_TABS.has(t.id))
      : TABS;
  const [tab, setTab] = useState(visibleTabs[0]?.id || 'profile');
  // If the user reopens the panel in a different mode, the previously
  // selected tab can be invalid — snap back to the first visible.
  useEffect(() => {
    if (!visibleTabs.find(t => t.id === tab)) setTab(visibleTabs[0]?.id || 'profile');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  // Deep-link: when opened with an initialTab (e.g. returning from the Stripe
  // portal straight to Billing), select it. The panel persists `tab` across
  // open/close, so only force the tab while `open` is true.
  useEffect(() => {
    if (open && initialTab && visibleTabs.find(t => t.id === initialTab)) setTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTab]);
  const feedback = useFeedback();

  if (!open) return null;

  // Show tab rail whenever there's more than one tab to switch between.
  const showTabRail = visibleTabs.length > 1;
  const headTitle = mode === 'account' ? 'Account' : 'Settings';

  return createPortal(
    <div className={`settings-bg ${mode === 'account' ? 'is-account-mode' : ''}`}
         onMouseDown={onClose}>
      <div className={`settings-modal ${mode === 'account' ? 'settings-modal-narrow' : ''}`}
           onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <span className="settings-title">{headTitle}</span>
          <span style={{ flex: 1 }} />
          {onSignOut && mode === 'account' && (
            <button type="button" className="settings-link-btn settings-head-signout"
                    onClick={async () => {
                      const ok = await feedback.confirm({
                        title: 'Sign out',
                        message: `Sign out of ${user?.email || 'this account'}?`,
                        confirmLabel: 'Sign out',
                      });
                      if (ok) { onClose?.(); onSignOut?.(); }
                    }}>Sign out</button>
          )}
          <button type="button" className="settings-x"
                  onClick={onClose} aria-label="Close">
            <Icon as={X} size={14} />
          </button>
        </div>
        <div className="settings-body">
          {showTabRail && (
            <nav className="settings-tabs" role="tablist">
              {visibleTabs.map(t => (
                <button key={t.id}
                        type="button"
                        role="tab"
                        className={`settings-tab ${tab === t.id ? 'is-active' : ''}`}
                        onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </nav>
          )}
          <div className="settings-pane">
            {tab === 'profile' && (
              <ProfileTab user={user} workspaceId={workspaceId} onSaved={onSaved} />
            )}
            {tab === 'scout' && (
              <ScoutTab user={user} />
            )}
            {tab === 'api' && (
              <ApiTab user={user} />
            )}
            {tab === 'invite' && (
              <InviteTab user={user} />
            )}
            {tab === 'billing' && (
              <BillingTab user={user} />
            )}
            {tab === 'notifications' && (
              <NotificationsTab user={user} />
            )}
            {tab === 'defaults' && (
              <DefaultsTab workspaceId={workspaceId}
                           workspaceName={workspaceName}
                           user={user}
                           role={role}
                           workspaceSettings={workspaceSettings}
                           refresh={refresh}
                           onWorkspacesChanged={onWorkspacesChanged}
                           onOpenRecovery={onOpenRecovery} />
            )}
            {tab === 'theme' && (
              <ThemeTab mySettings={mySettings} refresh={refresh} />
            )}
            {tab === 'display' && (
              <DisplayTab mySettings={mySettings} refresh={refresh} />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
