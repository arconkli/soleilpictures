// panelsProbe — mounts single panels from the visual sweep (Settings,
// Version history, Trash, Notifications) in a real browser, for
// tests/panels-visual.spec.js.
//
// Served by the Vite dev server by path (page.evaluate → import('/tests/…')),
// so Vite transforms it and the bare 'react' specifiers resolve. Nothing in
// src/ imports this file, so it is in no chunk and ships nowhere. Supabase
// reads go to the fake project the Playwright config forces; the spec answers
// the ones a panel needs with page.route.
import React, { useEffect, useState } from 'react';
import * as ReactDOM from 'react-dom/client';
import { I18nProvider } from '@lingui/react';
import { i18n } from '../../src/lib/i18n.js';

import { FeedbackProvider, useFeedback } from '../../src/components/AppFeedback.jsx';
import { SettingsPanel } from '../../src/components/SettingsPanel.jsx';
import { VersionHistoryModal } from '../../src/components/VersionHistoryModal.jsx';
import { TrashModal } from '../../src/components/TrashModal.jsx';
import { NotificationsPanel } from '../../src/components/NotificationsPanel.jsx';
import { ShareModal } from '../../src/components/ShareModal.jsx';
import { WorkspacePresenceStack } from '../../src/components/WorkspacePresenceStack.jsx';

const h = React.createElement;

// Lets the spec raise a toast through the same provider the panel uses.
function ToastHook() {
  const feedback = useFeedback();
  useEffect(() => {
    window.__probeToast = (message) => feedback.toast({ type: 'info', message, action: { label: 'Undo', onClick: () => {} }, ttl: 60000 });
    return () => { delete window.__probeToast; };
  }, [feedback]);
  return null;
}

function mountInto(el, hostStyle = null) {
  const host = document.createElement('div');
  host.className = 'panels-probe-host';
  if (hostStyle) Object.assign(host.style, hostStyle);
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);
  root.render(h(I18nProvider, { i18n }, h(FeedbackProvider, null, h(ToastHook), el)));
  return host;
}

// Settings behind a trigger button, so focus restore on close is checkable.
function SettingsHarness({ initialTab, role }) {
  const [open, setOpen] = useState(false);
  return h(React.Fragment, null,
    h('button', { type: 'button', className: 'probe-settings-trigger', onClick: () => setOpen(true),
      style: { position: 'fixed', left: 8, bottom: 8, zIndex: 10 } }, 'Open settings'),
    h(SettingsPanel, {
      open, onClose: () => setOpen(false),
      user: { id: '00000000-0000-4000-8000-000000000001', email: 'probe@example.com', user_metadata: {} },
      workspaceId: 'ws-probe', workspaceName: 'Probe studio',
      role, refresh: () => {}, workspaceSettings: {}, mySettings: {},
      initialTab,
    }));
}

export function mountSettings(initialTab = 'profile', role = 'owner') {
  mountInto(h(SettingsHarness, { initialTab, role }));
}

export function mountVersionHistory() {
  mountInto(h(VersionHistoryModal, {
    open: true, boardId: 'b-probe', boardName: 'Reference wall',
    onClose: () => {}, canEdit: true,
  }));
}

export function mountTrash() {
  mountInto(h(TrashModal, { open: true, workspaceId: 'ws-probe', onClose: () => {} }));
}

// onlinePeerName: also list an editor who is online (live presence) under
// that display name.
export function mountShare({ onlinePeerName } = {}) {
  const self = '00000000-0000-4000-8000-000000000001';
  const peer = '00000000-0000-4000-8000-000000000002';
  mountInto(h(ShareModal, {
    board: { id: 'b-probe', name: 'Reference wall', workspace_id: 'ws-probe' },
    workspace: { id: 'ws-probe', name: 'Probe studio', created_by: self },
    workspaceMembers: [{ user_id: self, role: 'owner' },
      ...(onlinePeerName ? [{ user_id: peer, role: 'editor' }] : [])],
    wsPeers: onlinePeerName ? [{ user: { id: peer, name: onlinePeerName } }] : [],
    selfUserId: self, canManage: true, myWorkspaceRole: 'owner',
    onClose: () => {},
  }));
}

// One person online, in a corner above the local shell. A jump is counted on
// window.__probeJumped.
export function mountPresence() {
  mountInto(h(WorkspacePresenceStack, {
    peers: [{ key: 'peer-1', tabId: 't1',
      user: { id: '00000000-0000-4000-8000-000000000002', name: 'Maya Okafor', color: '#4f8df8' },
      location: { boardId: 'b-probe', boardName: 'Reference wall', surface: 'canvas' } }],
    status: 'connected', selfId: '00000000-0000-4000-8000-000000000001',
    workspaceId: 'ws-probe', max: 1,
    onJumpTo: () => { window.__probeJumped = (window.__probeJumped || 0) + 1; },
  }), { position: 'fixed', top: '120px', left: '24px', zIndex: '50' });
}

// `mobileShell`: what App passes on a phone, where the list is a sheet.
export function mountNotifications({ mobileShell = false } = {}) {
  const now = new Date().toISOString();
  return mountInto(h(NotificationsPanel, {
    items: [
      { id: 'n1', kind: 'file.shared', title: 'Maya shared a file with you', body: 'Lookbook.pdf', created_at: now, read_at: null },
    ],
    unread: 1, loading: false, onClose: () => {}, mobileShell,
  }));
}
