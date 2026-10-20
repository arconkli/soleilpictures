import { useContext, useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { ChevronLeft, X, Search, Pin, MoreHorizontal, UserPlus, LogOut, Edit, ArrowDown } from '../lib/icons.js';
import { useMessageThread } from '../hooks/useMessageThread.js';
import { useStickToBottom } from '../hooks/useStickToBottom.js';
import { useLongPress } from '../hooks/useLongPress.js';
import { swallowNextClick } from '../lib/swallowClick.js';
import { MessageActionSheet } from './MessageActionSheet.jsx';
import { MessageMenu } from './MessageMenu.jsx';
import { MessagePinsPopover } from './MessagePinsPopover.jsx';
import { MessageFaces } from './MessageFaces.jsx';
import { useMessageableUsers } from '../hooks/useMessageableUsers.js';
import {
  sendMessage, deleteMessage, restoreMessage, editMessage, toggleReaction,
  searchMessagesInConversation, fetchMessagesByIds, fetchReadState,
  togglePin,
  listPinnedForConversation,
  addParticipants, leaveConversation, rejoinConversation, renameConversation,
} from '../lib/messages.js';
import {
  broadcastConversationMessage, broadcastConversationTyping, broadcastConversationChange,
} from '../lib/messageRealtime.js';
import { MessageBubble } from './MessageBubble.jsx';
import { RelTime } from './RelTime.jsx';
import { MessageComposer } from './MessageComposer.jsx';
import { finePointer } from '../lib/composerKeys.js';
import { lastEditableMessage, withinEditWindow } from '../lib/messageEdit.js';
import { snippetParts } from '../lib/messageSearchSnippet.js';
import { useDraftValue } from '../hooks/useDraft.js';
import { replyTarget, updateDraft } from '../lib/draftStore.js';
import { INBOX_MIME } from '../lib/dragMimes.js';
import { inboxPayloadFor } from '../lib/messageAttachments.js';
import { SoleilMark } from './primitives.jsx';
import { useFeedback } from './AppFeedback.jsx';
import { undoToast } from '../lib/undoToast.js';
import * as userProfiles from '../lib/userProfiles.js';
import { pickPresenceColor } from '../lib/presenceColor.js';
import { lastMessageId } from '../lib/messagePaging.js';
import { newMessageId, toggleReactionMap } from '../lib/messageStore.js';
import { buildFeedItems, selectSeenMessageId, typingLabel } from '../lib/messageFeed.js';
import { showingConversation } from '../lib/threadAttention.js';
import { usePanelPresence } from './MessagesPresence.jsx';
import { readOnlyCopy } from '../lib/messageAccess.js';
import { escapeClosesPanel } from '../lib/panelEscape.js';
import { isDmConversation } from '../lib/conversationState.js';
import { useMessagesLook } from './messagesLook.js';
import { membersLine, dmSubline } from '../lib/messagesCard.js';
import { MessagesFixtureContext } from '../lib/messagesFixture.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { sendShape, errorCode } from '../lib/messageEvents.js';

// Dragging an attachment out of a message onto a canvas makes it a card.
function attachmentDragStart(e, att) {
  const payload = inboxPayloadFor(att);
  if (!payload) return;
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData(INBOX_MIME, JSON.stringify(payload));
}

// Start fetching the previous page this far before the reader hits the top.
const LOAD_OLDER_THRESHOLD_PX = 120;

// conversation = { id, title, participants: [{ user_id, left_at, ... }] }
export function MessageThread({
  workspaceId, currentUser, conversation,
  onBack, onClose, onChanged, jumpToMessageId, onJumpConsumed,
  canSend = true, readOnlyReason = null, lastReadAt,
  peerHere = false, // a DM's other person is in the workspace now (the card look's "Here now")
}) {
  const userId = currentUser?.id;
  const conversationId = conversation?.id;
  const scrollRef = useRef(null);
  const [bottomSeen, setBottomSeen] = useState(false);
  // The end of the thread, checked live when it's time to mark read: the
  // observer behind bottomSeen reports changes, and an empty thread's end was
  // "seen" before its rows arrived and the view moved off it.
  const endRef = useRef(null);
  const endOnScreen = useCallback(() => {
    const root = scrollRef.current;
    const end = endRef.current;
    if (!root || !end) return false;
    const r = root.getBoundingClientRect();
    const e = end.getBoundingClientRect();
    return e.top <= r.bottom && e.bottom >= r.top;
  }, []);
  // Where you'd read up to when the conversation opened: the "New" line sits
  // after it and stays put while the thread is open, however it gets marked.
  // undefined until known. A link or a toast can open a thread before the
  // list has loaded: then it reads it itself, and marks nothing read until
  // it has, or the mark would wipe out where you'd got to.
  const [newAfter, setNewAfter] = useState(() => lastReadAt);
  const fixtureMode = !!useContext(MessagesFixtureContext);
  useEffect(() => {
    if (newAfter !== undefined) return undefined;
    if (lastReadAt !== undefined || fixtureMode) { setNewAfter(lastReadAt ?? null); return undefined; }
    let cancelled = false;
    fetchReadState({ conversationId }).then((rows) => {
      if (cancelled) return;
      setNewAfter((rows || []).find(r => r.user_id === userId)?.last_read_at ?? null);
    });
    return () => { cancelled = true; };
  }, [lastReadAt, newAfter, conversationId, userId, fixtureMode]);
  const feedback = useFeedback();
  // The files sidebar's card look: who's in it under the name, the thread in
  // bubbles (messagesCard.css), no glowing mark on an empty one.
  const card = useMessagesLook() === 'card';
  // The dev QA harness's rows, when it provides them (lib/messagesFixture.js).
  const fixture = useContext(MessagesFixtureContext);

  const {
    messages, typingUsers, pinTick, refetch, hasOlder, loadingOlder, loadOlder, failed: loadFailed, loading,
    sendLocal, markSendState, confirmSend, patchLocal, removeLocal, upsertLocal, settle, rollback, fresh, readState,
  } = useMessageThread({
    conversationId, userId,
    onMarkedRead: onChanged,
    // Read means seen: the newest message has been on screen (see endRef),
    // and where you'd read up to before is known (the "New" line).
    readGate: bottomSeen && newAfter !== undefined,
    isReadable: endOnScreen,
  });


  // Tell the inbox this conversation is on screen, so its toast and OS
  // notification stay quiet only while it really is (COMMS-03).
  // Not while the panel plays its exit: a message landing then should still
  // say so with a toast.
  const closing = usePanelPresence() === 'closing';
  useEffect(() => (closing ? undefined : showingConversation(conversationId)), [conversationId, closing]);

  // ── Active participants (for title + group menu) ─────────────────────
  const activeParticipants = useMemo(
    () => (conversation?.participants || []).filter(p => !p.left_at),
    [conversation?.participants],
  );
  const peers = useMemo(
    () => activeParticipants.filter(p => p.user_id !== userId),
    [activeParticipants, userId],
  );
  // A DM is two participant ROWS, left or not. Counting only active ones
  // turned a group that dropped to two members into a "DIRECT MESSAGE" with
  // no way to rename it, add people or leave (COMMS-17).
  const isDm = isDmConversation(conversation?.participants);

  // Resolve display names.
  useEffect(() => {
    for (const p of peers) userProfiles.resolve(p.user_id);
  }, [peers]);
  const [, force] = useState(0);
  useEffect(() => userProfiles.subscribe(() => force(n => (n + 1) | 0)), []);

  const peerLabels = peers.map(p => {
    const u = userProfiles.get(p.user_id);
    return u?.name || u?.email || 'Member';
  });
  const titleText = conversation?.title || (peerLabels.length ? peerLabels.join(', ') : 'New conversation');
  // The card look's faces: the people in it besides you.
  const peerPeople = peers.map(p => {
    const u = userProfiles.get(p.user_id);
    return { id: p.user_id, name: u?.name || u?.email || 'Member', color: u?.color || pickPresenceColor(p.user_id || '') };
  });
  const firstPeer = (peerLabels[0] || '').split(/[\s@]/)[0];
  // A first name for "Replying to …": you, or whoever wrote it.
  const replyName = (uid) => {
    if (uid === userId) return 'yourself';
    const u = userProfiles.get(uid);
    return (u?.name || u?.email || 'Member').split(/[\s@]/)[0];
  };
  // A face for someone in the card look: theirs, or yours.
  const faceOf = (uid) => {
    const u = userProfiles.get(uid);
    const mine = uid === userId;
    return {
      id: uid,
      name: u?.name || u?.email || (mine ? currentUser?.name || currentUser?.email : '') || 'Member',
      color: u?.color || (mine ? currentUser?.color : null) || pickPresenceColor(uid || ''),
    };
  };
  // Who wrote a search result.
  const senderName = (m) => {
    if (m.sender_id === userId) return 'You';
    const u = userProfiles.get(m.sender_id);
    return u?.name || u?.email || m.sender_name || 'Member';
  };

  // ── Focus ────────────────────────────────────────────────────────────
  // Focus has a home in the conversation: the box you type in where there's a
  // mouse and a keyboard, the panel itself under a finger (a focused field
  // would raise the keyboard). The conversation opens with focus there, so
  // Escape and the shortcuts reach it (the list row that opened it is gone),
  // and focus goes back there whenever what held it goes away: an edit box
  // that saved, a search that closed, a menu or a palette that shut.
  const rootRef = useRef(null);
  const composerRef = useRef(null);
  const lastFocusRef = useRef(null);
  const focusHome = useCallback(() => {
    if (composerRef.current && finePointer()) composerRef.current.focus();
    else rootRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (!rootRef.current?.contains(document.activeElement)) focusHome();
    });
    return () => cancelAnimationFrame(id);
  }, [focusHome]);
  // Only focus that's still ours: pressing or moving focus anywhere outside
  // the panel lets it go, so an element removed after you've gone to the
  // canvas never pulls you back into the box you type in.
  const dropFocusIfOutside = useCallback((target) => {
    if (target && !rootRef.current?.contains(target)) lastFocusRef.current = null;
  }, []);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof MutationObserver === 'undefined') return undefined;
    let frame = 0;
    // Looked at once focus has settled: a press elsewhere can remove the
    // focused element (a rename that commits on blur) mid-way through moving
    // focus, and focus is on the page for that moment.
    const rescue = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const had = lastFocusRef.current;
        if (!had || had.isConnected) return;
        const active = document.activeElement;
        lastFocusRef.current = null;
        if (active && active !== document.body && active !== document.documentElement) return;
        focusHome();
      });
    };
    const inside = new MutationObserver(rescue);
    inside.observe(root, { childList: true, subtree: true });
    // Menus, pickers and palettes are portals on <body>; their focus counts.
    const portals = new MutationObserver(rescue);
    portals.observe(document.body, { childList: true });
    const onDown = (e) => dropFocusIfOutside(e.target);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      cancelAnimationFrame(frame);
      inside.disconnect(); portals.disconnect();
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [focusHome, dropFocusIfOutside]);

  // ── Staying where the reader is ─────────────────────────────────────
  // useStickToBottom keeps the newest message in view while you're at the
  // bottom, whatever grows (a message, an image, a reaction, the typing row,
  // the composer), and holds your place while you read history (older pages,
  // reactions and images landing above you). A send always goes to the bottom.
  const contentRef = useRef(null);
  const stick = useStickToBottom({ scrollRef, contentRef, startStuck: !jumpToMessageId });
  const [unseenCount, setUnseenCount] = useState(0);
  const prevLastIdRef = useRef(null);

  const requestOlder = () => {
    if (!hasOlder || loadingOlder || !scrollRef.current) return;
    // The controller holds the first message in view while the page lands above it.
    stick.captureAnchor();
    loadOlder();
  };
  const lastScrollTopRef = useRef(0);
  const onScroll = () => {
    stick.onScroll();
    if (stick.stuckRef.current) setUnseenCount(0);
    const el = scrollRef.current;
    if (!el) return;
    // Only an UPWARD scroll near the top pages back: the opening jump to the
    // bottom starts at scrollTop 0 and must not fetch history on its way down.
    const goingUp = el.scrollTop < lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;
    if (goingUp && el.scrollTop < LOAD_OLDER_THRESHOLD_PX && !searchOpen) requestOlder();
  };
  const jumpToBottom = () => {
    stick.pin();
    setUnseenCount(0);
  };

  // While you read history, count what the others send: the jump button says
  // how many. At the bottom the controller simply keeps you there.
  const lastId = lastMessageId(messages);
  useEffect(() => {
    const prevId = prevLastIdRef.current;
    prevLastIdRef.current = lastId;
    if (!lastId || !prevId || lastId === prevId || stick.stuckRef.current) return;
    const at = messages.findIndex(m => m.id === prevId);
    const added = messages.slice(at + 1).filter(m => m.sender_id !== userId && !m.sendState).length;
    if (added > 0) setUnseenCount(c => c + added);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

  // The end of the thread on screen = the newest message seen: only then does
  // the thread mark itself read (useMessageThread's readGate).
  useEffect(() => {
    const root = scrollRef.current;
    const end = endRef.current;
    if (!root || !end || typeof IntersectionObserver === 'undefined') { setBottomSeen(true); return undefined; }
    const io = new IntersectionObserver(([e]) => setBottomSeen(e.isIntersecting), { root, threshold: 0 });
    io.observe(end);
    return () => io.disconnect();
  }, []);

  // ── Search ───────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchInputRef = useRef(null);
  const searchSeqRef = useRef(0);
  // The search's last settled query, logged once as the search ends: its
  // length and what it found, never the words (msg_search).
  const searchStatRef = useRef(null);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!searchOpen || !q || !conversationId) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    const seq = ++searchSeqRef.current;
    const t = setTimeout(async () => {
      let rows = [];
      let failed = false;
      try {
        rows = await searchMessagesInConversation({ conversationId, query: q, limit: 50 });
      } catch (e) { failed = true; console.warn('search failed', e); }
      if (seq !== searchSeqRef.current) return;
      searchStatRef.current = { q_len: q.length, results_n: rows.length, failed };
      setSearchResults(rows);
      setSearching(false);
    }, 150);
    return () => clearTimeout(t);
  }, [searchQuery, searchOpen, conversationId]);

  const endSearch = (picked) => {
    const stat = searchStatRef.current;
    searchStatRef.current = null;
    if (stat) logEvent(EV.MSG_SEARCH, { ...stat, picked });
  };
  // Closing the panel mid-search ends it too.
  useEffect(() => () => {
    const stat = searchStatRef.current;
    if (stat) logEvent(EV.MSG_SEARCH, { ...stat, picked: false });
  }, []);

  const closeSearch = () => {
    endSearch(false);
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  // ── Replies ──────────────────────────────────────────────────────────
  // A reply sits in the conversation with what it answers quoted above it
  // (there's no separate thread view). replyTo is what your next send answers;
  // the composer shows it as "Replying to …", and Escape lets it go. It's part
  // of the conversation's draft, so it waits with your text if you go elsewhere.
  const replyTo = useDraftValue(conversationId || '', (d) => d.replyTo);
  const setReplyTo = useCallback((m) => updateDraft(conversationId || '', (d) => {
    const next = replyTarget(m);
    return (d.replyTo?.id || null) === (next?.id || null) ? d : { ...d, replyTo: next };
  }), [conversationId]);

  // Search results borrow the scroller: hands off while they're up, and back
  // to where you were after.
  useEffect(() => {
    if (!searchOpen) return undefined;
    return stick.suspend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen]);

  // ── Pinned strip ─────────────────────────────────────────────────────
  const [pinned, setPinned] = useState([]);
  const [pinnedExpanded, setPinnedExpanded] = useState(false);
  // Read again when a pin changes: one on screen (pinnedSig), a peer's pin
  // of any message, and after a resync (pinTick). Not on every arrival: the
  // pinned list is the whole conversation's, so a new message doesn't move it.
  const pinnedSig = messages.filter(m => m.is_pinned).map(m => m.id).join(',');
  useEffect(() => {
    if (!conversationId) return;
    if (fixture) { setPinned(messages.filter(m => m.is_pinned)); return; }
    let cancelled = false;
    listPinnedForConversation({ conversationId }).then(rows => { if (!cancelled) setPinned(rows); });
    return () => { cancelled = true; };
  }, [conversationId, pinnedSig, pinTick, fixture]);

  // ── Permalink scroll ─────────────────────────────────────────────────
  // Once, when the target's page is on screen. It re-ran on every new
  // message, so each arrival — your own sends too — yanked the view back up
  // to the permalinked message and closed an open search (COMMS-09). Keyed
  // on whether the target is loaded, not on the message count.
  const jumpTargetLoaded = !!jumpToMessageId && messages.some(m => m.id === jumpToMessageId);
  const jumpDoneRef = useRef(null);
  useEffect(() => {
    if (!jumpToMessageId || !jumpTargetLoaded) return;
    const key = `${conversationId}:${jumpToMessageId}`;
    if (jumpDoneRef.current === key) return;
    const t = setTimeout(() => {
      jumpDoneRef.current = key;
      flashMessage(jumpToMessageId);
      onJumpConsumed?.();
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToMessageId, jumpTargetLoaded, conversationId]);

  // A target older than the loaded pages is paged back to, a few pages at
  // most, so a permalink, pinned or search jump into old history still lands.
  // seekId is an in-thread jump (pinned / search) still waiting on its page;
  // a permalink is flashed by the effect above once its page arrives.
  const PERMALINK_MAX_PAGES = 5;
  const [seekId, setSeekId] = useState(null);
  const permalinkPagesRef = useRef(0);
  const seekTarget = seekId || jumpToMessageId;
  useEffect(() => { permalinkPagesRef.current = 0; }, [seekTarget, conversationId]);
  useEffect(() => { setSeekId(null); }, [conversationId]);
  useEffect(() => {
    if (!seekTarget) return;
    if (messages[0]?.conversation_id !== conversationId) return; // switch still loading
    if (messages.some(m => m.id === seekTarget)) {
      if (seekId) { setSeekId(null); flashMessage(seekId); }
      return;
    }
    if (loadingOlder) return;
    if (!hasOlder || permalinkPagesRef.current >= PERMALINK_MAX_PAGES) {
      if (seekId) setSeekId(null);
      return;
    }
    permalinkPagesRef.current += 1;
    loadOlder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekTarget, messages.length, hasOlder, loadingOlder, conversationId]);

  // ⌘F + j/k/r/e/Esc keyboard shortcuts.
  const [focusedId, setFocusedId] = useState(null);
  useEffect(() => {
    const onKey = (e) => {
      if (!e.target?.closest?.('.msg-panel')) return;
      const inField = ['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      }
      if (e.key === 'Escape') {
        // The nearest layer only. A control inside the panel that handled it
        // (the edit box, rename, the link field, the ⋯ menu, the emoji
        // palette) has claimed it with preventDefault; closing the whole
        // panel on the same press threw away what you were in (COMMS-10).
        if (e.defaultPrevented || e.isComposing) return;
        if (searchOpen) { closeSearch(); return; }
        if (replyTo) { setReplyTo(null); return; }
        if (escapeClosesPanel(e, '.msg-panel')) onClose?.();
        return;
      }
      if (inField) return;
      const list = messages;
      if (list.length === 0) return;
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        const dir = e.key === 'j' ? 1 : -1;
        const idx = focusedId ? list.findIndex(m => m.id === focusedId) : (dir > 0 ? -1 : list.length);
        const next = list[Math.max(0, Math.min(list.length - 1, idx + dir))];
        if (next) {
          setFocusedId(next.id);
          requestAnimationFrame(() => {
            const el = scrollRef.current?.querySelector(`[data-msg-id="${next.id}"]`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          });
        }
      } else if (e.key === 'r' && focusedId) {
        const m = list.find(x => x.id === focusedId);
        if (m && !m.sendState) { e.preventDefault(); setReplyTo(m); }
      } else if (e.key === 'e' && focusedId) {
        const m = list.find(x => x.id === focusedId);
        if (m && m.sender_id === userId) {
          e.preventDefault();
          document.dispatchEvent(new CustomEvent('soleil-msg-edit', { detail: { id: m.id }}));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen, replyTo, messages, focusedId, userId, onClose]);

  const flashMessage = (msgId) => {
    closeSearch();
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(`[data-msg-id="${msgId}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('is-flashed');
      setTimeout(() => el.classList.remove('is-flashed'), 1600);
    });
  };

  const messagesById = useMemo(() => {
    const m = new Map();
    for (const x of messages || []) m.set(x.id, x);
    return m;
  }, [messages]);
  // Jump within the thread: flash it if it's loaded, else page back to it.
  // One function for the life of the thread (it reads the latest through a
  // ref), so the memoized bubbles that hold it don't all re-render.
  const jumpToRef = useRef(null);
  jumpToRef.current = (msgId) => {
    if (messagesById.has(msgId)) { flashMessage(msgId); return; }
    closeSearch();
    setSeekId(msgId);
  };
  const jumpTo = useCallback((msgId) => jumpToRef.current(msgId), []);

  // What a reply quotes when the original isn't on screen (older than the
  // pages loaded, or deleted): read by id, once each.
  const [quoteRows, setQuoteRows] = useState(() => new Map());
  useEffect(() => {
    const want = [...new Set(messages
      .filter(m => m.parent_id && !messagesById.has(m.parent_id) && !quoteRows.has(m.parent_id))
      .map(m => m.parent_id))];
    if (!want.length || fixture || !conversationId) return undefined;
    let cancelled = false;
    fetchMessagesByIds({ conversationId, ids: want }).then(rows => {
      if (cancelled || rows == null) return;
      setQuoteRows(prev => {
        const next = new Map(prev);
        for (const id of want) {
          const r = rows.find(x => x.id === id);
          next.set(id, !r ? { id, unavailable: 'missing' } : r.deleted_at ? { id, unavailable: 'deleted' } : r);
        }
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [messages, messagesById, quoteRows, conversationId, fixture]);
  const quoteFor = (m) => (m.parent_id ? (messagesById.get(m.parent_id) || quoteRows.get(m.parent_id) || null) : null);

  // ── Day dividers, runs and the "New" line (lib/messageFeed.js) ───────
  // A message continues the run above it when it's from the same sender,
  // within 5 minutes of the one before it, on the same day, and is neither a
  // reply nor pinned; continuations drop their avatar/name/time header (see
  // MessageBubble's isContinuation). A message still sending is laid out
  // like the one it becomes, so it never changes shape when it's saved.
  // The card look keeps a reply and a pin in their run: the quote sits inside
  // the bubble, and "Pinned" in the line under it.
  const groupedMessages = useMemo(
    () => buildFeedItems(messages, { selfId: userId, newAfter: newAfter || null, ...(card ? { breakOnPin: false, breakOnReply: false } : {}) }),
    [messages, userId, newAfter, card],
  );

  // "Seen", in a DM only: under your newest message once the other person has
  // read it (lib/messageFeed.js). Their position is the later of what the
  // list knows and what this thread last read; one who left still counts.
  const peerId = isDm ? (conversation?.participants || []).find(p => p.user_id !== userId)?.user_id || null : null;
  const listReadAt = (conversation?.participants || []).find(p => p.user_id === peerId)?.last_read_at || null;
  const liveReadAt = peerId ? readState.get(peerId) || null : null;
  const peerLastReadAt = !listReadAt ? liveReadAt : !liveReadAt ? listReadAt : (listReadAt > liveReadAt ? listReadAt : liveReadAt);
  const seenId = useMemo(
    () => selectSeenMessageId(messages, { selfId: userId, isDm, peerId, peerLastReadAt }),
    [messages, userId, isDm, peerId, peerLastReadAt],
  );

  // Opening with more unread than fits: land on the "New" line, not the
  // bottom, so you start where you left off. A linked message wins, and so
  // does the bottom when everything new fits on screen.
  const landedRef = useRef(false);
  useLayoutEffect(() => {
    if (landedRef.current || !fresh) return;
    landedRef.current = true;
    if (jumpToMessageId) return;
    const el = scrollRef.current;
    const line = el?.querySelector('.msg-new-divider');
    if (!el || !line) return;
    // Measured from the end of the thread, wherever the scroller is right now.
    const lineInContent = line.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    if (el.scrollHeight - lineInContent <= el.clientHeight) return;
    stick.holdAt(line, 64);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh]);

  // ── Send / Edit / Delete / React / Reply / Pin / Copy-link ──────────
  // Everything shows before the server answers (useMessageThread's local
  // writes). A send appears at once with the id the server will keep, so its
  // bubble never remounts or changes shape when it's confirmed; a reaction,
  // edit, pin or delete shows at once and rolls back, with a toast, if the
  // server refuses it. A failed send stays in the thread with Retry/Discard
  // (the composer already cleared, so the bubble owns recovery) plus a toast
  // in case you've scrolled away.
  const sendOpsRef = useRef(new Map()); // message id → its send's write
  const sendTriesRef = useRef(new Map()); // message id → { n: attempts, at: when the last began } (msg_send)

  const deliverPending = useCallback(async (row) => {
    const opId = sendOpsRef.current.get(row.id);
    const tries = sendTriesRef.current.get(row.id) || { n: 0, at: 0 };
    tries.n += 1;
    tries.at = Date.now();
    sendTriesRef.current.set(row.id, tries);
    let saved = null;
    try {
      saved = await sendMessage({
        id: row.id,
        workspaceId, conversationId,
        senderId: userId,
        senderEmail: currentUser?.email || null,
        parentId: row.parent_id,
        body: row.body, attachments: row.attachments, mentions: row.mentions,
      });
    } catch (e) {
      // A retry whose first try was saved after all (its answer was lost)
      // hits the id it already has: show the stored message, not a copy.
      if (e?.code === '23505') saved = (await fetchMessagesByIds({ conversationId, ids: [row.id] }))?.[0] || null;
      if (!saved) {
        console.warn('send failed', e);
        markSendState(opId, 'failed');
        logEvent(EV.MSG_SEND, { ok: false, attempt: tries.n, ms: Date.now() - tries.at, code: errorCode(e), ...sendShape(row) });
        feedback.toast({ type: 'error', message: "Message didn't send — it's kept in the thread with a Retry button." });
        return;
      }
    }
    sendOpsRef.current.delete(row.id);
    sendTriesRef.current.delete(row.id);
    confirmSend(opId, saved);
    logEvent(EV.MSG_SEND, { ok: true, attempt: tries.n, ms: Date.now() - tries.at, ...sendShape(row) });
    // Tell the others once it's saved, without waiting on the socket: a slow
    // or failed broadcast must never make a saved message look unsent. They
    // re-read it by id; the payload carries nothing else.
    broadcastConversationMessage({ conversationId, payload: { id: saved.id, sender_id: saved.sender_id } })
      .then(null, (e) => console.warn('send broadcast failed', e));
    // No list re-read here: the insert bumps the conversation (0058's
    // messages_touch_conversation) and the list hears that change live. A
    // read per send was three queries in each of two lists, on top of it.
  }, [workspaceId, conversationId, userId, currentUser, markSendState, confirmSend, feedback]);

  const handleSend = useCallback(async ({ body, attachments, mentions }) => {
    if (!conversationId) return false;
    const row = {
      id: newMessageId(),
      conversation_id: conversationId,
      workspace_id: workspaceId,
      kind: 'user',
      body, attachments, mentions,
      parent_id: replyTo?.id || null,
      sender_id: userId,
      sender_email: currentUser?.email || null,
      sender_name: currentUser?.name || currentUser?.email,
      reactions: {},
      created_at: new Date().toISOString(),
    };
    sendOpsRef.current.set(row.id, sendLocal(row));
    setReplyTo(null);
    stick.requestPin();
    deliverPending(row);
    return true;
  }, [conversationId, workspaceId, replyTo, userId, currentUser, sendLocal, deliverPending, stick]);

  const retryPending = useCallback((msg) => {
    markSendState(sendOpsRef.current.get(msg.id), 'sending');
    deliverPending(msg);
  }, [markSendState, deliverPending]);
  const discardPending = useCallback((msg) => {
    rollback(sendOpsRef.current.get(msg.id));
    sendOpsRef.current.delete(msg.id);
    logEvent(EV.MSG_ACTION, { action: 'discard', attempts: sendTriesRef.current.get(msg.id)?.n || 0 });
    sendTriesRef.current.delete(msg.id);
  }, [rollback]);

  const handleDelete = useCallback(async (msg) => {
    // No confirm: it goes at once and the toast's Undo brings it back (the
    // house convention for deleting). Messages soft-delete via deleted_at.
    const opId = removeLocal(msg.id);
    try {
      await deleteMessage({ id: msg.id });
    } catch (e) {
      console.warn('delete failed', e);
      rollback(opId);
      logEvent(EV.MSG_ACTION, { action: 'delete', ok: false, code: errorCode(e) });
      feedback.toast({ type: 'error', message: 'Could not delete the message — try again.' });
      return;
    }
    settle(opId);
    logEvent(EV.MSG_ACTION, { action: 'delete', ok: true });
    // Peers only learn of a change already in the thread from a nudge:
    // messages aren't in the realtime publication (COMMS-04).
    broadcastConversationChange({ conversationId, changed: 'delete', id: msg.id });
    undoToast(feedback, {
      message: 'Message deleted',
      onUndo: async () => {
        const back = upsertLocal({ ...msg, deleted_at: null });
        try {
          await restoreMessage({ id: msg.id });
          settle(back);
          logEvent(EV.MSG_ACTION, { action: 'undo_delete', ok: true });
          broadcastConversationChange({ conversationId, changed: 'restore', id: msg.id });
        }
        catch (e) {
          rollback(back);
          logEvent(EV.MSG_ACTION, { action: 'undo_delete', ok: false, code: errorCode(e) });
          feedback.toast({ type: 'error', message: 'Could not restore the message — try again.' });
        }
      },
    });
  }, [conversationId, removeLocal, upsertLocal, settle, rollback, feedback]);

  // Resolves false when the save failed, so the bubble reopens with your text.
  const handleEdit = useCallback(async (msg, newBody) => {
    const opId = patchLocal(msg.id, { body: newBody, edited_at: new Date().toISOString() });
    try {
      await editMessage({ id: msg.id, body: newBody });
    } catch (e) {
      console.warn('edit failed', e);
      rollback(opId);
      logEvent(EV.MSG_ACTION, { action: 'edit', ok: false, code: errorCode(e) });
      feedback.toast({ type: 'error', message: 'Could not save your edit — try again.' });
      return false;
    }
    settle(opId);
    logEvent(EV.MSG_ACTION, { action: 'edit', ok: true });
    broadcastConversationChange({ conversationId, changed: 'edit', id: msg.id });
    return true;
  }, [conversationId, patchLocal, settle, rollback, feedback]);

  const handleReact = useCallback(async (msg, emoji) => {
    if (!emoji) return;
    const action = Array.isArray(msg.reactions?.[emoji]) && msg.reactions[emoji].includes(userId) ? 'unreact' : 'react';
    const opId = patchLocal(msg.id, { reactions: toggleReactionMap(msg.reactions, emoji, userId) });
    try {
      const reactions = await toggleReaction({ messageId: msg.id, emoji, userId });
      settle(opId, reactions && typeof reactions === 'object' ? { patch: { reactions } } : {});
      logEvent(EV.MSG_ACTION, { action, ok: true });
      broadcastConversationChange({ conversationId, changed: 'react', id: msg.id });
    } catch (e) {
      rollback(opId);
      logEvent(EV.MSG_ACTION, { action, ok: false, code: errorCode(e) });
      feedback.toast({ type: 'error', message: "Couldn't save your reaction — try again." });
    }
  }, [conversationId, userId, patchLocal, settle, rollback, feedback]);

  const handleReply = useCallback((msg) => {
    setReplyTo(msg);
    setFocusedId(null);
    logEvent(EV.MSG_ACTION, { action: 'reply' });
  }, []);

  // ↑ in an empty composer: edit your last message (the `e` key's event),
  // brought into view. False when there's none to edit, so ↑ stays a caret key.
  const editLast = useCallback(() => {
    const m = lastEditableMessage(messages, userId);
    if (!m) return false;
    document.dispatchEvent(new CustomEvent('soleil-msg-edit', { detail: { id: m.id } }));
    requestAnimationFrame(() => {
      scrollRef.current?.querySelector(`[data-msg-id="${m.id}"]`)?.scrollIntoView({ block: 'nearest' });
    });
    return true;
  }, [messages, userId]);

  const handlePin = useCallback(async (msg) => {
    const action = msg.is_pinned ? 'unpin' : 'pin';
    const opId = patchLocal(msg.id, { is_pinned: !msg.is_pinned });
    try {
      const isPinned = await togglePin(msg.id);
      settle(opId, { patch: { is_pinned: isPinned } });
      broadcastConversationChange({ conversationId, changed: 'pin', id: msg.id });
      const rows = await listPinnedForConversation({ conversationId });
      setPinned(rows);
      logEvent(EV.MSG_ACTION, { action, ok: true });
    } catch (e) {
      console.warn('pin failed', e);
      rollback(opId);
      feedback.toast({ type: 'error', message: msg.is_pinned ? "Couldn't unpin the message — try again." : "Couldn't pin the message — try again." });
      logEvent(EV.MSG_ACTION, { action, ok: false, code: errorCode(e) });
    }
  }, [conversationId, patchLocal, settle, rollback, feedback]);

  // Say whether it worked: a silent copy left you guessing (COMMS-24).
  const handleCopyLink = useCallback(async (msg) => {
    const url = `${window.location.origin}${window.location.pathname}?m=${msg.id}`;
    try {
      await navigator.clipboard.writeText(url);
      logEvent(EV.MSG_ACTION, { action: 'copy_link', ok: true });
      feedback.toast({ type: 'success', message: 'Link copied' });
    } catch (_) {
      logEvent(EV.MSG_ACTION, { action: 'copy_link', ok: false });
      feedback.toast({ type: 'error', message: "Couldn't copy the link — your browser blocked the clipboard." });
    }
  }, [feedback]);

  const handleTyping = useCallback(() => {
    if (!conversationId) return;
    broadcastConversationTyping({ conversationId, userId });
  }, [conversationId, userId]);

  // ── Press and hold (a finger) ────────────────────────────────────────
  // Under a finger there's no hover chip: holding a message opens its
  // actions in a sheet. The click that ends the hold is eaten (it would open
  // a link or an attachment under the finger), and the long-press menu
  // Android raises a moment later is turned away.
  const [sheetId, setSheetId] = useState(null);
  const heldAtRef = useRef(0);
  useLongPress(scrollRef, (x, y, e) => {
    const id = e?.target?.closest?.('[data-msg-id]')?.getAttribute('data-msg-id');
    const m = id ? messagesById.get(id) : null;
    if (!m || m.sendState || m.kind === 'system') return;
    heldAtRef.current = Date.now();
    swallowNextClick({ held: true });
    setSheetId(id);
    logEvent(EV.MSG_ACTION, { action: 'sheet' });
  }, { ms: 480, tolerance: 8, pointerType: 'touch' });
  const sheetMsg = sheetId ? messagesById.get(sheetId) || null : null;
  const onThreadContextMenu = (e) => { if (Date.now() - heldAtRef.current < 1500) e.preventDefault(); };
  const handleCopyText = useCallback(async (msg) => {
    try {
      await navigator.clipboard.writeText(msg.body || '');
      logEvent(EV.MSG_ACTION, { action: 'copy_text', ok: true });
      feedback.toast({ type: 'success', message: 'Copied' });
    } catch (_) {
      logEvent(EV.MSG_ACTION, { action: 'copy_text', ok: false });
      feedback.toast({ type: 'error', message: "Couldn't copy — your browser blocked the clipboard." });
    }
  }, [feedback]);
  const requestEdit = useCallback((msg) => {
    document.dispatchEvent(new CustomEvent('soleil-msg-edit', { detail: { id: msg.id } }));
  }, []);

  // ── The card look: editing in the box, one menu, the pinned list ─────
  // An edit happens in the box you type in, its message outlined in the
  // thread: ↑ in an empty box, the `e` key, and a menu's or a sheet's Edit
  // all ask for it (soleil-msg-edit). Saving shows at once; a save that
  // fails reopens the edit with your words (handleEdit resolves false).
  const [editingMsg, setEditingMsg] = useState(null); // { id, body, draft }
  const messagesByIdRef = useRef(messagesById);
  messagesByIdRef.current = messagesById;
  const editingRef = useRef(null);
  editingRef.current = editingMsg;
  useEffect(() => {
    if (!card) return undefined;
    const onEditRequest = (e) => {
      const m = messagesByIdRef.current.get(e.detail?.id);
      if (!m || m.sender_id !== userId || m.sendState || !withinEditWindow(m.created_at)) return;
      setEditingMsg({ id: m.id, body: m.body, draft: null });
    };
    document.addEventListener('soleil-msg-edit', onEditRequest);
    return () => document.removeEventListener('soleil-msg-edit', onEditRequest);
  }, [card, userId]);
  // A message that goes (deleted here or by a peer) lets its edit go too.
  useEffect(() => {
    if (editingMsg && !messagesById.has(editingMsg.id)) setEditingMsg(null);
  }, [editingMsg, messagesById]);
  const cancelEdit = useCallback(() => setEditingMsg(null), []);
  const saveEdit = useCallback(async (text) => {
    const m = editingRef.current && messagesByIdRef.current.get(editingRef.current.id);
    setEditingMsg(null);
    if (!m || text === m.body) return;
    const ok = await handleEdit(m, text);
    // Reopened with your words, unless you've started another edit meanwhile
    // (the toast still says this one didn't save).
    if (ok === false && !editingRef.current) setEditingMsg({ id: m.id, body: m.body, draft: text });
  }, [handleEdit]);

  // A message's actions are one menu, from its ⋯ (which toggles it) or a
  // right click.
  const [menuFor, setMenuFor] = useState(null); // { id, anchor, trigger }
  const openMenu = useCallback((msg, anchor, trigger) => {
    setMenuFor(cur => (cur && trigger && cur.trigger === trigger ? null : { id: msg.id, anchor, trigger }));
  }, []);
  // Shut from inside (an action, Escape): focus goes home, as when anything
  // that held it goes away; a press elsewhere keeps where it went.
  const settleFocus = useCallback((back) => {
    if (!back) return;
    requestAnimationFrame(() => { if (!rootRef.current?.contains(document.activeElement)) focusHome(); });
  }, [focusHome]);
  const closeMenu = useCallback((back) => { setMenuFor(null); settleFocus(back); }, [settleFocus]);
  const menuMsg = menuFor ? messagesById.get(menuFor.id) || null : null;
  // A message that goes (deleted here or by a peer) takes its menu with it,
  // so an Undo doesn't bring the menu back where it was.
  useEffect(() => { if (menuFor && !menuMsg) setMenuFor(null); }, [menuFor, menuMsg]);

  // The pinned messages open from the count in the header.
  const [pinsFor, setPinsFor] = useState(null); // { anchor, trigger }
  const closePins = useCallback((back) => { setPinsFor(null); settleFocus(back); }, [settleFocus]);
  // Unpinning the last one empties the list: it shuts, and focus goes home.
  useEffect(() => { if (pinsFor && !pinned.length) closePins(true); }, [pinsFor, pinned.length, closePins]);

  const handleAttachmentDragStart = attachmentDragStart;

  // ── Group chat actions ───────────────────────────────────────────────
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [addPickerAnchor, setAddPickerAnchor] = useState(null);

  const beginRename = () => {
    setRenameValue(conversation?.title || '');
    setRenaming(true);
    setMenuAnchor(null);
  };
  const commitRename = async () => {
    const next = renameValue.trim();
    setRenaming(false);
    if (next === (conversation?.title || '')) return;
    try {
      await renameConversation({ conversationId, title: next });
      onChanged?.();
    } catch (e) {
      console.warn('rename failed', e);
      feedback.toast({ type: 'error', message: 'Could not rename the conversation — try again.' });
    }
  };

  const openLeaveConfirm = async () => {
    if (isDm) return;
    setMenuAnchor(null);
    const ok = await feedback.confirm({
      title: 'Leave conversation',
      message: `Leave "${titleText}"? You'll stop receiving its messages.`,
      confirmLabel: 'Leave',
      danger: true,
    });
    if (!ok) return;
    // leaveConversation resolves false on a failed write (it never threw, so
    // a failure used to pass as a leave).
    const convId = conversationId;
    const left = await leaveConversation({ conversationId: convId, userId });
    if (!left) {
      feedback.toast({ type: 'error', message: 'Could not leave the conversation — try again.' });
      return;
    }
    onChanged?.();
    onBack?.();
    undoToast(feedback, {
      message: 'You left the conversation',
      onUndo: async () => {
        const back = await rejoinConversation({ conversationId: convId, userId });
        if (!back) { feedback.toast({ type: 'error', message: "Couldn't bring the conversation back — try again." }); return; }
        onChanged?.();
      },
    });
  };

  // ── Render ───────────────────────────────────────────────────────────
  const isEmpty = !searchOpen && messages.length === 0;
  // Who's typing, for the card look's dots: first names, or one's full name.
  const typingIds = [...typingUsers.keys()];
  const typingNames = typingIds.map(id => (userProfiles.get(id)?.name || userProfiles.get(id)?.email || 'Someone').split(/[\s@]/)[0]);
  const typingFull = typingIds.length === 1 ? (userProfiles.get(typingIds[0])?.name || typingNames[0]) : '';
  const subtitle = isDm ? 'DIRECT MESSAGE' : 'GROUP CHAT';

  const showPinned = !searchOpen && pinned.length > 0;

  const draftKey = conversationId || '';

  return (
    <div className="msg-pane msg-pane-thread" ref={rootRef} tabIndex={-1}
         onFocus={(e) => { lastFocusRef.current = e.target; }}
         onBlur={(e) => dropFocusIfOutside(e.relatedTarget)}>
      <div className="msg-panel-head">
        {card && searchOpen ? (
          // The card look searches in the header: the field, then Done.
          <>
            <label className="msg-search is-head">
              <Icon as={Search} size={15} weight="regular" />
              <input
                ref={searchInputRef}
                className="msg-search-input"
                placeholder={`Search ${titleText}`}
                aria-label="Search this conversation"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button type="button" className="msg-search-clear" aria-label="Clear the search"
                        onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}>
                  <Icon as={X} size={12} weight="regular" />
                </button>
              )}
            </label>
            <button type="button" className="msg-search-done" onClick={closeSearch}>Done</button>
          </>
        ) : (
        <>
        <button
          className="msg-panel-icon"
          onClick={() => onBack?.()}
          title="Back"
          aria-label="Back"
        >
          <Icon as={ChevronLeft} size={14} />
        </button>
        {card && <MessageFaces people={peerPeople} size={28} className="msg-panel-faces" />}
        <div className="msg-panel-title">
          {!card && <div className="t-eyebrow msg-panel-eyebrow">{subtitle}</div>}
          {renaming ? (
            <input
              className="msg-panel-name-input"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                // Claim the key: cancelling the rename must not close the panel.
                if (e.key === 'Escape') { e.preventDefault(); setRenaming(false); }
              }}
              onBlur={commitRename}
              maxLength={80}
            />
          ) : (
            <button
              className="msg-panel-name"
              title={titleText}
              onClick={!isDm ? beginRename : undefined}
            >
              {titleText}
            </button>
          )}
          {card && (isDm ? dmSubline(peerHere) : membersLine(peerLabels)) && (
            <div className="msg-panel-sub">
              {isDm ? dmSubline(peerHere) : membersLine(peerLabels)}
            </div>
          )}
        </div>
        {card && pinned.length > 0 && (
          <button
            type="button"
            className={`msg-pins-chip ${pinsFor ? 'is-active' : ''}`}
            onClick={(e) => { const el = e.currentTarget; setPinsFor(cur => (cur ? null : { anchor: el.getBoundingClientRect(), trigger: el })); }}
            title="Pinned messages"
            aria-label={`${pinned.length} pinned message${pinned.length === 1 ? '' : 's'}`}
            aria-expanded={!!pinsFor}
          >
            <Icon as={Pin} size={13} weight="regular" />{pinned.length}
          </button>
        )}
        {!isDm && !card && (
          <button
            className="msg-panel-icon"
            onClick={(e) => setMenuAnchor(e.currentTarget.getBoundingClientRect())}
            title="Conversation actions"
            aria-label="Conversation actions"
          >
            <Icon as={MoreHorizontal} size={14} />
          </button>
        )}
        <button
          className={`msg-panel-icon ${searchOpen ? 'is-active' : ''}`}
          onClick={() => {
            if (searchOpen) closeSearch();
            else { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0); }
          }}
          title="Search messages (⌘F)"
          aria-label="Search messages"
        >
          <Icon as={Search} size={14} />
        </button>
        {!isDm && card && (
          <button
            className={`msg-panel-icon ${menuAnchor ? 'is-active' : ''}`}
            onClick={(e) => setMenuAnchor(e.currentTarget.getBoundingClientRect())}
            title="Conversation actions"
            aria-label="Conversation actions"
          >
            <Icon as={MoreHorizontal} size={14} />
          </button>
        )}
        <button className="msg-panel-icon" onClick={onClose} title="Close (Esc)" aria-label="Close messages">
          <Icon as={X} size={14} />
        </button>
        </>
        )}
      </div>

      {menuAnchor && (
        <GroupChatMenu
          anchor={menuAnchor}
          onRename={beginRename}
          onAdd={() => { setAddPickerAnchor(menuAnchor); setMenuAnchor(null); }}
          onLeave={openLeaveConfirm}
          // Any group can be left. The old 3+ rule only existed because a
          // group at two members was mistaken for a DM (COMMS-17).
          canLeave
          onClose={() => setMenuAnchor(null)}
        />
      )}

      {addPickerAnchor && (
        <AddParticipantsPicker
          workspaceId={workspaceId}
          conversationId={conversationId}
          existingIds={new Set(activeParticipants.map(p => p.user_id))}
          anchor={addPickerAnchor}
          onClose={() => setAddPickerAnchor(null)}
          onAdded={() => {
            setAddPickerAnchor(null); onChanged?.(); refetch();
            broadcastConversationChange({ conversationId, changed: 'participants' });
          }}
          actorId={userId}
          currentUser={currentUser}
        />
      )}

      {searchOpen && !card && (
        <div className="msg-search">
          <Icon as={Search} size={12} />
          <input
            ref={searchInputRef}
            className="msg-search-input"
            placeholder="Find in conversation…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button className="msg-search-clear" onClick={closeSearch}>×</button>
        </div>
      )}

      {showPinned && !card && (
        <div className={`msg-pinned-strip ${pinnedExpanded ? 'is-expanded' : ''}`}>
          <button className="msg-pinned-head" onClick={() => setPinnedExpanded(v => !v)}>
            <Icon as={Pin} size={11} />
            <span className="t-eyebrow">PINNED · {pinned.length}</span>
            <span className="msg-pinned-chev">{pinnedExpanded ? '▾' : '▸'}</span>
          </button>
          {pinnedExpanded && (
            <div className="msg-pinned-list">
              {pinned.map(p => (
                <button
                  key={p.id}
                  className="msg-pinned-item"
                  onClick={() => jumpTo(p.id)}
                  title={`Jump to message · ${new Date(p.created_at).toLocaleString()}`}
                >
                  <span className="msg-pinned-item-body">{(p.body || '').slice(0, 80)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="msg-thread-scroll">
      <div className={`msg-thread-body${card ? (isDm ? ' is-dm' : ' is-group') : ''}`} ref={scrollRef} onScroll={onScroll} onContextMenu={onThreadContextMenu}>
        <div className="msg-thread-content" ref={contentRef}>
        {!searchOpen && hasOlder && (
          <button
            type="button"
            className="msg-load-older t-meta"
            onClick={requestOlder}
            disabled={loadingOlder}
          >
            {loadingOlder ? 'Loading earlier messages…' : 'Load earlier messages'}
          </button>
        )}
        {searchOpen && searchQuery.trim() ? (
          <>
            <div className="msg-search-summary t-meta">
              {searching ? 'Searching…' : card
                ? `${searchResults.length} message${searchResults.length === 1 ? '' : 's'} in ${titleText}`
                : `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`}
            </div>
            {searchResults.length === 0 && !searching && (
              <div className="msg-empty">No matches for "{searchQuery}".</div>
            )}
            {/* A result is one button: who, when, and the words around the
                match. A whole message inside it put its own buttons inside
                a button, and pressing React there jumped as well. */}
            {searchResults.map(m => {
              const parts = snippetParts(m.body, searchQuery);
              return (
                <button key={m.id} type="button" className="msg-search-result" onClick={() => { endSearch(true); jumpTo(m.id); }}>
                  {card && <MessageFaces people={[faceOf(m.sender_id)]} size={26} />}
                  <span className="msg-search-result-head">
                    <span className="msg-search-result-who">{senderName(m)}</span>
                    <RelTime className="msg-search-result-time" iso={m.created_at} />
                  </span>
                  <span className="msg-search-result-body">
                    {parts.length
                      ? parts.map((p, i) => (p.match
                        ? <mark key={i} className="msg-bubble-mark">{p.text}</mark>
                        : <span key={i}>{p.text}</span>))
                      : (m.attachments?.[0]?.name || 'Attachment')}
                  </span>
                </button>
              );
            })}
          </>
        ) : isEmpty && loadFailed ? (
          // A failed read is not an empty conversation (COMMS-15).
          <div className="msg-empty msg-load-failed" role="alert">
            <span>Couldn't load messages.</span>
            <button type="button" className="msg-retry-btn" onClick={() => refetch()}>Retry</button>
          </div>
        ) : isEmpty && loading ? (
          // Still reading this conversation: not "No messages yet". The card
          // look shows the shape of a thread if the read takes a moment.
          card ? <ThreadSkeleton /> : null
        ) : isEmpty ? (
          card ? (
            <div className="msg-empty msg-empty-hero is-card">
              <MessageFaces people={peerPeople} size={56} />
              <div className="msg-empty-title">{titleText}</div>
              <div className="msg-empty-sub">
                {isDm && firstPeer ? `This is the start of your conversation with ${firstPeer}.` : `This is the start of ${titleText}.`}
              </div>
            </div>
          ) : (
            <div className="msg-empty msg-empty-hero">
              <SoleilMark size={32} color="var(--soleil)" glow />
              <div className="msg-empty-title">No messages yet</div>
              <div className="msg-empty-sub">Say hi</div>
            </div>
          )
        ) : (
          <>
            {groupedMessages.map(g => g.kind === 'divider' ? (
              <div key={g.key} className="msg-day-divider"><span>{g.label}</span></div>
            ) : g.kind === 'new' ? (
              <div key={g.key} className="msg-new-divider" role="separator" aria-label="New messages"><span>New</span></div>
            ) : g.msg.kind === 'system' ? (
              <div key={g.key} className="msg-system-row t-meta">{g.msg.body}</div>
            ) : (
              <MessageBubble
                key={g.key} msg={g.msg} selfId={userId}
                isContinuation={g.isContinuation}
                parent={quoteFor(g.msg)}
                onJumpToMessage={jumpTo}
                isFocused={focusedId === g.msg.id}
                onDelete={handleDelete}
                onAttachmentDragStart={handleAttachmentDragStart}
                onReact={handleReact}
                onEdit={handleEdit}
                onReply={handleReply}
                onPin={handlePin}
                onCopyLink={handleCopyLink}
                onRetrySend={retryPending}
                onDiscardSend={discardPending}
                seen={g.msg.id === seenId}
                card={card}
                inDm={isDm}
                runStart={g.runStart}
                joinUp={g.joinUp}
                joinDown={g.joinDown}
                runEnd={g.runEnd}
                showTime={g.showTime}
                editingHere={card && editingMsg?.id === g.msg.id}
                menuOpen={card && menuFor?.id === g.msg.id}
                onOpenMenu={card ? openMenu : undefined}
              />
            ))}
            {typingUsers.size > 0 && (card ? (
              // The card look: a bubble of dots from them, named in a group.
              <div className="msg-typing is-card" role="status" aria-label={typingLabel(typingNames)}>
                {!isDm && <div className="msg-bubble-author">{typingNames.length === 1 ? typingFull : typingLabel(typingNames)}</div>}
                <div className="msg-typing-bubble"><span className="msg-typing-dots"><span /><span /><span /></span></div>
              </div>
            ) : (
              <div className="msg-typing">
                <span className="msg-typing-dots"><span /><span /><span /></span>
                <span className="t-meta">{typingUsers.size === 1 ? 'Typing…' : `${typingUsers.size} typing…`}</span>
              </div>
            ))}
          </>
        )}
          <div className="msg-thread-end" ref={endRef} aria-hidden="true" />
        </div>
      </div>

      {!searchOpen && !stick.stuck && (card ? (
        // The card look: a round chip with how many are new on its corner.
        <button type="button" className="msg-jump-pill is-round" onClick={jumpToBottom} title="Latest"
                aria-label={unseenCount > 0 ? `Jump to the latest, ${unseenCount} new` : 'Jump to the latest'}>
          <Icon as={ArrowDown} size={16} weight="regular" />
          {unseenCount > 0 && <span className="msg-jump-n" aria-hidden="true">{unseenCount > 99 ? '99+' : unseenCount}</span>}
        </button>
      ) : (
        <button type="button" className="msg-jump-pill" onClick={jumpToBottom}
                aria-label={unseenCount > 0 ? `Jump to the latest, ${unseenCount} new` : 'Jump to the latest'}>
          <Icon as={ArrowDown} size={13} />
          {unseenCount > 0 ? `${unseenCount} new message${unseenCount === 1 ? '' : 's'}` : 'Latest'}
        </button>
      ))}
      </div>

      {canSend ? (
        <MessageComposer
          ref={composerRef}
          onSend={handleSend}
          onTyping={handleTyping}
          workspaceId={workspaceId}
          userId={userId}
          draftKey={draftKey}
          placeholder={card ? `Message ${isDm && firstPeer ? firstPeer : titleText}` : 'Message…'}
          card={card}
          editing={card ? editingMsg : null}
          onSaveEdit={saveEdit}
          onCancelEdit={cancelEdit}
          replyTo={replyTo}
          replyToName={replyTo ? replyName(replyTo.sender_id) : ''}
          onCancelReply={() => setReplyTo(null)}
          onEditLast={editLast}
        />
      ) : (
        <ReadOnlyComposerNotice reason={readOnlyReason} />
      )}

      {menuMsg && (
        <MessageMenu
          msg={menuMsg}
          selfId={userId}
          anchor={menuFor.anchor}
          trigger={menuFor.trigger}
          onClose={closeMenu}
          onReact={handleReact}
          onReply={handleReply}
          onCopyText={handleCopyText}
          onCopyLink={handleCopyLink}
          onPin={handlePin}
          onEdit={requestEdit}
          onDelete={handleDelete}
        />
      )}

      {card && pinsFor && pinned.length > 0 && (
        <MessagePinsPopover
          anchor={pinsFor.anchor}
          trigger={pinsFor.trigger}
          title={titleText}
          pinned={pinned}
          selfId={userId}
          onJump={jumpTo}
          onUnpin={handlePin}
          onClose={closePins}
        />
      )}

      {sheetMsg && (
        <MessageActionSheet
          msg={sheetMsg}
          selfId={userId}
          onClose={() => setSheetId(null)}
          onReact={handleReact}
          onReply={handleReply}
          onCopyText={handleCopyText}
          onCopyLink={handleCopyLink}
          onPin={handlePin}
          onEdit={requestEdit}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

// The shape of a thread while its first page loads (the card look), shown
// only once the read has taken a moment, so a quick one doesn't flash it.
function ThreadSkeleton() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 150);
    return () => clearTimeout(t);
  }, []);
  if (!shown) return null;
  return (
    <div className="msg-thread-skel" role="status" aria-label="Loading messages">
      {[[58, 0], [72, 0], [44, 1], [64, 0], [52, 1], [30, 1]].map(([w, mine], i) => (
        <span key={i} className={`msg-skel-bubble${mine ? ' is-mine' : ''}`} style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

// Shown in place of the composer when the current user can't send from this
// workspace. Server-side: messages.insert RLS requires can_write_workspace on
// the current workspace — a role rule, not a plan rule (lib/messageAccess.js),
// so the note gives the real reason instead of blaming the plan (COMMS-08).
function ReadOnlyComposerNotice({ reason }) {
  return (
    <div className="msg-composer-readonly" role="status">
      <span className="msg-composer-readonly-text">
        {readOnlyCopy(reason).notice}
      </span>
    </div>
  );
}

// ── Group chat menu (rename / add / leave) ──────────────────────────
function GroupChatMenu({ anchor, onRename, onAdd, onLeave, canLeave, onClose }) {
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!anchor) return;
    const vw = window.innerWidth;
    const top = anchor.bottom + 4;
    const left = Math.min(anchor.left, vw - 180);
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e) => { if (popRef.current && !popRef.current.contains(e.target)) onClose?.(); };
    // Claim Escape (preventDefault) so the layer beneath — the Messages panel —
    // doesn't close on the same press.
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose?.(); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal((
    <div ref={popRef} className="msg-group-menu" style={{ position: 'fixed', top: pos.top, left: pos.left }}>
      <button className="msg-group-menu-item" onClick={onRename}>
        <Icon as={Edit} size={12} /> Rename
      </button>
      <button className="msg-group-menu-item" onClick={onAdd}>
        <Icon as={UserPlus} size={12} /> Add people
      </button>
      <button
        className="msg-group-menu-item is-danger"
        onClick={canLeave ? onLeave : undefined}
        disabled={!canLeave}
        title={canLeave ? 'Leave conversation' : 'Need 3+ members to leave'}
      >
        <Icon as={LogOut} size={12} /> Leave
      </button>
    </div>
  ), document.body);
}

// ── Add-participants picker (messageable-users list + addParticipants) ──
function AddParticipantsPicker({ workspaceId, conversationId, existingIds, anchor, onClose, onAdded, actorId, currentUser }) {
  const { users: members } = useMessageableUsers(workspaceId);
  const feedback = useFeedback();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const popRef = useRef(null);
  const inputRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, maxHeight: 480 });

  useEffect(() => {
    for (const m of members || []) userProfiles.resolve(m.user_id);
  }, [members]);
  const [, force] = useState(0);
  useEffect(() => userProfiles.subscribe(() => force(n => (n + 1) | 0)), []);

  useLayoutEffect(() => {
    if (!anchor) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const top = Math.min(anchor.bottom + 8, vh - 360);
    const left = Math.min(anchor.left, vw - 328);
    setPos({ top, left, maxHeight: Math.round(vh * 0.7) });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e) => { if (popRef.current && !popRef.current.contains(e.target)) onClose?.(); };
    // Claim Escape (preventDefault) so the layer beneath — the Messages panel —
    // doesn't close on the same press.
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose?.(); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const visibleMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (members || [])
      .filter(m => !existingIds.has(m.user_id))
      .map(m => {
        const p = userProfiles.get(m.user_id);
        return {
          user_id: m.user_id,
          name: p?.name || m.name || p?.email || m.email || 'Member',
          email: p?.email || m.email || '',
          color: p?.color || m.color || pickPresenceColor(m.user_id),
        };
      })
      .filter(m => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [members, existingIds, query]);

  const handleAdd = async () => {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    const nameOf = (uid) => userProfiles.get(uid)?.name || userProfiles.get(uid)?.email || 'someone';
    try {
      const joined = await addParticipants({ conversationId, userIds: picked });
      if (!joined.length) {
        feedback.toast({ type: 'info', message: 'They’re already in this conversation.' });
        onAdded?.();
        return;
      }
      const names = joined.map(nameOf);
      // Announce only the people who actually joined.
      const me = currentUser?.name || currentUser?.email || 'Someone';
      const body = `${me} added ${names.join(', ')}`;
      await sendMessage({
        workspaceId,
        conversationId,
        senderId: actorId,
        senderEmail: currentUser?.email || null,
        body,
        kind: 'system',
      });
      feedback.toast({ type: 'success', message: `Added ${names.join(', ')} to the conversation.` });
      onAdded?.();
    } catch (e) {
      console.warn('add participants failed', e);
      feedback.toast({ type: 'error', message: 'Could not add people — try again.' });
    } finally {
      setBusy(false);
    }
  };

  return createPortal((
    <div
      ref={popRef}
      className="msg-newconv-pop"
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: 320, maxHeight: pos.maxHeight }}
    >
      <div className="msg-newconv-head">
        <span className="t-eyebrow">ADD TO THIS CONVERSATION</span>
        <button className="msg-panel-icon" onClick={onClose} aria-label="Close">
          <Icon as={X} size={12} />
        </button>
      </div>
      <div className="msg-newconv-search">
        <Icon as={Search} size={12} />
        <input
          ref={inputRef}
          className="msg-newconv-input"
          placeholder="Find people…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="msg-newconv-list">
        {visibleMembers.length === 0 && (
          <div className="msg-empty t-meta">No more people to add.</div>
        )}
        {visibleMembers.map(m => {
          const sel = picked.includes(m.user_id);
          return (
            <button
              key={m.user_id}
              className={`msg-newconv-row ${sel ? 'is-picked' : ''}`}
              onClick={() => setPicked(p => sel ? p.filter(x => x !== m.user_id) : [...p, m.user_id])}
            >
              <span className="msg-row-avatar" style={{ background: m.color }}>
                {(m.name || 'M').charAt(0).toUpperCase()}
              </span>
              <span className="msg-row-text">
                <span className="msg-row-name">{m.name}</span>
                {m.email && m.email !== m.name && <span className="msg-row-preview t-meta">{m.email}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="msg-newconv-foot">
        <button
          className="msg-newconv-btn primary"
          disabled={picked.length === 0 || busy}
          onClick={handleAdd}
        >
          Add {picked.length || ''}
        </button>
      </div>
    </div>
  ), document.body);
}
