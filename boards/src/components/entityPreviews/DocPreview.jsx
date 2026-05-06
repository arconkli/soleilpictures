// Doc preview — title + body excerpt. The body field on doc cards
// is currently the first paragraph or page summary.

export function previewMini(row) {
  const excerpt = row?.body?.slice?.(0, 140) || null;
  if (!excerpt) return null;
  return <div className="ent-prev-text">{excerpt}</div>;
}

export function previewFull(row) {
  const excerpt = row?.body?.slice?.(0, 280) || null;
  if (!excerpt) return null;
  return <div className="ent-prev-text">{excerpt}</div>;
}
