// What a failed file-share call says, read through Lingui. App-only: the
// constants and logic stay in fileShares.js, which gen-docs reads and which
// takes no macros.
import { t } from '@lingui/core/macro';

export function friendlyShareError(error) {
  const hint = error?.hint || '';
  const code = error?.code || '';
  switch (hint) {
    case 'invite_limit_reached': return t`You've reached today's invite limit. Try again tomorrow.`;
    case 'sending_on_hold': return t`Sharing is paused on your account.`;
    case 'comment_rate_limited': return t`Slow down a little: try again in a few minutes.`;
    case 'new_account_risky': return t`New accounts can't open program files to anyone with the link yet.`;
    case 'not_shareable': return t`This file can't be shared.`;
    default: break;
  }
  if (code === '42501') return t`You can't do that on this file.`;
  return t`Something went wrong. Try again.`;
}
