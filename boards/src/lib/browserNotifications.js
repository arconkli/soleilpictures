// Browser-level Notifications API integration. Two responsibilities:
//
// 1. Ask permission ONCE, deferred until the user's first sendMessage.
//    Asking on app open is hostile (and most modern browsers block
//    prompts that fire without a user gesture anyway).
//
// 2. Show an OS notification on `inbox-ping` only when the tab isn't
//    visible — otherwise the in-app toast carries it.
//
// Permission outcome is sticky once granted/denied. The "asked once"
// flag lives in localStorage so a declined user isn't re-prompted on
// every send.

const ASKED_KEY = 'soleil.notif.askedOnce';

function supported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permissionState() {
  if (!supported()) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

// Call from the first successful sendMessage. No-op if we've already
// asked (regardless of outcome) or the browser doesn't support it.
export async function requestPermissionDeferred() {
  if (!supported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    if (localStorage.getItem(ASKED_KEY) === '1') return Notification.permission;
    localStorage.setItem(ASKED_KEY, '1');
  } catch (_) { /* localStorage blocked — proceed without the guard */ }
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch (e) {
    console.warn('[notif] requestPermission failed', e);
    return 'denied';
  }
}

function tabIsActive() {
  if (typeof document === 'undefined') return true;
  if (document.visibilityState === 'hidden') return false;
  // hasFocus is sturdier than visibilityState — a foregrounded tab in
  // a backgrounded window still reads as 'visible'.
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false;
  return true;
}

// Show an OS notification if (a) supported, (b) permission granted,
// (c) the tab is not active. `tag` collapses repeated pings from the
// same conversation. onClick is invoked when the user clicks the
// notification (we focus the window + delegate to the caller).
export function maybeShowNotification({ title, body, tag, icon, onClick }) {
  if (!supported()) return null;
  if (Notification.permission !== 'granted') return null;
  if (tabIsActive()) return null;
  try {
    const n = new Notification(title || 'New message', {
      body: body || '',
      tag: tag || undefined,
      icon: icon || '/icon-192.png',
      // Re-rings the OS chime even if a same-tag notification is open.
      renotify: !!tag,
      silent: false,
    });
    n.onclick = () => {
      try { window.focus(); } catch (_) {}
      try { onClick?.(); } catch (e) { console.warn('[notif] onClick threw', e); }
      try { n.close(); } catch (_) {}
    };
    return n;
  } catch (e) {
    console.warn('[notif] show failed', e);
    return null;
  }
}
