// PersonFace — one person's face: their picture when there is one, otherwise
// their initial on their colour, exactly as each surface drew it before.
//
// The surface passes its own class (presence-dot, canvas-comment-avatar,
// msg-bubble-avatar, share-avatar, …), which keeps the size, the corners and
// the ring; this only decides what goes inside (personFace.css).
//
// Where the picture comes from: `url` when the caller already holds one,
// otherwise the userProfiles cache by `userId` (member_profiles.avatar_url,
// which Capture Mode masks to nothing). From either source, only an
// 'r2:<key>' value (a picture uploaded here) is ever loaded. avatar_url is
// written by the client, so an outside URL there would make every colleague's
// browser request someone's own server (IP address, user agent, timing) each
// time the face is drawn. Anything else shows the initial.
//
// A face is too small to explain a failure, so there is never a padlock, a
// spinner or a Retry here. The initial shows until the picture has actually
// loaded, and stays if it can't be signed (a key under a workspace you are
// not in), is unavailable, or fails to load. That is why this signs through
// lib/r2.js directly rather than R2Image: R2Image draws those states, and it
// calls notifyImageAuthError, which on the public viewers re-fetches the whole
// share bundle. Nothing here reaches a global handler or a toast.

import { useEffect, useReducer, useRef, useState } from 'react';
import * as userProfiles from '../lib/userProfiles.js';
import { cachedUrl, getSignedUrl, signFailure } from '../lib/r2.js';
import { isPersonaOn } from '../lib/captureState.js';
import { initialOf } from '../lib/graphemes.js';
import './personFace.css';

// Pictures that did not sign or load, by stored value → when to try again.
// Without it every face of the same person would ask again on every mount (a
// message list is hundreds of them), which is a retry loop by another name.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A refusal (r2.js signFailure 'denied': a key this person may not read) or a
// picture that would not load waits ten minutes. Anything else is passing (the
// network, a missing token, the upload service answering 503 during a deploy),
// so it is tried again after half a minute.
const RETRY_AFTER_MS = 10 * 60 * 1000;
const RETRY_PASSING_MS = 30 * 1000;
const failedUntil = new Map();
// Display URLs that have loaded once this session, so a face that remounts
// (a virtualised list, a reopened panel) shows its picture on the first paint
// instead of flashing the initial.
const loadedUrls = new Set();

function isFailed(raw) {
  const until = failedUntil.get(raw);
  return !!until && until > Date.now();
}
function markFailed(raw, ms = RETRY_AFTER_MS) {
  if (raw) failedUntil.set(raw, Date.now() + ms);
}
// A picture that did not sign: how long to wait depends on why.
function markSignFailed(raw) {
  markFailed(raw, signFailure(raw.slice(3)) === 'denied' ? RETRY_AFTER_MS : RETRY_PASSING_MS);
}

// Only a picture stored here. Anything else (an https URL on someone's own
// server, an http URL, a blob: or data: value) is never requested.
function usable(raw) {
  return typeof raw === 'string' && raw.startsWith('r2:') && raw.length > 3 ? raw : null;
}

// The stored value (always r2:, see usable) → a URL that can go in an <img>
// now, or null (not signed yet, or failed). Signs it once per mount.
function useFaceUrl(raw) {
  const [signed, setSigned] = useState(null); // { raw, url }
  const [, bump] = useReducer((n) => (n + 1) | 0, 0);
  const failed = !!raw && isFailed(raw);
  const ready = !raw || failed ? null
    : cachedUrl(raw) || (signed && signed.raw === raw ? signed.url : null);
  const needsSign = !!raw && !failed && !ready;

  useEffect(() => {
    if (!needsSign) return undefined;
    let alive = true;
    // A value that failed before and is due another try has to be signed
    // afresh: the cached URL may be the dead one.
    const force = failedUntil.has(raw);
    getSignedUrl(raw.slice(3), { force }).then((url) => {
      if (url) failedUntil.delete(raw); else markSignFailed(raw);
      if (!alive) return;
      if (url) setSigned({ raw, url }); else bump();
    }, () => { markFailed(raw, RETRY_PASSING_MS); if (alive) bump(); });
    return () => { alive = false; };
  }, [raw, needsSign]);

  return { url: ready, fail: () => { markFailed(raw); bump(); } };
}

export function PersonFace({
  userId = null,
  name = '',
  color,
  url,                 // an r2: picture the caller already holds; wins over the cache
  initial,             // the text to show without a picture; default initialOf(name)
  size,                // px; leave out when the class sets the size
  className = '',
  style,
  title,
  ariaLabel,
  ariaHidden,          // true when the name is written beside the face
  onClick,
  isolate = false,     // keep the press and the click from what's underneath
  // 'span' renders the clickable face as a span with role="button", for a
  // face that sits inside another button (a button can't hold a button).
  as,
  role,
}) {
  const [, bump] = useReducer((n) => (n + 1) | 0, 0);
  const [loaded, setLoaded] = useState(null);

  // The cache is read only when the caller gave no picture. Re-render when
  // this person's picture changes, not on every cache change: a rename
  // elsewhere must not repaint every face on screen.
  // Real account ids only: Capture Mode's synthetic peers and email-keyed
  // rows carry other strings, and one of those in the batched profile fetch
  // would fail it for everyone else in the batch.
  const fromCache = url === undefined && typeof userId === 'string' && UUID_RE.test(userId);
  const seenRef = useRef(null);
  const cached = fromCache ? (userProfiles.get(userId)?.avatarUrl || null) : null;
  seenRef.current = cached;
  useEffect(() => {
    if (!fromCache) return undefined;
    userProfiles.resolve(userId); // fetches the profile row if nobody has yet
    const check = () => {
      const next = userProfiles.get(userId)?.avatarUrl || null;
      if (next !== seenRef.current) bump();
    };
    check();
    return userProfiles.subscribe(check);
  }, [fromCache, userId]);

  // Capture Mode films under a persona: no real face, whoever supplied it.
  const raw = isPersonaOn() ? null : usable(fromCache ? cached : url);
  const { url: src, fail } = useFaceUrl(raw);
  const pictured = !!src && (loaded === src || loadedUrls.has(src));

  const cls = `person-face${pictured ? ' is-pictured' : ''}${onClick ? ' is-action' : ''}${className ? ` ${className}` : ''}`;
  const box = { ...(size ? { width: size, height: size, fontSize: Math.round(size * 0.46) } : null), ...style };
  if (!pictured && color) box.background = color;
  if (pictured) delete box.background;

  const inner = (
    <>
      {!pictured && (initial !== undefined ? initial : initialOf(name))}
      {src && (
        <img className={`person-face-img${pictured ? '' : ' is-pending'}`}
             src={src} alt="" draggable={false} decoding="async"
             referrerPolicy="no-referrer"
             onLoad={() => { loadedUrls.add(src); setLoaded(src); }}
             onError={fail} />
      )}
    </>
  );

  if (!onClick) {
    return (
      <span className={cls} style={box} title={title} role={role}
            aria-label={ariaLabel} aria-hidden={ariaHidden ? 'true' : undefined}>
        {inner}
      </span>
    );
  }

  // isolate: the click is the face's alone. Your own face sits on things that
  // open, select or drag on a press (a comment, a message row), so neither
  // the press nor the click may reach them. Off by default, so a face that
  // was already a button (a message face opens a DM) behaves as it did.
  const stop = isolate ? (e) => { e.stopPropagation(); } : undefined;
  const act = (e) => {
    if (isolate) { e.stopPropagation(); e.preventDefault(); }
    onClick(e);
  };
  if (as === 'span') {
    return (
      <span className={cls} style={box} title={title} aria-label={ariaLabel || title}
            role="button" tabIndex={0}
            onPointerDown={stop} onMouseDown={stop}
            onClick={act}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              // Always kept from the button around it, which would take the
              // same key as its own press.
              e.stopPropagation(); e.preventDefault();
              onClick(e);
            }}>
        {inner}
      </span>
    );
  }
  return (
    <button type="button" className={cls} style={box} title={title} aria-label={ariaLabel || title}
            onPointerDown={stop} onMouseDown={stop} onClick={act}>
      {inner}
    </button>
  );
}
