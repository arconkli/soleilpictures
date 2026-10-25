// TeamPlanCard — the third card on /pricing in the team preview (the owner's
// Buy mockup, 2026-10-21): the seat picker, three benefits, "Start a Team
// trial". Lazy and preview-only (PricingPageView renders it only when
// PricingPage passes `teamCard`); nothing here charges anything. Prices come
// from lib/teamModel.js until S3 moves them into billingCopy.js.
import './teamPlanCard.css';
import { Icon } from '../Icon.jsx';
import { Plus, Minus } from '../../lib/icons.js';
import {
  money, sizeLabel, TEAM_SEAT_MIN, TEAM_SEAT_PRICE, TEAM_STORAGE_PER_SEAT,
} from '../../lib/teamModel.js';

export const TEAM_SEAT_MAX = 100;

export default function TeamPlanCard({ plan = 'monthly', seats, setSeats, onStart }) {
  const yearly = plan === 'annual';
  const each = yearly ? TEAM_SEAT_PRICE.year / 12 : TEAM_SEAT_PRICE.month;
  const sum = yearly ? `${money(TEAM_SEAT_PRICE.year * seats)}/yr` : `${money(TEAM_SEAT_PRICE.month * seats)}/mo`;
  const set = (n) => setSeats(Math.max(TEAM_SEAT_MIN, Math.min(TEAM_SEAT_MAX, n)));

  return (
    <article className="pp-plan pp-plan-team">
      <div className="pp-plan-head">
        <div className="pp-plan-name">Team</div>
        <span className="pp-team-tag">More than 10 editors</span>
      </div>
      <div className="pp-plan-price">
        {money(each)}
        <span className="pp-plan-unit">{yearly ? 'a seat /mo, billed yearly' : 'a seat /mo'}</span>
      </div>
      <p className="pp-plan-sub t-meta">{TEAM_SEAT_MIN} seats or more. Viewers never use a seat.</p>

      <div className="pp-seatpick">
        <span className="pp-seatpick-k">Seats</span>
        <span className="pp-step">
          <button type="button" aria-label="One fewer seat" disabled={seats <= TEAM_SEAT_MIN} onClick={() => set(seats - 1)}>
            <Icon as={Minus} size={12} weight="regular" />
          </button>
          <b data-seats>{seats}</b>
          <button type="button" aria-label="One more seat" disabled={seats >= TEAM_SEAT_MAX} onClick={() => set(seats + 1)}>
            <Icon as={Plus} size={12} weight="regular" />
          </button>
        </span>
        <span className="pp-seatpick-sum" data-seat-sum>{sum}</span>
      </div>

      <ul className="pp-team-bens">
        <li><b>A seat for each person who edits</b><span>Guests from outside the team use one too. Add or drop seats any time.</span></li>
        <li><b>Storage that grows with you</b><span>{sizeLabel(TEAM_STORAGE_PER_SEAT)} a seat, shared by the whole team.</span></li>
        <li><b>One team, one bill</b><span>A team page for people, seats and joining by link or company email.</span></li>
      </ul>

      <button type="button" className="pricing-cta pricing-cta-secondary pp-plan-cta" onClick={onStart}>Start a Team trial</button>
      <p className="pp-team-note">14 days free · card needed</p>
    </article>
  );
}
