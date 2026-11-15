// `failed`: the workspace's rows could not be read, which is not an empty
// workspace. Plain markup only: this ships in the lazy 3D chunk.
import { Trans } from '@lingui/react/macro';
export function HomeEmptyState({ failed = false, onRetry = null }) {
  if (failed) {
    return (
      <div className="home-empty" role="alert">
        <div className="home-empty-glow" aria-hidden="true" />
        <div className="t-body home-empty-body"><Trans>Couldn’t load your workspace map</Trans></div>
        {onRetry && (
          <button type="button" className="msg-retry-btn" style={{ marginTop: 14 }} onClick={onRetry}><Trans>Retry</Trans></button>
        )}
      </div>
    );
  }
  return (
    <div className="home-empty">
      <div className="home-empty-glow" aria-hidden="true" />
      <div className="t-h1 home-empty-title"><Trans>CONNECT YOUR WORKSPACE</Trans></div>
      <div className="t-body home-empty-body">
        <Trans>Create boards and cards, then link them by typing @ in any doc or note.
        Your workspace appears here as a living map of everything that's connected.</Trans>
      </div>
    </div>
  );
}
