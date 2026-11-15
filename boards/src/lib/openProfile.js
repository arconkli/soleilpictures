// openProfile.js — the one way something outside App opens Settings on the
// Profile tab: your own face on a comment, a message or the Share panel, or
// the one-time "add your name and picture" note on the canvas. App listens for
// the event and calls its own openSettings('profile') (App.jsx). Same shape as
// 'soleil:open-invite'.

export const OPEN_PROFILE_EVENT = 'soleil:open-profile';

// `via` says where it came from ('comment', 'message', 'share', 'hint', …).
export function openProfile(via) {
  try {
    window.dispatchEvent(new CustomEvent(OPEN_PROFILE_EVENT, { detail: { via: via || null } }));
  } catch (_) { /* no window (node) — nothing to open */ }
}
