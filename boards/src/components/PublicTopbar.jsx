// PublicTopbar — the branded bar on every public viewer state.
//
// Lifted out of PublicBoardView.jsx so it can be rendered on its own. That
// module decodes Y.js state, fetches the public bundle, installs global R2
// resolvers and mounts a full CanvasSurface; importing it to show a top bar
// would drag that whole graph along. The bar is pure props, and its four CTA
// variants are the acquisition surface most worth eyeballing after a change —
// so it lives here, where the admin Surface Gallery can import it for the cost
// of an icon and a wordmark.
import { ClustersMark } from './SoleilWordmark.jsx';
import { initialOf } from '../lib/graphemes.js';
import './shareJoin.css';

// Branded top bar — rendered in every viewer state (loading / invalid / ok)
// so the wordmark and signup CTA are visible from the first paint.
//
// EXACTLY ONE green-field call to action. This used to carry three: "Make a
// copy", "Try free" and "Sign in". To someone who has never heard of Clusters
// the first two are the same offer worded twice, and the third is for people
// who already have an account — three choices to answer one question. The
// most-clicked element on the page was neither of the buttons but the brand
// mark, which is what "I don't understand what this is yet" looks like in
// event data. So: brand (what is this) · title (what am I looking at) ·
// Sign in, quiet (not for you) · one gold action.
//
// "Make a copy" wins that slot whenever the board is remixable, because it
// answers the visitor's actual question — how do I get one of these — and
// hands them this board rather than an empty workspace.
//
// Signed in (the viewer arrived with a session, typically because AuthGate just
// sent them back here): no Sign in link, and the copy CTA reads "Save a copy" —
// the one-tap way to make this board theirs. No automatic cloning.
// `hrefFor(surface)` is passed in rather than built here: the attribution
// rules (utm shape, share-return stashing) belong with the page that owns
// the context, and keeping them there leaves this file free of them.
//
// A link someone SENT you (/share) that can be joined passes `join`
// ({ label, href, onClick }): Join (or "Open it" for someone already in) is then
// the one primary button, in neutral ink, and Make a copy and Sign in step back
// to quiet buttons. A phone's bar keeps only Join.
export function PublicTopbar({ hrefFor, center, busy, onCta, remixUrl, remixLabel = 'Make a copy', signedIn = false, join = null }) {
  return (
    <div className="public-topbar">
      <a className="public-brand" href={hrefFor('badge')} title="Clusters home" onClick={onCta('badge')}>
        <ClustersMark size={20} />
        <span className="public-brand-name">Clusters</span>
      </a>
      {center}
      {join ? (
        <div className="public-topbar-actions">
          {remixUrl && (
            <a className="public-btn-quiet" href={remixUrl} onClick={onCta('remix')}>{signedIn ? 'Save a copy' : remixLabel}</a>
          )}
          {!signedIn && (
            <a className="public-btn-quiet" href={hrefFor('signin')} onClick={onCta('signin')}>Sign in</a>
          )}
          <a className="public-btn-join" href={join.href} onClick={join.onClick}>{join.label}</a>
        </div>
      ) : (
      <div className="public-topbar-actions">
        {!signedIn && (
          <a className="public-signin-quiet" href={hrefFor('signin')} onClick={onCta('signin')}>Sign in</a>
        )}
        {remixUrl
          ? <a className="public-cta" href={remixUrl} onClick={onCta('remix')}>{signedIn ? 'Save a copy' : remixLabel}</a>
          : (signedIn
            ? <a className="public-cta" href="/">Open Clusters</a>
            : <a className="public-cta" href={hrefFor('topbar')} onClick={onCta('topbar')}>Try Clusters free</a>)}
      </div>
      )}
      {busy && <div className="public-nav-progress" aria-hidden="true" />}
    </div>
  );
}

// The sender's avatar colour: muted, never gold, steady for a name.
const AVATAR_HUES = ['#3b6e5a', '#6a4bb5', '#2f6f8f', '#8a4b6a', '#5b6b2f', '#8a5a2f'];
export function senderColor(name) {
  const c = String(name || '?').trim().codePointAt(0) || 0;
  return AVATAR_HUES[c % AVATAR_HUES.length];
}

// Small round avatar with the sender's initial.
export function SenderAvatar({ name }) {
  const n = String(name || '').trim();
  return <span className="public-av" aria-hidden="true" style={{ background: senderColor(n) }}>{initialOf(n, '?', { upper: false })}</span>;
}

// The topbar's title block for a link someone sent: the cluster's name, and
// next to it who sent it and what they can do. No sender name (the sender has
// none to show): a view link keeps its "Shared with you · view only" line above
// the name, an edit link is just the name.
export function ShareTitle({ name, sharer, kind }) {
  const title = name || 'Untitled';
  if (!sharer) {
    return (
      <div className="public-board-title">
        {kind !== 'invite' && <div className="public-board-eyebrow">Shared with you · view only</div>}
        <div className="public-board-name">{title}</div>
      </div>
    );
  }
  return (
    <div className="public-board-title has-from">
      <div className="public-board-name">{title}</div>
      <div className="public-board-from">
        <SenderAvatar name={sharer} />
        <span className="public-board-from-t">
          {kind === 'invite' ? `${sharer} invited you to edit` : `${sharer} shared this with you · view only`}
        </span>
      </div>
    </div>
  );
}
