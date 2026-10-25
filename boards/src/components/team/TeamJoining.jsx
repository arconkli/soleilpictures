// TeamJoining — the Joining tab (owner and admins): invite by email, the team
// link, and the company domain. On the sample team it is look only: nothing is
// emailed or verified. On a real team each control is a real call.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { ChevronDown, LinkSimple, Copy, Globe, Check } from '../../lib/icons.js';
import { seatsFree, joinUrl } from '../../lib/teamModel.js';
import { parseEmails } from '../../lib/inviteSubmit.js';
import { refusalLine, domainCheckLine } from '../../lib/teamCopy.js';
import { TeamMenu } from './TeamMenu.jsx';

const FROZEN = 'The team is view-only until it’s paid';
const ROLE_ITEMS = [
  { id: 'editor', label: 'Can edit · uses a seat' },
  { id: 'viewer', label: 'Can view · free' },
];
const LINK_ITEMS = [
  { id: 'editor', label: 'Can edit' },
  { id: 'viewer', label: 'Can view' },
];

// A fixed-looking TXT value per domain, so the hint doesn't change on re-render.
function txtValue(domain) {
  let h = 2166136261;
  for (let i = 0; i < domain.length; i += 1) h = Math.imul(h ^ domain.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export default function TeamJoining({ t, viewOnly, onAction, onToast, focusKey, live, go, report, ask, priceThen }) {
  const taRef = useRef(null);
  const [text, setText] = useState('');
  const [role, setRole] = useState('editor');
  const [menu, setMenu] = useState(null); // 'invite' | 'link'
  const [addingDomain, setAddingDomain] = useState(false);
  const [domainText, setDomainText] = useState('');
  const { link, domains } = t.joining || { link: null, domains: [] };
  const domainsOn = domains.length > 0 && domains.every((d) => d.on);
  const lock = viewOnly ? { disabled: true, title: FROZEN } : {};

  useEffect(() => {
    if (focusKey) taRef.current?.focus();
  }, [focusKey]);

  const parsed = parseEmails(text);
  const free = seatsFree(t);
  const needs = role === 'editor' ? parsed.valid.length : 0;
  let seatLine = `${free} seat${free === 1 ? '' : 's'} free`;
  if (needs > free) {
    seatLine = free === 0
      ? `No seats free: sending adds ${needs}`
      : `${free} seat${free === 1 ? '' : 's'} free: sending adds ${needs - free}`;
  }

  const sendLive = async (fresh, left, addSeats) => {
    const res = await onAction('invite', { emails: fresh, role, ...(addSeats ? { addSeats: true } : {}) });
    if (res.ok) {
      setText('');
      onToast(`${fresh.length} invite${fresh.length === 1 ? '' : 's'} sent.${left}`);
    } else if (res.refusal?.code === 'team_seats_needed' && Number(res.refusal.needed) > 0 && t.plan && !addSeats) {
      priceThen(t.plan.seats + Number(res.refusal.needed), 'Add seats and send',
        () => sendLive(fresh, left, true), 'Sending needs more seats. ');
    } else {
      report('invite', res);
    }
    return res;
  };

  const send = () => {
    const have = new Set(t.people.map((p) => (p.email || '').toLowerCase()));
    const fresh = parsed.valid.filter((e) => !have.has(e.toLowerCase()));
    const left = parsed.invalid.length ? ` Left out: ${parsed.invalid.join(', ')}` : '';
    if (!fresh.length) {
      onToast(live ? `No new addresses to invite.${left}` : `Preview: nobody was emailed. No new addresses to invite.${left}`);
      return;
    }
    if (live) { sendLive(fresh, left, false); return; }
    onAction('invite', { emails: fresh, role, now: Date.now() });
    setText('');
    onToast(`Preview: nobody was emailed. ${fresh.length} invite${fresh.length === 1 ? '' : 's'} added to People.${left}`);
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText('https://' + joinUrl(link.token)); } catch (_) {}
    onToast(live ? 'Link copied.' : 'Link copied. Preview: it opens nothing yet.');
  };

  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); onToast('Copied.'); } catch (_) { onToast('Couldn’t copy. Select it and copy by hand.'); }
  };

  const addDomain = () => {
    if (!domainText.trim()) return;
    if (live) {
      go('addDomain', { domain: domainText }).then((res) => {
        if (res.ok) { setDomainText(''); setAddingDomain(false); }
      });
      return;
    }
    onAction('addDomain', { domain: domainText });
    setDomainText('');
    setAddingDomain(false);
  };

  const removeDomain = (d) => ask({
    message: `Remove ${d.domain}? People who sign up with it stop joining the team.`,
    confirmLabel: 'Remove',
    danger: true,
    run: () => go('removeDomain', { domain: d.domain }),
  });

  const checkDomain = async (d) => {
    const res = await onAction('checkDomain', { domain: d.domain });
    onToast(res.ok ? domainCheckLine(res.data, d.domain) : refusalLine(res.refusal));
  };

  const switchDomains = () => {
    const on = !domainsOn;
    if (live) go('domainOn', { on, domains: domains.map((d) => d.domain) });
    else onAction('domainOn', { on });
  };

  const setLink = (on) => (live ? go('link', { on }) : onAction('link', { on }));
  const setLinkRole = (r) => (live ? go('linkRole', { role: r }) : onAction('linkRole', { role: r }));
  const newLink = () => {
    if (!live) {
      onAction('newLink', { token: 'nl-' + Math.random().toString(36).slice(2, 8) });
      onToast('Preview: the old link would stop working.');
      return;
    }
    ask({
      message: 'Make a new link? The old link stops working.',
      confirmLabel: 'Make a new link',
      run: () => go('newLink'),
    });
  };

  const label = (items, id) => items.find((i) => i.id === id)?.label;

  if (!link) return <p className="tp-card-t">Joining isn’t set up for this team yet.</p>;

  return (
    <div className="tp-join">
      <div className="tp-card">
        <span className="tp-card-k">Invite by email</span>
        <textarea
          ref={taRef}
          className="tp-ta"
          aria-label="Email addresses"
          placeholder="Paste addresses, one a line or with commas between"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="tp-row">
          <span className="tp-selwrap">
            <button type="button" className="tp-sel" aria-haspopup="menu" aria-expanded={menu === 'invite'} onClick={() => setMenu(menu === 'invite' ? null : 'invite')}>
              {label(ROLE_ITEMS, role)}<Icon as={ChevronDown} size={10} weight="regular" />
            </button>
            {menu === 'invite' && (
              <TeamMenu items={ROLE_ITEMS.map((i) => ({ ...i, checked: i.id === role }))} onPick={setRole} onClose={() => setMenu(null)} />
            )}
          </span>
          <span className="tp-sp" />
          <span className="tp-card-t">{seatLine}</span>
          <button type="button" className="tp-btn" onClick={send} {...lock}>Send invites</button>
        </div>
      </div>

      <div className="tp-card">
        <div className="tp-row">
          <span className="tp-card-k">Team link</span>
          <button type="button" className="tp-sw" role="switch" aria-checked={link.on} aria-label="Team link" onClick={() => setLink(!link.on)} />
        </div>
        <div className={`tp-row${link.on ? '' : ' is-off'}`}>
          <span className="tp-copybox"><Icon as={LinkSimple} size={13} weight="regular" />{joinUrl(link.token)}</span>
          <button type="button" className="tp-btn tp-btn-sm" disabled={!link.on} onClick={copy}>
            <Icon as={Copy} size={12} weight="regular" />Copy
          </button>
        </div>
        <div className={`tp-row${link.on ? '' : ' is-off'}`}>
          <span className="tp-card-t">People who open it join as</span>
          <span className="tp-selwrap">
            <button type="button" className="tp-sel" disabled={!link.on} aria-haspopup="menu" aria-expanded={menu === 'link'} onClick={() => setMenu(menu === 'link' ? null : 'link')}>
              {label(LINK_ITEMS, link.role)}<Icon as={ChevronDown} size={10} weight="regular" />
            </button>
            {menu === 'link' && (
              <TeamMenu items={LINK_ITEMS.map((i) => ({ ...i, checked: i.id === link.role }))} onPick={setLinkRole} onClose={() => setMenu(null)} />
            )}
          </span>
          <span className="tp-sp" />
          <button
            type="button"
            className="tp-link"
            disabled={!link.on}
            onClick={newLink}
          >
            Make a new link
          </button>
        </div>
      </div>

      <div className="tp-card">
        <div className="tp-row">
          <span className="tp-card-k">Company domain</span>
          <button type="button" className="tp-sw" role="switch" aria-checked={domainsOn} aria-label="Join by domain" onClick={switchDomains} />
        </div>
        {domains.map((d) => (
          <div key={d.domain}>
            <div className="tp-dom">
              <Icon as={Globe} size={14} weight="regular" />
              <b>{d.domain}</b>
              <span className="tp-badge">
                {d.verified ? <Icon as={Check} size={10} weight="regular" /> : null}
                {d.verified ? 'Verified' : 'Not verified'}
              </span>
              {live && <button type="button" className="tp-link" onClick={() => removeDomain(d)} {...lock}>Remove</button>}
            </div>
            {!d.verified && !live && (
              <p className="tp-card-t" style={{ marginTop: 8 }}>Add a TXT record soleil-verify={txtValue(d.domain)} to its DNS, then check back.</p>
            )}
            {!d.verified && live && (
              <div className="tp-stack" style={{ marginTop: 8 }}>
                <p className="tp-card-t">Add this TXT record to its DNS, then check.</p>
                {d.txtName && (
                  <div className="tp-copyline">
                    <span className="tp-card-t">Name</span><code>{d.txtName}</code>
                    <button type="button" className="tp-btn tp-btn-sm" onClick={() => copyText(d.txtName)}><Icon as={Copy} size={12} weight="regular" />Copy</button>
                  </div>
                )}
                {d.txtValue && (
                  <div className="tp-copyline">
                    <span className="tp-card-t">Value</span><code>{d.txtValue}</code>
                    <button type="button" className="tp-btn tp-btn-sm" onClick={() => copyText(d.txtValue)}><Icon as={Copy} size={12} weight="regular" />Copy</button>
                  </div>
                )}
                <div className="tp-card-acts">
                  <button type="button" className="tp-btn tp-btn-sm" onClick={() => checkDomain(d)}>Check now</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {domains[0] && (
          <p className="tp-card-t">
            Anyone who signs up with an @{domains[0].domain} address joins the team. People who already have an account are asked once, the next time they sign in. Admins never see who has an account.
          </p>
        )}
        <div className="tp-row">
          {addingDomain ? (
            <>
              <input
                className="tp-dom-in"
                aria-label="Company domain"
                placeholder="example.com"
                value={domainText}
                autoFocus
                onChange={(e) => setDomainText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addDomain();
                  if (e.key === 'Escape') { e.stopPropagation(); setAddingDomain(false); setDomainText(''); }
                }}
              />
              <button type="button" className="tp-btn tp-btn-sm" onClick={addDomain}>Add</button>
            </>
          ) : (
            <button type="button" className="tp-link" onClick={() => setAddingDomain(true)}>Add another domain</button>
          )}
        </div>
      </div>
    </div>
  );
}
