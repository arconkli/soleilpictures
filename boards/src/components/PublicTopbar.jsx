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
export function PublicTopbar({ hrefFor, center, busy, onCta, remixUrl, remixLabel = 'Make a copy', signedIn = false }) {
  return (
    <div className="public-topbar">
      <a className="public-brand" href={hrefFor('badge')} title="Clusters home" onClick={onCta('badge')}>
        <ClustersMark size={20} />
        <span className="public-brand-name">Clusters</span>
      </a>
      {center}
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
      {busy && <div className="public-nav-progress" aria-hidden="true" />}
    </div>
  );
}
