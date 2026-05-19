// Fixed bottom navigation for phone width. Renders when
// useBreakpoint().isPhone is true at the call site. The desktop
// sidebar is hidden via @media (max-width: 640px) when this is
// mounted so the two don't overlap.
//
// Props:
//   tabs   — [{ key, label, icon, badge? }]
//   active — current tab key
//   onChange(key)
//
// Each tab is a 44×44 minimum tap target and the whole bar respects
// safe-area-bottom so it sits above the iOS home indicator.
export function MobileBottomNav({ tabs, active, onChange }) {
  return (
    <nav className="mb-nav" role="tablist" aria-label="App navigation">
      {tabs.map((t) => (
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
      ))}
    </nav>
  );
}
