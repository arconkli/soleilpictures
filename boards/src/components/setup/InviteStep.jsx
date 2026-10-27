// InviteStep — the invite panel of the first-run setup and of its one re-ask.
//
// The workspace's invite link leads: Copy on a computer, the phone's own share
// sheet on a phone (closing the sheet counts as shared). A phone with no share
// sheet copies instead, and says Copied. Where the browser refuses the
// clipboard, the link is shown selected, to copy by hand (which counts as out
// too): the press is never silent. Then "or invite by email", one row and a
// secondary Send. Email goes out through lib/inviteSubmit.js, the same way the
// share panel sends it. The parent owns the way on: it hears onOut('link') when
// the link goes out and onOut('email') when an email was sent, and
// onInvited(addresses) for the workspace card's faces.

import { useEffect, useMemo, useRef, useState } from 'react';
import { LinkSimple, Copy, Check, Export, Plus, X, CaretDown, Gift, Info, CheckCircle } from '@phosphor-icons/react';
import { Icon } from '../Icon.jsx';
import { logEvent, logEventNow } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { inviteWorkspaceMember } from '../../lib/boardsApi.js';
import { createWorkspaceInviteLink, getWorkspaceInviteLinkTerms } from '../../lib/inviteApi.js';
import { workspaceInviteUrl } from '../../lib/workspaceLink.js';
import { parseEmails, runInvitesByRole, inviteLimitKind } from '../../lib/inviteSubmit.js';
import { editorLimitRefusalMessage } from '../../lib/editorLimit.js';
import { inviteRewardCopy } from '../../lib/inviteReward.js';
import { MAX_INVITE_ROWS, linkTermsLine } from '../../lib/workspaceSetup.js';

let rowSeq = 0;
const newRow = () => ({ id: `r${(rowSeq += 1)}`, email: '', role: 'editor' });
const ROLE_LABEL = { editor: 'Can edit', viewer: 'Can view' };

// The server's refusal, as a sentence for the link field.
function linkProblem(e) {
  if (e?.hint === 'link_limit') return 'You’ve made today’s invite links. Invite by email below, or try again tomorrow.';
  const msg = String(e?.message || '');
  if (/paused/i.test(msg)) return 'Sharing is paused on this account while we review unusual activity.';
  return 'The invite link didn’t load. Invite by email below.';
}

const sentence = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// The link onto the clipboard: the Clipboard API, then the old select-and-copy,
// which some in-app browsers still allow when they refuse the API. Whether
// either worked.
async function writeLink(url) {
  try { await navigator.clipboard.writeText(url); return true; } catch (_) { /* the old way next */ }
  const was = document.activeElement;
  const ta = document.createElement('textarea');
  try {
    ta.value = url;
    ta.setAttribute('readonly', '');
    // 16px, or iOS zooms the page to the field it is about to select.
    Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', opacity: '0', fontSize: '16px' });
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, url.length);
    return document.execCommand('copy');
  } catch (_) { return false; } finally {
    ta.remove();
    try { was?.focus?.(); } catch (_) { /* focus is only a courtesy */ }
  }
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

// The whole link selected from its end back, so the field shows where it starts.
function selectLink(el) {
  try { el.setSelectionRange(0, el.value.length, 'backward'); el.scrollLeft = 0; } catch (_) { /* still on screen to copy */ }
}

export function InviteStep({ workspaceId, workspaceName, surface, isPhone, onOut, onInvited }) {
  const [token, setToken] = useState(null);
  const [terms, setTerms] = useState(null);
  const [linkError, setLinkError] = useState(null);
  const [copied, setCopied] = useState(false);
  // The browser refused the clipboard: the link is shown, selected, instead.
  const [copyRefused, setCopyRefused] = useState(false);
  const linkFieldRef = useRef(null);
  const [rows, setRows] = useState(() => [newRow()]);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState([]);
  const [limit, setLimit] = useState(null);
  const [editorsFull, setEditorsFull] = useState(null);
  const copiedTimer = useRef(null);
  const url = token ? workspaceInviteUrl(token) : null;
  const canShare = isPhone && typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  // The link is made (or the live one fetched) as the step opens, so the field
  // shows the real URL. Making one sends nothing to anyone.
  useEffect(() => {
    if (!workspaceId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const t = await createWorkspaceInviteLink(workspaceId, 'editor');
        if (cancelled) return;
        setToken(t);
        try { logEvent(EV.WORKSPACE_LINK_CREATED, { surface, role: 'editor' }); } catch (_) {}
        try {
          const row = await getWorkspaceInviteLinkTerms(t);
          if (!cancelled && row) setTerms(row);
        } catch (_) { /* the first sentence still reads */ }
      } catch (e) {
        if (cancelled) return;
        setLinkError(linkProblem(e));
        try { logEvent(EV.SETUP_ERROR, { op: 'link', surface, reason: String(e?.hint || e?.code || e?.message || 'error').slice(0, 80) }); } catch (_) {}
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, surface]);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  useEffect(() => {
    if (!copyRefused) return;
    const el = linkFieldRef.current;
    if (!el) return;
    try { el.focus(); } catch (_) { /* still on screen to copy */ }
    selectLink(el);
  }, [copyRefused]);

  const termsLine = linkTermsLine({
    workspaceName, role: terms?.role || 'editor', expiresAt: terms?.expires_at,
    maxUses: terms?.max_uses, uses: terms?.uses, now: Date.now(),
  });

  const markCopied = () => {
    setCopyRefused(false);
    setCopied(true);
    onOut?.('link');
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2400);
  };

  const copyLink = async () => {
    if (!url) return;
    const ok = await writeLink(url);
    try { logEventNow(EV.WORKSPACE_LINK_SHARED, { surface, method: 'copy', ok }); } catch (_) {}
    if (!ok) { setCopyRefused(true); return; }
    markCopied();
  };

  // They copied the shown link themselves. The field leaves on the next tick,
  // once the browser has taken the selection.
  const copiedByHand = () => {
    try { logEventNow(EV.WORKSPACE_LINK_SHARED, { surface, method: 'copy', ok: true, by: 'hand' }); } catch (_) {}
    setTimeout(markCopied, 0);
  };

  const shareLink = async () => {
    if (!url) return;
    if (!canShare) { copyLink(); return; }
    let completed = false;
    try {
      await navigator.share({ title: `Join ${workspaceName || 'my workspace'} on Clusters`, url });
      completed = true;
    } catch (_) { completed = false; }
    // Closing the sheet counts: the person reached for it, and the step should
    // not ask them to prove they sent it.
    try { logEventNow(EV.WORKSPACE_LINK_SHARED, { surface, method: 'share', completed }); } catch (_) {}
    onOut?.('link');
  };

  const valid = useMemo(() => rows.filter((r) => parseEmails(r.email).valid.length > 0), [rows]);
  const setRow = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const send = async () => {
    if (sending || valid.length === 0 || !workspaceId) return;
    setSending(true);
    setLimit(null);
    setEditorsFull(null);
    const byRole = { editor: [], viewer: [] };
    for (const r of valid) for (const e of parseEmails(r.email).valid) byRole[r.role === 'viewer' ? 'viewer' : 'editor'].push(e);
    const next = [];
    const sentEmails = [];
    // The invite budget stops everything after it; the editor limit (0521)
    // stops only the editors, so the viewers still go out.
    const { runs, budget, editors } = await runInvitesByRole(byRole,
      (role) => (email) => inviteWorkspaceMember({ workspaceId, email, role }));
    for (const r of runs) {
      const { role } = r;
      for (const e of r.granted) next.push({ email: e, ok: true, label: 'Added' });
      for (const e of r.pending) next.push({ email: e, ok: true, label: 'Invite sent' });
      for (const f of r.fail) next.push({ email: f.email, ok: false, label: f.reason === 'already a member' ? 'Already in it' : 'Not sent' });
      sentEmails.push(...r.granted, ...r.pending);
      try {
        if (r.granted.length) {
          logEventNow(EV.INVITE_SENT, { role, result: 'granted', n: r.granted.length, surface, method: 'email', reward_note: 'free' });
          logEventNow(EV.ACCESS_GRANTED, { how: 'workspace', role: `workspace:${role}`, board_id: null, surface });
        }
        if (r.pending.length) logEventNow(EV.INVITE_SENT, { role, result: 'pending', n: r.pending.length, surface, method: 'email', reward_note: 'free' });
      } catch (_) { /* analytics never breaks a send */ }
    }
    setResults((prev) => [...prev, ...next]);
    if (budget) {
      setLimit(sentence(budget.reason));
      try {
        logEventNow(EV.INVITE_LIMIT_REACHED, { surface, method: 'email', kind: inviteLimitKind(budget.reason), unsent: budget.unsent.length });
      } catch (_) { /* analytics never breaks a send */ }
    }
    if (editors) {
      setEditorsFull(editorLimitRefusalMessage(editors));
      try { logEventNow(EV.EDITOR_LIMIT_REFUSED, { door: 'workspace_invite', ask: !!editors.ask, surface }); } catch (_) {}
    }
    // Sent rows clear; whatever a limit stopped stays, ready to send again.
    const keep = new Set([...(budget?.unsent || []), ...(editors?.unsent || [])].map((e) => e.toLowerCase()));
    setRows((rs) => {
      const left = rs.filter((r) => parseEmails(r.email).valid.some((e) => keep.has(e.toLowerCase())));
      return left.length ? left : [newRow()];
    });
    setSending(false);
    if (sentEmails.length) {
      onOut?.('email');
      onInvited?.(sentEmails);
    }
  };

  const reward = inviteRewardCopy().lead;
  const refusedHint = isPhone
    ? 'Copying didn’t work here. Press and hold the link to copy it.'
    : `Copying didn’t work here. The link is selected: press ${isMac() ? '⌘C' : 'Ctrl+C'} to copy it.`;
  const linkField = (
    <input ref={linkFieldRef} className={isPhone ? 'su-input su-link-field-phone' : 'su-link-url su-link-field'}
      type="text" readOnly value={url || ''} aria-label="Invite link"
      onFocus={(e) => selectLink(e.target)} onCopy={copiedByHand} />
  );

  return (
    <>
      {isPhone ? (
        <>
          {/* With no share sheet the press copies, so it says so. */}
          <button type="button" className={`su-btn su-primary su-share-btn${copied ? ' is-done' : ''}`} onClick={shareLink} disabled={!url}>
            <Icon as={copied ? Check : Export} size={18} weight="regular" />{copied ? 'Copied' : 'Share invite link'}
          </button>
          {copyRefused && linkField}
        </>
      ) : (
        <div className="su-link" role="group" aria-label="Invite link">
          <Icon as={LinkSimple} size={18} weight="regular" className="su-link-ico" />
          {copyRefused ? linkField : (
            <span className={`su-link-url${url ? '' : ' is-waiting'}`}>{url ? url.replace(/^https?:\/\//, '') : (linkError ? 'No link right now' : 'Making your link…')}</span>
          )}
          <button type="button" className={`su-btn ${copied ? 'su-secondary is-done' : 'su-primary'}`} onClick={copyLink} disabled={!url}>
            <Icon as={copied ? Check : Copy} size={16} weight="regular" />{copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      )}
      <p className="su-linknote" aria-live="polite">{linkError || (copyRefused ? refusedHint : termsLine)}</p>

      <div className="su-or" role="presentation"><span>or invite by email</span></div>
      <div className="su-rows">
        {rows.map((r, i) => (
          <div className="su-row" key={r.id}>
            <input className="su-input su-email" type="email" inputMode="email" autoComplete="off" autoCapitalize="off" spellCheck={false}
              aria-label={i === 0 ? 'Email address' : `Email address ${i + 1}`} placeholder={i === 0 ? 'name@studio.com' : 'another@studio.com'}
              value={r.email} disabled={sending}
              onChange={(e) => setRow(r.id, { email: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }} />
            <button type="button" className="su-role" aria-label={`Access: ${ROLE_LABEL[r.role]}`} disabled={sending}
              onClick={() => setRow(r.id, { role: r.role === 'editor' ? 'viewer' : 'editor' })}>
              <span>{ROLE_LABEL[r.role]}</span><Icon as={CaretDown} size={10} weight="bold" />
            </button>
            {i > 0 && (
              <button type="button" className="su-x" aria-label="Remove this email" disabled={sending}
                onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>
                <Icon as={X} size={14} weight="regular" />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="su-email-actions">
        <button type="button" className="su-add" disabled={rows.length >= MAX_INVITE_ROWS || sending}
          onClick={() => setRows((rs) => [...rs, newRow()])}>
          <Icon as={Plus} size={14} weight="regular" />Add another
        </button>
        <button type="button" className="su-btn su-secondary su-send" disabled={valid.length === 0 || sending} onClick={send}>
          {sending ? 'Sending…' : (valid.length > 1 ? `Send ${valid.length} invites` : 'Send invite')}
        </button>
      </div>

      {results.length > 0 && (
        <ul className="su-results" aria-live="polite">
          {results.map((x, i) => (
            <li key={`${x.email}-${i}`} className={`su-res${x.ok ? '' : ' is-no'}`}>
              <span className="su-res-mail">{x.email}</span>
              <span className="su-res-st">{x.ok && <Icon as={CheckCircle} size={14} weight="fill" />}{x.label}</span>
            </li>
          ))}
        </ul>
      )}
      {limit && (
        <p className="su-note" role="status"><Icon as={Info} size={16} weight="regular" />
          <span>{limit} {isPhone ? 'Share' : 'Copy'} the invite link for everyone else.</span></p>
      )}
      {editorsFull && (
        <p className="su-note" role="status"><Icon as={Info} size={16} weight="regular" />
          <span>{editorsFull}</span></p>
      )}

      <p className="su-reward"><Icon as={Gift} size={16} weight="regular" /><span>{reward}</span></p>
    </>
  );
}
