// The invitation reward, said where the inviting happens: under the Share
// panel's invite box. People only ever met the reward in Settings → Invite &
// earn, so the place that actually sends invitations never mentioned it.
//
// One line at rest — the 25 free cards — and the rest behind "Details": the
// storage, when each side gets theirs, the limits, and progress once anyone
// has joined. At rest it is a strip, not a box, so it never pushes the list
// of who has access off the first screen.
//
// Every figure comes from lib/inviteReward.js, which the build holds to the SQL
// that pays it. `tier` picks the wording (only a free plan has a card limit for
// the inviter's bonus cards to raise); `stats` is getMyReferralStats() or null.
import { useState } from 'react';
import { inviteRewardCopy, inviteProgressLine } from '../lib/inviteReward.js';
import { Gift as GiftIcon } from '../lib/icons.js';
import { Icon as Glyph } from './Icon.jsx';

export function InviteRewardNote({ tier = null, stats = null, onOpenInvites = null }) {
  const copy = inviteRewardCopy({ tier });
  const progress = inviteProgressLine(stats);
  const [open, setOpen] = useState(false);
  return (
    <div className="share-reward">
      <span className="share-reward-icon" aria-hidden="true">
        <Glyph as={GiftIcon} size={15} weight="regular" />
      </span>
      <div className="share-reward-text">
        <span className="share-reward-lead">{copy.lead}</span>{' '}
        <button type="button" className="share-linkish share-reward-toggle"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide details' : 'Details'}
        </button>
        {open && (
          <div className="share-reward-more">
            <p className="share-reward-detail">{copy.detail}</p>
            {progress && <p className="share-reward-progress">{progress}</p>}
            <ul>
              {copy.how.map((line) => <li key={line}>{line}</li>)}
            </ul>
            {onOpenInvites && (
              <button type="button" className="share-linkish" onClick={onOpenInvites}>
                Your invites and referral link →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
