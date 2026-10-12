// What the inbox shows for a conversation, given your own participant row.
// Pure, so node --test can pin it.

// A DM is a conversation with exactly two participant rows. Rows are never
// deleted (leaving sets left_at), so this holds however many have left; a
// group that drops to two ACTIVE members stays a group (COMMS-17).
export function isDmConversation(participants) {
  return Array.isArray(participants) && participants.length === 2;
}

const ts = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : null;
};

// Hidden from the inbox: not yours, or one you left. Hiding a DM is the same
// left_at write as leaving (there is no separate "hidden" flag yet), and the
// server stops pinging a participant who left — so a peer's reply to a DM
// you hid used to vanish while still counting as unread (COMMS-11). A DM
// therefore comes back when someone else writes in it after you hid it;
// opening it rejoins you.
export function hiddenFromInbox({ conv, me, participants }) {
  if (!me) return true;
  if (!me.left_at) return false;
  if (!isDmConversation(participants)) return true;
  const last = ts(conv?.last_message_at);
  const left = ts(me.left_at);
  if (last == null || left == null) return true;
  return !(last > left && conv?.last_message_sender_id && conv.last_message_sender_id !== me.user_id);
}
