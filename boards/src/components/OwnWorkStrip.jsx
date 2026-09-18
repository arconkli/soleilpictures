// OwnWorkStrip — the viewer's own clusters, across the top of the upgrade modal.
//
// Presentational: no hooks beyond rendering, no tier reads, no fetching, no
// analytics. Items come in as a prop, exactly like UpgradePill was split out of
// UpgradeChip, so the admin Surface Gallery can render every state from
// fixtures instead of only the one the previewing account happens to be in
// (which, for an admin looking at a demo paywall, is none of them).
//
// Renders nothing at all when there is nothing to show — a new account, a
// collaborator in someone else's workspace, or boards whose thumbnails have
// not been generated yet. An empty frame would be worse than no frame: it would
// say "you have built nothing" on the screen asking you to pay for more room.

import { R2Image } from './R2Image.jsx';

export function OwnWorkStrip({ items = [], summary = null }) {
  const shown = (items || []).filter((it) => it && (it.key || it.url));
  if (!shown.length && !summary) return null;

  return (
    <div className="own-work">
      {shown.length > 0 && (
        // aria-hidden: every thumbnail is decorative here. The summary line
        // below carries the same fact in words, and a screen reader listing
        // five cluster names before the offer would bury it.
        <div className="own-work-strip" aria-hidden="true">
          {shown.map((it) => (
            <div className="own-work-thumb" key={it.id}>
              {it.url ? (
                // Fixture path, for the admin Surface Gallery only. An admin
                // has no demo boards and a fabricated R2 key cannot presign, so
                // without this the strip could be previewed empty and never
                // populated — which is the state least worth looking at.
                <img src={it.url} alt="" />
              ) : (
                // `bust` is R2Image's designed cache-version prop — an in-place
                // R2 overwrite is otherwise hidden by the immutable browser
                // cache. `eager` because all five are on screen the instant the
                // modal opens, so the viewport gate would only buy a frame of
                // shimmer on the surface we least want to look unfinished.
                <R2Image src={it.key} bust={it.version || undefined} eager alt="" />
              )}
            </div>
          ))}
        </div>
      )}
      {summary && <p className="own-work-line t-body">You've built {summary}.</p>}
    </div>
  );
}
