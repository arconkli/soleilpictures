// TeamBilling — the Seats & billing tab (owner and admins): plan, storage,
// payment, seats, and what happens when seats run out.
import { useState } from 'react';
import { Icon } from '../Icon.jsx';
import { Plus, Minus, CreditCard } from '../../lib/icons.js';
import {
  teamCan, seatsUsed, seatsFree, money, seatPrice, seatAddLine, sizeLabel, dateLabel, TEAM_SEAT_MIN,
} from '../../lib/teamModel.js';

const FROZEN = 'The team is view-only until it’s paid';

export default function TeamBilling({ t, now, viewOnly, dispatch, onToast, onCloseTeam }) {
  const role = t.me.role;
  const { plan, storage, whenFull } = t;
  const used = seatsUsed(t.people);
  const free = seatsFree(t);
  const interval = plan.interval;
  const price = seatPrice(plan);
  const lock = viewOnly ? { disabled: true, title: FROZEN } : {};
  const [seatInfo, setSeatInfo] = useState(false);
  const [adding, setAdding] = useState(false);
  const [n, setN] = useState(1);
  const canWhenFull = teamCan(role, 'setWhenFull');
  const ownerFirst = String(t.admins[0]?.name || 'the owner').split(' ')[0];
  const removeFloor = Math.max(TEAM_SEAT_MIN, used);

  return (
    <>
      <div className="tp-cols">
        <div className="tp-stack">
          <div className="tp-card">
            <span className="tp-card-k">Plan</span>
            <span className="tp-card-big">Team, {interval === 'year' ? 'yearly' : 'monthly'}</span>
            <p className="tp-card-t">
              {money(price)} a seat a {interval}. {plan.seats} seats, {money(price * plan.seats)} a {interval}, renewing {dateLabel(plan.renewsAt)}.
            </p>
            <div className="tp-card-acts">
              {teamCan(role, 'changePlan') && (
                <button type="button" className="tp-btn tp-btn-sm" onClick={() => onToast('Preview: a switch starts at renewal. Nothing changed.')}>
                  {interval === 'year' ? 'Switch to monthly' : 'Switch to yearly'}
                </button>
              )}
              <button type="button" className="tp-link" aria-expanded={seatInfo} onClick={() => setSeatInfo(!seatInfo)}>What a seat is</button>
            </div>
            {seatInfo && (
              <p className="tp-card-t">
                A seat is anyone who can edit, guests too. Viewers are free and never use one. A seat nobody uses stays free to give until renewal, then drops, never below 3.
              </p>
            )}
          </div>

          <div className="tp-card">
            <span className="tp-card-k">Storage</span>
            <span className="tp-card-big">{sizeLabel(storage.usedBytes)}<small>of {sizeLabel(storage.quotaBytes)}</small></span>
            <div className="tp-meter"><span style={{ width: `${Math.min(100, (storage.usedBytes / storage.quotaBytes) * 100)}%` }} /></div>
            <p className="tp-card-t">250 GB a seat, at least 1 TB, shared by the whole team.</p>
            {teamCan(role, 'addStorage') && (
              <div className="tp-card-acts">
                <button type="button" className="tp-btn tp-btn-sm" onClick={() => onToast('Preview: nothing was charged.')}>
                  <Icon as={Plus} size={12} weight="regular" />Add 1 TB · $25 a month
                </button>
              </div>
            )}
          </div>

          <div className="tp-card">
            <span className="tp-card-k">Payment</span>
            <div className="tp-pay">
              <span className="tp-pay-ic"><Icon as={CreditCard} size={16} weight="regular" /></span>
              <span className="tp-pay-t">
                <b>{plan.card.brand} ending {plan.card.last4}</b>
                <span>Expires {plan.card.exp} · receipts to {plan.receiptsTo}</span>
              </span>
            </div>
            {teamCan(role, 'changeCard') ? (
              <div className="tp-card-acts">
                <button type="button" className="tp-btn tp-btn-sm" onClick={() => onToast('Preview: this comes with billing.')}>Change card</button>
                <button type="button" className="tp-link" onClick={() => onToast('Preview: this comes with billing.')}>Invoices and receipts</button>
              </div>
            ) : (
              <p className="tp-card-t">Only {ownerFirst} changes the card.</p>
            )}
          </div>
        </div>

        <div className="tp-stack">
          <div className="tp-card">
            <span className="tp-card-k">Seats</span>
            <span className="tp-card-big">{used}<small>of {plan.seats} used</small></span>
            <div className="tp-meter"><span style={{ width: `${Math.min(100, (used / plan.seats) * 100)}%` }} /></div>
            <p className="tp-card-t">
              {free === 0 ? 'None are free to give.' : `${free} ${free === 1 ? 'is' : 'are'} free to give.`} A seat is anyone who can edit, guests too; viewers are free. Seats nobody uses drop at renewal, never below 3.
            </p>
            <div className="tp-card-acts">
              <button type="button" className="tp-btn tp-btn-sm" onClick={() => setAdding(!adding)} aria-expanded={adding} {...lock}>
                <Icon as={Plus} size={12} weight="regular" />Add seats
              </button>
              <button
                type="button"
                className="tp-link"
                disabled={viewOnly || plan.seats <= removeFloor}
                title={viewOnly ? FROZEN : undefined}
                onClick={() => dispatch({ type: 'removeSeat' })}
              >
                Remove a seat
              </button>
            </div>
            {adding && !viewOnly && (
              <div className="tp-addrow">
                <span className="tp-step">
                  <button type="button" aria-label="Fewer seats" disabled={n <= 1} onClick={() => setN(Math.max(1, n - 1))}><Icon as={Minus} size={12} weight="regular" /></button>
                  <output aria-label="Seats to add">{n}</output>
                  <button type="button" aria-label="More seats" disabled={n >= 50} onClick={() => setN(Math.min(50, n + 1))}><Icon as={Plus} size={12} weight="regular" /></button>
                </span>
                <span className="tp-card-t">{seatAddLine(plan, n, now)}</span>
                <button
                  type="button"
                  className="tp-btn tp-btn-sm"
                  onClick={() => { dispatch({ type: 'addSeats', n }); onToast('Preview: nothing was charged.'); setAdding(false); setN(1); }}
                >
                  Add
                </button>
                <button type="button" className="tp-link" onClick={() => { setAdding(false); setN(1); }}>Cancel</button>
              </div>
            )}
            <div className="tp-card-rule" />
            <span className="tp-card-k">When seats run out</span>
            <div className="tp-opts">
              <label className={`tp-opt${whenFull.mode === 'ask' ? ' is-on' : ''}${canWhenFull ? '' : ' is-off'}`}>
                <input type="radio" name="tp-when-full" checked={whenFull.mode === 'ask'} disabled={!canWhenFull} onChange={() => dispatch({ type: 'whenFull', mode: 'ask' })} />
                <span className="tp-opt-t">
                  <b>Ask first</b>
                  <span>They join as a viewer. An admin approves, and that adds a seat.</span>
                </span>
              </label>
              <label className={`tp-opt${whenFull.mode === 'auto' ? ' is-on' : ''}${canWhenFull ? '' : ' is-off'}`}>
                <input type="radio" name="tp-when-full" checked={whenFull.mode === 'auto'} disabled={!canWhenFull} onChange={() => dispatch({ type: 'whenFull', mode: 'auto' })} />
                <span className="tp-opt-t">
                  <b>Add a seat for them</b>
                  <span>No waiting. Admins hear about each one.</span>
                  <span className={`tp-cap${whenFull.mode === 'ask' ? ' is-dim' : ''}`}>
                    <span className="tp-cap-k">Monthly limit</span>
                    <input
                      className="tp-num"
                      type="text"
                      inputMode="numeric"
                      placeholder="None"
                      aria-label="Most new seats a month"
                      value={whenFull.monthlyLimit == null ? '' : String(whenFull.monthlyLimit)}
                      disabled={!canWhenFull}
                      onChange={(e) => dispatch({ type: 'monthlyLimit', value: e.target.value })}
                    />
                    <span>new seats, then ask first. Any number you like; leave it empty for no limit.</span>
                  </span>
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {teamCan(role, 'closeTeam') && (
        <div className="tp-endrow">
          <button type="button" className="tp-link is-danger" onClick={onCloseTeam}>Close the team</button>
          <span>Only you can. Its workspaces move to your own account, and everyone in them keeps what they had.</span>
        </div>
      )}
    </>
  );
}
