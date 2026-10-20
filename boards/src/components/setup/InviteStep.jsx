// InviteStep — the invite panel of the first-run setup and of its one re-ask.
//
// The workspace's invite link leads: Copy on a computer, the phone's own share
// sheet on a phone (closing the sheet counts as shared). Then "or invite by
// email", one row and a secondary Send. Email goes out through
// lib/inviteSubmit.js, the same way the share panel sends it. The parent owns
// the way on: it hears onOut('link') when the link goes out and onOut('email')
// when an email was sent, and onInvited(addresses) for the workspace card's
// faces.

import { useEffect, useMemo, useRef, useState } from 'react';
import { LinkSimple, Copy, Check, Export, Plus, X, CaretDown, Gift, Info, CheckCircle } from '@phosphor-icons/react';
import { Icon } from '../Icon.jsx';
import { logEvent, logEventNow } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { inviteWorkspaceMember } from '../../lib/boardsApi.js';
import { createWorkspaceInviteLink, getWorkspaceInviteLinkTerms } from '../../lib/inviteApi.js';
import { workspaceInviteUrl } from '../../lib/workspaceLink.js';
import { parseEmails, runInvites } from '../../lib/inviteSubmit.js';
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

export function InviteStep({ workspaceId, workspaceName, surface, isPhone, onOut, onInvited }) {
  const [token, setToken] = useState(null);
  const [terms, setTerms] = useState(null);
  const [linkError, setLinkError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [rows, setRows] = useState(() => [newRow()]);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState([]);
  const [limit, setLimit] = useState(null);
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

  const termsLine = linkTermsLine({
    workspaceName, role: terms?.role || 'editor', expiresAt: terms?.expires_at,
    maxUses: terms?.max_uses, uses: terms?.uses, now: Date.now(),
  });

  const copyLink = async () => {
    if (!url) return;
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch (_) { ok = false; }
    try { logEventNow(EV.WORKSPACE_LINK_SHARED, { surface, method: 'copy', ok }); } catch (_) {}
    if (!ok) return;
    setCopied(true);
    onOut?.('link');
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2400);
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
    const byRole = { editor: [], viewer: [] };
    for (const r of valid) for (const e of parseEmails(r.email).valid) byRole[r.role === 'viewer' ? 'viewer' : 'editor'].push(e);
    const next = [];
    const sentEmails = [];
    let stopped = null;
    for (const role of ['editor', 'viewer']) {
      const emails = byRole[role];
      if (emails.length === 0 || stopped) continue;
      const r = await runInvites(emails, (email) => inviteWorkspaceMember({ workspaceId, email, role }));
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
      if (r.limit) stopped = r.limit;
    }
    setResults((prev) => [...prev, ...next]);
    if (stopped) setLimit(sentence(stopped.reason));
    // Sent rows clear; whatever the limit stopped stays, ready for tomorrow.
    const keep = stopped ? new Set(stopped.unsent.map((e) => e.toLowerCase())) : new Set();
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

  return (
    <>
      {isPhone ? (
        <button type="button" className="su-btn su-primary su-share-btn" onClick={shareLink} disabled={!url}>
          <Icon as={Export} size={18} weight="regular" />Share invite link
        </button>
      ) : (
        <div className="su-link" role="group" aria-label="Invite link">
          <Icon as={LinkSimple} size={18} weight="regular" className="su-link-ico" />
          <span className={`su-link-url${url ? '' : ' is-waiting'}`}>{url ? url.replace(/^https?:\/\//, '') : (linkError ? 'No link right now' : 'Making your link…')}</span>
          <button type="button" className={`su-btn ${copied ? 'su-secondary is-done' : 'su-primary'}`} onClick={copyLink} disabled={!url}>
            <Icon as={copied ? Check : Copy} size={16} weight="regular" />{copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      )}
      <p className="su-linknote" aria-live="polite">{linkError || termsLine}</p>

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

      <p className="su-reward"><Icon as={Gift} size={16} weight="regular" /><span>{reward}</span></p>
    </>
  );
}
