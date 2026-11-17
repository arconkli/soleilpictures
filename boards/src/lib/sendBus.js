// Open the Send to… sheet from anywhere (SendHost listens):
//   openSend({ boardId, boardTitle, cards, surface })
// boardId is the cluster the thing lives in. cards (optional) are plain card
// objects as the canvas holds them, one or several, in the order picked;
// without cards the whole cluster is sent. A cluster card on a canvas sends
// the cluster it stands for, so its caller passes that cluster's id and no
// cards. surface names where it came from (canvas_menu, card_menu_touch,
// sidebar_menu, …) for the send_to event.

export const SEND_EVENT = 'soleil-open-send';

// The most cards one message carries. More than this and the menu item
// says so and does nothing.
export const SEND_MAX_CARDS = 50;

// The most people, groups and email addresses one send reaches together.
// send_board_to (0904, c_max_targets) refuses more; gen-docs checks the two
// agree.
export const SEND_MAX_PEOPLE = 25;

// The signed-in app shell mounts SendHost, which registers here; public
// pages never mount it, so they never offer Send to….
let hosts = 0;
export function registerSendHost() {
  hosts += 1;
  let done = false;
  return () => { if (!done) { done = true; hosts -= 1; } };
}
export function sendAvailable() { return hosts > 0; }

export function openSend(detail) {
  if (typeof document === 'undefined' || !detail?.boardId) return;
  const cards = Array.isArray(detail.cards) ? detail.cards.filter((c) => c && c.id) : [];
  if (cards.length > SEND_MAX_CARDS) return;
  document.dispatchEvent(new CustomEvent(SEND_EVENT, { detail: { ...detail, cards } }));
}
