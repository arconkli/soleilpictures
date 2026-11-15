// shareWorkspaceProbe — mounts the workspace switcher menu, the Share panel
// and Settings › Members with fixtures, for tests/share-workspace-menu.spec.js
// and tests/editor-limit.spec.js.
//
// Why a probe: local QA mode (?local=1) renders its own simplified sidebar with
// no workspace switcher, so the real menu is unreachable there. Lives in src/
// for the same reason as the Surface Gallery render probe — Vite only rewrites bare module
// specifiers in files it transforms. Imported by NOTHING in the app; the spec
// reaches it over the dev server by path, so it is in no chunk and ships
// nowhere.
import React from 'react';
import * as ReactDOM from 'react-dom/client';
import { I18nProvider } from '@lingui/react';
import { i18n } from '../lib/i18n.js';

import { WorkspaceMenu } from '../components/WorkspaceMenu.jsx';
import { ShareModal } from '../components/ShareModal.jsx';
import { MembersTab } from '../components/settings/MembersTab.jsx';
import { FeedbackProvider } from '../components/AppFeedback.jsx';

// The app's provider (main.jsx) is not here, so the wrapped components get one.
const mountIn = (el, tree) => ReactDOM.createRoot(el).render(React.createElement(I18nProvider, { i18n }, tree));

const host = () => {
  const el = document.createElement('div');
  el.className = 'share-probe-host';
  document.body.appendChild(el);
  return el;
};

// Records what the menu asked the app to do on window.__shareProbe.
export function mountWorkspaceMenu(props) {
  const calls = { share: [], settings: [], remove: [], close: 0 };
  window.__shareProbe = calls;
  mountIn(host(), React.createElement(WorkspaceMenu, {
    triggerSelector: null,
    onSelect: () => {},
    onAddNew: () => {},
    onShare: (ws) => calls.share.push(ws.id),
    onOpenSettings: (ws) => calls.settings.push(ws.id),
    onRemove: (ws, action) => calls.remove.push([ws.id, action]),
    onClose: () => { calls.close += 1; },
    ...props,
  }));
  return true;
}

export function mountShareModal(props) {
  mountIn(host(), React.createElement(FeedbackProvider, null,
    React.createElement(ShareModal, { onClose: () => {}, ...props })));
  return true;
}

// Settings is a layer over the app, so the tab gets one: under it the local-QA
// canvas takes the pointer and a hover never reaches a row. Below the
// confirm and the toasts, which portal to <body> on the top tier.
export function mountMembersTab(props) {
  mountIn(host(), React.createElement(FeedbackProvider, null,
    React.createElement('div', { style: { position: 'fixed', inset: 0, zIndex: 9999, overflow: 'auto', background: 'var(--bg-0)' } },
      React.createElement('div', { style: { width: 680, padding: 16 } },
        React.createElement(MembersTab, props)))));
  return true;
}
