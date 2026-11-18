// feedbackProbe — mounts the feedback button in a real browser, for
// tests/feedback-fixes.spec.js.
//
// Served by the Vite dev server by path (page.evaluate → import('/tests/…')),
// so Vite transforms it and the bare 'react' specifiers resolve — a
// page.evaluate string can't import them itself. Nothing in src/ imports this
// file, so it is in no chunk and ships nowhere.
import React from 'react';
import * as ReactDOM from 'react-dom/client';
import { I18nProvider } from '@lingui/react';
import { i18n } from '../../src/lib/i18n.js';

import { FeedbackButton } from '../../src/components/FeedbackButton.jsx';
import { FeedbackProvider } from '../../src/components/AppFeedback.jsx';

function mountInto(el) {
  const host = document.createElement('div');
  host.className = 'feedback-probe-host';
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);
  root.render(React.createElement(I18nProvider, { i18n }, React.createElement(FeedbackProvider, null, el)));
  return host;
}

export function mountFeedback() {
  mountInto(React.createElement(FeedbackButton, { as: 'floating' }));
}
