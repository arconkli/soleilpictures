// Note card preview — short text excerpt of the body.

export function previewMini(row) {
  const text = (row?.body || '').slice(0, 140);
  if (!text) return null;
  return <div className="ent-prev-text">{text}</div>;
}

export function previewFull(row) {
  const text = (row?.body || '').slice(0, 280);
  if (!text) return null;
  return <div className="ent-prev-text">{text}</div>;
}
