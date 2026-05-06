// User preview — simple email line. Avatar + presence belong to a
// future iteration; for now we just show enough to identify them.

export function previewMini(row) {
  const email = row?.body || null;
  if (!email) return null;
  return <div className="ent-prev-meta">{email}</div>;
}

export const previewFull = previewMini;
