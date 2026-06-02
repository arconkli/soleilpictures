// AdminTimeRange — the global time-window selector for the Analytics tab.
// A small segmented control (reuses the .tob-segmented look). Its value is an
// integer day-count that the tab threads into every windowed RPC (p_days) and
// into useAdminData's deps, so changing it re-fetches the whole tab.

const PRESETS = [
  { d: 7,  label: '7d' },
  { d: 30, label: '30d' },
  { d: 90, label: '90d' },
];

export function AdminTimeRange({ value, onChange }) {
  return (
    <div className="tob-segmented admin-range" role="group" aria-label="Time range">
      {PRESETS.map((p) => (
        <button
          key={p.d}
          type="button"
          className={value === p.d ? 'is-active' : ''}
          aria-pressed={value === p.d}
          onClick={() => onChange(p.d)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
