// TeamPlanCard — the third card on /pricing in the team preview (the owner's
// Buy mockup, 2026-10-21): the seat picker, the Team benefits in Creator's
// look (lib/teamPricingCopy.js; the owner, 2026-10-26: show the benefits),
// "Start a Team trial". Also the comparison's three-column table. Lazy and
// preview-only (PricingPageView renders them only when PricingPage passes
// `teamCard`); nothing here charges anything. Prices come from
// lib/teamModel.js until S3 moves them into billingCopy.js.
import './teamPlanCard.css';
import { Stack, ArrowsOutSimple, UsersThree, ShieldCheck, UserCircle, Link as LinkGlyph } from '@phosphor-icons/react';
import { Icon } from '../Icon.jsx';
import { BenefitGrid } from '../PricingBits.jsx';
import { Plus, Minus } from '../../lib/icons.js';
import { money, TEAM_SEAT_MIN, TEAM_SEAT_MAX, TEAM_SEAT_PRICE } from '../../lib/teamModel.js';
import { teamBenefits, teamComparison } from '../../lib/teamPricingCopy.js';
import { PLAN_NAME } from '../../lib/billingCopy.js';

// Creator's glyphs where the benefit is Creator's (cards, drive), the rest in kind.
const TEAM_BENEFIT_ICON = {
  'team-cards': Stack,
  'team-storage': ArrowsOutSimple,
  'team-seats': UsersThree,
  'team-admins': ShieldCheck,
  'team-perk': UserCircle,
  'team-joining': LinkGlyph,
};

export default function TeamPlanCard({ plan = 'monthly', seats, setSeats, onStart, editorLimit }) {
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

      <BenefitGrid benefits={teamBenefits(editorLimit)} icons={TEAM_BENEFIT_ICON} marked={false}
                   className="pricing-benefits pp-plan-benefits pp-team-benefits" />

      <button type="button" className="pricing-cta pricing-cta-secondary pp-plan-cta" onClick={onStart}>Start a Team trial</button>
      <p className="pp-team-note">14 days free · card needed</p>
    </article>
  );
}

// The comparison with a Team column: the two-plan table's rows plus who can
// edit, who can view, admins and company-email joining (PricingPageView's
// table furniture, so the two tables read as one).
export function TeamCompareTable({ editorLimit }) {
  return (
    <div className="seo-compare-wrap">
      <table className="seo-compare pp-compare-team">
        <thead>
          <tr>
            <th scope="col">&nbsp;</th>
            <th scope="col">Free</th>
            <th scope="col">{PLAN_NAME}</th>
            <th scope="col" className="seo-us-col">Team</th>
          </tr>
        </thead>
        <tbody>
          {teamComparison(editorLimit).map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              <td className="seo-them">{r.demo}</td>
              <td className="seo-them">{r.creator}</td>
              <td className="seo-us">{r.team}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
