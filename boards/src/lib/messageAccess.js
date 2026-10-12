// Can this person send messages from the workspace they're in? Pure, so
// node --test can pin it against the server's rule.
//
// A send stamps messages.workspace_id with the CURRENT workspace, and the
// insert policy requires can_write_workspace on it: not on the waitlist, and
// the workspace's owner or a member whose role can write (owner, coowner,
// admin, editor, service — _workspace_member_can_write, 0391). There is no
// plan check. The client used to gate on the plan instead, so a free editor
// was shown "requires a paid plan" for a send the server would take, and a
// paid viewer got a composer whose every send failed (COMMS-08).

export const MESSAGE_WRITER_ROLES = new Set(['owner', 'coowner', 'admin', 'editor', 'service']);

// → { canSend, reason }  reason: null | 'waitlist' | 'viewer'
export function messagingAccess({ tier, workspace, role, userId }) {
  if (tier === 'waitlist') return { canSend: false, reason: 'waitlist' };
  if (userId && workspace?.created_by === userId) return { canSend: true, reason: null };
  if (role && MESSAGE_WRITER_ROLES.has(role)) return { canSend: true, reason: null };
  return { canSend: false, reason: 'viewer' };
}

// Why starting a DM or a group failed, in words — the picker used to just
// re-enable its button (COMMS-25). Maps the find_or_create_dm /
// create_group_conversation exceptions (0178).
export function startChatErrorMessage(error, { group = false } = {}) {
  const msg = String(error?.message || error || '').toLowerCase();
  if (msg.includes('cannot message one or more')) {
    return "You can't message one or more of those people from this workspace.";
  }
  if (msg.includes('cannot message')) return "You can't message this person from this workspace.";
  if (msg.includes('workspace member')) {
    return "You're not a member of this workspace. Switch to one you belong to and try again.";
  }
  if (msg.includes('suspended')) return 'This account is suspended.';
  if (msg.includes('failed to fetch') || msg.includes('network')) {
    return `Couldn't ${group ? 'create the group' : 'start the chat'}. Check your connection and try again.`;
  }
  return `Couldn't ${group ? 'create the group' : 'start the chat'} — try again.`;
}

// What the thread says in place of the composer, and the New chat button's
// title, when sending isn't allowed here. 'left' is a group you left, opened
// from a permalink or a toast.
export function readOnlyCopy(reason) {
  if (reason === 'left') {
    return { notice: 'You left this conversation. You can still read it.', newChatTitle: 'New chat' };
  }
  if (reason === 'waitlist') {
    return {
      notice: 'You can read this conversation. Sending messages opens once your account is off the waitlist.',
      newChatTitle: 'Messaging opens once your account is off the waitlist',
    };
  }
  return {
    notice: "You're a viewer in this workspace, so you can read but not reply here. Switch to your own workspace to reply.",
    newChatTitle: "Viewers can't start chats here. Switch to your own workspace to start one.",
  };
}
