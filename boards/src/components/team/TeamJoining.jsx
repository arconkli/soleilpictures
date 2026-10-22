// TeamJoining — the Joining tab (owner and admins): invite by email, the team
// link, and the company domain. Look only: nothing is emailed or verified.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { ChevronDown, LinkSimple, Copy, Globe, Check } from '../../lib/icons.js';
import { seatsFree, joinUrl } from '../../lib/teamModel.js';
import { parseEmails } from '../../lib/inviteSubmit.js';
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

export default function TeamJoining({ t, viewOnly, dispatch, onToast, focusKey }) {
  const taRef = useRef(null);
  const [text, setText] = useState('');
  const [role, setRole] = useState('editor');
  const [menu, setMenu] = useState(null); // 'invite' | 'link'
  const [addingDomain, setAddingDomain] = useState(false);
  const [domainText, setDomainText] = useState('');
  const { link, domains } = t.joining;
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

  const send = () => {
    const have = new Set(t.people.map((p) => (p.email || '').toLowerCase()));
    const fresh = parsed.valid.filter((e) => !have.has(e.toLowerCase()));
    const left = parsed.invalid.length ? ` Left out: ${parsed.invalid.join(', ')}` : '';
    if (!fresh.length) {
      onToast(`Preview: nobody was emailed. No new addresses to invite.${left}`);
      return;
    }
    dispatch({ type: 'invite', emails: fresh, role, now: Date.now() });
    setText('');
    onToast(`Preview: nobody was emailed. ${fresh.length} invite${fresh.length === 1 ? '' : 's'} added to People.${left}`);
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText('https://' + joinUrl(link.token)); } catch (_) {}
    onToast('Link copied. Preview: it opens nothing yet.');
  };

  const addDomain = () => {
    if (!domainText.trim()) return;
    dispatch({ type: 'addDomain', domain: domainText });
    setDomainText('');
    setAddingDomain(false);
  };

  const label = (items, id) => items.find((i) => i.id === id)?.label;

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
          <button type="button" className="tp-sw" role="switch" aria-checked={link.on} aria-label="Team link" onClick={() => dispatch({ type: 'link', on: !link.on })} />
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
              <TeamMenu items={LINK_ITEMS.map((i) => ({ ...i, checked: i.id === link.role }))} onPick={(r) => dispatch({ type: 'linkRole', role: r })} onClose={() => setMenu(null)} />
            )}
          </span>
          <span className="tp-sp" />
          <button
            type="button"
            className="tp-link"
            disabled={!link.on}
            onClick={() => {
              dispatch({ type: 'newLink', token: 'nl-' + Math.random().toString(36).slice(2, 8) });
              onToast('Preview: the old link would stop working.');
            }}
          >
            Make a new link
          </button>
        </div>
      </div>

      <div className="tp-card">
        <div className="tp-row">
          <span className="tp-card-k">Company domain</span>
          <button type="button" className="tp-sw" role="switch" aria-checked={domainsOn} aria-label="Join by domain" onClick={() => dispatch({ type: 'domainOn', on: !domainsOn })} />
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
            </div>
            {!d.verified && (
              <p className="tp-card-t" style={{ marginTop: 8 }}>Add a TXT record soleil-verify={txtValue(d.domain)} to its DNS, then check back.</p>
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
