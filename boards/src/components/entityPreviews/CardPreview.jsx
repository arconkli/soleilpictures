// Generic card preview — when a card kind has no specialized preview,
// fall back to title + body excerpt.

export function previewMini(row) {
  const text = (row?.body || '').slice(0, 100);
  if (!text) return null;
  return <div className="ent-prev-text">{text}</div>;
}

export const previewFull = previewMini;
