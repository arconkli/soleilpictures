// The language Stripe Checkout and the billing portal open in. The account's
// language lives in the auth user's metadata (user_metadata.locale, written by
// boards/src/lib/accountLocale.js). Plain ESM so the Deno functions and the
// node tests import the same file.
export const STRIPE_LOCALES = ['en', 'es', 'fr', 'ja', 'ko', 'pt-BR', 'ru'];

// The account's language when it is one Stripe and the app share; otherwise
// nothing, so Stripe follows the browser as it always has.
export function stripeLocale(user) {
  const l = user?.user_metadata?.locale;
  return STRIPE_LOCALES.includes(l) ? l : undefined;
}
