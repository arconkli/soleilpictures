import { Icon } from './Icon.jsx';

// Shared empty-state shell. Used wherever a surface has no content yet —
// inbox, list view, board grid, etc.
//   icon  — Lucide component (passed via `as`)
//   title — Brandon-Grotesque hero
//   body  — Aileron supporting copy
//   action — { label, onClick } for an optional primary CTA
//   glow  — when true, the icon takes the soleil-gold drop-shadow halo
export function EmptyState({ icon, title, body, action, glow = false }) {
  return (
    <div className="empty-state">
      {icon && (
        <div
          className="empty-icon"
          style={glow ? { filter: 'drop-shadow(0 0 16px rgba(255,165,0,.30))', color: 'var(--soleil)' } : undefined}
        >
          <Icon as={icon} size={48} />
        </div>
      )}
      {title && <div className="empty-title t-h1">{title}</div>}
      {body && <div className="empty-body t-body">{body}</div>}
      {action && (
        <button className="empty-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
