// A doc shared with you on its own, read or edited together through its live
// room (lib/docRoomClient.js → party/doc.ts). FileSharePage renders it, on
// /f/<token> and as the in-app viewer, for an answer whose file is a doc.
//
// The room holds a mirror of that one doc while its cluster stays the source
// of truth (party/bridge.ts). This keeps a Y.Doc of its own for each room, so
// nothing here ever touches a board's, and finds the card in it by the key the
// share's answer names (card_key), never by looking around the room.
//
// What this reader may do is the room's to say. The answer's can_edit picked
// the room (edit or view); the room's hello says whether this socket may write
// (readOnly), and until it has, the doc is read-only. A signed-in editor's
// comments carry their own id and the name the room gave them (hello.me), the
// two things the room checks on a guest's comment.
//
// Images are signed for this reader by the share (lib/docShareImages.js):
// every image key that arrives in the doc is pointed at that resolver
// (r2.js setKeyResolver) in the same update that brings it, before the editor
// draws it.
//
// When the room ends: moved (a restore or a move made a new generation) or
// refused at the door asks the share again (onRefresh). The answer either names
// a new room, and FileSharePage remounts this view on it, or the same one, and
// this starts the room over, or says why not, and the page shows that instead.
// A refused write means this copy holds something the room never will, so it
// starts over from the room.
//
// `api` may carry attachDocRoom / createDocImageResolver / getSessionUserId:
// the DEV harness passes an in-memory room (local/FileShareQaHarness.jsx).
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { attachDocRoom as realAttachDocRoom, DOC_ROOM_CLOSE } from '../../lib/docRoomClient.js';
import { createDocImageResolver as realImageResolver } from '../../lib/docShareImages.js';
import { r2KeysIn } from '../../lib/docRoomBridge.js';
import { cardScope } from '../../lib/docState.js';
import { setKeyResolver, releaseKeyResolver } from '../../lib/r2.js';
import { lazyWithReload } from '../../lib/lazyWithReload.js';
import { logEventNow } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import './docShareView.css';

const DocSurface = lazyWithReload(() => import('../DocSurface.jsx').then((m) => ({ default: m.DocSurface })));

async function supabaseClient() {
  try { return (await import('../../lib/supabase.js')).supabase; } catch (_) { return null; }
}
async function accessToken() {
  const sb = await supabaseClient();
  try { const { data } = await sb.auth.getSession(); return data?.session?.access_token || ''; } catch (_) { return ''; }
}
async function refreshSession() {
  const sb = await supabaseClient();
  try { await sb?.auth.refreshSession(); } catch (_) { /* ask again anyway */ }
}

// The card's title, as it changes.
function useTitle(card) {
  const [title, setTitle] = useState(() => (card ? String(card.get('title') || '') : ''));
  useEffect(() => {
    if (!card) return undefined;
    const read = () => setTitle(String(card.get('title') || ''));
    read();
    const onChange = (e) => { if (e.keysChanged.has('title')) read(); };
    card.observe(onChange);
    return () => card.unobserve(onChange);
  }, [card]);
  return title;
}

export function DocShareView({ token, res, onRefresh, signInHref, api = null }) {
  const attachDocRoom = api?.attachDocRoom || realAttachDocRoom;
  const makeImageResolver = api?.createDocImageResolver || realImageResolver;
  const room = res.room;
  const cardKey = res.card_key;
  const signedIn = !!res.signed_in;

  // Each start of the room gets a fresh copy of the doc, made and thrown away
  // by the effect that runs the room (so StrictMode's second run gets its own).
  const [attempt, setAttempt] = useState(0);
  const [ydoc, setYdoc] = useState(null);

  const [phase, setPhase] = useState('connecting');   // connecting | ready | reasking | ended
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [hello, setHello] = useState(null);
  const [card, setCard] = useState(null);
  const [notice, setNotice] = useState(null);
  const [userId, setUserId] = useState(null);
  const clientRef = useRef(null);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  // Whose comments these are, for a signed-in reader (the room checks it).
  const getSessionUserId = api?.getSessionUserId || null;
  useEffect(() => {
    if (!signedIn) { setUserId(null); return undefined; }
    let off = false;
    (async () => {
      if (getSessionUserId) { const id = await getSessionUserId(); if (!off) setUserId(id || null); return; }
      const sb = await supabaseClient();
      try {
        const { data } = await sb.auth.getSession();
        if (!off) setUserId(data?.session?.user?.id || null);
      } catch (_) { /* their comments wait for a session */ }
    })();
    return () => { off = true; };
  }, [signedIn, getSessionUserId]);

  // The doc's images, through the share.
  const resolver = useMemo(
    () => makeImageResolver({ token, getBearer: signedIn ? accessToken : async () => '', refresh: refreshSession }),
    [makeImageResolver, token, signedIn],
  );

  // The room, on a copy of its own.
  useEffect(() => {
    let off = false;
    const doc = new Y.Doc();
    setYdoc(doc);
    setPhase('connecting');
    setHello(null);
    setCard(null);
    // Each image key the room sends is pointed at the share's resolver in the
    // update that brings it, before anything draws it.
    const keys = new Set();
    const onUpdate = (update) => {
      for (const k of r2KeysIn(update)) {
        if (keys.has(k)) continue;
        keys.add(k);
        setKeyResolver(k, resolver);
      }
    };
    doc.on('update', onUpdate);
    const client = attachDocRoom(doc, {
      room, token,
      getAccessToken: signedIn ? accessToken : async () => '',
      onHello: (m) => { if (!off) setHello(m); },
      // Caught up with the room, now or after a reconnect.
      onSync: () => { if (!off && phaseRef.current === 'connecting') setPhase('ready'); },
      onRefused: (reason) => {
        if (off) return;
        setNotice(reason === 'doc_full'
          ? 'This doc has grown too large to edit here. You can still read it.'
          : "That change couldn't be saved here, so the doc was reloaded.");
        setAttempt((n) => n + 1);
      },
      onEnd: ({ code }) => {
        if (off) return;
        if (code === DOC_ROOM_CLOSE.SUSPENDED) { setPhase('ended'); setNotice("This account can't open shared docs right now."); return; }
        if (code === DOC_ROOM_CLOSE.TOO_BIG) { setPhase('ended'); setNotice('That change was too large to save.'); return; }
        // Moved, gone, access ended, refused at the door: the share decides.
        setPhase('reasking');
        onRefreshRef.current?.();
      },
    });
    clientRef.current = client;
    // The card is found by the key the share named, once it has its doc.
    const cards = doc.getMap('cards');
    let watching = false;
    const find = () => {
      const c = cards.get(cardKey);
      if (c instanceof Y.Map && c.get('docPages')) { if (!off) setCard(c); return true; }
      return false;
    };
    const onCards = () => { if (find() && watching) { watching = false; cards.unobserve(onCards); } };
    if (!find()) { watching = true; cards.observe(onCards); }
    return () => {
      off = true;
      if (watching) { watching = false; try { cards.unobserve(onCards); } catch (_) {} }
      client.destroy();
      if (clientRef.current === client) clientRef.current = null;
      doc.off('update', onUpdate);
      for (const k of keys) releaseKeyResolver(k, resolver);
      try { doc.destroy(); } catch (_) {}
    };
  }, [room, attempt, token, cardKey, signedIn, attachDocRoom, resolver]);

  // Asked again and the share still names this room: start it over.
  const resRef = useRef(res);
  useEffect(() => {
    if (resRef.current === res) return;
    resRef.current = res;
    if (phaseRef.current === 'reasking' && res.room === room) setAttempt((n) => n + 1);
  }, [res, room]);

  const getAwareness = useCallback(() => clientRef.current?.awareness || null, []);
  const title = useTitle(card);
  const canEdit = !!res.can_edit && hello?.readOnly === false && phase !== 'ended';
  // The view room holds no comment threads: an empty map stands in, so the
  // doc's readers (useDocBoard) don't wait for one that never comes.
  const emptyComments = useMemo(() => new Y.Doc().getMap('docComments'), []);
  const scope = useMemo(() => {
    if (!card) return null;
    const s = cardScope(card);
    return { ...s, comments: s.comments || emptyComments, cardId: cardKey, docCardId: cardKey, boardId: null };
  }, [card, cardKey, emptyComments]);
  const currentUser = useMemo(() => (hello?.me
    ? { id: userId, name: hello.me.name, color: hello.me.color }
    : null), [hello, userId]);
  const name = title || res.file?.name || 'Untitled doc';

  const retry = () => { setNotice(null); setPhase('reasking'); onRefreshRef.current?.(); };

  return (
    <div className="dsv" data-doc-share-phase={phase} data-doc-share-mode={canEdit ? 'edit' : 'view'}>
      <div className="dsv-bar">
        <span className="dsv-name" title={name}>{name}</span>
        <span className="dsv-mode">{canEdit ? 'Editing' : 'View only'}</span>
        {notice && <span className="dsv-notice" role="status">{notice}</span>}
        <span className="dsv-spacer" />
        {res.edit_needs_sign_in && !signedIn && (
          <a className="fsp-btn dsv-signin" href={signInHref}
             onClick={() => logEventNow(EV.FILE_SHARE_SIGNIN_CLICK, { surface: 'doc_edit' })}>Sign in to edit</a>
        )}
      </div>
      <div className="dsv-body">
        {phase === 'ended' ? (
          <div className="fsp-state" role="status">
            <h1 className="fsp-state-title">This doc closed.</h1>
            <p className="fsp-state-body">{notice || 'It is no longer open here.'}</p>
            <div className="fsp-state-actions">
              <button type="button" className="fsp-btn" onClick={retry}>Open it again</button>
            </div>
          </div>
        ) : phase === 'ready' && !scope ? (
          // Caught up, and the room has no doc under that card: one that was
          // never opened in its cluster has nothing to mirror yet.
          <div className="fsp-state" role="status">
            <h1 className="fsp-state-title">This doc isn't ready yet.</h1>
            <p className="fsp-state-body">Ask the person who shared it to open it once, then try again.</p>
            <div className="fsp-state-actions">
              <button type="button" className="fsp-btn" onClick={retry}>Try again</button>
            </div>
          </div>
        ) : !scope || phase !== 'ready' ? (
          <div className="dsv-wait" role="status" aria-live="polite">
            <span className="fsp-spinner" aria-hidden="true" />
            <span>{phase === 'reasking' ? 'Reconnecting…' : 'Opening the doc…'}</span>
          </div>
        ) : (
          <Suspense fallback={<div className="doc-surface-skeleton" aria-hidden="true" />}>
            <DocSurface
              // The doc's card id, as its members' DocPresence uses: presence
              // crosses the mirror keyed by it (lib/docRoomPresence.js).
              board={{ id: cardKey, name }}
              ydoc={ydoc}
              ready
              scope={scope}
              titleOverride={title || null}
              workspaceId={null}
              userId={userId}
              boards={{}}
              getAwareness={getAwareness}
              currentUser={currentUser}
              chrome="modal"
              canEdit={canEdit}
              isPublic={!canEdit}
              guestMode
              allowExport={!!res.allow_download} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

export default DocShareView;
