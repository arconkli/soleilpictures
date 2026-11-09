import { SoleilMark } from './primitives.jsx';
import { useStall } from '../hooks/useStall.js';

// The boot screen: the gold sun on the dark (or themed) ground, used by
// AuthGate's SplashLoading, TierRouter's Splash and the workspace LoadingShell.
// They hand over to each other and to the page's own splash (index.html), so
// the words under the sun count from the start of the whole wait (useStall):
//   no name: nothing, then "Still loading…" at 8 s, then "This is taking longer
//            than usual" with a reload at 15 s
//   a name:  "Opening <name>…" from the start, the same longer words at 15 s
// The words sit under the sun, absolutely positioned, so the sun never moves.
// One live region is kept across the changes so they are read out. The
// .auth-loading class stays: errorReporting's bootCheck looks for it.
export function LoadingScreen({ dark = false, name = null, force }) {
  const stage = useStall({ force });
  const first = name ? `Opening ${name}…` : (stage === 1 ? 'Still loading…' : '');
  return (
    <div className={dark ? 'auth-screen public-dark' : 'auth-screen'}>
      <div className="auth-glow" aria-hidden="true" />
      <div className="auth-loading">
        <SoleilMark size={32} color="var(--soleil)" glow />
        <div className="loading-words" role="status">
          {stage >= 2 ? (
            <>
              {name && <span className="loading-words-line">{first}</span>}
              <span className="loading-words-line">This is taking longer than usual</span>
              <button type="button" className="surface-error-btn" onClick={() => window.location.reload()}>Reload page</button>
            </>
          ) : first ? (
            <span className="loading-words-line">{first}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
