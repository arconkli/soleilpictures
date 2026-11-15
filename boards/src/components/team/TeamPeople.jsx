// TeamPeople — the People tab: join requests, search + filter, the table.
import { useState } from 'react';
import { Icon } from '../Icon.jsx';
import { Search, ChevronDown, MoreHorizontal } from '../../lib/icons.js';
import {
  teamCan, peopleCounts, filterPeople, roleChoices, seatsFree, seatsUsed,
} from '../../lib/teamModel.js';
import { whereLabel, lastHereLabel, approveLine, adminNames, ROLE_LABEL } from '../../lib/teamModelWords.js';
import { searchKey } from '../../lib/textFold.js';
import { TeamMenu } from './TeamMenu.jsx';
import { initialOf } from '../../lib/graphemes.js';
import { t as tr, ph, plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

const frozen = () => tr`The team is view-only until it’s paid`;

// A real team's line under a join request: the price comes when it is confirmed.
function liveApproveLine(team) {
  const free = seatsFree(team);
  if (free > 0) return tr`${plural(free, { one: 'Approving uses one of the # free seat.', other: 'Approving uses one of the # free seats.' })}`;
  return tr`Approving adds a seat. You’ll see the price first.`;
}

function firstName(name) {
  return String(name || '').split(' ')[0];
}

export default function TeamPeople({ t, now, viewOnly, onAction, onToast, live, go, ask, priceThen }) {
  const role = t.me.role;
  const manager = teamCan(role, 'managePeople');
  const [query, setQuery] = useState('');
  const [show, setShow] = useState('all');
  const [menu, setMenu] = useState(null); // `role:<id>` | `dots:<id>`
  const counts = peopleCounts(t.people);
  const { rows, viewersFolded } = filterPeople(t.people, { query, show, fold: searchKey });
  const lock = viewOnly ? { disabled: true, title: frozen() } : {};

  const approve = (r) => {
    const buys = seatsFree(t) === 0;
    if (!live) {
      onAction('approve', { requestId: r.id });
      if (buys) onToast(tr`Preview: that added a seat. Nothing was charged.`);
      return;
    }
    if (!buys) { go('approve', { requestId: r.id }); return; }
    // No seat is free: the price first, and nothing happens unless confirmed.
    priceThen(t.plan.seats + 1, tr`Add a seat and approve`,
      () => go('approve', { requestId: r.id, addSeat: true }),
      'approve');
  };

  const changeRole = (p, next) => {
    if (!live) { onAction('role', { personId: p.id, role: next }); return; }
    const needsSeat = p.role === 'viewer' && next !== 'viewer';
    if (needsSeat && seatsFree(t) === 0 && t.plan) {
      priceThen(t.plan.seats + 1, tr`Add a seat and change the role`,
        () => go('role', { personId: p.id, role: next, addSeats: true }),
        'role');
      return;
    }
    go('role', { personId: p.id, role: next });
  };

  const removePerson = (p) => {
    if (!live) { onAction('remove', { personId: p.id }); return; }
    ask({
      message: p.outside
        ? tr`Remove their access?`
        : tr`Remove ${ph({ name: p.name })} from the team? They lose access to the team’s workspaces.`,
      confirmLabel: tr`Remove`,
      danger: true,
      run: () => go('remove', { personId: p.id }),
    });
  };

  const segs = [['all', tr`All`, counts.all], ['edit', tr`Can edit`, counts.edit], ['view', tr`Can view`, counts.view]];
  if (manager) segs.push(['invited', tr({ message: 'Invited', context: 'filter' }), counts.invited]);

  return (
    <>
      {manager && (t.requests || []).map((r) => (
        <div className="tp-req" key={r.id}>
          <span className="tp-av" style={{ background: r.color }}>{initialOf(r.name, '', { upper: false })}</span>
          <span className="tp-req-t">
            <b><Trans>{ph({ name: r.name })} asked to edit {ph({ workspace: r.workspace })}</Trans></b>
            <span><Trans>{ph({ firstName: firstName(r.name) })} can view it now. {ph({ value: live ? liveApproveLine(t) : approveLine(t, now) })}</Trans></span>
          </span>
          <span className="tp-req-acts">
            <button type="button" className="tp-link" onClick={() => (live ? go('keepViewer', { requestId: r.id }) : onAction('keepViewer', { requestId: r.id }))}><Trans>Keep as viewer</Trans></button>
            <button type="button" className="tp-btn tp-btn-sm" onClick={() => approve(r)} {...lock}><Trans>Approve</Trans></button>
          </span>
        </div>
      ))}

      <div className="tp-tools">
        <label className="tp-search">
          <Icon as={Search} size={13} weight="regular" />
          <input
            type="search"
            placeholder={tr`Search people`}
            aria-label={tr`Search people`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="tp-seg" role="group" aria-label={tr`Show`}>
          {segs.map(([id, label, n]) => (
            <button key={id} type="button" aria-pressed={show === id} onClick={() => setShow(id)}>
              {label} <em>{n}</em>
            </button>
          ))}
        </div>
        {manager && (
          <span className="tp-seats">
            {t.plan ? tr`${ph({ seatsUsed: seatsUsed(t.people) })} of ${ph({ seats: t.plan.seats })} seats` : tr`${ph({ seatsUsed: seatsUsed(t.people) })} seats`}
            {t.plan && <span className="tp-meter"><span style={{ width: `${Math.min(100, (seatsUsed(t.people) / t.plan.seats) * 100)}%` }} /></span>}
          </span>
        )}
      </div>

      <div className="tp-tbl" role="table" aria-label={tr`People`}>
        <div className="tp-tr is-head" role="row">
          <span><Trans context="person">Name</Trans></span><span><Trans>Role</Trans></span><span><Trans>Where they edit</Trans></span><span>{manager ? tr`Last here` : ''}</span><span />
        </div>
        {rows.map((p) => {
          const choices = roleChoices(t, p);
          const isMe = p.id === t.me.id;
          const here = lastHereLabel(p, now);
          return (
            <div className="tp-tr" role="row" key={p.id}>
              <span className="tp-who">
                <span className={`tp-av${p.invited ? ' is-neutral' : ''}`} style={p.invited ? undefined : { background: p.color }}>
                  {initialOf(p.invited ? (p.email || p.name) : p.name, '')}
                </span>
                <span className="tp-who-t">
                  <span className="tp-nm">{p.name}{isMe ? tr` (you)` : ''}</span>
                  {p.email && !p.invited ? <span className="tp-em">{p.email}</span> : null}
                </span>
              </span>
              <span className="tp-cell is-role">
                {p.invited ? (
                  <span className="tp-rolewrap"><span className="tp-role is-pending"><Trans>Invited</Trans></span></span>
                ) : choices ? (
                  <span className="tp-rolewrap">
                    <button
                      type="button"
                      className="tp-role"
                      aria-haspopup="menu"
                      aria-expanded={menu === `role:${p.id}`}
                      onClick={() => setMenu(menu === `role:${p.id}` ? null : `role:${p.id}`)}
                      {...lock}
                    >
                      {ROLE_LABEL[p.role]}<Icon as={ChevronDown} size={10} weight="regular" />
                    </button>
                    {menu === `role:${p.id}` && (
                      <TeamMenu
                        items={choices.map((c) => ({ id: c, label: ROLE_LABEL[c], checked: p.role === c }))}
                        onPick={(r) => changeRole(p, r)}
                        onClose={() => setMenu(null)}
                      />
                    )}
                  </span>
                ) : (
                  <span className="tp-rolewrap"><span className="tp-role is-fixed">{ROLE_LABEL[p.role]}</span></span>
                )}
              </span>
              <span className="tp-cell">{whereLabel(p)}</span>
              <span className={`tp-cell${here === 'Here now' ? ' is-now' : ''}`}>{manager ? here : ''}</span>
              <span className="tp-rowacts">
                {manager && p.invited && (
                  <>
                    {(!live || String(p.id).startsWith('invite:')) && (
                      <button type="button" className="tp-link" {...lock} onClick={() => {
                        if (live) { go('resend', { personId: p.id }); return; }
                        onAction('resend', { personId: p.id, now: Date.now() });
                        onToast(tr`Preview: nobody was emailed.`);
                      }}><Trans>Resend</Trans></button>
                    )}
                    {(!live || String(p.id).startsWith('invite:')) && (
                      <button type="button" className="tp-link" onClick={() => (live ? go('revoke', { personId: p.id }) : onAction('revoke', { personId: p.id }))} {...lock}><Trans>Revoke</Trans></button>
                    )}
                  </>
                )}
                {manager && !p.invited && p.role !== 'owner' && !isMe && (
                  <span className="tp-dotswrap">
                    <button
                      type="button"
                      className="tp-dots"
                      aria-label={tr`More for ${ph({ name: p.name })}`}
                      aria-haspopup="menu"
                      aria-expanded={menu === `dots:${p.id}`}
                      onClick={() => setMenu(menu === `dots:${p.id}` ? null : `dots:${p.id}`)}
                      {...lock}
                    >
                      <Icon as={MoreHorizontal} size={15} weight="regular" />
                    </button>
                    {menu === `dots:${p.id}` && (
                      <TeamMenu
                        align="right"
                        items={[{ id: 'remove', label: p.outside ? tr`Remove their access` : tr`Remove from the team`, danger: true }]}
                        onPick={() => removePerson(p)}
                        onClose={() => setMenu(null)}
                      />
                    )}
                  </span>
                )}
              </span>
            </div>
          );
        })}
        {rows.length === 0 && query.trim() && (
          <div className="tp-empty" role="row"><Trans>Nobody matches “{ph({ trim: query.trim() })}”.</Trans></div>
        )}
        {viewersFolded > 0 && (
          <div className="tp-tr is-group" role="row">
            <span className="tp-grp"><Trans>Can view <span>· {viewersFolded} · free, never a seat</span></Trans></span>
            <button type="button" className="tp-link" onClick={() => setShow('view')}><Trans>Show</Trans></button>
          </div>
        )}
      </div>

      {role === 'member' && (
        <p className="tp-note">
          <Trans>You’re a member: you see everyone’s name and where they edit. Email addresses, seats and billing are for the owner and admins, {ph({ adminNames: adminNames(t) })}.</Trans>
        </p>
      )}
    </>
  );
}
