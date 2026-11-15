// creatorIntentWords — the words around the price the sign-in form shows for a
// stashed "Get Creator" click, read through Lingui.
//
// A MIRROR of billingCopy's creatorIntentLabels (the public /pricing page, on
// its English-only path, writes those English labels into storage; they stay
// English there). The sign-in form shows them in the person's language by
// reading the frame ("/mo", "/mo billed annually") through Lingui and keeping
// the price itself as it was stored. It takes the stored label rather than
// rebuilding it from billingCopy because AuthGate is the entry chunk and must
// not import billingCopy (creatorIntent.js says why). App only: no outside
// reader needs it; creatorIntentWords.test.mjs holds the English to
// billingCopy's.
import { t as tr, ph } from '@lingui/core/macro';

const ANNUAL = /^(\S+)\/mo billed annually$/;
const MONTHLY = /^(\S+)\/mo$/;

// { planName, priceLabel } for an intent read back (creatorIntent.readCreatorIntent):
// the stored plan name as it is (a product name), the price label with its
// frame in the person's language. Anything it does not recognise comes back
// as stored.
export function intentLabels(intent) {
  const stored = intent?.priceLabel || null;
  const annual = stored ? ANNUAL.exec(stored) : null;
  const monthly = !annual && stored ? MONTHLY.exec(stored) : null;
  let priceLabel = stored;
  if (annual) { const price = annual[1]; priceLabel = tr`${ph({ price })}/mo billed annually`; }
  else if (monthly) { const price = monthly[1]; priceLabel = tr`${ph({ price })}/mo`; }
  return { planName: intent?.planName || null, priceLabel };
}
