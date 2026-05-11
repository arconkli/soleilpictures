// Pure scanner used outside Tiptap (renderMessageBody, NoteCard
// renderer, card-title renderer). Returns non-overlapping match
// ranges sorted by start offset, suitable for slicing the input
// string into segments around matched terms.
//
// Inside Tiptap a different scanner (AutoLinkPlugin) walks the
// ProseMirror text nodes and adds Decoration.inline ranges.
//
// Match shape: { start, end, text, records: [{kind,id,name,boardId,cardId}, ...] }

export function scanForAutoLinks(text, trie) {
  if (!text || !trie || typeof trie.findMatches !== 'function') return [];
  const out = [];
  for (const m of trie.findMatches(text)) {
    out.push({
      start: m.start,
      end: m.end,
      text: text.slice(m.start, m.end),
      records: m.records || [],
    });
  }
  return out;
}

// Convenience: split a string into [textBefore, match, textBetween,
// match, ..., textAfter] tokens. Useful for renderers that want to
// map straight to an array of React nodes.
//
// Returns: [{ kind: 'text', value }, { kind: 'match', match, value }, ...]
export function tokenizeWithAutoLinks(text, trie) {
  const matches = scanForAutoLinks(text, trie);
  const tokens = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) tokens.push({ kind: 'text', value: text.slice(cursor, m.start) });
    tokens.push({ kind: 'match', match: m, value: m.text });
    cursor = m.end;
  }
  if (cursor < text.length) tokens.push({ kind: 'text', value: text.slice(cursor) });
  return tokens;
}

// Convert one trie record into a canonical EntityRef.
export function recordToRef(rec) {
  if (!rec) return null;
  switch (rec.kind) {
    case 'board':   return { kind: 'board', id: rec.id || rec.boardId };
    case 'doc':     return { kind: 'doc', docCardId: rec.docCardId || rec.cardId, boardId: rec.boardId };
    case 'user':    return { kind: 'user', id: rec.id };
    case 'url':     return { kind: 'url', href: rec.name };
    case 'tag':     return { kind: 'tag', id: rec.id };
    case 'card':    return { kind: 'card', boardId: rec.boardId, cardId: rec.cardId };
    case 'note':    return { kind: 'card', boardId: rec.boardId, cardId: rec.cardId };
    default:        return { kind: 'card', boardId: rec.boardId, cardId: rec.cardId };
  }
}
