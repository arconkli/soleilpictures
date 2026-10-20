// Messages QA harness (?msgqa=1, DEV only): the REAL <MessagesPanel> over an
// in-memory fake of the Supabase client (local/msgqa/fakeSupabase.js), so a
// spec can drive and screenshot it with no backend.
//
//   &look=card|drawer   card (default) is the files sidebar's look; drawer is production's
//   &phone=1            with card: no floating attribute (the phone layout)
//   &conv=<id>          open a conversation          &m=<msgId>   open a message's permalink
//   &peer=<userId>      open (or start) a DM with them
//   &readonly=viewer    a viewer: reading only        &theme=light
//   &latency=<ms>       every fake call takes this long
//
// window.__msgQa drives it: peer(id).send/type/react/edit/delete/pin/read,
// setLatency, failNext, dropSocket, openConversation, openPeer, permalink,
// close, calls, db. The page sets <html data-msgqa-ready="1"> once mounted.
//
// The fake and the attachment resolver are installed at module scope, before
// anything renders. The seam is supabase.js's installSupabaseForQa, which is a
// no-op outside a DEV build.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import '../styles.css';
import '../components/sidebar/clusterSidebar.css';
import '../components/messagesCard.css';
import { MessagesPanel } from '../components/MessagesPanel.jsx';
import { MessagesLookContext } from '../components/messagesLook.js';
import { FeedbackProvider, useFeedback } from '../components/AppFeedback.jsx';
import { OpenDmContext } from '../hooks/useOpenDm.js';
import { useEntityNameTrie, EntityTrieContext } from '../hooks/useEntityNameTrie.js';
import { useInboxLive } from '../hooks/useInboxLive.js';
import { installSupabaseForQa } from '../lib/supabase.js';
import { installAttachmentResolverForQa } from '../lib/messageAttachmentUrls.js';
import { messagingAccess } from '../lib/messageAccess.js';
import { createFakeSupabase } from './msgqa/fakeSupabase.js';
import { buildMsgQaDb, SELF_ID, WORKSPACE_ID, PEOPLE } from './msgqa/msgQaFixtures.js';

const QS = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const LOOK = QS.get('look') === 'drawer' ? 'drawer' : 'card';
const PHONE = QS.get('phone') === '1';
const VIEWER = QS.get('readonly') === 'viewer';
const LIGHT = QS.get('theme') === 'light';

// Real photographs behind the panel (and as attachments), as the sidebar
// harness does: a screenshot of this is judged as the product.
const PHOTO_URLS = import.meta.glob('./qa-photos/*.jpg', { eager: true, query: '?url', import: 'default' });
const PHOTOS = Object.fromEntries(Object.entries(PHOTO_URLS).map(([k, v]) => [k.replace(/^.*\/|\.jpg$/g, ''), v]));
const PHOTO_LIST = Object.values(PHOTOS);

const db = buildMsgQaDb();
const fake = createFakeSupabase({ db, selfId: SELF_ID, latency: Number(QS.get('latency')) || 0 });

// qa/<photo>.jpg serves the local photo; an upload made in this session serves
// its own bytes; anything else (a pdf) is a link that goes nowhere.
function resolveAttachment(path, { download } = {}) {
  const m = /^qa\/([^/]+)\.jpg$/.exec(String(path || ''));
  if (m && PHOTOS[m[1]]) return PHOTOS[m[1]];
  const up = db.storage.get(path);
  if (up?.file && typeof URL !== 'undefined' && typeof Blob !== 'undefined' && up.file instanceof Blob) {
    up.url ||= URL.createObjectURL(up.file);
    return up.url;
  }
  return `#qa-file/${path}${download ? `?download=${encodeURIComponent(download)}` : ''}`;
}

installSupabaseForQa(fake);
installAttachmentResolverForQa(resolveAttachment);
if (typeof window !== 'undefined') window.__msgQa = fake.qa;

const ACCESS = messagingAccess({
  tier: 'free',
  workspace: { created_by: VIEWER ? 'someone-else' : SELF_ID },
  role: VIEWER ? 'viewer' : 'owner',
  userId: SELF_ID,
});
const CURRENT_USER = { id: SELF_ID, name: PEOPLE.find((p) => p.user_id === SELF_ID)?.name, email: PEOPLE.find((p) => p.user_id === SELF_ID)?.email, color: PEOPLE.find((p) => p.user_id === SELF_ID)?.color };

const CSS = `
html, body { margin: 0; height: 100%; }
.msgqa-backdrop { position: fixed; inset: 0; z-index: 0; background: #0d0d10 center / cover no-repeat; }
.msgqa-reopen { position: fixed; left: 24px; bottom: 24px; z-index: 1; font: 13px var(--font-sans); padding: 6px 12px; }
`;

function Inner() {
  const feedback = useFeedback();
  const permalink0 = useMemo(() => {
    const id = QS.get('m');
    const row = id ? db.messages.find((m) => m.id === id) : null;
    return row ? { messageId: row.id, conversationId: row.conversation_id } : null;
  }, []);
  const [open, setOpen] = useState(true);
  const [openConv, setOpenConv] = useState(permalink0?.conversationId || QS.get('conv') || null);
  const [permalink, setPermalink] = useState(permalink0);
  const [peerId, setPeerId] = useState(QS.get('peer') || null);
  const [tick, setTick] = useState(0);

  const onOpenFromToast = useCallback((id) => { if (id) { setOpenConv(id); setOpen(true); } }, []);
  useInboxLive({ userId: SELF_ID, onOpenConversation: onOpenFromToast, feedback });

  const { trie } = useEntityNameTrie(WORKSPACE_ID);
  const trieValue = useMemo(() => ({ trie, workspaceId: WORKSPACE_ID }), [trie]);
  const openDm = useCallback((userId) => { setPeerId(userId); setOpen(true); }, []);

  useEffect(() => {
    fake.qa.bindHarness({
      openConversation: (id) => { setOpenConv(id); setOpen(true); },
      openPeer: (userId) => { setPeerId(userId); setOpen(true); },
      permalink: (messageId) => {
        const row = db.messages.find((m) => m.id === messageId);
        if (!row) throw new Error(`no message ${messageId}`);
        setPermalink({ messageId, conversationId: row.conversation_id });
        setOpenConv(row.conversation_id);
        setOpen(true);
      },
      close: () => setOpen(false),
    });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', LIGHT ? 'light' : 'dark');
    const b = document.body;
    if (LOOK === 'card') {
      b.setAttribute('data-sb-files', '1');
      if (!PHONE) b.setAttribute('data-sb-float', '1');
    }
    root.dataset.msgqaReady = '1';
    return () => {
      b.removeAttribute('data-sb-files'); b.removeAttribute('data-sb-float');
      delete root.dataset.msgqaReady;
    };
  }, []);

  const suggested = useMemo(() => new Set(['maya', 'jon']), []);

  return (
    <OpenDmContext.Provider value={openDm}>
      <EntityTrieContext.Provider value={trieValue}>
        <style>{CSS}</style>
        <div className="msgqa-backdrop" style={{ backgroundImage: `url(${PHOTO_LIST[0] || ''})` }} />
        {!open && (
          <button type="button" className="msgqa-reopen" data-testid="msgqa-reopen" onClick={() => setOpen(true)}>Open Messages</button>
        )}
        {open && createPortal((
          <MessagesLookContext.Provider value={LOOK === 'card' ? 'card' : null}>
            <MessagesPanel
              workspaceId={WORKSPACE_ID}
              currentUser={CURRENT_USER}
              canSendMessages={ACCESS.canSend}
              readOnlyReason={ACCESS.reason}
              refreshTick={tick}
              openConversationId={openConv}
              setOpenConversationId={setOpenConv}
              initialOpenConversationId={permalink?.conversationId || null}
              jumpToMessageId={permalink?.messageId || null}
              pendingOpenPeerId={peerId}
              suggestedUserIds={suggested}
              onRefreshRequested={() => setTick((t) => t + 1)}
              onPermalinkConsumed={() => setPermalink(null)}
              onPeerConsumed={() => setPeerId(null)}
              onClose={() => setOpen(false)}
            />
          </MessagesLookContext.Provider>
        ), document.body)}
      </EntityTrieContext.Provider>
    </OpenDmContext.Provider>
  );
}

export function MessagesQaHarness() {
  return (
    <FeedbackProvider>
      <Inner />
    </FeedbackProvider>
  );
}
