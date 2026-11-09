// JoinBoardCard — the confirm card on a /share page whose link can be joined.
//
// Both kinds of link get it: an edit link ("invite", 0189) and, since 0830, a
// view link. The cluster on screen IS the pitch and this card is the one
// action. Joining is NEVER automatic — a bare GET only previews; access is
// granted by join_view_link / claim_collab_link after the visitor clicks Join
// (and signs in if needed: the href carries ?join=<token>&jk=<kind>, which
// AuthGate stashes across the OTP hop and claims on the first authenticated
// load).
//
// Timing: a computer shows it after `delayMs`, a phone at once (a bottom
// sheet), and both only once `ready` (the first-visit tip is finished).
// "Just looking" and Escape hide it for this visit; the top bar's Join stays.

import { useEffect, useState } from 'react';
import { logEventOnce, logEventNow } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { editorLimitAllowed } from '../lib/appHost.js';
import { SenderAvatar } from './PublicTopbar.jsx';
import './shareJoin.css';
import { isComposingKey } from '../lib/composerKeys.js';

const NARROW = '(max-width: 640px)';

function useNarrow() {
  const [narrow, setNarrow] = useState(() => {
    try { return !!window.matchMedia?.(NARROW).matches; } catch (_) { return false; }
  });
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia?.(NARROW); } catch (_) { mq = null; }
    if (!mq) return undefined;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return narrow;
}

// `kind` is 'view' | 'invite'; a caller that only knows the role (the surface
// gallery) gets the kind from it.
export function JoinBoardCard({
  kind: kindProp, role: roleProp, boardName, sharerName = null, href, token, rootId = null,
  onJoinClick, ready = true, delayMs = 0,
}) {
  const kind = kindProp || (roleProp === 'editor' ? 'invite' : 'view');
  const role = roleProp || 'editor';
  const [closed, setClosed] = useState(false);
  const [waited, setWaited] = useState(delayMs <= 0);
  const narrow = useNarrow();
  const sharer = sharerName ? String(sharerName).trim() : '';

  // root_id: the cluster the link opens, so a view and a join are credited to
  // its sharer (the token is only the once-per-link key, never a prop).
  useEffect(() => {
    if (kind !== 'invite') return;
    logEventOnce(`invite-link-view-${token}`, EV.INVITE_LINK_VIEW, { role, root_id: rootId || null });
  }, [token, role, rootId, kind]);

  useEffect(() => {
    if (narrow || delayMs <= 0) { setWaited(true); return undefined; }
    const t = setTimeout(() => setWaited(true), delayMs);
    return () => clearTimeout(t);
  }, [narrow, delayMs]);

  const visible = ready && waited && !closed;
  useEffect(() => {
    if (!visible) return undefined;
    const onKey = (e) => { if (isComposingKey(e)) return; if (e.key === 'Escape') setClosed(true); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  if (!visible) return null;
  const quoted = boardName ? `“${boardName}”` : 'this cluster';
  const editor = kind === 'invite';
  const eyebrow = editor
    ? (sharer ? `${sharer} invited you` : 'You’re invited')
    : (sharer ? `From ${sharer}` : 'Shared with you');
  const title = editor ? `Join ${quoted} as an editor` : `Join ${quoted}`;
  let text;
  if (editor) {
    // With the editor limit, an edit link can let its holder in to view, so
    // editing isn't promised as free.
    const free = editorLimitAllowed() ? '' : ' Free.';
    text = sharer
      ? `Add your own cards, notes and ideas with ${sharer}.${free}`
      : `Add your own cards, notes and ideas right alongside theirs.${free}`;
  } else {
    const their = sharer ? `${sharer}’s changes` : 'changes';
    text = narrow
      ? `Keep it in your Clusters and see ${their} as they happen. Free.`
      : `Keep it in your Clusters, see ${their} as they happen, and ask to edit. Free.`;
  }
  return (
    <div className="jc" role="dialog" aria-label={`Join ${boardName || 'this cluster'}`}>
      <button type="button" className="jc-x" aria-label="Dismiss" onClick={() => setClosed(true)}>×</button>
      <div className="jc-eb">
        {sharer && <SenderAvatar name={sharer} />}
        <span>{eyebrow}</span>
      </div>
      <div className="jc-tt">{title}</div>
      <div className="jc-tx">{text}</div>
      <div className="jc-acts">
        <a className="public-btn-join" href={href}
           onClick={() => {
             if (editor) logEventNow(EV.INVITE_LINK_JOIN_CLICK, { role, root_id: rootId || null });
             onJoinClick?.('card');
           }}>
          {editor ? 'Join as editor' : 'Join free'}
        </a>
        <button type="button" className="public-btn-quiet" onClick={() => setClosed(true)}>
          Just looking
        </button>
      </div>
    </div>
  );
}
