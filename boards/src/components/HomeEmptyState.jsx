// `failed`: the workspace's rows could not be read, which is not an empty
// workspace. Plain markup only: this ships in the lazy 3D chunk.
export function HomeEmptyState({ failed = false, onRetry = null }) {
  if (failed) {
    return (
      <div className="home-empty" role="alert">
        <div className="home-empty-glow" aria-hidden="true" />
        <div className="t-body home-empty-body">Couldn’t load your workspace map</div>
        {onRetry && (
          <button type="button" className="msg-retry-btn" style={{ marginTop: 14 }} onClick={onRetry}>Retry</button>
        )}
      </div>
    );
  }
  return (
    <div className="home-empty">
      <div className="home-empty-glow" aria-hidden="true" />
      <div className="t-h1 home-empty-title">CONNECT YOUR WORKSPACE</div>
      <div className="t-body home-empty-body">
        Create boards and cards, then link them by typing @ in any doc or note.
        Your workspace appears here as a living map of everything that's connected.
      </div>
    </div>
  );
}
