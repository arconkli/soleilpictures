// TeamJoining — the Joining tab (owner and admins): invite by email, the team
// link, and the company domain. On the sample team it is look only: nothing is
// emailed or verified. On a real team each control is a real call.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { ChevronDown, LinkSimple, Copy, Globe, Check } from '../../lib/icons.js';
import { seatsFree, joinUrl } from '../../lib/teamModel.js';
import { parseEmails } from '../../lib/inviteSubmit.js';
import { refusalLine, domainCheckLine, removedLine } from '../../lib/teamCopy.js';
import { domainKey } from '../../lib/teamPendingRemovals.js';
import { TeamMenu } from './TeamMenu.jsx';
import { isComposingKey } from '../../lib/composerKeys.js';
import { t as tr, ph, plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

const frozen = () => tr`The team is view-only until it’s paid`;
// A toast, then the "Left out" note after a space when some addresses were dropped:
// one message, so a language can order the two parts as it needs.
const withLeft = (msg, emails) => (emails ? tr`${msg} Left out: ${ph({ emails })}` : msg);
const ROLE_ITEMS = [
  { id: 'editor', get label() { return tr`Can edit · uses a seat`; } },
  { id: 'viewer', get label() { return tr`Can view · free`; } },
];
const LINK_ITEMS = [
  { id: 'editor', get label() { return tr`Can edit`; } },
  { id: 'viewer', get label() { return tr`Can view`; } },
];

// A fixed-looking TXT value per domain, so the hint doesn't change on re-render.
function txtValue(domain) {
  let h = 2166136261;
  for (let i = 0; i < domain.length; i += 1) h = Math.imul(h ^ domain.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export default function TeamJoining({ t, viewOnly, onAction, onToast, focusKey, live, go, report, ask, priceThen, removeLater, track, isBusy }) {
  const taRef = useRef(null);
  const [text, setText] = useState('');
  const [role, setRole] = useState('editor');
  const [menu, setMenu] = useState(null); // 'invite' | 'link'
  const [addingDomain, setAddingDomain] = useState(false);
  const [domainText, setDomainText] = useState('');
  const { link, domains } = t.joining || { link: null, domains: [] };
  const domainsOn = domains.length > 0 && domains.every((d) => d.on);
  const lock = viewOnly ? { disabled: true, title: frozen() } : {};

  useEffect(() => {
    if (focusKey) taRef.current?.focus();
  }, [focusKey]);

  const parsed = parseEmails(text);
  const free = seatsFree(t);
  const needs = role === 'editor' ? parsed.valid.length : 0;
  const adds = needs - free;
  let seatLine = tr`${plural(free, { one: '# seat free', other: '# seats free' })}`;
  if (needs > free) {
    seatLine = free === 0
      ? tr`No seats free: sending adds ${needs}`
      : tr`${plural(free, { one: `# seat free: sending adds ${adds}`, other: `# seats free: sending adds ${adds}` })}`;
  }

  const sendLive = async (fresh, left, addSeats) => {
    const res = await onAction('invite', { emails: fresh, role, ...(addSeats ? { addSeats: true } : {}) });
    if (res.ok) {
      setText('');
      onToast(withLeft(tr`${plural(fresh.length, { one: '# invite sent.', other: '# invites sent.' })}`, left));
    } else if (res.refusal?.code === 'team_seats_needed' && Number(res.refusal.needed) > 0 && t.plan && !addSeats) {
      priceThen(t.plan.seats + Number(res.refusal.needed), tr`Add seats and send`,
        () => sendLive(fresh, left, true), 'send');
    } else {
      report('invite', res);
    }
    return res;
  };

  const send = () => {
    const have = new Set(t.people.map((p) => (p.email || '').toLowerCase()));
    const fresh = parsed.valid.filter((e) => !have.has(e.toLowerCase()));
    const left = parsed.invalid.length ? parsed.invalid.join(', ') : '';
    if (!fresh.length) {
      onToast(withLeft(live ? tr`No new addresses to invite.` : tr`Preview: nobody was emailed. No new addresses to invite.`, left));
      return;
    }
    if (live) { sendLive(fresh, left, false); return; }
    onAction('invite', { emails: fresh, role, now: Date.now() });
    setText('');
    onToast(withLeft(tr`${plural(fresh.length, { one: 'Preview: nobody was emailed. # invite added to People.', other: 'Preview: nobody was emailed. # invites added to People.' })}`, left));
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(`${live ? window.location.protocol : 'https:'}//${joinUrl(link.token, live ? window.location.host : undefined)}`); } catch (_) {}
    onToast(live ? tr`Link copied.` : tr`Link copied. Preview: it opens nothing yet.`);
  };

  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); onToast(tr`Copied.`); } catch (_) { onToast(tr`Couldn’t copy. Select it and copy by hand.`); }
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

  // Gone at once, with an Undo toast; the call is made a few seconds on.
  const removeDomain = (d) => removeLater({
    key: domainKey(d.domain),
    type: 'removeDomain',
    payload: { domain: d.domain },
    line: removedLine('domain', d.domain),
  });

  const checkKey = (d) => `check:${d.domain}`;
  const checkDomain = (d) => track(checkKey(d), async () => {
    const res = await onAction('checkDomain', { domain: d.domain });
    onToast(res.ok ? domainCheckLine(res.data, d.domain) : refusalLine(res.refusal));
  });

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
      onToast(tr`Preview: the old link would stop working.`);
      return;
    }
    ask({
      message: tr`Make a new link? The old link stops working.`,
      confirmLabel: tr`Make a new link`,
      run: () => go('newLink'),
    });
  };

  const label = (items, id) => items.find((i) => i.id === id)?.label;

  if (!link) return <p className="tp-card-t"><Trans>Joining isn’t set up for this team yet.</Trans></p>;

  return (
    <div className="tp-join">
      <div className="tp-card">
        <span className="tp-card-k"><Trans>Invite by email</Trans></span>
        <textarea
          ref={taRef}
          className="tp-ta"
          aria-label={tr`Email addresses`}
          placeholder={tr`Paste addresses, one a line or with commas between`}
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
          <button type="button" className="tp-btn" onClick={send} {...lock}><Trans>Send invites</Trans></button>
        </div>
      </div>

      <div className="tp-card">
        <div className="tp-row">
          <span className="tp-card-k"><Trans>Team link</Trans></span>
          <button type="button" className="tp-sw" role="switch" aria-checked={link.on} aria-label={tr`Team link`} onClick={() => setLink(!link.on)} />
        </div>
        <div className={`tp-row${link.on ? '' : ' is-off'}`}>
          <span className="tp-copybox"><Icon as={LinkSimple} size={13} weight="regular" />{joinUrl(link.token, live ? window.location.host : undefined)}</span>
          <button type="button" className="tp-btn tp-btn-sm" disabled={!link.on} onClick={copy}>
            <Icon as={Copy} size={12} weight="regular" /><Trans>Copy</Trans>
          </button>
        </div>
        <div className={`tp-row${link.on ? '' : ' is-off'}`}>
          <span className="tp-card-t"><Trans>People who open it join as</Trans></span>
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
            <Trans>Make a new link</Trans>
          </button>
        </div>
      </div>

      <div className="tp-card">
        <div className="tp-row">
          <span className="tp-card-k"><Trans>Company domain</Trans></span>
          <button type="button" className="tp-sw" role="switch" aria-checked={domainsOn} aria-label={tr`Join by domain`} onClick={switchDomains} />
        </div>
        {domains.map((d) => (
          <div key={d.domain}>
            <div className="tp-dom">
              <Icon as={Globe} size={14} weight="regular" />
              <b>{d.domain}</b>
              <span className="tp-badge">
                {d.verified ? <Icon as={Check} size={10} weight="regular" /> : null}
                {d.verified ? tr`Verified` : tr`Not verified`}
              </span>
              <button type="button" className="tp-link" onClick={() => removeDomain(d)} {...lock}><Trans>Remove</Trans></button>
            </div>
            {!d.verified && !live && (
              <p className="tp-card-t" style={{ marginTop: 8 }}><Trans>Add a TXT record soleil-verify={ph({ txtValue: txtValue(d.domain) })} to its DNS, then check back.</Trans></p>
            )}
            {!d.verified && live && (
              <div className="tp-stack" style={{ marginTop: 8 }}>
                <p className="tp-card-t"><Trans>Add this TXT record to its DNS, then check.</Trans></p>
                {d.txtName && (
                  <div className="tp-copyline">
                    <span className="tp-card-t"><Trans>Name</Trans></span><code>{d.txtName}</code>
                    <button type="button" className="tp-btn tp-btn-sm" onClick={() => copyText(d.txtName)}><Icon as={Copy} size={12} weight="regular" /><Trans>Copy</Trans></button>
                  </div>
                )}
                {d.txtValue && (
                  <div className="tp-copyline">
                    <span className="tp-card-t"><Trans>Value</Trans></span><code>{d.txtValue}</code>
                    <button type="button" className="tp-btn tp-btn-sm" onClick={() => copyText(d.txtValue)}><Icon as={Copy} size={12} weight="regular" /><Trans>Copy</Trans></button>
                  </div>
                )}
                <div className="tp-card-acts">
                  <button type="button" className="tp-btn tp-btn-sm" disabled={isBusy(checkKey(d))} onClick={() => checkDomain(d)}><Trans>Check now</Trans></button>
                </div>
              </div>
            )}
          </div>
        ))}
        {domains[0] && (
          <p className="tp-card-t">
            <Trans>Anyone who signs up with an @{ph({ domain: domains[0].domain })} address joins the team. People who already have an account are asked once, the next time they sign in. Admins never see who has an account.</Trans>
          </p>
        )}
        <div className="tp-row">
          {addingDomain ? (
            <>
              <input
                className="tp-dom-in"
                aria-label={tr`Company domain`}
                placeholder={tr`example.com`}
                value={domainText}
                autoFocus
                onChange={(e) => setDomainText(e.target.value)}
                onKeyDown={(e) => {
                  if (isComposingKey(e)) return;
                  if (e.key === 'Enter') addDomain();
                  if (e.key === 'Escape') { e.stopPropagation(); setAddingDomain(false); setDomainText(''); }
                }}
              />
              <button type="button" className="tp-btn tp-btn-sm" onClick={addDomain}><Trans>Add</Trans></button>
            </>
          ) : (
            <button type="button" className="tp-link" onClick={() => setAddingDomain(true)}><Trans>Add another domain</Trans></button>
          )}
        </div>
      </div>
    </div>
  );
}
