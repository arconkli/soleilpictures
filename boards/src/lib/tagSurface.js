// Pure helpers behind the tag surfaces: the canvas chips (useWorkspaceTags),
// the sidebar Tags section and the tag profile (TagDetailView). Kept out of
// the components so the rules they encode can be tested with node --test.

// ── Realtime ────────────────────────────────────────────────────────────
// entity_links and tag_suggestions keep REPLICA IDENTITY DEFAULT and have
// RLS on, so a realtime DELETE carries only the primary key in `old` — never
// target_kind / link_kind / target_id. Every "does this touch a tag?" check
// that read old.target_kind therefore never matched a removal: the row went
// away server-side and the chip, the count and the profile list stayed put.
// A DELETE we can't attribute has to be treated as "maybe ours".

export function isDeleteEvent(payload) {
  return payload?.eventType === 'DELETE';
}

// An applied-tag application changed (optionally: for this one tag).
export function touchesAppliedTag(payload, tagId = null) {
  if (isDeleteEvent(payload)) return true;
  const hit = (r) => !!r && r.target_kind === 'tag' && r.link_kind === 'applied'
    && (!tagId || r.target_id === tagId);
  return hit(payload?.new) || hit(payload?.old);
}

// A doc-side reference to this tag changed: a mention, or an applied tag on a
// doc page (the tag profile's "Appears in" list).
export function touchesTagMention(payload, tagId) {
  if (isDeleteEvent(payload)) return true;
  const hit = (r) => !!r && r.target_kind === 'tag' && r.target_id === tagId
    && (r.link_kind === 'mention' || (r.link_kind === 'applied' && r.source_kind === 'doc'));
  return hit(payload?.new) || hit(payload?.old);
}

// A suggestion for this tag changed. A DELETE whose `old` still names a tag
// (when tag_id is part of the key) is matched exactly; one that doesn't is
// treated as possibly ours.
export function touchesTagSuggestion(payload, tagId) {
  const n = payload?.new || {};
  const o = payload?.old || {};
  if (n.tag_id === tagId || o.tag_id === tagId) return true;
  return isDeleteEvent(payload) && o.tag_id == null;
}

// ── Coalesced refresh ───────────────────────────────────────────────────
// Wraps an async reload so overlapping calls never run concurrently AND are
// never dropped: a call made while one is in flight queues exactly one
// trailing re-run. The old boolean guard returned early instead, so an
// explicit refresh after a removal (or the refresh for a board you just
// switched to) was silently lost whenever another fetch was mid-flight.
// `fn` owns its own error reporting; a throw doesn't stop the trailing run.
export function coalesce(fn) {
  let inFlight = null;
  let again = false;
  return function run() {
    if (inFlight) { again = true; return inFlight; }
    inFlight = (async () => {
      try {
        do {
          again = false;
          try { await fn(); } catch (_) { /* fn reports its own failures */ }
        } while (again);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
}

// ── Profile filters ─────────────────────────────────────────────────────
// The tag profile's type filter is one remembered preference across every
// tag. Applied to a tag that has none of that kind it made the tag look
// empty ("No images tagged.") — and when the tag had no synced cards at all
// the pill row was hidden, leaving no way back. Show everything instead; the
// preference itself is left alone so it still applies to the next tag that
// does have that kind.
export function effectiveTypeFilter(stored, typeCounts) {
  if (!stored || stored === 'all') return 'all';
  const n = typeCounts?.get ? typeCounts.get(stored) : 0;
  return n > 0 ? stored : 'all';
}
