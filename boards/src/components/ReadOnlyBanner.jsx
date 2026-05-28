// ReadOnlyBanner — slim banner pinned to the top of the canvas when a
// demo-tier user is viewing a board they don't own. RLS blocks edits
// server-side; this is the visible cue so the user knows why.
//
// Shown only when boardPermission.source === 'tier-demoted'. Other
// read-only states (legitimate viewer shares, no access at all) get the
// existing "VIEW ONLY" topbar pill but no upgrade banner — those aren't
// gated by tier and won't unlock with a paid plan.

export function ReadOnlyBanner({ boardPermission, onRequestUpgrade }) {
  if (boardPermission?.source !== 'tier-demoted') return null;
  return (
    <div className="readonly-banner" role="status">
      <span className="readonly-banner-text">
        You're viewing this board. Editing shared boards is a paid feature.
      </span>
      <button
        type="button"
        className="readonly-banner-cta"
        onClick={() => onRequestUpgrade?.()}
      >
        Upgrade to edit
      </button>
    </div>
  );
}
