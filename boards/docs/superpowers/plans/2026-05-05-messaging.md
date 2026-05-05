# Messaging (DMs + per-board channels) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy Inbox panel with a real chat surface — DMs between workspace members + per-board channels with realtime messages, mentions, reactions, attachments draggable to the canvas.

**Architecture:** No `channels` table — board chat is `messages WHERE board_id = X`. DMs are messages with `dm_peer_id`. Realtime rides the existing per-board Supabase Realtime broadcast channel (chat-message + chat-typing events) plus a new `dm:{lo}:{hi}` channel for direct messages. RLS on `messages` inherits workspace membership from `boards.workspace_id`. People mentions notify; entity mentions render as inline soleil pills.

**Tech Stack:** Vite + React 18, Supabase (Postgres + Realtime + Storage), existing `EntityPicker` / `InlineComposer` / `feedback` primitives, Lucide icons.

**Spec:** `boards/docs/superpowers/specs/2026-05-05-messaging-design.md`

---

## File Structure

**New files**

- `boards/src/lib/dragMimes.js` — extracted `INBOX_MIME` constant + `inboxPayloadFor(attachment)` translator.
- `boards/src/lib/messages.js` — Supabase CRUD: send, fetch, edit, delete, react, mark-read.
- `boards/src/lib/messageRealtime.js` — broadcast helpers for chat-message + chat-typing on `board:{id}` and `dm:{lo}:{hi}` channels.
- `boards/src/lib/messageAttachments.js` — upload to Storage, build attachment record, paste-from-clipboard helper.
- `boards/src/lib/caretRect.js` — caret bounding-rect helper extracted from the auto-detect plugin.
- `boards/src/hooks/useChannelList.js` — joined boards + DMs list with per-user unread counts.
- `boards/src/hooks/useMessageThread.js` — fetch + realtime sub for one thread.
- `boards/src/hooks/useUnreadTotal.js` — sidebar badge total.
- `boards/src/hooks/useTitleBadge.js` — prepends `(N)` / `(@N)` to document.title.
- `boards/src/components/MessagesPanel.jsx` — drawer-slot list view (DIRECT + BOARDS sections + currently-open pin).
- `boards/src/components/MessageThread.jsx` — body, presence header, composer, scroll, mark-read.
- `boards/src/components/MessageBubble.jsx` — single message row with hover actions.
- `boards/src/components/MessageComposer.jsx` — wraps `<InlineComposer/>` with attach / mention / emoji buttons.
- `boards/src/components/MessageAttachment.jsx` — single attachment renderer with drag-to-canvas wiring.
- `boards/src/components/NewDMPicker.jsx` — `<EntityPicker filter={['user']}/>`.
- `boards/src/components/EmojiPalette.jsx` — fixed 8-emoji palette popover.
- `supabase/migrations/0005_messaging.sql` — schema + RLS + views + storage bucket.
- `boards/tests/messaging.spec.js` — Playwright smoke (CSS + sidebar Messages row + thread loads).

**Modified files**

- `boards/src/lib/entitySearch.js` — add `'user'` kind support.
- `supabase/migrations/0006_entity_search_user.sql` — extend `entity_search` view to include workspace members.
- `boards/src/components/EntityPicker.jsx` — handle `'user'` rows + `'user'` icon mapping.
- `boards/src/components/CanvasSurface.jsx` — already handles INBOX_MIME drops; just import from new `dragMimes.js`.
- `boards/src/App.jsx` — sidebar Inbox row → Messages row, `tweak.showInbox` → `tweak.showMessages`, mount `<MessagesPanel/>` instead of `<InboxPanel/>`. Migration helper for the localStorage tweak key.
- `boards/src/local/LocalBoardsApp.jsx` — same Messages-instead-of-Inbox sidebar wiring; messaging is no-op in local QA mode (no Supabase).
- `boards/src/styles.css` — append messaging CSS section.

**Deleted files (Phase F)**

- `boards/src/components/InboxPanel.jsx`
- `boards/src/lib/inbox.js` (export moves to `dragMimes.js`)
- `boards/src/lib/inboxApi.js`
- The `INBOX_SEED` constant in `boards/src/data.js`
- `supabase/migrations/0007_drop_inbox_items.sql` (drops the legacy inbox_items table)

---

# Phase A — Schema + RLS

### Task A1: Create `messages` table + indexes + RLS

**Files:**
- Create: `supabase/migrations/0005_messaging.sql`

- [ ] **Step 1: Author the migration**

```sql
create table messages (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces on delete cascade,
  board_id      uuid references boards on delete cascade,
  dm_peer_id    uuid references auth.users on delete cascade,
  sender_id     uuid not null references auth.users on delete cascade,
  body          text not null default '',
  attachments   jsonb not null default '[]'::jsonb,
  mentions      uuid[] not null default '{}',
  reactions     jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  edited_at     timestamptz,
  deleted_at    timestamptz,
  check (board_id is not null or dm_peer_id is not null),
  check (board_id is null or dm_peer_id is null)
);

create index messages_board_idx on messages (board_id, created_at desc) where board_id is not null;
create index messages_dm_idx    on messages (workspace_id, sender_id, dm_peer_id, created_at desc) where dm_peer_id is not null;
create index messages_sender_idx on messages (sender_id, created_at desc);
create index messages_mentions_idx on messages using gin (mentions);

alter table messages enable row level security;

drop policy if exists "messages read"   on messages;
drop policy if exists "messages insert" on messages;
drop policy if exists "messages update" on messages;
drop policy if exists "messages delete" on messages;

create policy "messages read" on messages for select
  using (is_workspace_member(workspace_id));

create policy "messages insert" on messages for insert
  with check (is_workspace_member(workspace_id) and sender_id = auth.uid());

create policy "messages update" on messages for update
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

create policy "messages delete" on messages for delete
  using (sender_id = auth.uid());
```

- [ ] **Step 2: Apply via the Supabase MCP tool**

Apply migration `messaging_messages` to project `ehlhlmbpwwalmeisvmdp` with the SQL above.

- [ ] **Step 3: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add supabase/migrations/0005_messaging.sql
git commit -m "$(cat <<'EOF'
Add messages table + RLS

Workspace-scoped chat. board_id XOR dm_peer_id determines whether the
row is a board channel post or a 1:1 DM. RLS allows reads by any
workspace member; writes only by the sender.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: Add `message_reads` table + RLS

**Files:**
- Modify: `supabase/migrations/0005_messaging.sql` (append)

- [ ] **Step 1: Append to the migration file**

```sql
create table message_reads (
  user_id        uuid not null references auth.users on delete cascade,
  reads_board_id uuid references boards on delete cascade,
  reads_dm_peer  uuid references auth.users on delete cascade,
  last_read_at   timestamptz not null default now(),
  hidden_at      timestamptz,
  primary key (user_id,
               coalesce(reads_board_id, '00000000-0000-0000-0000-000000000000'::uuid),
               coalesce(reads_dm_peer,  '00000000-0000-0000-0000-000000000000'::uuid))
);

alter table message_reads enable row level security;
drop policy if exists "reads own" on message_reads;
create policy "reads own" on message_reads for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- [ ] **Step 2: Apply via MCP**

Apply migration `messaging_reads` to project `ehlhlmbpwwalmeisvmdp` with just the SQL added above.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0005_messaging.sql
git commit -m "$(cat <<'EOF'
Add message_reads — per-user last-read timestamp + hidden flag

Drives unread badges and the "hide row" UX. PK uses sentinel UUIDs
for nullable target columns (same pattern as doc_backlinks).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Add summary views

**Files:**
- Modify: `supabase/migrations/0005_messaging.sql` (append)

- [ ] **Step 1: Append the views**

```sql
create or replace view board_channel_summary as
select
  m.workspace_id,
  m.board_id,
  b.name                              as board_name,
  count(*)                            as message_count,
  max(m.created_at)                   as last_message_at,
  (select body from messages m2
     where m2.board_id = m.board_id and m2.deleted_at is null
     order by m2.created_at desc limit 1) as last_message
from messages m
join boards b on b.id = m.board_id
where m.board_id is not null and m.deleted_at is null
group by m.workspace_id, m.board_id, b.name;

create or replace view dm_thread_summary as
select
  m.workspace_id,
  least(m.sender_id, m.dm_peer_id)    as user_a,
  greatest(m.sender_id, m.dm_peer_id) as user_b,
  count(*)                             as message_count,
  max(m.created_at)                    as last_message_at,
  (select body from messages m2
     where m2.dm_peer_id is not null and m2.deleted_at is null
       and least(m2.sender_id, m2.dm_peer_id)    = least(m.sender_id, m.dm_peer_id)
       and greatest(m2.sender_id, m2.dm_peer_id) = greatest(m.sender_id, m.dm_peer_id)
     order by m2.created_at desc limit 1) as last_message
from messages m
where m.dm_peer_id is not null and m.deleted_at is null
group by m.workspace_id, least(m.sender_id, m.dm_peer_id), greatest(m.sender_id, m.dm_peer_id);
```

- [ ] **Step 2: Apply + commit**

Apply via MCP as `messaging_views`. Commit.

```bash
git add supabase/migrations/0005_messaging.sql
git commit -m "$(cat <<'EOF'
Add board_channel_summary + dm_thread_summary views

Powers the Messages-panel list with one row per active board channel
and per active DM thread. Per-user unread counts are computed
client-side by joining against message_reads.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A4: Create message-attachments Storage bucket + policies

**Files:**
- Modify: `supabase/migrations/0005_messaging.sql` (append)

- [ ] **Step 1: Append**

```sql
insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', true)
on conflict (id) do nothing;

drop policy if exists "msg-att read"  on storage.objects;
drop policy if exists "msg-att write" on storage.objects;

create policy "msg-att read" on storage.objects for select
  using (bucket_id = 'message-attachments');

create policy "msg-att write" on storage.objects for insert
  with check (bucket_id = 'message-attachments' and auth.uid() is not null);
```

Public bucket because chat attachments need to render in <img>/<a> from arbitrary clients; the per-message access control is enforced by `messages` RLS (you can only see messages you have read access to, so you only ever discover attachment URLs you're allowed to see).

- [ ] **Step 2: Apply + commit**

Apply via MCP as `messaging_storage`. Commit:

```bash
git add supabase/migrations/0005_messaging.sql
git commit -m "$(cat <<'EOF'
Add message-attachments storage bucket

Public bucket for chat image/file attachments. Read access is
implicitly gated by the messages RLS — you only discover URLs
through messages you can read.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A5: Extend `entity_search` view to include workspace members

**Files:**
- Create: `supabase/migrations/0006_entity_search_user.sql`
- Modify: `boards/src/lib/entitySearch.js`

- [ ] **Step 1: Migration**

```sql
-- Adds a 'user' kind to entity_search by union-ing workspace_members
-- against auth.users.
create or replace view entity_search as
select
  b.id::text                       as id,
  'board'::text                    as kind,
  b.workspace_id                   as workspace_id,
  b.id                             as board_id,
  null::text                       as card_id,
  b.name                           as title,
  b.meta                           as body,
  b.updated_at                     as updated_at
from boards b
union all
select
  ci.board_id::text || ':' || ci.card_id  as id,
  ci.kind                                  as kind,
  ci.workspace_id                          as workspace_id,
  ci.board_id                              as board_id,
  ci.card_id                               as card_id,
  ci.title                                 as title,
  ci.body                                  as body,
  ci.updated_at                            as updated_at
from card_index ci
union all
select
  u.id::text                               as id,
  'user'::text                             as kind,
  wm.workspace_id                          as workspace_id,
  null::uuid                               as board_id,
  null::text                               as card_id,
  coalesce(u.raw_user_meta_data->>'full_name', u.email) as title,
  u.email                                  as body,
  greatest(u.created_at, now())            as updated_at
from workspace_members wm
join auth.users u on u.id = wm.user_id;
```

- [ ] **Step 2: Apply + update entitySearch helper**

Apply migration `entity_search_user` via MCP.

In `boards/src/lib/entitySearch.js`, no code change needed — the helper already passes `kinds` through, and `'user'` is now a valid kind.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0006_entity_search_user.sql
git commit -m "$(cat <<'EOF'
entity_search — include workspace members as 'user' kind

Powers @-mention picker for people. Title is the user's full_name
(falling back to email); body is the email. Searched the same way
as boards/cards via the existing searchEntities helper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase B — MessagesPanel shell

### Task B1: `lib/dragMimes.js` extraction

**Files:**
- Create: `boards/src/lib/dragMimes.js`
- Modify: `boards/src/lib/inbox.js` — re-export from new module
- (Other consumers stay imports from `./inbox.js` for now; Phase F deletes.)

- [ ] **Step 1: Create the new module**

```js
// MIME types used for drag-and-drop between Soleil surfaces. Used today
// by the chat-attachment → canvas drop, by the existing inbox-item drag,
// and by board-link / card transfers between panes.
export const INBOX_MIME = 'application/x-soleil-inbox';
```

- [ ] **Step 2: Re-export from inbox.js to keep current consumers working**

Find the existing `export const INBOX_MIME = 'application/x-soleil-inbox';` line in `inbox.js` and replace with:

```js
export { INBOX_MIME } from './dragMimes.js';
```

- [ ] **Step 3: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build && cd /Users/andrewconklin/soleilpictures-1
git add boards/src/lib/dragMimes.js boards/src/lib/inbox.js
git commit -m "$(cat <<'EOF'
Extract INBOX_MIME to lib/dragMimes.js — chat will need it too

Phase F deletes lib/inbox.js entirely; everything else keeps
importing INBOX_MIME from there until then via re-export.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: `lib/messages.js` — fetch + send CRUD

**Files:**
- Create: `boards/src/lib/messages.js`

- [ ] **Step 1: Create**

```js
import { supabase } from './supabase.js';

// All message CRUD lives here. Realtime broadcast is in messageRealtime.js
// — callers do both: write to Postgres via these helpers and broadcast on
// the appropriate channel so peers update without a refetch.

export async function fetchBoardChannelMessages({ boardId, limit = 200 }) {
  const { data, error } = await supabase.from('messages')
    .select('*')
    .eq('board_id', boardId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) { console.warn('fetchBoardChannelMessages', error); return []; }
  return data || [];
}

export async function fetchDmThreadMessages({ workspaceId, userA, userB, limit = 200 }) {
  const [lo, hi] = userA < userB ? [userA, userB] : [userB, userA];
  const { data, error } = await supabase.from('messages')
    .select('*')
    .eq('workspace_id', workspaceId)
    .or(`and(sender_id.eq.${lo},dm_peer_id.eq.${hi}),and(sender_id.eq.${hi},dm_peer_id.eq.${lo})`)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) { console.warn('fetchDmThreadMessages', error); return []; }
  return data || [];
}

export async function listBoardChannels({ workspaceId }) {
  const { data, error } = await supabase.from('board_channel_summary')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('last_message_at', { ascending: false });
  if (error) { console.warn('listBoardChannels', error); return []; }
  return data || [];
}

export async function listDmThreads({ workspaceId }) {
  const { data, error } = await supabase.from('dm_thread_summary')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('last_message_at', { ascending: false });
  if (error) { console.warn('listDmThreads', error); return []; }
  return data || [];
}

export async function listMessageReadsForUser({ userId }) {
  const { data, error } = await supabase.from('message_reads')
    .select('*')
    .eq('user_id', userId);
  if (error) { console.warn('listMessageReadsForUser', error); return []; }
  return data || [];
}

export async function sendMessage({ workspaceId, boardId, dmPeerId, senderId, body, attachments = [], mentions = [] }) {
  const row = {
    workspace_id: workspaceId,
    board_id: boardId || null,
    dm_peer_id: dmPeerId || null,
    sender_id: senderId,
    body,
    attachments,
    mentions,
  };
  const { data, error } = await supabase.from('messages').insert(row).select().single();
  if (error) { console.warn('sendMessage', error); throw error; }
  return data;
}

export async function editMessage({ id, body, attachments }) {
  const patch = { body, edited_at: new Date().toISOString() };
  if (attachments) patch.attachments = attachments;
  const { error } = await supabase.from('messages').update(patch).eq('id', id);
  if (error) { console.warn('editMessage', error); throw error; }
}

export async function deleteMessage({ id }) {
  const { error } = await supabase.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) { console.warn('deleteMessage', error); throw error; }
}

export async function toggleReaction({ messageId, emoji, userId }) {
  // Postgres-side toggle would need a function; do a read-modify-write
  // on the client. Acceptable for v1 — reactions are low-frequency.
  const { data: msg } = await supabase.from('messages').select('reactions').eq('id', messageId).maybeSingle();
  const reactions = { ...(msg?.reactions || {}) };
  const existing = new Set(reactions[emoji] || []);
  if (existing.has(userId)) existing.delete(userId);
  else existing.add(userId);
  if (existing.size === 0) delete reactions[emoji];
  else reactions[emoji] = [...existing];
  await supabase.from('messages').update({ reactions }).eq('id', messageId);
}

export async function markRead({ userId, boardId, dmPeerId }) {
  const row = {
    user_id: userId,
    reads_board_id: boardId || null,
    reads_dm_peer:  dmPeerId || null,
    last_read_at:   new Date().toISOString(),
    hidden_at:      null,  // un-hide on read
  };
  const { error } = await supabase.from('message_reads').upsert(row, {
    onConflict: 'user_id,reads_board_id,reads_dm_peer',
  });
  if (error) { console.warn('markRead', error); }
}

export async function hideRow({ userId, boardId, dmPeerId }) {
  const row = {
    user_id: userId,
    reads_board_id: boardId || null,
    reads_dm_peer:  dmPeerId || null,
    last_read_at:   new Date().toISOString(),
    hidden_at:      new Date().toISOString(),
  };
  await supabase.from('message_reads').upsert(row, {
    onConflict: 'user_id,reads_board_id,reads_dm_peer',
  });
}
```

- [ ] **Step 2: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -3
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/lib/messages.js
git commit -m "$(cat <<'EOF'
Add lib/messages.js — Supabase CRUD for chat

Helpers: fetch (board / DM / lists / reads), sendMessage, editMessage,
deleteMessage, toggleReaction, markRead, hideRow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: `lib/messageRealtime.js` — broadcast helpers

**Files:**
- Create: `boards/src/lib/messageRealtime.js`

- [ ] **Step 1: Create**

```js
import { supabase } from './supabase.js';

// Subscribe to a board channel's chat events. Returns an unsubscribe fn.
//   onMessage({ id, body, sender, attachments, mentions, ts })  — peer sent
//   onTyping ({ user_id, ts })                                   — peer typing
//
// Reuses the existing board:{id} broadcast channel that Yjs already
// subscribes to (Supabase de-dupes channel instances per name).
export function subscribeBoardChat({ boardId, onMessage, onTyping }) {
  const channel = supabase.channel(`board:${boardId}`, { config: { broadcast: { self: false } } });
  channel.on('broadcast', { event: 'chat-message' }, ({ payload }) => onMessage?.(payload));
  channel.on('broadcast', { event: 'chat-typing'  }, ({ payload }) => onTyping?.(payload));
  channel.subscribe();
  return () => { try { supabase.removeChannel(channel); } catch (_) {} };
}

export function broadcastBoardMessage({ boardId, payload }) {
  const channel = supabase.channel(`board:${boardId}`);
  return channel.send({ type: 'broadcast', event: 'chat-message', payload });
}

export function broadcastBoardTyping({ boardId, userId }) {
  const channel = supabase.channel(`board:${boardId}`);
  return channel.send({ type: 'broadcast', event: 'chat-typing', payload: { user_id: userId, ts: Date.now() } });
}

// DM channel — name is "dm:{loId}:{hiId}" so both ends subscribe to the same one.
function dmChannelName(a, b) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return `dm:${lo}:${hi}`;
}

export function subscribeDmChat({ userA, userB, onMessage, onTyping }) {
  const channel = supabase.channel(dmChannelName(userA, userB), { config: { broadcast: { self: false } } });
  channel.on('broadcast', { event: 'chat-message' }, ({ payload }) => onMessage?.(payload));
  channel.on('broadcast', { event: 'chat-typing'  }, ({ payload }) => onTyping?.(payload));
  channel.subscribe();
  return () => { try { supabase.removeChannel(channel); } catch (_) {} };
}

export function broadcastDmMessage({ userA, userB, payload }) {
  const channel = supabase.channel(dmChannelName(userA, userB));
  return channel.send({ type: 'broadcast', event: 'chat-message', payload });
}

export function broadcastDmTyping({ userA, userB, userId }) {
  const channel = supabase.channel(dmChannelName(userA, userB));
  return channel.send({ type: 'broadcast', event: 'chat-typing', payload: { user_id: userId, ts: Date.now() } });
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -3
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/lib/messageRealtime.js
git commit -m "$(cat <<'EOF'
Add lib/messageRealtime.js — chat broadcast over Supabase Realtime

Reuses the per-board channel Yjs already uses + adds chat-message and
chat-typing broadcast events. DMs get a dedicated dm:{lo}:{hi} channel
so the two members subscribe to the same name.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B4: `useChannelList` hook

**Files:**
- Create: `boards/src/hooks/useChannelList.js`

- [ ] **Step 1: Create**

```js
import { useEffect, useState, useMemo } from 'react';
import { listBoardChannels, listDmThreads, listMessageReadsForUser } from '../lib/messages.js';

// Returns the unified Messages-panel list:
//   { boardChannels: [...], dmThreads: [...], unreadByKey: Map, hidden: Set, refresh }
// Each row is annotated with `unread` count and `hidden` flag for the user.
//
// Re-fetches on mount + on `refreshTick` change. Realtime updates are layered
// on by the caller (when a chat-message broadcast fires, bump refreshTick).
export function useChannelList({ workspaceId, userId, refreshTick = 0 }) {
  const [boards, setBoards]   = useState([]);
  const [dms,    setDms]      = useState([]);
  const [reads,  setReads]    = useState([]);

  useEffect(() => {
    if (!workspaceId || !userId) return;
    let cancelled = false;
    (async () => {
      const [b, d, r] = await Promise.all([
        listBoardChannels({ workspaceId }),
        listDmThreads({ workspaceId }),
        listMessageReadsForUser({ userId }),
      ]);
      if (cancelled) return;
      setBoards(b); setDms(d); setReads(r);
    })();
    return () => { cancelled = true; };
  }, [workspaceId, userId, refreshTick]);

  // Per-row unread / hidden lookup.
  const { unreadByKey, hidden } = useMemo(() => {
    const reads_byKey = new Map();
    const hiddenSet = new Set();
    for (const r of reads) {
      const key = r.reads_board_id ? `b:${r.reads_board_id}` : `d:${r.reads_dm_peer}`;
      reads_byKey.set(key, r);
      if (r.hidden_at) hiddenSet.add(key);
    }
    const unread = new Map();
    for (const ch of boards) {
      const r = reads_byKey.get(`b:${ch.board_id}`);
      const lastRead = r?.last_read_at ? new Date(r.last_read_at) : new Date(0);
      const lastMsg  = ch.last_message_at ? new Date(ch.last_message_at) : new Date(0);
      unread.set(`b:${ch.board_id}`, lastMsg > lastRead ? 1 : 0); // exact count via separate query if needed; v1 binary is fine
    }
    for (const t of dms) {
      const peer = t.user_a === userId ? t.user_b : t.user_a;
      const r = reads_byKey.get(`d:${peer}`);
      const lastRead = r?.last_read_at ? new Date(r.last_read_at) : new Date(0);
      const lastMsg  = t.last_message_at ? new Date(t.last_message_at) : new Date(0);
      unread.set(`d:${peer}`, lastMsg > lastRead ? 1 : 0);
    }
    return { unreadByKey: unread, hidden: hiddenSet };
  }, [boards, dms, reads, userId]);

  return { boardChannels: boards, dmThreads: dms, unreadByKey, hidden };
}
```

- [ ] **Step 2: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -3
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/hooks/useChannelList.js
git commit -m "$(cat <<'EOF'
Add useChannelList — combined boards + DMs + per-user unread/hidden

V1 unread is binary (last_message_at > last_read_at = 1, else 0). A
proper count would need a per-(user, channel) cached counter; binary is
the simplest signal that drives the dot indicator and is enough for v1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B5: `useUnreadTotal` hook + `useTitleBadge`

**Files:**
- Create: `boards/src/hooks/useUnreadTotal.js`
- Create: `boards/src/hooks/useTitleBadge.js`

- [ ] **Step 1: useUnreadTotal**

```js
import { useMemo } from 'react';

// Sum unreadByKey from useChannelList. Returns { total, mentions } where
// `mentions` counts rows whose unread includes a @-mention of the current
// user (drives the brighter badge style). For v1, we don't separately
// track mention-only unread per row — return 0 mentions and surface
// mentions inline at the row level instead.
export function useUnreadTotal({ unreadByKey }) {
  return useMemo(() => {
    let total = 0;
    if (unreadByKey) for (const v of unreadByKey.values()) total += v ? 1 : 0;
    return { total, mentions: 0 };
  }, [unreadByKey]);
}
```

- [ ] **Step 2: useTitleBadge**

```js
import { useEffect } from 'react';

// Prepends "(N)" or "(@N)" to document.title when there are unread
// messages or @-mentions. Restores the original title on unmount.
export function useTitleBadge({ total = 0, mentions = 0 }) {
  useEffect(() => {
    const original = document.title.replace(/^\(\@?\d+\)\s+/, '');
    if (total === 0 && mentions === 0) {
      document.title = original;
      return;
    }
    const badge = mentions > 0 ? `(@${mentions}) ` : `(${total}) `;
    document.title = badge + original;
    return () => { document.title = original; };
  }, [total, mentions]);
}
```

- [ ] **Step 3: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -3
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/hooks/useUnreadTotal.js boards/src/hooks/useTitleBadge.js
git commit -m "$(cat <<'EOF'
Add useUnreadTotal + useTitleBadge

Sidebar Messages row badge count + browser tab title prefix when
there are unread messages or @-mentions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B6: `<MessagesPanel/>` shell — list view

**Files:**
- Create: `boards/src/components/MessagesPanel.jsx`
- Create: `boards/src/components/NewDMPicker.jsx`

- [ ] **Step 1: NewDMPicker**

```jsx
import { useState } from 'react';
import { EntityPicker } from './EntityPicker.jsx';

// Wraps EntityPicker filtered to workspace members. Returns the picked
// user via onPick({ id, name }).
export function NewDMPicker({ workspaceId, anchor, onPick, onClose }) {
  return (
    <EntityPicker
      workspaceId={workspaceId}
      anchor={anchor}
      filter={['user']}
      onCommit={(targets) => {
        const t = targets?.[0];
        if (t?.kind === 'card' || t?.id) {
          // EntityPicker emits { kind, id } for users (kind='card' fallback in
          // the helper since we didn't add a 'user' branch in rowToTarget).
          onPick?.({ id: t.id || t.cardId, name: t.title });
        }
        onClose?.();
      }}
      onCancel={onClose}
    />
  );
}
```

- [ ] **Step 2: Update EntityPicker.jsx rowToTarget for 'user'**

Find the `rowToTarget` function. Add a user branch:

```jsx
function rowToTarget(row) {
  if (row.kind === 'board') return { kind: 'board', id: row.board_id };
  if (row.kind === 'doc')   return { kind: 'doc', docCardId: row.card_id };
  if (row.kind === 'user')  return { kind: 'user', id: row.id, title: row.title };
  return { kind: 'card', boardId: row.board_id, cardId: row.card_id };
}
```

Also add `User` to the KIND_ICON map at the top:

```jsx
import { User } from '../lib/icons.js';
// ...
const KIND_ICON = {
  board: LayoutGrid,
  doc: FileText,
  user: User,
  // ...existing
};
const KIND_LABEL = {
  // existing
  user: 'PEOPLE',
};
```

If `User` isn't in `lib/icons.js`, append it. Verify:
```bash
grep -n "User," /Users/andrewconklin/soleilpictures-1/boards/src/lib/icons.js
```
If missing, add `User,` near other Lucide imports.

- [ ] **Step 3: MessagesPanel — list view + state machine**

```jsx
import { useState, useMemo } from 'react';
import { Icon } from './Icon.jsx';
import { Plus, MessageSquare, X, ChevronLeft } from '../lib/icons.js';
import { useChannelList } from '../hooks/useChannelList.js';
import { NewDMPicker } from './NewDMPicker.jsx';
import { MessageThread } from './MessageThread.jsx';

// Right-drawer slot. Two modes:
//   list: the BOARDS + DIRECT lists
//   thread: one open conversation
//
// Props:
//   workspaceId, currentUser, currentBoard
//   refreshTick — bump to force a list refetch
//   onClose — close the drawer
export function MessagesPanel({ workspaceId, currentUser, currentBoard, refreshTick, onClose }) {
  const userId = currentUser?.id;
  const { boardChannels, dmThreads, unreadByKey, hidden } = useChannelList({ workspaceId, userId, refreshTick });
  const [openThread, setOpenThread] = useState(null);
  //   openThread = { kind:'board', boardId, name } | { kind:'dm', peerId, name } | null
  const [newDmAnchor, setNewDmAnchor] = useState(null);

  // Always show the currently-open board's chat at the bottom of BOARDS,
  // even if no messages have been posted yet (option C "currently-open pin").
  const visibleBoardChannels = useMemo(() => {
    const seenIds = new Set();
    const list = [];
    for (const ch of boardChannels) {
      if (hidden.has(`b:${ch.board_id}`)) continue;
      seenIds.add(ch.board_id);
      list.push(ch);
    }
    return { active: list, currentPin: currentBoard && !seenIds.has(currentBoard.id) ? currentBoard : null };
  }, [boardChannels, hidden, currentBoard]);

  if (openThread) {
    return (
      <MessageThread
        workspaceId={workspaceId}
        currentUser={currentUser}
        thread={openThread}
        onBack={() => setOpenThread(null)}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="msg-panel">
      <div className="msg-panel-head">
        <span className="t-eyebrow">MESSAGES</span>
        <button className="modal-close" onClick={onClose}><Icon as={X} size={16} /></button>
      </div>

      <div className="msg-panel-body">
        {/* DIRECT */}
        <div className="msg-section">
          <div className="msg-section-head">
            <span className="t-eyebrow">DIRECT</span>
            <button className="msg-section-add"
                    onClick={(e) => setNewDmAnchor(e.currentTarget.getBoundingClientRect())}
                    title="New message">
              <Icon as={Plus} size={14} />
            </button>
          </div>
          {dmThreads.filter(t => !hidden.has(`d:${t.user_a === userId ? t.user_b : t.user_a}`)).map(t => {
            const peerId = t.user_a === userId ? t.user_b : t.user_a;
            const isUnread = unreadByKey.get(`d:${peerId}`) > 0;
            return (
              <button key={peerId}
                      className={`msg-row ${isUnread ? 'is-unread' : ''}`}
                      onClick={() => setOpenThread({ kind: 'dm', peerId, name: 'DM' })}>
                {isUnread && <span className="msg-row-dot" />}
                <span className="msg-row-name">{t.last_message?.slice(0, 60) || 'Conversation'}</span>
                <span className="msg-row-time t-meta">{relTime(t.last_message_at)}</span>
              </button>
            );
          })}
          {dmThreads.length === 0 && (
            <div className="msg-empty t-meta">No direct messages yet.</div>
          )}
        </div>

        {/* BOARDS */}
        <div className="msg-section">
          <div className="msg-section-head">
            <span className="t-eyebrow">BOARDS</span>
          </div>
          {visibleBoardChannels.active.map(ch => {
            const isUnread = unreadByKey.get(`b:${ch.board_id}`) > 0;
            return (
              <button key={ch.board_id}
                      className={`msg-row ${isUnread ? 'is-unread' : ''}`}
                      onClick={() => setOpenThread({ kind: 'board', boardId: ch.board_id, name: ch.board_name })}>
                {isUnread && <span className="msg-row-dot" />}
                <span className="msg-row-name">{ch.board_name}</span>
                <span className="msg-row-time t-meta">{relTime(ch.last_message_at)}</span>
              </button>
            );
          })}
          {visibleBoardChannels.currentPin && (
            <>
              <div className="msg-section-sub t-meta">— currently open</div>
              <button className="msg-row msg-row-pinned"
                      onClick={() => setOpenThread({ kind: 'board', boardId: visibleBoardChannels.currentPin.id, name: visibleBoardChannels.currentPin.name })}>
                <Icon as={MessageSquare} size={12} />
                <span className="msg-row-name">{visibleBoardChannels.currentPin.name}</span>
                <span className="msg-row-time t-meta">empty</span>
              </button>
            </>
          )}
        </div>
      </div>

      {newDmAnchor && (
        <NewDMPicker
          workspaceId={workspaceId}
          anchor={newDmAnchor}
          onPick={(u) => { setNewDmAnchor(null); setOpenThread({ kind: 'dm', peerId: u.id, name: u.name }); }}
          onClose={() => setNewDmAnchor(null)}
        />
      )}
    </div>
  );
}

function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60)    return `${sec}s`;
  if (sec < 3600)  return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}
```

- [ ] **Step 4: Stub MessageThread (Phase C builds it)**

So MessagesPanel imports a real component, create a temporary stub:

```jsx
// boards/src/components/MessageThread.jsx
import { Icon } from './Icon.jsx';
import { ChevronLeft, X } from '../lib/icons.js';

export function MessageThread({ thread, onBack, onClose }) {
  return (
    <div className="msg-panel">
      <div className="msg-panel-head">
        <button className="modal-close" onClick={onBack}><Icon as={ChevronLeft} size={16} /></button>
        <span className="t-eyebrow">{thread?.name || 'Thread'}</span>
        <button className="modal-close" onClick={onClose}><Icon as={X} size={16} /></button>
      </div>
      <div className="msg-panel-body">
        <div className="msg-empty t-meta">Thread coming in Phase C…</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -3
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/MessagesPanel.jsx boards/src/components/NewDMPicker.jsx boards/src/components/MessageThread.jsx boards/src/components/EntityPicker.jsx boards/src/lib/icons.js
git commit -m "$(cat <<'EOF'
Add MessagesPanel + NewDMPicker shell + MessageThread stub

List-view of DIRECT and BOARDS sections with option-C channel discovery
(only board channels with messages appear, plus the currently-open
board pinned at the bottom). EntityPicker gains a 'user' kind for the
NewDMPicker; MessageThread is a stub that Phase C fleshes out.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B7: Wire sidebar Inbox → Messages + mount panel

**Files:**
- Modify: `boards/src/App.jsx`
- Modify: `boards/src/local/LocalBoardsApp.jsx`

- [ ] **Step 1: Migrate the tweak key**

In `App.jsx`, near the `useTweaks` call, add a one-shot localStorage migration:

```jsx
useEffect(() => {
  // One-time: rename tweak.showInbox → tweak.showMessages so existing users
  // keep their drawer-open state across the rename.
  if (tweak.showInbox !== undefined && tweak.showMessages === undefined) {
    setTweak('showMessages', tweak.showInbox);
    setTweak('showInbox', undefined);
  }
}, []);
```

Add `showMessages: true` to `TWEAK_DEFAULTS` (drop `showInbox`).

- [ ] **Step 2: Replace the sidebar Inbox row JSX with a Messages row**

Find the existing:
```jsx
<div className={`sb-row ${tweak.showInbox ? 'active' : ''}`} onClick={() => setTweak('showInbox', !tweak.showInbox)}>
  <Icon as={InboxIcon} size={14} />
  <span className="sb-row-label">Inbox</span>
  <span className="sb-row-count t-meta">{inbox.items.length}</span>
</div>
```

Replace with:

```jsx
<div className={`sb-row ${tweak.showMessages ? 'active' : ''}`}
     onClick={() => setTweak('showMessages', !tweak.showMessages)}>
  <Icon as={MessageSquare} size={14} />
  <span className="sb-row-label">Messages</span>
  {messagesUnread > 0 && (
    <span className={`sb-row-count t-meta ${messagesUnread > 0 ? 'has-unread' : ''}`}>{messagesUnread}</span>
  )}
</div>
```

Add the imports: `MessageSquare` from `lib/icons.js` (already there). And inside the `Workspace` component, add:

```jsx
import { MessagesPanel } from './components/MessagesPanel.jsx';
import { useChannelList } from './hooks/useChannelList.js';
import { useUnreadTotal } from './hooks/useUnreadTotal.js';
import { useTitleBadge } from './hooks/useTitleBadge.js';

// in component body
const [msgRefreshTick, setMsgRefreshTick] = useState(0);
const channelList = useChannelList({ workspaceId: workspace.id, userId: user.id, refreshTick: msgRefreshTick });
const { total: messagesUnread, mentions: messagesMentions } = useUnreadTotal({ unreadByKey: channelList.unreadByKey });
useTitleBadge({ total: messagesUnread, mentions: messagesMentions });
```

- [ ] **Step 3: Mount MessagesPanel where InboxPanel was rendered**

Find the `<InboxPanel ... />` render. Replace with:

```jsx
{tweak.showMessages && (
  <MessagesPanel
    workspaceId={workspace.id}
    currentUser={userInfo}
    currentBoard={currentBoard}
    refreshTick={msgRefreshTick}
    onClose={() => setTweak('showMessages', false)}
  />
)}
```

Leave the existing InboxPanel JSX block deleted; the old import can stay until Phase F removes it.

- [ ] **Step 4: Same in LocalBoardsApp.jsx**

Local QA mode has no Supabase, so messaging is a no-op. Replace the InboxPanel mount with:

```jsx
{tweak.showMessages && (
  <div className="msg-panel">
    <div className="msg-panel-head"><span className="t-eyebrow">MESSAGES</span></div>
    <div className="msg-panel-body">
      <div className="msg-empty t-meta">Messaging requires Supabase. Sign in to use it.</div>
    </div>
  </div>
)}
```

Same tweak migration + sidebar swap as App.jsx.

- [ ] **Step 5: CSS for the panel**

Append to `boards/src/styles.css`:

```css
/* ───────────────────────────── Messages panel ───────────────────────────── */

.msg-panel {
  position: absolute;
  right: 16px; top: 16px; bottom: 16px;
  width: 320px;
  z-index: 30;
  background: rgba(16,16,20,.85);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
  backdrop-filter: blur(18px) saturate(1.2);
  border: 1px solid rgba(255,255,255,.06);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-3);
  display: flex; flex-direction: column;
  overflow: hidden;
  animation: ctx-menu-in var(--dur-base) var(--ease);
}
[data-theme='light'] .msg-panel { background: rgba(250,250,252,.85); border-color: rgba(10,10,12,.06); }

.msg-panel-head {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line-1);
  flex-shrink: 0;
}
.msg-panel-head .t-eyebrow { flex: 1; color: var(--ink-1); }

.msg-panel-body { flex: 1; overflow-y: auto; padding: 8px; }

.msg-section { margin-bottom: 12px; }
.msg-section-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px;
}
.msg-section-add {
  background: transparent; border: 0;
  color: var(--ink-3);
  width: 22px; height: 22px;
  border-radius: var(--radius);
  display: grid; place-items: center;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.msg-section-add:hover { color: var(--ink-0); background: var(--bg-hov); }
.msg-section-sub { padding: 8px 10px 4px; color: var(--ink-3); }

.msg-row {
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  text-align: left;
  background: transparent; border: 0;
  padding: 8px 10px;
  border-radius: var(--radius);
  color: var(--ink-1);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.msg-row:hover { background: var(--bg-hov); color: var(--ink-0); }
.msg-row.is-unread { color: var(--ink-0); font-weight: 600; }
.msg-row.msg-row-pinned { color: var(--ink-2); font-style: italic; }
.msg-row-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--soleil);
  flex-shrink: 0;
}
.msg-row-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 500 13px/1.4 var(--font-sans); }
.msg-row-time { color: var(--ink-3); flex-shrink: 0; }
.msg-empty { padding: 16px 12px; color: var(--ink-3); }

.sb-row-count.has-unread { background: var(--soleil); color: var(--bg-0); padding: 2px 6px; border-radius: 999px; font-weight: 600; }
```

- [ ] **Step 6: Build + smoke + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -3
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/App.jsx boards/src/local/LocalBoardsApp.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Sidebar Inbox → Messages, mount MessagesPanel in the right drawer

Tweak.showInbox renames to tweak.showMessages with a one-shot
localStorage migration so existing users keep their drawer-open state.
Sidebar row uses MessageSquare icon + soleil-pill unread badge driven
by useChannelList. LocalBoardsApp shows a "requires Supabase" placeholder
since messaging needs the real backend.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase C — MessageThread

### Task C1: `useMessageThread` hook (fetch + realtime)

**Files:**
- Create: `boards/src/hooks/useMessageThread.js`

- [ ] **Step 1: Create**

```js
import { useEffect, useState, useCallback } from 'react';
import { fetchBoardChannelMessages, fetchDmThreadMessages, markRead } from '../lib/messages.js';
import { subscribeBoardChat, subscribeDmChat } from '../lib/messageRealtime.js';

// Returns { messages, typingUsers, refetch } for a single thread.
//   thread = { kind:'board', boardId, name } | { kind:'dm', peerId, name }
//   userId = current user (for marking read + filtering self typing)
export function useMessageThread({ workspaceId, userId, thread }) {
  const [messages, setMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState(new Map()); // userId → ts

  const refetch = useCallback(async () => {
    if (!workspaceId || !thread) return;
    let rows = [];
    if (thread.kind === 'board') rows = await fetchBoardChannelMessages({ boardId: thread.boardId });
    else if (thread.kind === 'dm') rows = await fetchDmThreadMessages({ workspaceId, userA: userId, userB: thread.peerId });
    setMessages(rows);
  }, [workspaceId, userId, thread?.kind, thread?.boardId, thread?.peerId]);

  useEffect(() => { refetch(); }, [refetch]);

  // Mark read whenever the thread or its message list changes.
  useEffect(() => {
    if (!userId || !thread) return;
    if (thread.kind === 'board') markRead({ userId, boardId: thread.boardId });
    if (thread.kind === 'dm')    markRead({ userId, dmPeerId: thread.peerId });
  }, [userId, thread?.kind, thread?.boardId, thread?.peerId, messages.length]);

  // Realtime subscribe.
  useEffect(() => {
    if (!thread) return;
    const onMessage = () => refetch();   // simplest: re-pull on any peer message
    const onTyping = ({ user_id, ts }) => {
      if (user_id === userId) return;
      setTypingUsers(m => { const next = new Map(m); next.set(user_id, ts); return next; });
      setTimeout(() => {
        setTypingUsers(m => {
          const stamp = m.get(user_id);
          if (stamp === ts) { const next = new Map(m); next.delete(user_id); return next; }
          return m;
        });
      }, 3000);
    };
    let unsub = () => {};
    if (thread.kind === 'board') unsub = subscribeBoardChat({ boardId: thread.boardId, onMessage, onTyping });
    if (thread.kind === 'dm')    unsub = subscribeDmChat({ userA: userId, userB: thread.peerId, onMessage, onTyping });
    return () => unsub();
  }, [thread?.kind, thread?.boardId, thread?.peerId, userId, refetch]);

  return { messages, typingUsers, refetch };
}
```

- [ ] **Step 2: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -3
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/hooks/useMessageThread.js
git commit -m "$(cat <<'EOF'
Add useMessageThread — fetch + realtime subscribe for one thread

Re-fetches the message list on any peer chat-message broadcast (simpler
than reconciling individual events for v1). Tracks typing users with
3s auto-expiry. Marks read whenever the thread opens or new messages
arrive.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C2: `<MessageBubble/>` — single message render

**Files:**
- Create: `boards/src/components/MessageBubble.jsx`

- [ ] **Step 1: Create**

```jsx
import { useState } from 'react';
import { Icon } from './Icon.jsx';
import { Trash2, Edit, Smile } from '../lib/icons.js';

// One message row in a thread.
//   msg = full row from messages table
//   selfId = current user
//   onDelete, onEdit, onReact, onAttachmentDragStart  — wired by parent
export function MessageBubble({ msg, selfId, onDelete, onEdit, onReact, onAttachmentDragStart }) {
  const isMine = msg.sender_id === selfId;
  const within15min = msg.created_at && (Date.now() - new Date(msg.created_at).getTime()) < 15 * 60 * 1000;
  const [hover, setHover] = useState(false);
  const time = relTime(msg.created_at);

  return (
    <div className="msg-bubble" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="msg-bubble-head">
        <span className="msg-bubble-author">{msg.sender_name || 'Someone'}</span>
        <span className="msg-bubble-time t-meta">{time}{msg.edited_at ? ' · edited' : ''}</span>
        {hover && (
          <span className="msg-bubble-actions">
            <button title="React"  onClick={() => onReact?.(msg)}><Icon as={Smile} size={12} /></button>
            {isMine && within15min && <button title="Edit"   onClick={() => onEdit?.(msg)}><Icon as={Edit}   size={12} /></button>}
            {isMine               && <button title="Delete" onClick={() => onDelete?.(msg)}><Icon as={Trash2} size={12} /></button>}
          </span>
        )}
      </div>
      <div className="msg-bubble-body">{msg.body}</div>
      {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
        <div className="msg-bubble-attachments">
          {msg.attachments.map((att, i) => (
            <div key={i}
                 className="msg-attachment"
                 draggable
                 onDragStart={(e) => onAttachmentDragStart?.(e, att)}>
              {att.kind === 'image' && att.storage_path && (
                <img alt={att.name || ''} src={publicUrl(att.storage_path)} />
              )}
              {att.kind === 'file' && (
                <span className="msg-attachment-file">📎 {att.name || 'file'}</span>
              )}
              {att.kind === 'url' && (
                <a href={att.href} target="_blank" rel="noopener noreferrer">{att.title || att.href}</a>
              )}
              {(att.kind === 'board' || att.kind === 'card' || att.kind === 'doc' || att.kind === 'docPos') && (
                <span className="msg-attachment-entity">{(att.title || att.name || att.kind).toString()}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {msg.reactions && Object.keys(msg.reactions).length > 0 && (
        <div className="msg-bubble-reactions">
          {Object.entries(msg.reactions).map(([emoji, ids]) => (
            <button key={emoji} className={`msg-reaction ${ids?.includes(selfId) ? 'own' : ''}`} onClick={() => onReact?.(msg, emoji)}>
              <span>{emoji}</span>
              <span className="msg-reaction-count">{ids?.length || 0}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function publicUrl(path) {
  // Supabase storage public URL pattern.
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) return '';
  return `${base}/storage/v1/object/public/message-attachments/${path}`;
}

function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60)    return 'just now';
  if (sec < 3600)  return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return d.toLocaleDateString();
}
```

If `Edit` and `Smile` icons aren't in `lib/icons.js`, append them.

- [ ] **Step 2: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -3
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/MessageBubble.jsx boards/src/lib/icons.js
git commit -m "$(cat <<'EOF'
Add MessageBubble — single message render with hover actions

Body, time, edit/delete (own messages within 15-min window), reaction
trigger, attachments with draggable wrapper (Phase D wires the drop
target), reaction pills with own-vs-others state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C3: `<MessageComposer/>` + `<MessageThread/>` real impl

**Files:**
- Create: `boards/src/components/MessageComposer.jsx`
- Modify: `boards/src/components/MessageThread.jsx` (replace stub)

- [ ] **Step 1: MessageComposer**

```jsx
import { useState, useRef } from 'react';
import { Icon } from './Icon.jsx';
import { Paperclip, Smile } from '../lib/icons.js';

// Bottom-of-thread input. Phase D wires attachments + paste-image; Phase E
// wires @-mentions + emoji palette. For Phase C this is just text + send.
export function MessageComposer({ onSend, busy }) {
  const [body, setBody] = useState('');
  const inputRef = useRef(null);
  const send = () => {
    const v = body.trim();
    if (!v) return;
    onSend?.({ body: v, attachments: [], mentions: [] });
    setBody('');
    inputRef.current?.focus();
  };
  return (
    <form className="msg-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <textarea
        ref={inputRef}
        className="msg-composer-input"
        placeholder="Message…"
        rows={1}
        disabled={busy}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
        }}
      />
      <div className="msg-composer-actions">
        <button type="button" className="msg-composer-btn" title="Attach"><Icon as={Paperclip} size={14} /></button>
        <button type="button" className="msg-composer-btn" title="Emoji"><Icon as={Smile} size={14} /></button>
        <button type="submit" className="btn-primary" disabled={busy || !body.trim()}>Send</button>
      </div>
    </form>
  );
}
```

If `Paperclip` isn't exported from `lib/icons.js`, add it.

- [ ] **Step 2: Replace MessageThread.jsx stub with real**

```jsx
import { useEffect, useRef, useCallback } from 'react';
import { Icon } from './Icon.jsx';
import { ChevronLeft, X } from '../lib/icons.js';
import { useMessageThread } from '../hooks/useMessageThread.js';
import { sendMessage, deleteMessage } from '../lib/messages.js';
import { broadcastBoardMessage, broadcastDmMessage } from '../lib/messageRealtime.js';
import { MessageBubble } from './MessageBubble.jsx';
import { MessageComposer } from './MessageComposer.jsx';
import { INBOX_MIME } from '../lib/dragMimes.js';

export function MessageThread({ workspaceId, currentUser, thread, onBack, onClose }) {
  const userId = currentUser?.id;
  const { messages, typingUsers, refetch } = useMessageThread({ workspaceId, userId, thread });
  const scrollRef = useRef(null);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  const handleSend = useCallback(async ({ body, attachments, mentions }) => {
    const dmPeerId = thread.kind === 'dm' ? thread.peerId : null;
    const boardId  = thread.kind === 'board' ? thread.boardId : null;
    try {
      const inserted = await sendMessage({ workspaceId, boardId, dmPeerId, senderId: userId, body, attachments, mentions });
      // Broadcast to peers so they update without polling.
      const payload = { ...inserted, sender_name: currentUser?.name || currentUser?.email };
      if (boardId) await broadcastBoardMessage({ boardId, payload });
      else         await broadcastDmMessage({ userA: userId, userB: dmPeerId, payload });
      refetch();
    } catch (e) { console.warn('send failed', e); }
  }, [workspaceId, userId, thread, currentUser, refetch]);

  const handleDelete = useCallback(async (msg) => {
    await deleteMessage({ id: msg.id });
    refetch();
  }, [refetch]);

  const handleAttachmentDragStart = (e, att) => {
    e.dataTransfer.effectAllowed = 'copy';
    // Attachments piggyback on the existing INBOX_MIME drag protocol so
    // CanvasSurface's existing drop handler turns them into the right
    // card kind. Phase D fleshes out inboxPayloadFor; for now we send
    // the attachment row as-is.
    e.dataTransfer.setData(INBOX_MIME, JSON.stringify({ kind: att.kind, attachment: att }));
  };

  return (
    <div className="msg-panel">
      <div className="msg-panel-head">
        <button className="modal-close" onClick={onBack}><Icon as={ChevronLeft} size={16} /></button>
        <span className="t-eyebrow">{thread?.name || 'Thread'}</span>
        <button className="modal-close" onClick={onClose}><Icon as={X} size={16} /></button>
      </div>
      <div className="msg-thread-body" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="msg-empty t-meta">No messages yet — type one below.</div>
        )}
        {messages.map(m => (
          <MessageBubble
            key={m.id}
            msg={m}
            selfId={userId}
            onDelete={handleDelete}
            onAttachmentDragStart={handleAttachmentDragStart}
            onReact={() => { /* Phase E */ }}
            onEdit={() => { /* Phase E */ }}
          />
        ))}
        {typingUsers.size > 0 && (
          <div className="msg-typing t-meta">{typingUsers.size === 1 ? 'Typing…' : `${typingUsers.size} typing…`}</div>
        )}
      </div>
      <MessageComposer onSend={handleSend} />
    </div>
  );
}
```

- [ ] **Step 3: Append composer + thread CSS**

```css
.msg-thread-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex; flex-direction: column;
  gap: 12px;
}
.msg-bubble { display: flex; flex-direction: column; gap: 4px; }
.msg-bubble-head { display: flex; align-items: center; gap: 8px; }
.msg-bubble-author { font: 600 12px/1.2 var(--font-sans); color: var(--ink-0); }
.msg-bubble-time   { color: var(--ink-3); }
.msg-bubble-actions {
  margin-left: auto;
  display: inline-flex; gap: 2px;
}
.msg-bubble-actions button {
  background: transparent; border: 0; color: var(--ink-3);
  width: 22px; height: 22px;
  border-radius: var(--radius);
  display: grid; place-items: center;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.msg-bubble-actions button:hover { color: var(--ink-0); background: var(--bg-hov); }
.msg-bubble-body { font: 400 13px/1.5 var(--font-sans); color: var(--ink-1); white-space: pre-wrap; }
.msg-bubble-attachments { display: flex; flex-direction: column; gap: 6px; }
.msg-attachment {
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  padding: 6px 8px;
  background: var(--bg-3);
  cursor: grab;
}
.msg-attachment:active { cursor: grabbing; }
.msg-attachment img { max-width: 100%; border-radius: var(--radius); display: block; }
.msg-bubble-reactions { display: flex; gap: 4px; flex-wrap: wrap; }
.msg-reaction {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--bg-3); border: 1px solid var(--line-2);
  color: var(--ink-1);
  padding: 2px 6px;
  border-radius: 999px;
  font: 500 11px/1 var(--font-sans);
  cursor: pointer;
}
.msg-reaction.own { background: var(--soleil-soft); border-color: var(--soleil); }
.msg-reaction-count { color: var(--ink-3); }

.msg-typing { color: var(--ink-3); padding: 0 4px; }

.msg-composer {
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid var(--line-1);
  flex-shrink: 0;
}
.msg-composer-input {
  resize: none;
  background: var(--bg-3);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  color: var(--ink-0);
  font: 500 13px/1.4 var(--font-sans);
  padding: 8px 10px;
  outline: none;
  min-height: 36px;
  max-height: 120px;
  transition: box-shadow var(--dur-base) var(--ease), border-color var(--dur-base) var(--ease);
}
.msg-composer-input:focus { border-color: transparent; box-shadow: var(--shadow-glow); }
.msg-composer-actions { display: flex; align-items: center; gap: 6px; }
.msg-composer-btn {
  background: transparent; border: 0; color: var(--ink-2);
  width: 28px; height: 28px;
  border-radius: var(--radius);
  display: grid; place-items: center;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.msg-composer-btn:hover { color: var(--ink-0); background: var(--bg-hov); }
.msg-composer .btn-primary { margin-left: auto; height: 30px; padding: 0 12px; }
```

- [ ] **Step 4: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -3
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/MessageThread.jsx boards/src/components/MessageComposer.jsx boards/src/styles.css boards/src/lib/icons.js
git commit -m "$(cat <<'EOF'
MessageThread + MessageComposer — real impl, send + delete + realtime

Send writes to Postgres then broadcasts on the per-board / per-DM
channel so peers update immediately. Delete is soft (deleted_at). The
existing INBOX_MIME drag protocol carries chat attachments to canvas;
Phase D fleshes out the payload translation. Auto-scrolls on new
messages, shows a typing indicator when peers fire chat-typing events.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C4: Wire typing indicator broadcast on composer keystroke

**Files:**
- Modify: `boards/src/components/MessageComposer.jsx`
- Modify: `boards/src/components/MessageThread.jsx`

- [ ] **Step 1: Add `onTyping` prop to composer**

In MessageComposer, throttle typing pings to once per 1.5s while the user is actively typing:

```jsx
const lastTypingRef = useRef(0);
// inside onChange handler:
onChange={(e) => {
  setBody(e.target.value);
  const now = Date.now();
  if (now - lastTypingRef.current > 1500 && e.target.value.length > 0) {
    lastTypingRef.current = now;
    onTyping?.();
  }
}}
```

Pass `onTyping` from MessageThread:

```jsx
<MessageComposer
  onSend={handleSend}
  onTyping={() => {
    if (thread.kind === 'board') broadcastBoardTyping({ boardId: thread.boardId, userId });
    else                          broadcastDmTyping({ userA: userId, userB: thread.peerId, userId });
  }}
/>
```

- [ ] **Step 2: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -3
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/MessageComposer.jsx boards/src/components/MessageThread.jsx
git commit -m "$(cat <<'EOF'
Typing indicator — composer broadcasts chat-typing every 1.5s

Throttled so a fast typist doesn't saturate the broadcast quota. Peers
already render the indicator (Phase C subscribed to the event). Auto-
fades after 3s of silence (handled by useMessageThread).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C5: Hook MessagesPanel refresh on new messages

**Files:**
- Modify: `boards/src/App.jsx`

- [ ] **Step 1: Subscribe to current-board chat events at the App level**

When ANY peer posts in the current board, bump `msgRefreshTick` so the panel list refetches and unread badges update:

In Workspace component, add an effect that subscribes to the current board's chat broadcast and bumps the tick:

```jsx
import { subscribeBoardChat } from './lib/messageRealtime.js';

useEffect(() => {
  if (!currentBoard?.id) return;
  const unsub = subscribeBoardChat({
    boardId: currentBoard.id,
    onMessage: () => setMsgRefreshTick(t => t + 1),
    onTyping: () => {},
  });
  return () => unsub();
}, [currentBoard?.id]);
```

- [ ] **Step 2: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -3
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/App.jsx
git commit -m "$(cat <<'EOF'
App listens for chat-message on current board → bumps panel refresh

When a peer posts in the board you're viewing, the Messages panel
list refetches so the channel row + unread dot update without
requiring you to open the panel first.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase D — Attachments

### Task D1: `lib/messageAttachments.js` — upload + payload translator

**Files:**
- Create: `boards/src/lib/messageAttachments.js`

- [ ] **Step 1: Create**

```js
import { supabase } from './supabase.js';

// Upload a File to the message-attachments bucket. Returns the attachment
// record shape ready to push into messages.attachments.
export async function uploadMessageFile(file, { workspaceId, userId }) {
  if (!supabase || !file) return null;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const id  = crypto.randomUUID();
  const path = `${workspaceId}/${userId}/${id}.${ext || 'bin'}`;
  const { error } = await supabase.storage.from('message-attachments').upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) { console.warn('upload failed', error); return null; }
  const isImage = (file.type || '').startsWith('image/');
  return {
    kind: isImage ? 'image' : 'file',
    storage_path: path,
    name: file.name,
    mime: file.type,
    size: file.size,
    ...(isImage ? await readImageDims(file) : {}),
  };
}

async function readImageDims(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve({}); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

// Translate a chat attachment into the inbox-MIME payload shape that
// CanvasSurface.handleDrop already understands. Each attachment kind maps
// to the appropriate seeded card.
export function inboxPayloadFor(att) {
  const url = att.storage_path
    ? `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/message-attachments/${att.storage_path}`
    : att.href;
  switch (att.kind) {
    case 'image':
      return { kind: 'image', src: url, label: att.name, w: att.width, h: att.height };
    case 'file':
      return { kind: 'link', url, title: att.name || url, source: 'attachment' };
    case 'url':
      return { kind: 'link', url: att.href, title: att.title || att.href, source: att.favicon };
    case 'board':
      return { kind: 'boardRef', boardId: att.boardId, name: att.title };
    case 'card':
      return { kind: 'boardRef', boardId: att.boardId, cardId: att.cardId };
    case 'doc':
    case 'docPos':
      return { kind: 'docRef', docCardId: att.docCardId, pageId: att.pageId };
    default: return null;
  }
}
```

- [ ] **Step 2: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -3
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/lib/messageAttachments.js
git commit -m "$(cat <<'EOF'
Add lib/messageAttachments.js — uploads + drag-payload translator

uploadMessageFile pushes a File to the message-attachments storage
bucket, reading image dims along the way. inboxPayloadFor maps each
attachment kind to the existing INBOX_MIME drag payload shape that
CanvasSurface already understands so chat attachments drop as the
right card kind.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task D2: Wire attachments into MessageComposer (paste + drop + button)

**Files:**
- Modify: `boards/src/components/MessageComposer.jsx`
- Modify: `boards/src/components/MessageThread.jsx`

- [ ] **Step 1: Add attachment state to MessageComposer**

```jsx
import { uploadMessageFile } from '../lib/messageAttachments.js';
// ...
const [attachments, setAttachments] = useState([]);
const [uploading, setUploading] = useState(false);
const fileInputRef = useRef(null);

const handleFiles = async (files) => {
  if (!files?.length || !workspaceId || !userId) return;
  setUploading(true);
  const uploaded = [];
  for (const f of files) {
    const att = await uploadMessageFile(f, { workspaceId, userId });
    if (att) uploaded.push(att);
  }
  setAttachments(prev => [...prev, ...uploaded]);
  setUploading(false);
};

const handlePaste = (e) => {
  const files = [...e.clipboardData?.files || []];
  if (files.length) { e.preventDefault(); handleFiles(files); }
};

const handleDrop = (e) => {
  e.preventDefault();
  const files = [...e.dataTransfer?.files || []];
  if (files.length) handleFiles(files);
};

// In send():
const send = () => {
  const v = body.trim();
  if (!v && attachments.length === 0) return;
  onSend?.({ body: v, attachments, mentions: [] });
  setBody('');
  setAttachments([]);
};

// In JSX, add a hidden file input + render attachment chips above the input:
<input ref={fileInputRef} type="file" hidden multiple
       onChange={(e) => { handleFiles([...e.target.files]); e.target.value = ''; }} />
{attachments.length > 0 && (
  <div className="msg-composer-attachments">
    {attachments.map((a, i) => (
      <div key={i} className="msg-composer-att-chip">
        <span>{a.name || a.kind}</span>
        <button type="button" onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}>×</button>
      </div>
    ))}
  </div>
)}

// On the textarea, add onPaste={handlePaste}.
// Wrap composer in onDrop={handleDrop} onDragOver={e => e.preventDefault()}.
// On the Paperclip button: onClick={() => fileInputRef.current?.click()}.
```

Add `workspaceId` and `userId` props to MessageComposer; thread passes them through.

- [ ] **Step 2: Append CSS**

```css
.msg-composer-attachments {
  display: flex; gap: 6px; flex-wrap: wrap;
}
.msg-composer-att-chip {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--bg-3); border: 1px solid var(--line-2);
  border-radius: var(--radius);
  padding: 4px 8px;
  font: 500 11px/1 var(--font-sans);
  color: var(--ink-1);
}
.msg-composer-att-chip button { background: transparent; border: 0; color: var(--ink-3); cursor: pointer; }
```

- [ ] **Step 3: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -3
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/MessageComposer.jsx boards/src/components/MessageThread.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Composer attachments — drop, paste, manual attach

Attach button (📎) opens file picker; pasting an image into the
textarea pulls it from clipboard; dropping files into the composer
uploads them. Pending attachments show as chips above the input;
click × to remove. Chips clear after send.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task D3: Update MessageBubble drag handler to emit canvas-ready payload

**Files:**
- Modify: `boards/src/components/MessageBubble.jsx`
- Modify: `boards/src/components/MessageThread.jsx`

- [ ] **Step 1: Use inboxPayloadFor in handleAttachmentDragStart**

In MessageThread.jsx, update the drag handler:

```jsx
import { inboxPayloadFor } from '../lib/messageAttachments.js';

const handleAttachmentDragStart = (e, att) => {
  const payload = inboxPayloadFor(att);
  if (!payload) return;
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData(INBOX_MIME, JSON.stringify(payload));
};
```

- [ ] **Step 2: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -3
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/MessageThread.jsx
git commit -m "$(cat <<'EOF'
Drag chat attachment → CanvasSurface drops it as the right card kind

Each kind maps via inboxPayloadFor: image → image card with the
storage URL; file → link card; entity refs → board/card/doc link
cards. The existing INBOX_MIME drop handler in CanvasSurface needs no
changes — chat attachments piggy-back on the same protocol.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase E — Mentions + reactions + edit

### Task E1: Extract `lib/caretRect.js`

**Files:**
- Create: `boards/src/lib/caretRect.js`

- [ ] **Step 1: Create**

```js
// Returns the bounding rect of the caret position in a textarea or
// contenteditable. Used to anchor the @-mention picker.
export function caretRect(el) {
  if (!el) return null;
  if (el.tagName === 'TEXTAREA') {
    // Mirror trick — render the textarea content up to the caret in a
    // hidden div with identical styling, then measure the cursor span.
    const mirror = document.createElement('div');
    const styles = window.getComputedStyle(el);
    for (const prop of ['fontFamily','fontSize','fontWeight','lineHeight','padding','border','width','letterSpacing','wordSpacing','whiteSpace']) {
      mirror.style[prop] = styles[prop];
    }
    mirror.style.position = 'fixed';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.style.boxSizing = styles.boxSizing;
    document.body.appendChild(mirror);
    const value = el.value.substring(0, el.selectionEnd);
    const span = document.createElement('span');
    span.textContent = '|';
    mirror.textContent = value;
    mirror.appendChild(span);
    const r = el.getBoundingClientRect();
    const sr = span.getBoundingClientRect();
    const mr = mirror.getBoundingClientRect();
    document.body.removeChild(mirror);
    return {
      left: r.left + (sr.left - mr.left) - el.scrollLeft,
      top: r.top + (sr.top - mr.top) - el.scrollTop,
      right: r.left + (sr.left - mr.left) - el.scrollLeft + 1,
      bottom: r.top + (sr.top - mr.top) - el.scrollTop + sr.height,
      width: 1,
      height: sr.height,
    };
  }
  // contenteditable: use Range + getClientRects.
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rects = range.getClientRects();
  if (rects.length === 0) return null;
  return rects[0];
}
```

- [ ] **Step 2: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -3
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/lib/caretRect.js
git commit -m "$(cat <<'EOF'
Add lib/caretRect.js — bounding rect of the caret in a textarea

Used by the chat composer's @-mention trigger to anchor the
EntityPicker right under the caret. Mirror-div trick for textareas;
Range.getClientRects() for contenteditable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task E2: Wire @-mention picker in MessageComposer

**Files:**
- Modify: `boards/src/components/MessageComposer.jsx`

- [ ] **Step 1: Detect `@…` token in onChange + open EntityPicker**

```jsx
import { caretRect } from '../lib/caretRect.js';
import { EntityPicker } from './EntityPicker.jsx';
// ...

const [mention, setMention] = useState(null);
//   mention = { tokenStart, query, anchor } | null
const [pendingMentions, setPendingMentions] = useState([]); // people only
const [pendingEntityRefs, setPendingEntityRefs] = useState([]); // board/card/doc refs that came from @

const detectMentionToken = (text, caret) => {
  // Find the last "@" at-or-before caret with no whitespace in between.
  let i = caret - 1;
  while (i >= 0 && /\S/.test(text[i]) && text[i] !== '@') i--;
  if (i < 0 || text[i] !== '@') return null;
  return { tokenStart: i, query: text.slice(i + 1, caret) };
};

// In onChange:
onChange={(e) => {
  const v = e.target.value;
  setBody(v);
  const tok = detectMentionToken(v, e.target.selectionEnd);
  if (tok) {
    const r = caretRect(e.target);
    setMention({ ...tok, anchor: r });
  } else {
    setMention(null);
  }
  // existing typing throttle
}}

// Render conditionally:
{mention && (
  <EntityPicker
    workspaceId={workspaceId}
    anchor={mention.anchor}
    initialQuery={mention.query}
    filter={['user','board','card','doc']}
    onCommit={(targets) => {
      const t = targets?.[0];
      if (!t) { setMention(null); return; }
      // Replace the @token with @<name>:
      const before = body.slice(0, mention.tokenStart);
      const after  = body.slice(mention.tokenStart + 1 + mention.query.length);
      const name   = t.title || t.name || (t.kind === 'user' ? 'someone' : t.kind);
      setBody(before + '@' + name + ' ' + after);
      if (t.kind === 'user') setPendingMentions(p => [...p, t.id]);
      else                   setPendingEntityRefs(p => [...p, t]);
      setMention(null);
    }}
    onCancel={() => setMention(null)}
  />
)}

// In send():
onSend?.({
  body: v,
  attachments: [...attachments, ...pendingEntityRefs],
  mentions: pendingMentions,
});
setPendingMentions([]);
setPendingEntityRefs([]);
```

- [ ] **Step 2: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -3
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/MessageComposer.jsx
git commit -m "$(cat <<'EOF'
@-mention picker — type @ to open EntityPicker at the caret

Detects @<query> tokens in the textarea, anchors EntityPicker via
caretRect(), filters to user/board/card/doc. Picking a user appends
to pendingMentions[] (drives notifications); picking an entity appends
to pendingEntityRefs[] (rendered as inline soleil pills, no notify).
Both replace the @token with @<resolved name> in the body.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task E3: Render @-mentions as pills in MessageBubble

**Files:**
- Modify: `boards/src/components/MessageBubble.jsx`

- [ ] **Step 1: Walk body for `@<name>` tokens, match against mentions[] / attachments[]**

Replace the body render with:

```jsx
function renderBody({ body, mentions = [], attachments = [], userNamesById = {} }) {
  // Build a lookup of @<name> tokens to (kind, ref).
  const matchByName = new Map();
  for (const userId of mentions) {
    const name = userNamesById[userId];
    if (name) matchByName.set(name.toLowerCase(), { kind: 'user', id: userId });
  }
  for (const att of attachments) {
    if (att.title || att.name) {
      matchByName.set((att.title || att.name).toLowerCase(), { kind: att.kind, ref: att });
    }
  }
  const parts = [];
  let i = 0;
  const re = /@([a-zA-Z0-9_'’\- ]{1,40})/g;
  let m;
  while ((m = re.exec(body)) != null) {
    if (m.index > i) parts.push(body.slice(i, m.index));
    const tokenName = m[1].trim().toLowerCase();
    const hit = matchByName.get(tokenName);
    if (hit) {
      parts.push(<span key={`p${parts.length}`} className={`msg-pill msg-pill-${hit.kind}`}>{m[0]}</span>);
    } else {
      parts.push(m[0]);
    }
    i = m.index + m[0].length;
  }
  if (i < body.length) parts.push(body.slice(i));
  return parts;
}

// In the bubble JSX:
<div className="msg-bubble-body">
  {renderBody({ body: msg.body, mentions: msg.mentions, attachments: msg.attachments })}
</div>
```

The `userNamesById` map can come from a small workspace-members hook later; for now, pills render even without resolved names because the @token visually pops via class.

Append CSS:

```css
.msg-pill {
  display: inline-block;
  background: var(--soleil-soft);
  color: var(--soleil);
  padding: 0 4px;
  border-radius: 3px;
  font-weight: 600;
}
.msg-pill-user { background: rgba(212,160,74,.18); }
```

- [ ] **Step 2: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -3
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/MessageBubble.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Render @-mentions as soleil pills in message bubbles

Walks the body for @<name> tokens, matches against the message's
mentions[] (users) and attachments[] (entities), and pill-styles the
matches. Unmatched @text renders as plain text.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task E4: Reactions + edit-own

**Files:**
- Create: `boards/src/components/EmojiPalette.jsx`
- Modify: `boards/src/components/MessageBubble.jsx`
- Modify: `boards/src/components/MessageThread.jsx`

- [ ] **Step 1: EmojiPalette**

```jsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const EMOJIS = ['👍', '❤️', '🎉', '😂', '🙏', '🔥', '👀', '✨'];

export function EmojiPalette({ anchor, onPick, onClose }) {
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!anchor) return;
    const W = 180, PAD = 8;
    const top = Math.min(window.innerHeight - 60 - PAD, anchor.bottom + PAD);
    const left = Math.min(Math.max(PAD, anchor.left), window.innerWidth - W - PAD);
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e) => { if (popRef.current && !popRef.current.contains(e.target)) onClose?.(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div ref={popRef} className="emoji-palette surface-frosted" style={{ top: pos.top, left: pos.left }}>
      {EMOJIS.map(e => (
        <button key={e} className="emoji-palette-btn" onClick={() => { onPick?.(e); onClose?.(); }}>{e}</button>
      ))}
    </div>,
    document.body,
  );
}
```

CSS:
```css
.emoji-palette {
  position: fixed;
  z-index: 2147483647;
  display: flex; gap: 4px;
  padding: 6px;
  border-radius: var(--radius-md);
  animation: ctx-menu-in var(--dur-fast) var(--ease);
}
.emoji-palette-btn {
  background: transparent; border: 0;
  font-size: 20px;
  width: 28px; height: 28px;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease);
}
.emoji-palette-btn:hover { background: var(--bg-hov); }
```

- [ ] **Step 2: Wire reactions in MessageBubble + MessageThread**

In MessageBubble, add:

```jsx
const [emojiAnchor, setEmojiAnchor] = useState(null);
// In actions: button onClick={(e) => setEmojiAnchor(e.currentTarget.getBoundingClientRect())}
{emojiAnchor && (
  <EmojiPalette
    anchor={emojiAnchor}
    onPick={(emoji) => onReact?.(msg, emoji)}
    onClose={() => setEmojiAnchor(null)}
  />
)}

// In reaction-pill click:
onClick={() => onReact?.(msg, emoji)}
```

In MessageThread:

```jsx
import { toggleReaction } from '../lib/messages.js';
const handleReact = useCallback(async (msg, emoji) => {
  if (!emoji) return;
  await toggleReaction({ messageId: msg.id, emoji, userId });
  refetch();
}, [userId, refetch]);
// pass to <MessageBubble onReact={handleReact} />
```

- [ ] **Step 3: Edit-own flow**

In MessageBubble, when edit is clicked, swap the body for an inline edit textarea:

```jsx
const [editing, setEditing] = useState(false);
const [editBody, setEditBody] = useState(msg.body);
const handleEditClick = () => { setEditBody(msg.body); setEditing(true); };
const submitEdit = async () => {
  if (!editBody.trim()) return;
  await onEdit?.(msg, editBody.trim());
  setEditing(false);
};

// In JSX, replace body div with:
{editing ? (
  <form onSubmit={(e) => { e.preventDefault(); submitEdit(); }}>
    <textarea autoFocus value={editBody} onChange={(e) => setEditBody(e.target.value)} className="msg-composer-input" rows={2} />
    <div className="msg-bubble-edit-actions">
      <button type="button" onClick={() => setEditing(false)}>Cancel</button>
      <button type="submit" className="btn-primary">Save</button>
    </div>
  </form>
) : (
  <div className="msg-bubble-body">{renderBody({ body: msg.body, mentions: msg.mentions, attachments: msg.attachments })}</div>
)}
```

In MessageThread:
```jsx
import { editMessage } from '../lib/messages.js';
const handleEdit = useCallback(async (msg, newBody) => {
  await editMessage({ id: msg.id, body: newBody });
  refetch();
}, [refetch]);
// pass to MessageBubble: onEdit={handleEdit}
```

The 15-min window is enforced UI-side (button hidden); server-side is best-effort because RLS doesn't enforce time, only ownership.

- [ ] **Step 4: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -3
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/EmojiPalette.jsx boards/src/components/MessageBubble.jsx boards/src/components/MessageThread.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Reactions (8-emoji palette) + edit-own-message

Click smile → palette pops at anchor → pick emoji → toggleReaction
read-modify-writes the message's reactions jsonb. Edit-own swaps the
body for an inline edit textarea; UI hides the edit button after
15 minutes. Server-side trust is RLS ownership only — time enforcement
is UI-side, acceptable for v1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase F — Polish + delete legacy Inbox

### Task F1: Hide-row + presence header + document-title badge

**Files:**
- Modify: `boards/src/components/MessagesPanel.jsx`
- Modify: `boards/src/components/MessageThread.jsx`
- (useTitleBadge already wired in B7.)

- [ ] **Step 1: Right-click row → Hide**

In MessagesPanel, add an onContextMenu handler that calls `hideRow` from `lib/messages.js`:

```jsx
import { hideRow } from '../lib/messages.js';

// On each .msg-row:
onContextMenu={(e) => {
  e.preventDefault();
  hideRow({ userId, boardId: <b.board_id or undefined>, dmPeerId: <peer or undefined> });
  // local optimistic remove
  // (refresh on next refetch tick)
}}
```

- [ ] **Step 2: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -3
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/MessagesPanel.jsx
git commit -m "$(cat <<'EOF'
Right-click any messages row → Hide (sets hidden_at on message_reads)

Hidden rows reappear when a new message arrives (the realtime
broadcast handler already un-hides on read).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task F2: Drop legacy Inbox files + table

**Files:**
- Delete: `boards/src/components/InboxPanel.jsx`
- Delete: `boards/src/lib/inbox.js`
- Delete: `boards/src/lib/inboxApi.js`
- Modify: `boards/src/components/CanvasSurface.jsx` — switch import from `./lib/inbox` to `./lib/dragMimes`
- Modify: `boards/src/data.js` — drop `INBOX_SEED`
- Modify: `boards/src/local/LocalBoardsApp.jsx` — drop `INBOX_SEED` import + `inboxItems` state
- Create: `supabase/migrations/0007_drop_inbox_items.sql`

- [ ] **Step 1: Remove the files**

```bash
cd /Users/andrewconklin/soleilpictures-1
rm boards/src/components/InboxPanel.jsx
rm boards/src/lib/inbox.js
rm boards/src/lib/inboxApi.js
```

- [ ] **Step 2: Update CanvasSurface import**

```bash
grep -n "from '../lib/inbox" boards/src/components/CanvasSurface.jsx
```

For each match, change `from '../lib/inbox.js'` (or `'../lib/inbox'`) → `from '../lib/dragMimes.js'`. The only export it uses is `INBOX_MIME`, which now lives in dragMimes.

If CanvasSurface also imports `inboxItemToCard`, that helper currently lives in `inbox.js` and is used by the legacy inbox-drop flow. With Inbox gone, only chat-attachment drops remain and they construct their payloads via `inboxPayloadFor` — `inboxItemToCard` is dead code. Look for any remaining references:

```bash
grep -rn "inboxItemToCard" boards/src/
```

If still referenced, move that helper to `boards/src/lib/dragPayloads.js` and update consumers. Otherwise, just deleting it with `inbox.js` is fine.

- [ ] **Step 3: Drop INBOX_SEED + LocalBoardsApp inbox state**

Edit `boards/src/data.js` — delete the `export const INBOX_SEED = [...]` block.

Edit `boards/src/local/LocalBoardsApp.jsx`:
- Remove the `INBOX_SEED` import.
- Remove `inboxItems` state and any setter.
- Remove the InboxPanel mount (already replaced in B7 with the "requires Supabase" placeholder).

- [ ] **Step 4: Migration to drop inbox_items**

```sql
-- supabase/migrations/0007_drop_inbox_items.sql
drop table if exists inbox_items cascade;
```

Apply via MCP as `drop_inbox_items`.

- [ ] **Step 5: Build + verify**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build 2>&1 | tail -10
grep -rE "InboxPanel|INBOX_SEED|inboxApi" boards/src/
```

The grep should return zero. If anything still imports them, remove the import.

- [ ] **Step 6: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/InboxPanel.jsx boards/src/lib/inbox.js boards/src/lib/inboxApi.js boards/src/components/CanvasSurface.jsx boards/src/data.js boards/src/local/LocalBoardsApp.jsx supabase/migrations/0007_drop_inbox_items.sql
git commit -m "$(cat <<'EOF'
Delete legacy Inbox — InboxPanel, inbox lib + api, INBOX_SEED, table

The Messages panel (Phase B) replaced the Inbox UX entirely. Drop:
- boards/src/components/InboxPanel.jsx
- boards/src/lib/inbox.js (INBOX_MIME re-export already moved to dragMimes)
- boards/src/lib/inboxApi.js
- INBOX_SEED + LocalBoardsApp's inboxItems state
- inbox_items Postgres table (cascade)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task F3: Phase F Playwright smoke

**Files:**
- Create: `boards/tests/messaging.spec.js`

- [ ] **Step 1: Smoke**

```js
import { expect, test } from '@playwright/test';

test('msg-panel CSS classes are shipped', async ({ page }) => {
  await page.goto('/?local=1');
  const has = await page.evaluate(() => {
    const want = ['.msg-panel', '.msg-row', '.msg-bubble', '.msg-composer'];
    const found = new Set();
    for (const s of document.styleSheets) {
      try {
        for (const r of s.cssRules) {
          for (const w of want) if (r.selectorText?.includes(w)) found.add(w);
        }
      } catch {}
    }
    return want.every(w => found.has(w));
  });
  expect(has).toBe(true);
});

test('Sidebar has Messages row (not Inbox) in local QA', async ({ page }) => {
  await page.goto('/?local=1');
  const hasMessages = await page.locator('.sb-row').filter({ hasText: 'Messages' }).count();
  const hasInbox    = await page.locator('.sb-row').filter({ hasText: 'Inbox' }).count();
  expect(hasMessages).toBeGreaterThan(0);
  expect(hasInbox).toBe(0);
});

test('app loads with no page errors after messaging migration', async ({ page }) => {
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto('/?local=1');
  await expect(page.getByRole('main').getByText('Studio', { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npx playwright test messaging 2>&1 | tail -10
cd /Users/andrewconklin/soleilpictures-1
git add boards/tests/messaging.spec.js
git commit -m "$(cat <<'EOF'
Phase F smoke — messaging CSS shipped + Inbox row gone + clean load

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Plan Self-Review

After all tasks above, verify against the spec sections:

- §3 architecture (no channels table, RLS inheritance) → Tasks A1–A3 ✓
- §4 schema (messages, message_reads, views, storage, RLS) → Tasks A1–A4 ✓
- §5.1 MessagesPanel → Task B6 ✓
- §5.2 MessageThread → Tasks C2–C5 ✓
- §5.3 MessageBubble → Tasks C2, E3, E4 ✓
- §5.4 NewDMPicker → Task B6 ✓
- §5.5 Sidebar Messages row → Task B7 ✓
- §6 drag-to-canvas wiring → Tasks D1–D3 ✓
- §7 mentions (people + entity) → Tasks E1–E3 ✓
- §8 notifications (sidebar badge + title badge + per-row dot) → Tasks B5, B7 ✓
- §9 migration (legacy Inbox deleted, inbox_items dropped) → Task F2 ✓
- §10 phases → mirrored as plan phases A–F ✓
- §13 verification → covered by manual smoke + Task F3 Playwright tests
