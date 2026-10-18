// The invitation reward, said where the inviting happens: under the Share
// panel's invite box. People only ever met the reward in Settings → Invite &
// earn, so the place that actually sends invitations never mentioned it.
//
// Every figure comes from lib/inviteReward.js, which the build holds to the SQL
// that pays it. `tier` picks the wording (only a free plan has a card limit for
// bonus cards to raise); `stats` is getMyReferralStats() or null, and without
// it the note simply has no progress line.
import { inviteRewardCopy, inviteProgressLine } from '../lib/inviteReward.js';
import { Gift as GiftIcon } from '../lib/icons.js';
import { Icon as Glyph } from './Icon.jsx';

export function InviteRewardNote({ tier = null, stats = null, onOpenInvites = null }) {
  const copy = inviteRewardCopy({ tier });
  const progress = inviteProgressLine(stats);
  return (
    <div className="share-reward">
      <span className="share-reward-icon" aria-hidden="true">
        <Glyph as={GiftIcon} size={16} weight="regular" />
      </span>
      <div className="share-reward-text">
        <div className="share-reward-lead">{copy.lead}</div>
        <div className="share-reward-detail">{copy.detail}</div>
        {progress && <div className="share-reward-progress">{progress}</div>}
        <details className="share-reward-how">
          <summary>How it works</summary>
          <ul>
            {copy.how.map((line) => <li key={line}>{line}</li>)}
          </ul>
          {onOpenInvites && (
            <button type="button" className="share-linkish" onClick={onOpenInvites}>
              Your invites and referral link →
            </button>
          )}
        </details>
      </div>
    </div>
  );
}
