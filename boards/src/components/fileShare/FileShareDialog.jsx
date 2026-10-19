// The owner's "Share file" dialog: who can open one file, on its own, at
// /f/<token>. Opened by FileShareHost from the bus (openFileShare).
//
// Every write goes to an RPC that returns the whole settings row (0421), so
// the dialog renders whatever the server says last. Writes run one after
// another (a promise chain), so two quick changes can't land out of order.
// A change shows at once; when a write fails the dialog goes back to the last
// settings the SERVER confirmed (serverRef), never to what the screen showed
// when that write was clicked, which may hold another queued write's guess.
//
// `api` defaults to lib/fileShares.js; the DEV harness passes a fake.
//
// It opens over the full-screen viewers (the lightbox and the PDF viewer sit
// at the top z-index; the dialog ties them and, portaled later, wins). The
// app's toast stack sits BELOW those, so every message here, Remove's Undo
// included, is the dialog's own inline notice (role="status"), never a toast.
// Every confirmed write tells the bus (notifyFileShareChanged), so the
// viewers' Share / Shared buttons and an open /f/ page re-read.
//
// A doc (card kind 'doc', 0426) is shared to read or edit together: its roles
// are Can view / Can edit, a link can let anyone read it and anyone signed in
// edit it, and "Allow downloading" is "Allow saving a copy". After a confirmed
// write its live rooms ask again who may be in them (api.recheckDocRooms), so a
// removed person is out within seconds rather than at the room's next minute.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../Modal.jsx';
import { Icon as Glyph } from '../Icon.jsx';
import { X as XIcon, Link as LinkIcon, Globe as GlobeIcon, Lock as LockIcon } from '../../lib/icons.js';
import * as realApi from '../../lib/fileShares.js';
import { FILE_SHARE_PEOPLE_PER_CALL, fileShareUrl, friendlyShareError } from '../../lib/fileShares.js';
import {
  mergeChips, normalizeSettings, sharedMessage, commentsLabel, fileDisplayName,
} from '../../lib/fileShareDialog.js';
import { pickPresenceColor } from '../../lib/presenceColor.js';
import { notifyFileShareChanged } from '../../lib/fileShareBus.js';
import { logEvent } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import './fileShareDialog.css';

const ROLE_LABEL = { view: 'Can view', comment: 'Can comment', edit: 'Can edit' };
// The roles above "Can view", by what is being shared.
const upperRole = (isDoc) => (isDoc ? 'edit' : 'comment');

function linkSub(link, isDoc = false) {
  if (isDoc) {
    if (link === 'edit') return 'Anyone with the link can read it. Signed in, they can edit it too.';
    if (link === 'view') return 'Anyone with the link can read it. No account needed.';
    return 'Only the people above, and people in this cluster, can open it.';
  }
  if (link === 'comment') return 'Anyone with the link can view it. Signed in, they can comment.';
  if (link === 'view') return 'Anyone with the link can view it. No account needed.';
  return 'Only the people above, and people in this cluster, can open it.';
}

// How long a burst of changes waits before the doc's rooms are asked again.
const RECHECK_AFTER_MS = 400;

async function writeClipboard(textOrPromise) {
  // A link that has to be created first is handed over as a promise: Safari
  // only lets a page write the clipboard inside the click, and an await
  // before writeText() falls outside it.
  if (typeof textOrPromise !== 'string') {
    if (typeof window !== 'undefined' && window.ClipboardItem && navigator.clipboard?.write) {
      try {
        const blob = textOrPromise.then((t) => {
          if (!t) throw new Error('no link');
          return new Blob([t], { type: 'text/plain' });
        });
        await navigator.clipboard.write([new window.ClipboardItem({ 'text/plain': blob })]);
        return true;
      } catch (_) { /* fall through to the plain path */ }
    }
    const t = await textOrPromise;
    if (!t) return false;
    return writeClipboard(t);
  }
  try {
    await navigator.clipboard.writeText(textOrPromise);
    return true;
  } catch (_) {
    try {
      const ta = document.createElement('textarea');
      ta.value = textOrPromise;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) { return false; }
  }
}

export function FileShareDialog({ boardId, cardId: cardIdProp, card, boardName = '', onClose, api = realApi }) {
  const cardId = cardIdProp || card?.id;
  const name = fileDisplayName(card);

  const [phase, setPhase] = useState('loading'); // loading | ready | denied | error
  const [s, setS] = useState(() => normalizeSettings(null));
  // A doc from the card that opened the dialog, then from the server's row.
  const isDoc = card?.kind === 'doc' || s.isDoc;
  const upper = upperRole(isDoc);
  const [chips, setChips] = useState([]);
  const [draft, setDraft] = useState('');
  const [inviteRole, setInviteRole] = useState(() => upperRole(card?.kind === 'doc'));
  const [sending, setSending] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null); // { message, action? }: the inline status line

  const copyRef = useRef(null);
  const inputRef = useRef(null);
  const mounted = useRef(true);
  const sRef = useRef(s);
  sRef.current = s;
  const isDocRef = useRef(isDoc);
  isDocRef.current = isDoc;
  const recheckTimer = useRef(null);
  const recheckNow = useRef(null);
  const chain = useRef(Promise.resolve());
  // The last settings row an RPC returned: updated only by load and results.
  const serverRef = useRef(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // A change made just before closing still reaches the rooms.
      if (recheckTimer.current) { clearTimeout(recheckTimer.current); recheckTimer.current = null; recheckNow.current?.(); }
    };
  }, []);

  const apply = useCallback((data) => {
    if (!data || typeof data !== 'object') return;
    serverRef.current = data;
    if (mounted.current) setS(normalizeSettings(data));
  }, []);

  // A doc's rooms ask again who may be in them, once a burst of changes ends.
  const scheduleRecheck = useCallback((token) => {
    if (!token || typeof api.recheckDocRooms !== 'function') return;
    recheckNow.current = () => { recheckNow.current = null; Promise.resolve(api.recheckDocRooms(token)).catch(() => {}); };
    if (recheckTimer.current) clearTimeout(recheckTimer.current);
    recheckTimer.current = setTimeout(() => { recheckTimer.current = null; recheckNow.current?.(); }, RECHECK_AFTER_MS);
  }, [api]);

  // A write the server confirmed: apply it, and tell the viewers.
  const applyWrite = useCallback((data) => {
    apply(data);
    notifyFileShareChanged({ boardId, cardId });
    if (isDocRef.current || data?.kind === 'doc') scheduleRecheck(data?.token || sRef.current.token);
  }, [apply, boardId, cardId, scheduleRecheck]);

  // A write failed: show what the server has, and why.
  const rollback = useCallback((err) => {
    if (!mounted.current) return;
    setS(normalizeSettings(serverRef.current));
    setError(friendlyShareError(err));
  }, []);

  // Runs one write after the last one finished. `fn` resolves {data, error}.
  const enqueue = useCallback((fn) => {
    const run = chain.current.then(fn, fn);
    chain.current = run.then(() => {}, () => {});
    return run;
  }, []);

  const say = useCallback((message, action = null) => {
    if (mounted.current) setNotice({ message, action });
  }, []);

  const load = useCallback(async () => {
    setPhase('loading');
    setError('');
    const { data, error: err } = await api.getFileShareSettings(boardId, cardId);
    if (!mounted.current) return;
    if (err) {
      setPhase(err.code === '42501' ? 'denied' : 'error');
      return;
    }
    apply(data);
    setPhase('ready');
  }, [api, apply, boardId, cardId]);

  useEffect(() => { load(); }, [load]);

  // ---- general access + download -------------------------------------
  const writeShare = useCallback((patch) => {
    const prev = sRef.current;
    const next = { ...prev, ...patch };
    setS(next);
    setError('');
    return enqueue(async () => {
      const { data, error: err } = await api.setFileShare(boardId, cardId, {
        linkAccess: next.linkAccess,
        allowDownload: 'allowDownload' in patch ? next.allowDownload : null,
      });
      if (!mounted.current) return { data, error: err };
      if (err) {
        rollback(err);
      } else {
        applyWrite(data);
        const after = normalizeSettings(data);
        logEvent(EV.FILE_SHARE_ACCESS_SET, { link_access: after.linkAccess, allow_download: after.allowDownload });
      }
      return { data, error: err };
    });
  }, [api, applyWrite, rollback, boardId, cardId, enqueue]);

  const onGeneral = (v) => {
    if (v === 'anyone') writeShare({ linkAccess: s.linkAccess === 'none' ? 'view' : s.linkAccess });
    else writeShare({ linkAccess: 'none' });
  };

  // ---- add people ----------------------------------------------------
  const commitDraft = useCallback((text) => {
    const { chips: next, overflow } = mergeChips(chips, text);
    setChips(next);
    setDraft('');
    if (overflow) setError(`At most ${FILE_SHARE_PEOPLE_PER_CALL} people at a time.`);
    return next;
  }, [chips]);

  const send = async () => {
    if (sending) return;
    const all = draft.trim() ? commitDraft(draft) : chips;
    const valid = all.filter((c) => !c.invalid).map((c) => c.email);
    const invalidCount = all.length - valid.length;
    if (!all.length) return;
    setError('');
    if (!valid.length) {
      say(sharedMessage(0, invalidCount));
      setChips([]);
      return;
    }
    setSending(true);
    const role = inviteRole === 'view' ? 'view' : upper;
    const { data, error: err } = await enqueue(() => api.addFileSharePeople(boardId, cardId, valid, role));
    if (!mounted.current) return;
    setSending(false);
    if (err) {
      setError(friendlyShareError(err));
      return;
    }
    applyWrite(data);
    const added = Array.isArray(data?.added) ? data.added.length : 0;
    const skipped = (Array.isArray(data?.skipped) ? data.skipped.length : 0) + invalidCount;
    setChips([]);
    say(sharedMessage(added, skipped));
    logEvent(EV.FILE_SHARE_PEOPLE_ADD, { n: added, role, skipped });
  };

  const onDraftKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (draft.trim()) commitDraft(draft);
      else if (chips.length) send();
    } else if (e.key === ',' || e.key === ' ' || e.key === ';') {
      if (draft.trim()) { e.preventDefault(); commitDraft(draft); }
    } else if (e.key === 'Backspace' && !draft && chips.length) {
      e.preventDefault();
      setChips(chips.slice(0, -1));
    }
  };

  const onDraftPaste = (e) => {
    const text = e.clipboardData?.getData('text') || '';
    if (!/[,;\s]/.test(text.trim())) return; // one address: let it type in
    e.preventDefault();
    commitDraft(`${draft} ${text}`);
  };

  // ---- people rows ---------------------------------------------------
  const setPersonRole = (p, role) => {
    const prev = sRef.current;
    setS({ ...prev, people: prev.people.map((x) => (x.email === p.email ? { ...x, role } : x)) });
    setError('');
    enqueue(async () => {
      const { data, error: err } = await api.setFileSharePerson(boardId, cardId, p.email, role);
      if (!mounted.current) return;
      if (err) rollback(err); else applyWrite(data);
    });
  };

  const removePerson = (p) => {
    const prev = sRef.current;
    const prevRole = p.role;
    const label = p.name || p.email;
    setS({ ...prev, people: prev.people.filter((x) => x.email !== p.email) });
    setError('');
    enqueue(async () => {
      const { data, error: err } = await api.setFileSharePerson(boardId, cardId, p.email, null);
      if (!mounted.current) return;
      if (err) { rollback(err); return; }
      applyWrite(data);
      // Undo puts the row back with its role. The server never re-sends the
      // invitation for an un-remove, and it spends no invite budget.
      const onUndo = () => {
        enqueue(async () => {
          const r = await api.setFileSharePerson(boardId, cardId, p.email, prevRole);
          if (!mounted.current) return;
          if (r.error) say(friendlyShareError(r.error));
          else applyWrite(r.data);
        });
      };
      say(`Removed ${label}`, { label: 'Undo', onClick: () => { setNotice(null); onUndo(); } });
    });
  };

  // ---- copy link -----------------------------------------------------
  const copyLink = async () => {
    if (phase !== 'ready' || copying) return;
    setError('');
    const cur = sRef.current;
    let created = null;
    let source;
    if (cur.token) {
      source = fileShareUrl(cur.token);
    } else {
      setCopying(true);
      created = enqueue(() => api.setFileShare(boardId, cardId, { linkAccess: cur.linkAccess, allowDownload: cur.allowDownload }));
      source = created.then(({ data, error: err }) => (err || !data?.token ? '' : fileShareUrl(data.token)));
    }
    const ok = await writeClipboard(source);
    if (created) {
      const { data, error: err } = await created;
      if (!mounted.current) return;
      setCopying(false);
      if (err) { setError(friendlyShareError(err)); return; }
      applyWrite(data);
    }
    if (!mounted.current) return;
    if (!ok) { setError("Couldn't copy the link. Try again."); return; }
    const after = sRef.current;
    logEvent(EV.FILE_SHARE_LINK_COPY, { link_access: after.linkAccess });
    setCopied(true);
    setTimeout(() => { if (mounted.current) setCopied(false); }, 1800);
    say(after.linkAccess === 'none' && after.people.length === 0
      ? 'Link copied. Only people you add can open it.'
      : 'Link copied');
  };

  const openComments = () => {
    if (!s.token) return;
    window.open(fileShareUrl(s.token), '_blank', 'noopener');
  };

  const restrictedAlone = phase === 'ready' && s.linkAccess === 'none' && s.people.length === 0;
  const sendable = chips.length > 0 || draft.trim().length > 0;

  const avatar = (p) => (p.avatarUrl
    ? <img className="fsd-avatar" src={p.avatarUrl} alt="" referrerPolicy="no-referrer" />
    : (
      <span className="fsd-avatar" aria-hidden="true" style={{ background: pickPresenceColor(p.email) }}>
        {(p.name || p.email).charAt(0).toUpperCase()}
      </span>
    ));

  const peopleRows = s.people.map((p) => {
    const label = p.name || p.email;
    const sub = [p.name ? p.email : null, p.pending ? 'invited' : null].filter(Boolean).join(' · ');
    return (
      <div key={p.email} className="fsd-row fsd-person" data-email={p.email}>
        {avatar(p)}
        <div className="fsd-row-text">
          <div className="fsd-row-name">{label}</div>
          {sub && <div className="fsd-row-sub">{sub}</div>}
        </div>
        <div className="fsd-row-access">
          <select className="fsd-pick" aria-label={`Access for ${label}`}
                  value={p.role}
                  onChange={(e) => (e.target.value === '__remove' ? removePerson(p) : setPersonRole(p, e.target.value))}>
            <option value="view">{ROLE_LABEL.view}</option>
            <option value={upper}>{ROLE_LABEL[upper]}</option>
            <option value="__remove">Remove</option>
          </select>
        </div>
      </div>
    );
  });

  return (
    <Modal open onClose={onClose} className="fsd-modal" backdropClassName="fsd-backdrop"
           labelledBy="fsd-title" initialFocusRef={copyRef}>
      <div className="fsd-head">
        <h2 className="fsd-title" id="fsd-title">
          <span className="fsd-title-verb">Share</span>{' '}
          <span className="fsd-title-name">“{name}”</span>
        </h2>
        <button type="button" className="fsd-close" onClick={onClose} aria-label="Close">
          <Glyph as={XIcon} size={14} />
        </button>
      </div>

      <div className="fsd-body">
        {phase === 'loading' && <div className="fsd-section fsd-empty">Loading…</div>}

        {phase === 'denied' && (
          <div className="fsd-section fsd-empty" role="alert">You can't share {isDoc ? 'docs' : 'files'} in this cluster.</div>
        )}

        {phase === 'error' && (
          <div className="fsd-section fsd-empty" role="alert">
            Couldn't load who has access.{' '}
            <button type="button" className="fsd-linkish" onClick={load}>Try again</button>
          </div>
        )}

        {phase === 'ready' && (
          <>
            <div className="fsd-section">
              <div className="fsd-invite-row">
                <div className="fsd-chips" onClick={() => inputRef.current?.focus()}>
                  {chips.map((c) => (
                    <span key={c.email} className={`fsd-chip${c.invalid ? ' is-invalid' : ''}`}
                          title={c.invalid ? 'Not an email address: it will be skipped' : c.email}>
                      <span className="fsd-chip-text">{c.email}</span>
                      <button type="button" className="fsd-chip-x" aria-label={`Remove ${c.email}`}
                              onClick={(e) => { e.stopPropagation(); setChips(chips.filter((x) => x.email !== c.email)); }}>
                        <Glyph as={XIcon} size={10} />
                      </button>
                    </span>
                  ))}
                  <input ref={inputRef} className="fsd-input" type="text"
                         aria-label="Add people by email"
                         placeholder={chips.length ? '' : 'Add people by email'}
                         value={draft}
                         autoComplete="off" autoCapitalize="off" spellCheck={false}
                         onChange={(e) => setDraft(e.target.value)}
                         onKeyDown={onDraftKey}
                         onPaste={onDraftPaste}
                         onBlur={() => { if (draft.trim()) commitDraft(draft); }} />
                </div>
              </div>
              <div className="fsd-invite-access">
                <select className="fsd-select" aria-label="Access for the people you add"
                        value={inviteRole === 'view' ? 'view' : upper} onChange={(e) => setInviteRole(e.target.value)}>
                  <option value={upper}>{ROLE_LABEL[upper]}</option>
                  <option value="view">{ROLE_LABEL.view}</option>
                </select>
                <button type="button" className="fsd-btn fsd-send" onClick={send} disabled={!sendable || sending}>
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>

            <div className="fsd-section">
              <h3 className="fsd-section-title">People with access</h3>
              {s.people.length > 0 && <div className="fsd-list">{peopleRows}</div>}
              <div className="fsd-hint">
                People in {boardName ? `“${boardName}”` : 'this cluster'} can open it too.
              </div>
            </div>

            <div className="fsd-section">
              <h3 className="fsd-section-title">General access</h3>
              <div className="fsd-row fsd-general">
                <span className="fsd-avatar fsd-avatar-link" aria-hidden="true">
                  <Glyph as={s.linkAccess === 'none' ? LockIcon : GlobeIcon} size={14} weight="regular" />
                </span>
                <div className="fsd-row-text">
                  <select className="fsd-pick fsd-pick-left" aria-label="Who can open it"
                          value={s.linkAccess === 'none' ? 'restricted' : 'anyone'}
                          onChange={(e) => onGeneral(e.target.value)}>
                    <option value="restricted">Only people added</option>
                    <option value="anyone">Anyone with the link</option>
                  </select>
                  <div className="fsd-row-sub fsd-wrap">{linkSub(s.linkAccess, isDoc)}</div>
                </div>
                {s.linkAccess !== 'none' && (
                  <div className="fsd-row-access">
                    <select className="fsd-pick" aria-label="What anyone with the link can do"
                            value={s.linkAccess}
                            onChange={(e) => writeShare({ linkAccess: e.target.value })}>
                      <option value="view">{ROLE_LABEL.view}</option>
                      <option value={upper}>{ROLE_LABEL[upper]}</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="fsd-row fsd-toggle-row">
                <div className="fsd-row-text">
                  <div className="fsd-row-name" id="fsd-dl-label">{isDoc ? 'Allow saving a copy' : 'Allow downloading'}</div>
                  <div className="fsd-row-sub fsd-wrap">
                    {isDoc ? 'People you share it with can save a copy of their own.' : 'People you share it with can save the original file.'}
                  </div>
                </div>
                <button type="button" role="switch" aria-checked={s.allowDownload}
                        aria-labelledby="fsd-dl-label"
                        className={`fsd-switch${s.allowDownload ? ' is-on' : ''}`}
                        onClick={() => writeShare({ allowDownload: !s.allowDownload })}>
                  <span className="fsd-switch-thumb" />
                </button>
              </div>
            </div>
          </>
        )}

        {error && <div className="fsd-error" role="alert">{error}</div>}
        {notice && (
          <div className="fsd-notice" role="status">
            <span>{notice.message}</span>
            {notice.action && (
              <button type="button" className="fsd-linkish" onClick={notice.action.onClick}>{notice.action.label}</button>
            )}
          </div>
        )}
      </div>

      {restrictedAlone && (
        <div className="fsd-foot-note">
          <span>Only people you add can open it.</span>
          <button type="button" className="fsd-linkish" onClick={() => writeShare({ linkAccess: 'view' })}>
            Let anyone with the link view
          </button>
        </div>
      )}
      <div className="fsd-foot">
        {phase === 'ready' && !isDoc && s.commentCount > 0 && s.token && (
          <button type="button" className="fsd-linkish fsd-comments" onClick={openComments}>
            {commentsLabel(s.commentCount)} · Open
          </button>
        )}
        {phase !== 'denied' && (
          <button type="button" ref={copyRef} className="fsd-btn fsd-foot-btn"
                  aria-disabled={phase !== 'ready' || copying}
                  onClick={copyLink}>
            <Glyph as={LinkIcon} size={14} />{' '}
            {copied ? 'Copied' : copying ? 'Working…' : 'Copy link'}
          </button>
        )}
        <button type="button" className="fsd-btn fsd-foot-btn fsd-done" onClick={onClose}>
          {phase === 'denied' ? 'Close' : 'Done'}
        </button>
      </div>
    </Modal>
  );
}
