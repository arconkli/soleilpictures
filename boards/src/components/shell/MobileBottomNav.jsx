// Fixed bottom navigation for phone width. Renders when
// useBreakpoint().isPhone is true at the call site. The desktop
// sidebar is hidden via @media (max-width: 640px) when this is
// mounted so the two don't overlap.
//
// Props:
//   tabs       — [{ key, label, icon, badge? }]
//   active     — current tab key (pass null/undefined to highlight none)
//   onChange(key)
//   showCreate — when true, an elevated centre "+" puck is rendered between
//                the two halves of the tab row (the primary create action).
//   createIcon — the icon node for the "+" puck
//   onCreate() — invoked when the "+" is tapped
//
// Each tab is a 44×44 minimum tap target and the whole bar respects
// safe-area-bottom so it sits above the iOS home indicator. The create puck
// is deliberately NOT a `.mb-nav-tab`/role="tab" — it's a plain button outside
// the tablist model (so the tab count + indices stay stable for existing wiring
// and a11y), centred by splitting the tab row in half around it.
export function MobileBottomNav({ tabs, active, onChange, showCreate = false, createIcon = null, onCreate }) {
  const mid = Math.ceil(tabs.length / 2);
  const left = showCreate ? tabs.slice(0, mid) : tabs;
  const right = showCreate ? tabs.slice(mid) : [];
  const renderTab = (t) => (
    <button
      key={t.key}
      role="tab"
      aria-selected={t.key === active}
      className={`mb-nav-tab${t.key === active ? ' is-active' : ''}`}
      onClick={() => onChange?.(t.key)}
    >
      {t.icon ? <span className="mb-nav-ico" aria-hidden="true">{t.icon}</span> : null}
      <span className="mb-nav-lbl">{t.label}</span>
      {t.badge ? <span className="mb-nav-badge">{t.badge}</span> : null}
    </button>
  );
  return (
    <nav className="mb-nav" role="tablist" aria-label="App navigation">
      {left.map(renderTab)}
      {showCreate && (
        <button
          type="button"
          className="mb-nav-create"
          data-tour="mb-create"
          aria-label="Add a card"
          onClick={() => onCreate?.()}
        >
          <span className="mb-nav-create-fab" aria-hidden="true">{createIcon}</span>
        </button>
      )}
      {right.map(renderTab)}
    </nav>
  );
}
