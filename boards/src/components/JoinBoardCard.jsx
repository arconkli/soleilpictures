// JoinBoardCard — the confirm card for role-bearing invite links (0189).
//
// When a /share bundle carries `join` ({ role, kind:'invite' }), the visitor
// was handed a claimable link: the board preview IS the pitch, and this card
// is the one action. Joining is NEVER automatic — a bare GET only previews;
// access is granted by claim_collab_link after the visitor clicks Join (and
// signs in if needed: the href carries ?join=<token>, which AuthGate stashes
// across the OTP hop and claims on the first authenticated load).
//
// Reuses the SharePrompt card styles (.share-prompt-*) — same placement,
// same visual language — but shows immediately (no dwell: the visitor was
// invited, not ambushed) and suppresses SharePrompt while visible.

import { useEffect, useState } from 'react';
import { logEventOnce, logEventNow } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

export function JoinBoardCard({ role, boardName, href, token, onJoinClick }) {
  const [closed, setClosed] = useState(false);
  const roleLabel = role === 'editor' ? 'edit' : 'view';

  useEffect(() => {
    logEventOnce(`invite-link-view-${token}`, EV.INVITE_LINK_VIEW, { share_token: token, role });
  }, [token, role]);

  useEffect(() => {
    if (closed) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setClosed(true); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closed]);

  if (closed) return null;
  return (
    <div className="share-prompt" role="dialog" aria-label="Join this board">
      <button type="button" className="share-prompt-x" aria-label="Dismiss" onClick={() => setClosed(true)}>×</button>
      <div className="share-prompt-eyebrow">You&apos;re invited</div>
      <div className="share-prompt-title">
        Join {boardName ? `“${boardName}”` : 'this board'} as {role === 'editor' ? 'an editor' : 'a viewer'}.
      </div>
      <div className="share-prompt-sub">
        {role === 'editor'
          ? 'Add cards, notes, and ideas right alongside them — free.'
          : `You'll be able to ${roleLabel} everything here, live — free.`}
      </div>
      <a className="public-cta share-prompt-cta"
         href={href}
         onClick={() => {
           logEventNow(EV.INVITE_LINK_JOIN_CLICK, { share_token: token, role });
           onJoinClick?.();
         }}>
        Join as {role === 'editor' ? 'editor' : 'viewer'}
      </a>
      <button type="button" className="share-prompt-later" onClick={() => setClosed(true)}>
        Just look around
      </button>
    </div>
  );
}
