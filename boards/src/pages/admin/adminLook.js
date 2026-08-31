// Dev-only visual-direction switch: ?adminstyle=a|b|c swaps the dashboard's
// look without touching its markup, so competing treatments can be built and
// compared against the same real data instead of described. Guarded by the
// literal import.meta.env.DEV so the bundler drops it from production, per the
// house rule for QA seams.
export function adminLookClass() {
  if (!import.meta.env.DEV) return '';
  try {
    const v = new URLSearchParams(window.location.search).get('adminstyle');
    return ['a', 'b', 'c'].includes(v) ? ` adm-look-${v}` : '';
  } catch { return ''; }
}
