# Soleil Boards — Messaging (DMs + per-board channels)

**Date:** 2026-05-05
**Status:** Design approved, awaiting written-spec review
**Owner:** Andrew Conklin
**Builds on:** the existing per-board Supabase Realtime channel infrastructure (`board:{id}` broadcast that Yjs uses for awareness + canvas presence — Phase 5 of the linking work shipped per-user awareness state on canvases). The messaging layer adds two new event types onto that same channel and a thin Postgres backbone.

---

## 1. Goal

Replace the current Inbox panel with a real conversation surface — DMs between workspace members and a chat per board where everyone in the workspace can post. Make the right-drawer slot the home for both. Preserve the existing "drag inbox item to canvas" muscle memory by making chat attachments draggable to the canvas as cards.

**Success criteria**

- Open the right drawer → see a unified Messages list (DMs + active board channels).
- Sending a message in any board chat appears live in everyone's view who has that board open or that thread open in their drawer.
- The board you're currently viewing always has its chat one click away, even if no one's posted yet.
- Drag a chat attachment onto the canvas — it drops as the right kind of card (image / link / board reference / file).
- `@person` mentions are clickable; mentioned people get a highlighted unread.
- Workspace member added/removed → their access to channels updates immediately via RLS.
- The legacy Inbox panel + its seeded items are gone; nothing in the app still references them.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Channels | One implicit channel per board (no `channels` table — it's `messages WHERE board_id = X`); 1:1 DMs between any two workspace members |
| Channel discovery (option **C**) | Board chat appears in the sidebar list once a message has been posted in it. The board you're currently viewing is also pinned (with empty-state composer) so you never hunt for "this board's chat." |
| Group DMs (3+ ad-hoc) | **Out of scope** for v1 |
| Threaded replies (Slack-style) | **Out of scope** for v1 |
| Workspace-wide search | **Out of scope** |
| Pin messages | **Out of scope** |
| Reactions | Yes — small palette: 👍 ❤️ 🎉 😂 🙏 🔥 👀 ✨. Click a message → palette pops; click a reaction pill → toggles. |
| Edit / delete | Edit own messages within 15 minutes (greys "edited" tag after); delete own anytime. Admin-delete-others is **deferred** to a future spec (no admin role exists in the workspace model today). |
| `@`-mentions | People (`@andrew`) and entities (`@board-name`, `@card-name`) using the existing `EntityPicker` we already built |
| Notifications | In-app only for v1: sidebar badge with total unread count + per-row dot + brighter highlight for mentions of you |
| Realtime transport | Supabase Realtime broadcast on the existing `board:{id}` channel (chat-message + chat-typing events). DMs use a per-pair channel `dm:{lo}:{hi}` |
| Attachments | Inline images (preview), files (small card), entity-references (board/card/doc as preview tile), URLs (auto-link with favicon). Drag onto canvas → drops as the matching card kind. |
| Emoji-picker scope | Small fixed palette only for v1 (no full picker) |
| DM scope | Workspace-scoped — DMs between two members of the same workspace. Cross-workspace DMs deferred. |
| Existing Inbox | **Fully replaced.** The right-drawer slot now holds Messages. Old `inbox_items` table + `InboxPanel.jsx` + the seed inbox for local-QA mode all get deleted. |
| Where it lives | The same right-side drawer slot the Inbox uses today (`tweak.showInbox` becomes `tweak.showMessages`). Sidebar Inbox row becomes a Messages row. |

## 3. Architecture

### 3.1 The "no channel object" trick

Channels aren't entities. A board channel = the SET of messages with that `board_id`. A DM thread = the SET of messages between two specific user ids. This avoids a whole class of state (no channel rows to create on board create, no orphans on board delete, no separate ACL).

**Membership inheritance:** the board channel inherits its workspace membership from the board's row. RLS on `messages` does the join.

### 3.2 Realtime overlay

We already use `supabase.channel('board:{id}', { broadcast: { self: false } })` per-board for Yjs sync + canvas-cursor awareness. The chat layer reuses that channel by adding two new broadcast events:

- `chat-message` — `{ id, body, sender, attachments, mentions, reactions, ts }`
- `chat-typing` — `{ user_id, ts }` (debounced 1s on send, peer fades after 3s of silence)

DMs use a separate channel `dm:{loId}:{hiId}` (lexicographic order so both ends subscribe to the same name).

When a peer posts, every subscriber:
- If they're viewing this thread → append to the message list, scroll, debounce mark-read.
- Otherwise → bump the unread badge; update the channel row's `last_message_at` cache.

The DB INSERT happens client-side immediately (optimistic). Postgres fan-out is asynchronous via the broadcast event. Other clients hear the event and refetch / update local cache. Single source of truth is still Postgres.

## 4. Data model

### 4.1 `messages`

```sql
create table messages (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces on delete cascade,
  board_id      uuid references boards on delete cascade,    -- one of these is set:
  dm_peer_id    uuid references auth.users on delete cascade, -- if board_id null, dm
  sender_id     uuid not null references auth.users on delete cascade,
  body          text not null default '',
  attachments   jsonb not null default '[]',
  mentions      uuid[] not null default '{}',
  reactions     jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  edited_at     timestamptz,
  deleted_at    timestamptz,
  check (board_id is not null or dm_peer_id is not null),
  check (board_id is null or dm_peer_id is null)
);
create index messages_board_id_idx on messages (board_id, created_at desc) where board_id is not null;
create index messages_dm_idx on messages (workspace_id, sender_id, dm_peer_id, created_at desc) where dm_peer_id is not null;
create index messages_sender_idx on messages (sender_id, created_at desc);
create index messages_mentions_idx on messages using gin (mentions);
```

`attachments` shape (one item):
```json
{
  "kind": "image" | "file" | "url" | "board" | "card" | "doc" | "docPos",
  // image / file:
  "storage_path": "msg-attachments/<uuid>",
  "name": "casting-board.png",
  "mime": "image/png",
  "width": 1200, "height": 800,        // images only
  "size": 482310,                       // bytes
  // url:
  "href": "https://example.com",
  "title": "...", "favicon": "...",
  // entity refs (use the same target schema as Links):
  "boardId": "...", "cardId": "...", "docCardId": "...", "pageId": "...", "anchor": 0
}
```

`reactions` shape: `{ "❤️": [userId, userId], "🎉": [userId] }`. Updates use Postgres jsonb operators.

`mentions` is the deduplicated user-id list extracted from the body at send-time. Drives notifications.

### 4.2 `message_reads`

```sql
create table message_reads (
  user_id        uuid not null references auth.users on delete cascade,
  reads_board_id uuid references boards on delete cascade,    -- one of these is set
  reads_dm_peer  uuid references auth.users on delete cascade,
  last_read_at   timestamptz not null default now(),
  hidden_at      timestamptz,                                 -- when user "hid" the row
  primary key (user_id,
               coalesce(reads_board_id, '00000000-0000-0000-0000-000000000000'::uuid),
               coalesce(reads_dm_peer,  '00000000-0000-0000-0000-000000000000'::uuid))
);
```

Upsert on:
- Open a thread → `last_read_at = now()`
- Right-click → Hide → `hidden_at = now()`
- New message arrives → `hidden_at = null` (un-hide)

### 4.3 `attachment_uploads` (Storage bucket)

`message-attachments/{workspace_id}/{message_id or new uuid}/{filename}` — RLS: read by workspace members, write by sender.

### 4.4 RLS

```sql
alter table messages enable row level security;

-- READ: any member of the message's workspace.
create policy "messages read" on messages for select
  using (is_workspace_member(workspace_id));

-- INSERT: sender must be authenticated + workspace member + sender_id = auth.uid().
create policy "messages insert" on messages for insert
  with check (
    is_workspace_member(workspace_id) and sender_id = auth.uid()
  );

-- UPDATE: only the sender, only within edit window (or always for body deletion).
create policy "messages update own" on messages for update
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

-- DELETE: sender, or workspace admin (we don't have admin role in v1, defer).
create policy "messages delete own" on messages for delete
  using (sender_id = auth.uid());

alter table message_reads enable row level security;
create policy "reads own" on message_reads for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

### 4.5 `board_channel_summary` view

For the Messages list. One row per (workspace, board_id) with at least one message:

```sql
create or replace view board_channel_summary as
select
  m.workspace_id,
  m.board_id,
  b.name                              as board_name,
  count(*)                            as message_count,
  max(m.created_at)                   as last_message_at,
  (select body from messages m2
     where m2.board_id = m.board_id
     order by m2.created_at desc limit 1) as last_message
from messages m
join boards b on b.id = m.board_id
where m.board_id is not null and m.deleted_at is null
group by m.workspace_id, m.board_id, b.name;
```

Per-user unread counts are computed client-side by joining the view rows against the user's `message_reads`.

### 4.6 `dm_thread_summary` view

```sql
create or replace view dm_thread_summary as
select
  m.workspace_id,
  least(m.sender_id, m.dm_peer_id)    as user_a,
  greatest(m.sender_id, m.dm_peer_id) as user_b,
  count(*)                             as message_count,
  max(m.created_at)                    as last_message_at,
  (select body from messages m2
     where m2.dm_peer_id is not null
       and least(m2.sender_id, m2.dm_peer_id)    = least(m.sender_id, m.dm_peer_id)
       and greatest(m2.sender_id, m2.dm_peer_id) = greatest(m.sender_id, m.dm_peer_id)
     order by m2.created_at desc limit 1) as last_message
from messages m
where m.dm_peer_id is not null and m.deleted_at is null
group by m.workspace_id, least(m.sender_id, m.dm_peer_id), greatest(m.sender_id, m.dm_peer_id);
```

## 5. UI components

### 5.1 `<MessagesPanel/>` — replaces `<InboxPanel/>` in the right drawer

```
┌─ MESSAGES ─────────────────┐
│ DIRECT                  +  │   (eyebrow + "+" opens member picker)
│ ● Andrew         · 2m      │   ← unread dot, bold name
│   Sarah          · 5h      │
│ ───────────────────────────│
│ BOARDS                     │
│ ● Q3 Casting     · 1m      │   ← active channels (have messages)
│   Lost Time      · 12d     │
│ ── currently-open ────────│
│ □ Strategy / Notes         │   ← pinned, empty, "start the conversation"
└────────────────────────────┘
```

Two modes: **list** (above) and **thread** (below). State driven by a single `openThread: { kind: 'dm'|'board', id } | null` — null = list, set = thread.

### 5.2 `<MessageThread/>` — opened when a row is clicked

```
┌─ ◀ Q3 Casting             ⋮│   (back arrow + meta menu)
│ 👤👤 3 viewing             │   (presence avatars)
│                            │
│ Andrew · 10:42             │
│ pulled the casting board   │
│ over from last quarter     │
│ ┌────[Q3 Casting card]──┐  │   (entity attachment renders as
│ │ board · 12 cards      │  │    a small preview tile — drag to canvas)
│ └───────────────────────┘  │
│                            │
│ Sarah · 11:05              │
│ amazing, will lock by Fri  │
│  ❤️ 2 · 👍 1                │   (reaction pills, click to toggle)
│                            │
│ Sarah is typing…           │   (subtle, fades after 3s of silence)
│ ┌──────────────────────┐   │
│ │ Message…             │   │   (InlineComposer, ⏎ sends)
│ │ 📎  @  😊       ⏎    │   │
│ └──────────────────────┘   │
└────────────────────────────┘
```

Reuses the existing `<InlineComposer/>` with a slightly augmented footer — the 📎 / @ / 😊 buttons sit alongside the existing Post button.

### 5.3 `<MessageBubble/>`

Rows look like Notion / Linear comment bubbles: 24px avatar (initial-tinted by user color from the canvas-presence palette), name + time on first line, body below, attachment grid, reactions row.

- Hover any bubble → small action toolbar appears at top-right (react, edit if mine, delete if mine, copy link).
- @-mentions render as soleil-tinted pills; click person mention → opens DM with them; click entity mention → navigates to entity.

### 5.4 `<NewDMPicker/>`

Wraps `<EntityPicker/>` with `filter={['user']}` + `kinds=['user']`. Picking a member → opens an empty thread with them.

To make this work, `entitySearch` needs a `'user'` kind that surfaces workspace members from `workspace_members` join `auth.users`.

### 5.5 Sidebar Messages row

The existing Inbox sidebar row (B2 polish) stays in place but is renamed and re-routed:

```jsx
<div className={`sb-row ${tweak.showMessages ? 'active' : ''}`}
     onClick={() => setTweak('showMessages', !tweak.showMessages)}>
  <Icon as={MessageSquare} size={14} />
  <span className="sb-row-label">Messages</span>
  <span className="sb-row-count t-meta">{totalUnread}</span>
</div>
```

`totalUnread` comes from a tiny client-side aggregator that subscribes to both views and the user's `message_reads`. When > 0, the count badge is rendered in soleil instead of ink-3.

## 6. Drag-to-canvas — the spiritual successor of inbox-drop

Each `<MessageBubble/>` whose attachment is a draggable kind sets:

```jsx
<div className="msg-attachment"
     draggable
     onDragStart={(e) => {
       e.dataTransfer.effectAllowed = 'copy';
       e.dataTransfer.setData(INBOX_MIME, JSON.stringify(inboxPayloadFor(attachment)));
     }}>
  …
</div>
```

`inboxPayloadFor()` translates each attachment kind into the same JSON shape `CanvasSurface.handleDrop` already understands:

| Attachment kind | Drop becomes |
|---|---|
| `image` | image card pointing at the storage URL (also re-uploaded to the board's image-card storage if cross-workspace) |
| `file` | link card pointing at the storage URL with mime icon |
| `url` | link card |
| `board` | board-link card |
| `card` | board-link card to the board, scrolled to the cardId |
| `doc` / `docPos` | doc-link card |

`CanvasSurface` already implements the inbox-MIME drop handler from when the inbox was real — it stays, this just feeds it new sources.

## 7. Mentions

Two kinds, stored differently because only one drives notifications:

- **People mentions** (`@andrew`) — go in the dedicated `messages.mentions uuid[]` column. Drives notifications, mention-highlight, and the document-title-badge `(@N)` count. There is exactly one notifyable target type: a workspace member.
- **Entity mentions** (`@board-name`, `@card-name`, `@doc-name`) — go in `messages.attachments` as the same `{kind:'board'|'card'|'doc'|'docPos', …}` shape used for drag-from-canvas attachments. Render at message-display time as inline soleil pills (matched against the body text by name); click navigates. They DO NOT trigger notifications.

The composer flow:

- On keystroke, find the last `@…` token before the caret.
- If present, open the existing `<EntityPicker/>` anchored to the caret's bounding rect (we have caret-coords helpers in the auto-detect plugin — extract to `lib/caretRect.js`).
- Default to `kinds=['user','board','card','doc']`. Picking a user appends to the local mentions[] array AND replaces the `@…` text with `@<resolved name>`. Picking an entity appends to the local attachments[] array AND replaces the `@…` text with `@<resolved name>`.
- On send, the body keeps the `@<name>` display text. mentions[] and attachments[] hold the resolved references.

Display: at render time, walk the body for `@<token>` patterns and match against (a) the user names in mentions[] and (b) the entity names in attachments[]. Matches become pill-styled clickable chips. Unmatched `@text` is rendered as plain text (the user typed @ but didn't pick anything).

## 8. Notifications (v1 — in-app only)

- **Sidebar Messages row** shows a soleil-pill count of total unread (DMs + channels). Mentions of you cause the pill to render in `--soleil` filled-style instead of just the ink-3 outlined count.
- **Per-row dot** in the Messages panel for any conversation with unread messages.
- **Mention highlight** — the channel/DM row whose unread count includes a mention of you gets a small bolt icon (Lucide `Bell`) before the time.
- **Document title**: when total unread > 0 OR a mention of you is unread, prepend `(N)` or `(@N)` to the page title so the browser tab badge updates.
- **No browser Notification API for v1.** Push is a v2 spec.

## 9. Migration

1. Drop the existing `inbox_items` table.
2. Delete `boards/src/components/InboxPanel.jsx` and `boards/src/lib/inbox.js` (the INBOX_MIME constant moves to `lib/dragMimes.js` since CanvasSurface still uses it for chat-attachment drops).
3. Delete `INBOX_SEED` from `data.js` and any LocalBoardsApp wiring.
4. The `tweak.showInbox` key is renamed to `tweak.showMessages` in the tweaks-panel migration (one-time client-side: if showInbox exists in localStorage, copy to showMessages then delete).

No data preservation — the inbox was demo content, never real user data.

## 10. Implementation phases

| Phase | Scope | Approx duration |
|---|---|---|
| **A** | Schema + RLS — `messages`, `message_reads`, two views, storage bucket. Plus `searchEntities` extension for `kind='user'`. | 0.5 day |
| **B** | `<MessagesPanel/>` shell — list view (boards + DMs), per-row unread, channel discovery (option C). Sidebar Messages row replaces Inbox. | 1 day |
| **C** | `<MessageThread/>` — body, message bubbles, composer, send, fetch on open, basic delete-own. Realtime broadcast layer (chat-message events on existing board channel + new dm channel). | 1.5 days |
| **D** | Attachments — image/file uploads to Storage, render bubbles, drag-to-canvas wiring, paste-image-into-composer support. | 1 day |
| **E** | Mentions + reactions + edit-own — inline mention picker via EntityPicker, fixed emoji palette, edit-within-15-min flow, mention-highlight notifications. | 1 day |
| **F** | Polish + delete legacy Inbox — typing indicators, presence avatars in thread header, hide-row, document title badge, drop the old InboxPanel + inbox_items table. | 1 day |

**Total: ~6 days.** Each phase ships a usable improvement.

## 11. Out of scope (explicit)

- Group DMs with 3+ members
- Threaded replies
- Workspace-wide message search
- Pinned messages
- Email / push / browser notifications
- Cross-workspace DMs
- Voice / video / huddles
- Message scheduling
- Custom emoji
- Admin role for moderating others' messages
- E2E encryption (we rely on Supabase RLS + TLS)

## 12. Risks

- **Realtime channel saturation** — every keystroke triggering a typing event would explode broadcast quota. Mitigation: send `chat-typing` only on first non-whitespace input within a 1-second window; peers fade after 3s of silence.
- **Image upload timing** — if the user drops a 5MB image and immediately hits send, the message could insert with a missing storage path. Mitigation: composer holds the message in a "pending" state until all attachments resolve; show progress per attachment.
- **Unread accounting at scale** — for very large channels the per-user unread count via SELECT COUNT could be slow. Mitigation: in v1 we cap unread display at 99+; long-term, a per-(user, channel) cached counter table.
- **`mentions` denormalization** — if a user is renamed, body text doesn't update. The `@<name>` is just display text; the underlying mention reference is by id, which stays correct. Acceptable cosmetic drift.
- **`message_reads` PK using sentinel UUIDs** — same trick we used for `doc_backlinks`. Tested working there.

## 13. End-to-end verification

After Phase F ships:

1. Sign in as User A in workspace W. Open the right drawer → Messages panel shows DIRECT and BOARDS sections, both empty (no Inbox visible anywhere).
2. Click "+ New message" → EntityPicker filtered to workspace members. Pick User B. Empty thread opens.
3. Type "hey", attach an image (drop file). Send. Message appears in your view immediately.
4. Sign in as User B in another browser — sidebar Messages badge shows "1". Click → DIRECT shows User A with bold name + dot. Click into thread → message + image visible. Marked read.
5. Open a board ("Q3 Casting") in browser A — Messages panel's BOARDS section pins "Q3 Casting" at the bottom with empty-state composer. Type "hey team". Send.
6. In browser B (also signed in), open Q3 Casting board — the channel pop into BOARDS section with the unread dot. Mention "@User B" in a follow-up message — User B's row gets the mention highlight, document title shows "(@1)".
7. In browser B, drag the image attachment from browser A's earlier message onto the canvas → image card created at drop position.
8. Edit own message within 15 min — works. After 15 min → edit greyed out.
9. Right-click a board channel → Hide. Channel disappears from list. Send another message in it → channel reappears.
10. Delete the Q3 Casting board → its channel + all messages cascade-delete; no orphan rows; channel vanishes from everyone's list.
11. `grep -rE "inbox_items|InboxPanel|INBOX_SEED" boards/src/` returns zero. `grep -rE "from .*inbox\.js'" boards/src/` returns zero outside the new `lib/dragMimes.js`.
