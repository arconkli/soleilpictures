// External URL preview — the host. OG-meta unfurls are explicitly
// out of scope for v1 (separate cache + worker route).

export function previewMini(row) {
  const href = row?.meta?.url || row?.title;
  if (!href) return null;
  let host = href;
  try { host = new URL(href).host; } catch (_) {}
  return <div className="ent-prev-meta">{host}</div>;
}

export const previewFull = previewMini;
