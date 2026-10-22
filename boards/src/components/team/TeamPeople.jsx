// TeamPeople — the People tab: join requests, search + filter, the table.
import { useState } from 'react';
import { Icon } from '../Icon.jsx';
import { Search, ChevronDown, MoreHorizontal } from '../../lib/icons.js';
import {
  teamCan, peopleCounts, filterPeople, roleChoices, whereLabel, lastHereLabel, approveLine,
  seatsFree, seatsUsed, adminNames, ROLE_LABEL,
} from '../../lib/teamModel.js';
import { TeamMenu } from './TeamMenu.jsx';

const FROZEN = 'The team is view-only until it’s paid';

function firstName(name) {
  return String(name || '').split(' ')[0];
}

export default function TeamPeople({ t, now, viewOnly, dispatch, onToast }) {
  const role = t.me.role;
  const manager = teamCan(role, 'managePeople');
  const [query, setQuery] = useState('');
  const [show, setShow] = useState('all');
  const [menu, setMenu] = useState(null); // `role:<id>` | `dots:<id>`
  const counts = peopleCounts(t.people);
  const { rows, viewersFolded } = filterPeople(t.people, { query, show });
  const lock = viewOnly ? { disabled: true, title: FROZEN } : {};

  const approve = (r) => {
    const buys = seatsFree(t) === 0;
    dispatch({ type: 'approve', requestId: r.id });
    if (buys) onToast('Preview: that added a seat. Nothing was charged.');
  };

  const segs = [['all', 'All', counts.all], ['edit', 'Can edit', counts.edit], ['view', 'Can view', counts.view]];
  if (manager) segs.push(['invited', 'Invited', counts.invited]);

  return (
    <>
      {manager && (t.requests || []).map((r) => (
        <div className="tp-req" key={r.id}>
          <span className="tp-av" style={{ background: r.color }}>{r.name.charAt(0)}</span>
          <span className="tp-req-t">
            <b>{r.name} asked to edit {r.workspace}</b>
            <span>{firstName(r.name)} can view it now. {approveLine(t, now)}</span>
          </span>
          <span className="tp-req-acts">
            <button type="button" className="tp-link" onClick={() => dispatch({ type: 'keepViewer', requestId: r.id })}>Keep as viewer</button>
            <button type="button" className="tp-btn tp-btn-sm" onClick={() => approve(r)} {...lock}>Approve</button>
          </span>
        </div>
      ))}

      <div className="tp-tools">
        <label className="tp-search">
          <Icon as={Search} size={13} weight="regular" />
          <input
            type="search"
            placeholder="Search people"
            aria-label="Search people"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="tp-seg" role="group" aria-label="Show">
          {segs.map(([id, label, n]) => (
            <button key={id} type="button" aria-pressed={show === id} onClick={() => setShow(id)}>
              {label} <em>{n}</em>
            </button>
          ))}
        </div>
        {manager && (
          <span className="tp-seats">
            {seatsUsed(t.people)} of {t.plan.seats} seats
            <span className="tp-meter"><span style={{ width: `${Math.min(100, (seatsUsed(t.people) / t.plan.seats) * 100)}%` }} /></span>
          </span>
        )}
      </div>

      <div className="tp-tbl" role="table" aria-label="People">
        <div className="tp-tr is-head" role="row">
          <span>Name</span><span>Role</span><span>Where they edit</span><span>{manager ? 'Last here' : ''}</span><span />
        </div>
        {rows.map((p) => {
          const choices = roleChoices(t, p);
          const isMe = p.id === t.me.id;
          const here = lastHereLabel(p, now);
          return (
            <div className="tp-tr" role="row" key={p.id}>
              <span className="tp-who">
                <span className={`tp-av${p.invited ? ' is-neutral' : ''}`} style={p.invited ? undefined : { background: p.color }}>
                  {(p.invited ? (p.email || p.name) : p.name).charAt(0).toUpperCase()}
                </span>
                <span className="tp-who-t">
                  <span className="tp-nm">{p.name}{isMe ? ' (you)' : ''}</span>
                  {p.email && !p.invited ? <span className="tp-em">{p.email}</span> : null}
                </span>
              </span>
              <span className="tp-cell is-role">
                {p.invited ? (
                  <span className="tp-rolewrap"><span className="tp-role is-pending">Invited</span></span>
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
                        onPick={(r) => dispatch({ type: 'role', personId: p.id, role: r })}
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
                    <button type="button" className="tp-link" onClick={() => { dispatch({ type: 'resend', personId: p.id, now: Date.now() }); onToast('Preview: nobody was emailed.'); }} {...lock}>Resend</button>
                    <button type="button" className="tp-link" onClick={() => dispatch({ type: 'revoke', personId: p.id })} {...lock}>Revoke</button>
                  </>
                )}
                {manager && !p.invited && p.role !== 'owner' && !isMe && (
                  <span className="tp-dotswrap">
                    <button
                      type="button"
                      className="tp-dots"
                      aria-label={`More for ${p.name}`}
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
                        items={[{ id: 'remove', label: p.outside ? 'Remove their access' : 'Remove from the team', danger: true }]}
                        onPick={() => dispatch({ type: 'remove', personId: p.id })}
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
          <div className="tp-empty" role="row">Nobody matches “{query.trim()}”.</div>
        )}
        {viewersFolded > 0 && (
          <div className="tp-tr is-group" role="row">
            <span className="tp-grp">Can view <span>· {viewersFolded} · free, never a seat</span></span>
            <button type="button" className="tp-link" onClick={() => setShow('view')}>Show</button>
          </div>
        )}
      </div>

      {role === 'member' && (
        <p className="tp-note">
          You’re a member: you see everyone’s name and where they edit. Email addresses, seats and billing are for the owner and admins, {adminNames(t)}.
        </p>
      )}
    </>
  );
}
