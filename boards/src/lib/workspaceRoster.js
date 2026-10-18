// Workspace presence as pure functions over what each socket carries.
//
// The workspace room (party/workspace.ts) hibernates, so it keeps no roster in
// memory: each socket holds its own tab's presence in its hibernation
// attachment, and every question the room asks — who is here, has this changed,
// is this tab still here through another socket — is answered from those. The
// party bundles this file; node --test covers it.
//
// A socket's presence:
//   { sid, userId, tabId?, user?, location?, lastSeen? }
// sid      — this socket's own id. A tab's sockets share connection.id across
//            reconnects, so connection.id cannot tell two of them apart.
// userId   — the JWT subject, stamped at upgrade (party/index.ts).
// the rest — from the tab's latest `here`; absent until it sends one.

// A tab goes stale after this long with no heartbeat. A backstop: a clean
// close or an explicit `leave` removes it at once.
export const STALE_MS = 60_000;

// True when nothing a consumer renders has changed between two records — used to
// suppress steady-state heartbeat fanout. Mirrors useWorkspacePresence.peerKey:
// only the fields consumers actually differentiate on (identity + the rendered
// location bits), NOT scrollTop.
export function sameUserLoc(a, b) {
  const au = a.user || {}, bu = b.user || {};
  if (au.id !== bu.id || au.name !== bu.name || au.color !== bu.color) return false;
  const al = a.location || {}, bl = b.location || {};
  return al.boardId === bl.boardId
      && al.surface === bl.surface
      && al.pageId === bl.pageId
      && al.docCardId === bl.docCardId
      && al.isActive === bl.isActive;
}

export function isFresh(p, now, staleMs = STALE_MS) {
  return !!(p && p.tabId && p.user && now - (Number(p.lastSeen) || 0) <= staleMs);
}

// The roster a joining socket is sent: one entry per tab (the freshest, when a
// reconnecting tab briefly holds two sockets), nothing stale.
export function rosterFrom(presences, now, staleMs = STALE_MS) {
  const byTab = new Map();
  for (const p of presences) {
    if (!isFresh(p, now, staleMs)) continue;
    const seen = byTab.get(p.tabId);
    if (!seen || p.lastSeen > seen.lastSeen) byTab.set(p.tabId, p);
  }
  return [...byTab.values()].map((p) => ({
    tabId: p.tabId,
    user: p.user,
    location: p.location ?? null,
    lastSeen: p.lastSeen,
  }));
}

// Fan a `here` out only when this socket was not already showing this tab, or
// something a consumer renders changed. A steady heartbeat is silent, which is
// the difference between O(N) and O(N^2) chatter as a workspace fills up.
export function shouldAnnounce(prev, next) {
  if (!prev || !prev.tabId || prev.tabId !== next.tabId) return true;
  return !sameUserLoc(prev, next);
}

// Is this tab still here through a socket other than `sid`? A reconnect opens
// its new socket before the old one's close arrives; that close must not tell
// everyone the tab left.
export function heldElsewhere(presences, tabId, sid, now, staleMs = STALE_MS) {
  return presences.some((p) => p && p.sid !== sid && p.tabId === tabId && isFresh(p, now, staleMs));
}
