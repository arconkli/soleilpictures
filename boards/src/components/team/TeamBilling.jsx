// TeamBilling — the Seats & billing tab (owner and admins): plan, storage,
// payment, seats, and what happens when seats run out.
import { useState } from 'react';
import { Icon } from '../Icon.jsx';
import { isComposingKey } from '../../lib/composerKeys.js';
import { Plus, Minus, CreditCard } from '../../lib/icons.js';
import {
  teamCan, seatsUsed, seatsFree, seatPrice, TEAM_SEAT_MIN, TEAM_STORAGE_PER_SEAT, TEAM_STORAGE_BLOCK_MONTHLY,
} from '../../lib/teamModel.js';
import { seatAddLine, dateLabel, money, sizeLabel } from '../../lib/teamModelWords.js';
import { t as tr, ph, plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

const frozen = () => tr`The team is view-only until it’s paid`;

export default function TeamBilling({ t, now, viewOnly, onAction, onToast, onCloseTeam, live, go, priceThen, openPortal }) {
  const role = t.me.role;
  const { plan, storage, whenFull } = t;
  const [seatInfo, setSeatInfo] = useState(false);
  const [adding, setAdding] = useState(false);
  const [n, setN] = useState(1);
  const [limitDraft, setLimitDraft] = useState(null);
  // A real owner's mirror of the plan can be a moment behind the team itself.
  if (!plan || !storage || !whenFull) {
    return <p className="tp-card-t"><Trans>The plan’s details haven’t arrived yet. Check back in a moment.</Trans></p>;
  }
  const used = seatsUsed(t.people);
  const free = seatsFree(t);
  const interval = plan.interval;
  const price = seatPrice(plan);
  const lock = viewOnly ? { disabled: true, title: frozen() } : {};
  const canWhenFull = teamCan(role, 'setWhenFull');
  const ownerFirst = t.admins[0]?.name ? String(t.admins[0].name).split(' ')[0] : null;
  const removeFloor = Math.max(TEAM_SEAT_MIN, used);

  return (
    <>
      <div className="tp-cols">
        <div className="tp-stack">
          <div className="tp-card">
            <span className="tp-card-k"><Trans>Plan</Trans></span>
            <span className="tp-card-big">{interval === 'year' ? tr`Team, yearly` : tr`Team, monthly`}</span>
            <p className="tp-card-t">
              {live
                ? (interval === 'year'
                  ? (plan.renewsAt
                    ? tr`${ph({ seats: plan.seats })} seats, billed yearly, renewing ${ph({ date: dateLabel(plan.renewsAt) })}.`
                    : tr`${ph({ seats: plan.seats })} seats, billed yearly.`)
                  : (plan.renewsAt
                    ? tr`${ph({ seats: plan.seats })} seats, billed monthly, renewing ${ph({ date: dateLabel(plan.renewsAt) })}.`
                    : tr`${ph({ seats: plan.seats })} seats, billed monthly.`))
                : (interval === 'year'
                  ? tr`${ph({ money: money(price) })} a seat a year. ${ph({ seats: plan.seats })} seats, ${ph({ total: money(price * plan.seats) })} a year, renewing ${ph({ date: dateLabel(plan.renewsAt) })}.`
                  : tr`${ph({ money: money(price) })} a seat a month. ${ph({ seats: plan.seats })} seats, ${ph({ total: money(price * plan.seats) })} a month, renewing ${ph({ date: dateLabel(plan.renewsAt) })}.`)}
            </p>
            <div className="tp-card-acts">
              {teamCan(role, 'changePlan') && (
                <button type="button" className="tp-btn tp-btn-sm" onClick={live ? openPortal : () => onToast(tr`Preview: a switch starts at renewal. Nothing changed.`)}>
                  {interval === 'year' ? tr`Switch to monthly` : tr`Switch to yearly`}
                </button>
              )}
              <button type="button" className="tp-link" aria-expanded={seatInfo} onClick={() => setSeatInfo(!seatInfo)}><Trans>What a seat is</Trans></button>
            </div>
            {seatInfo && (
              <p className="tp-card-t">
                <Trans>A seat is anyone who can edit, guests too. Viewers are free and never use one. A seat nobody uses stays free to give until renewal, then drops, never below 3.</Trans>
              </p>
            )}
          </div>

          <div className="tp-card">
            <span className="tp-card-k"><Trans>Storage</Trans></span>
            <span className="tp-card-big">{sizeLabel(storage.usedBytes)}<small>{tr`of ${ph({ quota: sizeLabel(storage.quotaBytes) })}`}</small></span>
            <div className="tp-meter"><span style={{ width: `${Math.min(100, (storage.usedBytes / storage.quotaBytes) * 100)}%` }} /></div>
            <p className="tp-card-t">{tr`${ph({ perSeat: sizeLabel(TEAM_STORAGE_PER_SEAT) })} a seat, shared by the whole team.`}</p>
            {!live && teamCan(role, 'addStorage') && (
              <div className="tp-card-acts">
                <button type="button" className="tp-btn tp-btn-sm" onClick={() => onToast(tr`Preview: nothing was charged.`)}>
                  <Icon as={Plus} size={12} weight="regular" /><Trans>Add 1 TB · {ph({ price: money(TEAM_STORAGE_BLOCK_MONTHLY) })} a month</Trans>
                </button>
              </div>
            )}
          </div>

          <div className="tp-card">
            <span className="tp-card-k"><Trans>Payment</Trans></span>
            <div className="tp-pay">
              <span className="tp-pay-ic"><Icon as={CreditCard} size={16} weight="regular" /></span>
              <span className="tp-pay-t">
                {live ? (
                  <b><Trans>Card, invoices and receipts are in Stripe.</Trans></b>
                ) : (
                  <>
                    <b><Trans>{ph({ brand: plan.card.brand })} ending {ph({ last4: plan.card.last4 })}</Trans></b>
                    <span><Trans>Expires {ph({ exp: plan.card.exp })} · receipts to {ph({ receiptsTo: plan.receiptsTo })}</Trans></span>
                  </>
                )}
              </span>
            </div>
            {live ? (
              teamCan(role, 'changeCard') ? (
                <div className="tp-card-acts">
                  <button type="button" className="tp-btn tp-btn-sm" onClick={openPortal}><Trans>Manage</Trans></button>
                </div>
              ) : (
                <p className="tp-card-t">{ownerFirst ? <Trans>Only {ownerFirst} changes the card.</Trans> : <Trans>Only the owner changes the card.</Trans>}</p>
              )
            ) : teamCan(role, 'changeCard') ? (
              <div className="tp-card-acts">
                <button type="button" className="tp-btn tp-btn-sm" onClick={() => onToast(tr`Preview: this comes with billing.`)}><Trans>Change card</Trans></button>
                <button type="button" className="tp-link" onClick={() => onToast(tr`Preview: this comes with billing.`)}><Trans>Invoices and receipts</Trans></button>
              </div>
            ) : (
              <p className="tp-card-t">{ownerFirst ? <Trans>Only {ownerFirst} changes the card.</Trans> : <Trans>Only the owner changes the card.</Trans>}</p>
            )}
          </div>
        </div>

        <div className="tp-stack">
          <div className="tp-card">
            <span className="tp-card-k"><Trans>Seats</Trans></span>
            <span className="tp-card-big">{used}<small><Trans>of {ph({ seats: plan.seats })} used</Trans></small></span>
            <div className="tp-meter"><span style={{ width: `${Math.min(100, (used / plan.seats) * 100)}%` }} /></div>
            <p className="tp-card-t">
              {free === 0 ? tr`None are free to give.` : tr`${plural(free, { one: '# is free to give.', other: '# are free to give.' })}`}{' '}
              <Trans>A seat is anyone who can edit, guests too; viewers are free. Seats nobody uses drop at renewal, never below 3.</Trans>
            </p>
            <div className="tp-card-acts">
              <button type="button" className="tp-btn tp-btn-sm" onClick={() => setAdding(!adding)} aria-expanded={adding} {...lock}>
                <Icon as={Plus} size={12} weight="regular" /><Trans>Add seats</Trans>
              </button>
              <button
                type="button"
                className="tp-link"
                disabled={viewOnly || plan.seats <= removeFloor}
                title={viewOnly ? frozen() : undefined}
                onClick={() => (live ? go('removeSeat') : onAction('removeSeat'))}
              >
                <Trans>Remove a seat</Trans>
              </button>
            </div>
            {adding && !viewOnly && (
              <div className="tp-addrow">
                <span className="tp-step">
                  <button type="button" aria-label={tr`Fewer seats`} disabled={n <= 1} onClick={() => setN(Math.max(1, n - 1))}><Icon as={Minus} size={12} weight="regular" /></button>
                  <output aria-label={tr`Seats to add`}>{n}</output>
                  <button type="button" aria-label={tr`More seats`} disabled={n >= 50} onClick={() => setN(Math.min(50, n + 1))}><Icon as={Plus} size={12} weight="regular" /></button>
                </span>
                <span className="tp-card-t">{live ? tr`You’ll see the price before anything is charged.` : seatAddLine(plan, n, now)}</span>
                <button
                  type="button"
                  className="tp-btn tp-btn-sm"
                  onClick={() => {
                    if (!live) { onAction('addSeats', { n }); onToast(tr`Preview: nothing was charged.`); setAdding(false); setN(1); return; }
                    const total = plan.seats + n;
                    priceThen(total, tr`Add seats`, async (p, requestId) => {
                      const res = await go('addSeats', { seats: total, requestId, prorationDate: p.proration_date });
                      if (res.ok) { setAdding(false); setN(1); }
                      return res;
                    });
                  }}
                >
                  {live ? tr`See the price` : tr`Add`}
                </button>
                <button type="button" className="tp-link" onClick={() => { setAdding(false); setN(1); }}><Trans>Cancel</Trans></button>
              </div>
            )}
            <div className="tp-card-rule" />
            <span className="tp-card-k"><Trans>When seats run out</Trans></span>
            <div className="tp-opts">
              <label className={`tp-opt${whenFull.mode === 'ask' ? ' is-on' : ''}${canWhenFull ? '' : ' is-off'}`}>
                <input type="radio" name="tp-when-full" checked={whenFull.mode === 'ask'} disabled={!canWhenFull} onChange={() => (live ? go('whenFull', { mode: 'ask', current: whenFull }) : onAction('whenFull', { mode: 'ask' }))} />
                <span className="tp-opt-t">
                  <b><Trans>Ask first</Trans></b>
                  <span><Trans>They join as a viewer. An admin approves, and that adds a seat.</Trans></span>
                </span>
              </label>
              <label className={`tp-opt${whenFull.mode === 'auto' ? ' is-on' : ''}${canWhenFull ? '' : ' is-off'}`}>
                <input type="radio" name="tp-when-full" checked={whenFull.mode === 'auto'} disabled={!canWhenFull} onChange={() => (live ? go('whenFull', { mode: 'auto', current: whenFull }) : onAction('whenFull', { mode: 'auto' }))} />
                <span className="tp-opt-t">
                  <b><Trans>Add a seat for them</Trans></b>
                  <span><Trans>No waiting. Admins hear about each one.</Trans></span>
                  <span className={`tp-cap${whenFull.mode === 'ask' ? ' is-dim' : ''}`}>
                    <span className="tp-cap-k"><Trans>Monthly limit</Trans></span>
                    <input
                      className="tp-num"
                      type="text"
                      inputMode="numeric"
                      placeholder={tr`None`}
                      aria-label={tr`Most new seats a month`}
                      value={live && limitDraft != null ? limitDraft : (whenFull.monthlyLimit == null ? '' : String(whenFull.monthlyLimit))}
                      disabled={!canWhenFull}
                      onChange={(e) => (live ? setLimitDraft(e.target.value) : onAction('monthlyLimit', { value: e.target.value }))}
                      onBlur={live ? async () => {
                        if (limitDraft == null) return;
                        const res = await go('monthlyLimit', { value: limitDraft, current: whenFull });
                        if (res.ok) setLimitDraft(null);
                      } : undefined}
                      onKeyDown={live ? (e) => { if (isComposingKey(e)) return; if (e.key === 'Enter') e.currentTarget.blur(); } : undefined}
                    />
                    <span><Trans>new seats, then ask first. Any number you like; leave it empty for no limit.</Trans></span>
                  </span>
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {teamCan(role, 'closeTeam') && (
        <div className="tp-endrow">
          <button type="button" className="tp-link is-danger" onClick={onCloseTeam}><Trans>Close the team</Trans></button>
          <span><Trans>Only you can. Its workspaces move to your own account, and everyone in them keeps what they had.</Trans></span>
        </div>
      )}
    </>
  );
}
