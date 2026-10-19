// A shared doc's live room (party/doc.ts), for someone reading or editing it
// through its share. The room is <share id>.<edit|view>.<generation>, named
// by get_file_share; the Worker lets a socket in only on the share's own
// terms (index.ts: doc_room_access as the caller, with ?share=<token> and,
// signed in, ?access_token=).
//
// It keeps the board client's rules (lib/yPartyKit.js), because the room is
// billed the same way, for every second a socket is open:
//   - a presence renewal every KEEPALIVE_MS, which the room echoes, and a
//     close when the last one was never answered (partyKeepalive.js);
//   - the socket is put down while the tab is hidden or unused
//     (partyPark.js), and taken back on the next use;
//   - it closes with a status code before disconnect() or destroy() close it
//     without one: the room does not answer an empty Close frame.
//
// What a close from the room means (party/doc.ts CLOSE), see closeAction():
//   4012 moved / view only / rebuilt — ask the share again: a restore or a
//        move is a new generation (a new room, and a fresh doc), and someone
//        who may now only view is sent to the view room.
//   4503 unavailable, 4429 busy, 4000 silent, a dropped socket — try again,
//        keeping this copy (YProvider reconnects with a backoff).
//   4410 gone, 4401 access ended, 4403 suspended, 1009 too big — stop.
// A socket the Worker refused before it opened (signed out of an edit room, a
// link turned off, an old generation) arrives as a plain failed connect, with
// no code; after REASK_AFTER_FAILURES of those in a row the share is asked
// again.
//
// The room speaks two custom messages: hello { me: { name, color }, access,
// readOnly, variant } once a socket is in, and refused { reason } when a
// write was turned away (that copy then holds something the room never will).
import YProvider from 'y-partyserver/provider';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import { PARTY_HOST } from './partyHost.js';
import { socketLooksDead } from './partyKeepalive.js';
import { parkWhileHidden, parkWhileIdle } from './partyPark.js';
import { pageBusy } from './buildWatch.js';

export const KEEPALIVE_MS = 15_000;
export const REASK_AFTER_FAILURES = 3;
export const MAX_BACKOFF_MS = 10_000;
const MESSAGE_AWARENESS = 1;

export const DOC_ROOM_CLOSE = Object.freeze({
  SILENT: 4000, MOVED: 4012, LOST: 4401, SUSPENDED: 4403, GONE: 4410, BUSY: 4429, UNAVAILABLE: 4503, TOO_BIG: 1009,
});
const STOP = new Set([DOC_ROOM_CLOSE.GONE, DOC_ROOM_CLOSE.LOST, DOC_ROOM_CLOSE.SUSPENDED, DOC_ROOM_CLOSE.TOO_BIG]);

// 'retry' | 'reask' | 'stop' for a close code.
export function closeAction(code) {
  if (code === DOC_ROOM_CLOSE.MOVED) return 'reask';
  if (STOP.has(code)) return 'stop';
  return 'retry';
}

// { type, ... } from a room's custom message, or null.
export function parseRoomMessage(text) {
  try {
    const m = JSON.parse(String(text || ''));
    return m && typeof m === 'object' && typeof m.type === 'string' ? m : null;
  } catch (_) {
    return null;
  }
}

// ydoc: a Y.Doc of its own (never a board's). onHello(hello), onRefused(reason),
// onSync() each time this copy has caught up with the room, onEnd({ action:
// 'reask' | 'stop', code }): the room is not coming back as it was; the caller
// asks the share again or says why.
export function attachDocRoom(ydoc, {
  room, token, getAccessToken = async () => '',
  onHello = () => {}, onRefused = () => {}, onEnd = () => {}, onSync = () => {},
  host = PARTY_HOST,
  WebSocketPolyfill = undefined,   // the tests' socket
} = {}) {
  if (!room || !token) return { awareness: null, whenSynced: async () => false, destroy() {} };
  const awareness = new Awareness(ydoc);
  // The room puts the name and color on it; this only gives the keepalive
  // something to renew.
  awareness.setLocalState({});

  let destroyed = false;
  let ended = false;
  const provider = new YProvider(host, room, ydoc, {
    party: 'doc',
    params: async () => {
      const accessToken = await getAccessToken().catch(() => '');
      return { share: token, access_token: accessToken || null };
    },
    awareness,
    maxBackoffTime: MAX_BACKOFF_MS,
    ...(WebSocketPolyfill ? { WebSocketPolyfill } : {}),
  });

  const closeSocket = (why) => {
    try { if (provider.ws) provider.ws.close(1000, why); } catch (_) { /* already closing */ }
  };

  const end = (action, code) => {
    if (ended || destroyed) return;
    ended = true;
    try { provider.disconnect(); } catch (_) {}
    try { onEnd({ action, code }); } catch (_) {}
  };

  // Sockets that closed before they ever opened, in a row. Counted here: the
  // provider counts its own only after it has told us of the close.
  let failures = 0;
  let opened = false;
  provider.on('status', ({ status }) => {
    if (status === 'connecting') opened = false;
    else if (status === 'connected') { opened = true; failures = 0; }
  });
  provider.on('connection-close', (event) => {
    if (destroyed || ended) return;
    const code = Number(event?.code) || 0;
    const action = closeAction(code);
    if (action !== 'retry') { end(action, code); return; }
    // Refused before it opened, again and again: the share has changed.
    if (!opened && ++failures >= REASK_AFTER_FAILURES) end('reask', code);
  });

  provider.on('sync', (isSynced) => {
    if (isSynced && !destroyed) { try { onSync(); } catch (_) {} }
  });

  provider.on('custom-message', (text) => {
    const m = parseRoomMessage(text);
    if (!m) return;
    if (m.type === 'hello') { try { onHello(m); } catch (_) {} }
    else if (m.type === 'refused') { try { onRefused(String(m.reason || '')); } catch (_) {} }
  });

  // Hidden, or on screen and unused with nobody else working: let go of the
  // room (lib/partyPark.js); the copy stays, so taking it back is a sync.
  const parkedFor = new Set();
  const parkFor = (why) => () => {
    const wasUp = parkedFor.size === 0;
    parkedFor.add(why);
    if (!wasUp || destroyed || ended) return;
    closeSocket('parked');
    try { provider.disconnect(); } catch (_) {}
  };
  const unparkFor = (why) => () => {
    if (!parkedFor.delete(why) || parkedFor.size > 0 || destroyed || ended) return;
    try { Promise.resolve(provider.connect()).catch(() => {}); } catch (_) {}
  };
  const whileHidden = parkWhileHidden({ park: parkFor('tab hidden'), unpark: unparkFor('tab hidden'), isBusy: pageBusy });
  const whileIdle = parkWhileIdle({ park: parkFor('idle'), unpark: unparkFor('idle'), isBusy: pageBusy });
  const onRemoteUpdate = (_update, origin) => { if (origin === provider) whileIdle.noteRemote(); };
  const onAwarenessChange = (_changes, origin) => { if (origin !== 'local') whileIdle.noteRemote(); };
  ydoc.on('update', onRemoteUpdate);
  awareness.on('change', onAwarenessChange);

  // Liveness, as the board client's.
  let lastPingAt = 0;
  const keepalive = setInterval(() => {
    if (destroyed || !provider.wsconnected || !provider.ws) { lastPingAt = 0; return; }
    if (socketLooksDead(provider.wsLastMessageReceived, lastPingAt)) {
      lastPingAt = 0;
      try { provider.ws.close(); } catch (_) {}
      return;
    }
    try {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(awareness, [ydoc.clientID]));
      provider.ws.send(encoding.toUint8Array(enc));
      lastPingAt = Date.now();
    } catch (_) { /* the next tick tries again */ }
  }, KEEPALIVE_MS);

  return {
    awareness,
    provider,
    whenSynced(timeoutMs = 10_000) {
      if (provider.synced) return Promise.resolve(true);
      return new Promise((resolve) => {
        const onSync = (isSynced) => {
          if (!isSynced) return;
          clearTimeout(timer);
          try { provider.off('sync', onSync); } catch (_) {}
          resolve(true);
        };
        const timer = setTimeout(() => {
          try { provider.off('sync', onSync); } catch (_) {}
          resolve(false);
        }, timeoutMs);
        provider.on('sync', onSync);
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearInterval(keepalive);
      whileHidden.dispose();
      whileIdle.dispose();
      try { ydoc.off('update', onRemoteUpdate); } catch (_) {}
      try { awareness.off('change', onAwarenessChange); } catch (_) {}
      closeSocket('left');
      try { provider.destroy(); } catch (_) {}
      try { awareness.destroy(); } catch (_) {}
    },
  };
}
