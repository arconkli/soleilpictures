// shareWorkspaceProbe — mounts the workspace switcher menu and the Share panel
// with fixtures, for tests/share-workspace-menu.spec.js.
//
// Why a probe: local QA mode (?local=1) renders its own simplified sidebar with
// no workspace switcher, so the real menu is unreachable there. Lives in src/
// for the same reason as the Surface Gallery render probe — Vite only rewrites bare module
// specifiers in files it transforms. Imported by NOTHING in the app; the spec
// reaches it over the dev server by path, so it is in no chunk and ships
// nowhere.
import React from 'react';
import * as ReactDOM from 'react-dom/client';

import { WorkspaceMenu } from '../components/WorkspaceMenu.jsx';
import { ShareModal } from '../components/ShareModal.jsx';
import { FeedbackProvider } from '../components/AppFeedback.jsx';

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
  ReactDOM.createRoot(host()).render(React.createElement(WorkspaceMenu, {
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
  ReactDOM.createRoot(host()).render(React.createElement(FeedbackProvider, null,
    React.createElement(ShareModal, { onClose: () => {}, ...props })));
  return true;
}
