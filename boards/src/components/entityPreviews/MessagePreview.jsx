// Message preview — stub. Phase 2 fills this in via get_entity_mentions
// (the popover's APPEARS IN section). v1 messages aren't typically
// "entities named this" themselves, so this preview shouldn't fire
// often in Phase 1.

export function previewMini(row) {
  const text = (row?.body || '').slice(0, 120);
  if (!text) return null;
  return <div className="ent-prev-text">{text}</div>;
}

export const previewFull = previewMini;
