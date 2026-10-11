// COMMS-01: clicking a person's avatar or "Message" opens the DM, even when
// the app re-renders while find_or_create_dm is in flight (opening the panel
// always triggers one). Pinned at the source: the effect must not restart on
// the parent's inline callbacks, and a cancelled run must not consume the
// pending peer out from under the run that replaced it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the avatar-click DM effect is keyed on the peer and workspace only', () => {
  const src = read('../components/MessagesPanel.jsx');
  assert.match(src, /\}, \[pendingOpenPeerId, workspaceId\]\);/);
  assert.doesNotMatch(src, /\[pendingOpenPeerId, workspaceId, onPeerConsumed, onRefreshRequested\]/);
  assert.doesNotMatch(src, /finally \{ onPeerConsumed\?\.\(\); \}/, 'a cancelled run must not consume the peer');
});
