import { pickPresenceColor } from '../../lib/presenceColor.js';

// The line under the workspace's name in the files sidebar: their faces and
// "Maya and Jon are here", or "Shared by …"; nothing when there's nothing to
// say. What it says is lib/sidebarWho.js's whoLine; App and the QA harness
// both draw it here, so the harness can't drift from the app.
export function SidebarWho({ line }) {
  if (!line) return null;
  return (
    <div className={`sbf-who is-${line.kind}`}>
      {line.kind === 'here' && (
        <span className="sbf-who-faces" aria-hidden="true">
          {line.faces.map(f => (
            <span key={f.id} className="sbf-who-face" style={{ background: pickPresenceColor(f.id) }}>{f.initial}</span>
          ))}
        </span>
      )}
      <span className="sbf-who-text">{line.text}</span>
    </div>
  );
}
