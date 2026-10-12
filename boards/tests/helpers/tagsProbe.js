// tagsProbe — mounts single components from the tags / feedback group in a
// real browser, for tests/tags-fixes.spec.js.
//
// Served by the Vite dev server by path (page.evaluate → import('/tests/…')),
// so Vite transforms it and the bare 'react' specifiers resolve — a
// page.evaluate string can't import them itself. Nothing in src/ imports this
// file, so it is in no chunk and ships nowhere.
import React from 'react';
import * as ReactDOM from 'react-dom/client';

import { FeedbackButton } from '../../src/components/FeedbackButton.jsx';
import { FeedbackProvider } from '../../src/components/AppFeedback.jsx';
import { SidebarTags } from '../../src/components/SidebarTags.jsx';
import { TagRangeHoverPopover } from '../../src/components/TagRangeHoverPopover.jsx';

function mountInto(el) {
  const host = document.createElement('div');
  host.className = 'tags-probe-host';
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);
  root.render(React.createElement(FeedbackProvider, null, el));
  return host;
}

export function mountFeedback() {
  mountInto(React.createElement(FeedbackButton, { as: 'floating' }));
}

// A long tag list in a sidebar column, so the bottom rows sit near the
// window's bottom edge (where an unclamped row menu used to run off-screen).
export function mountSidebarTags(count = 40) {
  const tags = Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `tag ${String(i).padStart(2, '0')}`,
    slug: `tag ${String(i).padStart(2, '0')}`,
    color: null, entity_type: null,
  }));
  mountInto(React.createElement('div',
    { style: { position: 'fixed', right: 0, top: 0, bottom: 0, width: 220, overflow: 'auto', zIndex: 5 } },
    React.createElement(SidebarTags, { workspaceId: 'ws-probe', userId: 'u-probe', tags })));
}

export function mountTagPopover() {
  mountInto(React.createElement(TagRangeHoverPopover, {
    anchor: { left: 40, top: 40, right: 60, bottom: 56, width: 20, height: 16 },
    tagId: '00000000-0000-4000-8000-000000000001',
    tagName: 'Probe',
    tagColor: '#7a8',
    source: 'user',
    workspaceId: 'ws-probe',
    sourceAnchor: { pHash: 'abc', startOffset: 0, length: 3 },
    onRemove: () => {},
    onClose: () => {},
  }));
}
