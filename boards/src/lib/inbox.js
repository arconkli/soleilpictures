// Helpers for inbox → card conversion + the drag MIME we use.

export const INBOX_MIME = 'application/x-soleil-inbox';
// Drag a sidebar board entry onto a canvas → drops a board card pointing to it.
export const BOARD_REF_MIME = 'application/x-soleil-board-ref';
// Drag a card from one canvas to another (split pane → main, or vice versa).
export const CARD_TRANSFER_MIME = 'application/x-soleil-card';

// Convert an inbox item into a board card payload at canvas-space (x, y).
// Callers center if they want — this just sets the top-left corner.
export function inboxItemToCard(item, x, y) {
  const id = `dropped-${item.id}-${Date.now()}`;
  if (item.kind === 'image') {
    return { id, kind: 'image', x, y, w: 240, h: 200,
             tone: item.tone || 'neutral',
             label: item.label || 'IMAGE',
             caption: item.caption };
  }
  if (item.kind === 'link') {
    const url = item.url || item.source || '';
    const title = item.title || 'Link';
    return { id, kind: 'note', x, y, w: 280, h: 170,
             html: `<div>${escapeHtml(title)}</div><div>${escapeHtml(url)}</div>` };
  }
  if (item.kind === 'note') {
    return { id, kind: 'note', x, y, w: 240, h: 160,
             body: item.body || '' };
  }
  if (item.kind === 'doc') {
    return { id, kind: 'doc', x, y, w: 280, h: 280,
             title: item.title || 'Document',
             lines: (item.lines || []).map(l => ({
               h: l.kind === 'h' ? 1 : (l.h || undefined),
               bullet: l.kind === 'p' ? false : l.bullet,
               text: l.text,
             })),
             author: item.author || item.from || 'Unknown',
             date: item.date || item.when || '—' };
  }
  return null;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
}

// Reverse of inboxItemToCard — turn a canvas card into an inbox item payload.
// Returns null if the kind doesn't make sense in the inbox (shapes, palettes,
// boards, etc.).
export function cardToInboxItem(card) {
  if (!card) return null;
  if (card.kind === 'image') {
    return { kind: 'image', src: card.src, label: card.title || card.label || 'Image',
             tone: card.tone || 'neutral', caption: card.caption };
  }
  if (card.kind === 'note') {
    // Strip HTML to text for inbox display; preserve raw HTML in `body` so a
    // round-trip back to canvas keeps formatting reasonably.
    const tmp = typeof document !== 'undefined' ? document.createElement('div') : null;
    if (tmp) tmp.innerHTML = card.html || '';
    const text = (tmp?.textContent || card.body || '').trim();
    return { kind: 'note', body: text || 'Empty note', html: card.html };
  }
  if (card.kind === 'link') {
    return { kind: 'link', title: card.title || 'Link', url: card.source || card.link || '' };
  }
  return null;
}
