// A choice of one in the side panel (mockup dx .seg.sm): All | Open |
// Resolved over the comments, This page | All pages over a search. A radio
// group, one stop in the tab order, ← and → between its choices; each choice
// can carry a count.
export function DocSeg({ label, value, options, onChange, className = '' }) {
  const onKeyDown = (e) => {
    const at = options.findIndex((o) => o.value === value);
    const to = e.key === 'ArrowRight' ? (at + 1) % options.length
      : e.key === 'ArrowLeft' ? (at - 1 + options.length) % options.length : null;
    if (to == null) return;
    e.preventDefault();
    onChange(options[to].value);
    const group = e.currentTarget;
    requestAnimationFrame(() => group.querySelector(`[data-value="${options[to].value}"]`)?.focus());
  };
  return (
    <div className={`dl-seg is-sm ${className}`.trim()} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" data-value={o.value}
                aria-checked={o.value === value} tabIndex={o.value === value ? 0 : -1}
                onClick={() => onChange(o.value)}>
          {o.label}
          {o.count != null && <> <span className="dl-cnt">{o.count}</span></>}
        </button>
      ))}
    </div>
  );
}
