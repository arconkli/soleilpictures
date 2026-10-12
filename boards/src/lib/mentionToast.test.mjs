// COMMS-14: every @mention produced two toasts — the inbox ping's "Sam
// mentioned you" with Open, and a second "You were mentioned in a direct
// message. Open Messages to see it." that was wrong for groups, had no
// action, and fired even with that thread open. Live mentions now leave the
// toast to the inbox ping; only mentions from while you were away get one,
// and it opens the thread.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('a mention that arrives live is marked live', () => {
  const src = read('../hooks/useMentionNotifications.js');
  assert.match(src, /\[\.\.\.arr, \{ \.\.\.row, live: true \}\]/);
});

test('App toasts only away-time mentions, never the open thread, with an Open action', () => {
  const app = read('../App.jsx');
  assert.doesNotMatch(app, /You were mentioned in \$\{where\}\. Open Messages to see it\./);
  assert.match(app, /if \(n\.live \|\| isWatchingConversation\(n\.conversation_id\)\) continue;/);
  assert.match(app, /label: 'Open', onClick: \(\) => openConversationFromToast\(n\.conversation_id\)/);
});
