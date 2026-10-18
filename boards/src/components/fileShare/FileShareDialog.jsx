// The owner's "Share file" dialog: who can open one file, on its own, at
// /f/<token>. Opened by FileShareHost from the bus (openFileShare).
//
// Every write goes to an RPC that returns the whole settings row (0421), so
// the dialog renders whatever the server says last. Writes run one after
// another (a promise chain), so two quick changes can't land out of order.
//
// `api` defaults to lib/fileShares.js; the DEV harness passes a fake.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../Modal.jsx';
import { useOptionalFeedback } from '../AppFeedback.jsx';
import { Icon as Glyph } from '../Icon.jsx';
import { X as XIcon, Link as LinkIcon, Globe as GlobeIcon, Lock as LockIcon } from '../../lib/icons.js';
import * as realApi from '../../lib/fileShares.js';
import { FILE_SHARE_PEOPLE_PER_CALL, fileShareUrl, friendlyShareError } from '../../lib/fileShares.js';
import {
  mergeChips, normalizeSettings, sharedMessage, commentsLabel, fileDisplayName,
} from '../../lib/fileShareDialog.js';
import { pickPresenceColor } from '../../lib/presenceColor.js';
import { undoToast } from '../../lib/undoToast.js';
import { logEvent } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import './fileShareDialog.css';

const ROLE_LABEL = { view: 'Can view', comment: 'Can comment' };

function linkSub(link) {
  if (link === 'comment') return 'Anyone with the link can view it. Signed in, they can comment.';
  if (link === 'view') return 'Anyone with the link can view it. No account needed.';
  return 'Only the people above, and people in this cluster, can open it.';
}

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
  const feedback = useOptionalFeedback();
  const name = fileDisplayName(card);

  const [phase, setPhase] = useState('loading'); // loading | ready | denied | error
  const [s, setS] = useState(() => normalizeSettings(null));
  const [chips, setChips] = useState([]);
  const [draft, setDraft] = useState('');
  const [inviteRole, setInviteRole] = useState('comment');
  const [sending, setSending] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null); // only without a FeedbackProvider

  const copyRef = useRef(null);
  const inputRef = useRef(null);
  const mounted = useRef(true);
  const sRef = useRef(s);
  sRef.current = s;
  const chain = useRef(Promise.resolve());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const apply = useCallback((data) => {
    if (mounted.current && data && typeof data === 'object') setS(normalizeSettings(data));
  }, []);

  // Runs one write after the last one finished. `fn` resolves {data, error}.
  const enqueue = useCallback((fn) => {
    const run = chain.current.then(fn, fn);
    chain.current = run.then(() => {}, () => {});
    return run;
  }, []);

  const say = useCallback((message, action = null) => {
    if (feedback?.toast) {
      feedback.toast({ type: 'info', message, ...(action ? { action } : {}) });
    } else if (mounted.current) {
      setNotice({ message, action });
    }
  }, [feedback]);

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
        setS(prev);
        setError(friendlyShareError(err));
      } else {
        apply(data);
        const after = normalizeSettings(data);
        logEvent(EV.FILE_SHARE_ACCESS_SET, { link_access: after.linkAccess, allow_download: after.allowDownload });
      }
      return { data, error: err };
    });
  }, [api, apply, boardId, cardId, enqueue]);

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
    const { data, error: err } = await enqueue(() => api.addFileSharePeople(boardId, cardId, valid, inviteRole));
    if (!mounted.current) return;
    setSending(false);
    if (err) {
      setError(friendlyShareError(err));
      return;
    }
    apply(data);
    const added = Array.isArray(data?.added) ? data.added.length : 0;
    const skipped = (Array.isArray(data?.skipped) ? data.skipped.length : 0) + invalidCount;
    setChips([]);
    say(sharedMessage(added, skipped));
    logEvent(EV.FILE_SHARE_PEOPLE_ADD, { n: added, role: inviteRole, skipped });
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
      if (err) { setS(prev); setError(friendlyShareError(err)); } else apply(data);
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
      if (err) { setS(prev); setError(friendlyShareError(err)); return; }
      apply(data);
      // Undo puts the row back with its role. The server never re-sends the
      // invitation for an un-remove, and it spends no invite budget.
      const onUndo = () => {
        enqueue(async () => {
          const r = await api.setFileSharePerson(boardId, cardId, p.email, prevRole);
          if (r.error) say(friendlyShareError(r.error));
          else apply(r.data);
        });
      };
      if (feedback?.toast) undoToast(feedback, { message: `Removed ${label}`, onUndo });
      else setNotice({ message: `Removed ${label}`, action: { label: 'Undo', onClick: () => { setNotice(null); onUndo(); } } });
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
      apply(data);
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
            <option value="comment">{ROLE_LABEL.comment}</option>
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
          <div className="fsd-section fsd-empty" role="alert">You can't share files in this cluster.</div>
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
                        value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                  <option value="comment">{ROLE_LABEL.comment}</option>
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
                  <div className="fsd-row-sub fsd-wrap">{linkSub(s.linkAccess)}</div>
                </div>
                {s.linkAccess !== 'none' && (
                  <div className="fsd-row-access">
                    <select className="fsd-pick" aria-label="What anyone with the link can do"
                            value={s.linkAccess}
                            onChange={(e) => writeShare({ linkAccess: e.target.value })}>
                      <option value="view">{ROLE_LABEL.view}</option>
                      <option value="comment">{ROLE_LABEL.comment}</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="fsd-row fsd-toggle-row">
                <div className="fsd-row-text">
                  <div className="fsd-row-name" id="fsd-dl-label">Allow downloading</div>
                  <div className="fsd-row-sub fsd-wrap">People you share it with can save the original file.</div>
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
        {phase === 'ready' && s.commentCount > 0 && s.token && (
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
