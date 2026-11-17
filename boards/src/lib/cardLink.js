// A deep link to a card: opens its board with the card selected (App reads
// ?board= & ?card= on load). Shared by Info and Files' right-click menu. It
// only resolves for someone who can already open that board.

import { t } from '@lingui/core/macro';
import { entityUrl } from './entityUrl.js';
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
    feedback?.toast?.({ type: 'success', message: t`Link copied` });
  } catch (_) {
    feedback?.toast?.({ type: 'error', code: 'link_copy_failed', message: t`Could not copy link` });
  }
}

// A cluster's link, from any menu. The clipboard write starts inside the tap
// (Safari needs that); same toasts as the Shared page and sidebar had.
export async function copyClusterLink(id, feedback) {
  if (!id) return;
  const url = `${window.location.origin}${entityUrl({ kind: 'board', id }, { pathname: '/' })}`;
  try {
    await navigator.clipboard.writeText(url);
    feedback?.toast?.({ type: 'success', message: t`Link copied` });
  } catch (_) {
    feedback?.toast?.({ type: 'error', code: 'cluster_link_copy_failed', message: t`Couldn't copy the link.` });
  }
}
