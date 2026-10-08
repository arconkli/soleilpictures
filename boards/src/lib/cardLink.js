// A deep link to a card: opens its board with the card selected (App reads
// ?board= & ?card= on load). Shared by Info and Files' right-click menu. It
// only resolves for someone who can already open that board.

export function cardLinkUrl(href, boardId, cardId) {
  const url = new URL(href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('board', boardId || '');
  url.searchParams.set('card', cardId);
  return `${url.origin}${url.pathname}?${url.searchParams.toString()}`;
}

export async function copyCardLink(cardId, boardId, feedback) {
  try {
    await navigator.clipboard.writeText(cardLinkUrl(window.location.href, boardId, cardId));
    feedback?.toast?.({ type: 'success', message: 'Link copied' });
  } catch (_) {
    feedback?.toast?.({ type: 'error', message: 'Could not copy link' });
  }
}
