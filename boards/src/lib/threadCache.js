// The last few conversations' rows, so going back to one paints at once
// while it reads again. Only what the server sent: never a send in flight or
// an optimistic change. Everything goes when the signed-in user changes.

export const THREAD_CACHE_MAX = 8;

let owner = null;
const cache = new Map(); // conversationId → { rows, hasOlder, reachedStart, historyFrom }

export function getCachedThread(userId, conversationId) {
  if (!userId || !conversationId || userId !== owner) return null;
  const hit = cache.get(conversationId);
  if (!hit) return null;
  cache.delete(conversationId);
  cache.set(conversationId, hit); // most recently used last
  return hit;
}

export function putCachedThread(userId, conversationId, entry) {
  if (!userId || !conversationId || !entry) return;
  if (owner !== userId) { cache.clear(); owner = userId; }
  cache.delete(conversationId);
  cache.set(conversationId, entry);
  while (cache.size > THREAD_CACHE_MAX) cache.delete(cache.keys().next().value);
}

export function clearThreadCache() {
  cache.clear();
  owner = null;
}
