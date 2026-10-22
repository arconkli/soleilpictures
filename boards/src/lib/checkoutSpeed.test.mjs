// What keeps a purchase quick, read from the source: the billing functions run
// beside the database, an offer warms the function its button calls, and the
// return from Stripe opens the app in place instead of loading it again.
// Run: node --test src/lib/checkoutSpeed.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(SRC, rel), 'utf8');
const checkout = read('lib/checkout.js');

test('the billing functions are called in the database region', () => {
  assert.match(checkout, /const BY_THE_DATABASE = '\?forceFunctionRegion=us-west-2';/);
  for (const name of ['CHECKOUT_URL', 'PORTAL_URL', 'VERIFY_URL']) {
    assert.match(checkout, new RegExp(`${name} += FUNCTIONS \\+ '[a-z-]+' \\+ BY_THE_DATABASE;`), name);
  }
  // Extra storage is bought from its own function, and pinned the same way.
  assert.match(read('lib/storageAddon.js'), /const ADDON_URL = .*'\/functions\/v1\/storage-addon\?forceFunctionRegion=us-west-2';/);
  // One verify URL: the warm and the success page's call must be the same URL,
  // or the remembered preflight is for an address nobody calls.
  const success = read('auth/PricingSuccess.jsx');
  assert.match(success, /import \{ VERIFY_URL \} from '\.\.\/lib\/checkout\.js';/);
  assert.ok(!/functions\/v1\//.test(success), 'PricingSuccess builds no function URL of its own');
});

test('a warm asks the way the click will, and never throws', () => {
  const warm = checkout.slice(checkout.indexOf('async function warm(url)'), checkout.indexOf('// For an offer of the plan'));
  assert.match(warm, /method: 'OPTIONS', headers: \{ authorization: `Bearer \$\{token\}`, 'content-type': 'application\/json' \}/);
  const post = checkout.slice(checkout.indexOf('const res = await fetch(CHECKOUT_URL'), checkout.indexOf('const body = await res.json()'));
  assert.match(post, /headers: \{ authorization: `Bearer \$\{token\}`, 'content-type': 'application\/json' \}/,
    'the POST sends the headers the warm asked the preflight about');
  assert.match(warm, /if \(now - \(warmedAt\.get\(url\) \|\| 0\) < WARM_EVERY_MS\) return;/);
  assert.match(warm, /try \{[\s\S]*\} catch \(_\) \{/);
  assert.match(checkout, /export function warmCheckout\(\) \{\s*warm\(CHECKOUT_URL\);\s*warm\(VERIFY_URL\);/);
  assert.match(checkout, /import\('\.\.\/auth\/PricingSuccess\.jsx'\)\.catch\(\(\) => \{\}\)/);
});

test('every offer warms the function its button calls', () => {
  assert.match(read('components/PricingModal.jsx'), /if \(alreadyPaid\) warmPortal\(\); else warmCheckout\(\);/);
  assert.match(read('auth/PricingPage.jsx'), /if \(!alreadyPaid\) warmCheckout\(\);\s*else if \(!noPortal\) warmPortal\(\);/);
  assert.match(read('components/settings/BillingTab.jsx'), /useEffect\(\(\) => \{ if \(tier === 'paid'\) warmPortal\(\); \}, \[tier\]\);/);
});

test('the success page enters the app in place, and the app does not time that as a boot', () => {
  const success = read('auth/PricingSuccess.jsx');
  assert.match(success, /export function PricingSuccess\(\{ onEnter = null \}\)/);
  assert.match(success, /const enter = \(\) => \{ if \(onEnter\) onEnter\(\); else window\.location\.assign\('\/'\); \};/);
  // The beat and the question to the holding tab run side by side: the beat is
  // its dwell, not its dwell plus the ask's 800 ms.
  const effect = success.slice(success.indexOf('if (!celebrating) return undefined;'), success.indexOf('}, [celebrating]);'));
  assert.match(effect, /const asked = askForHolder\(\);[\s\S]*const t = setTimeout\(\(\) => \{\s*asked\.then\(\(n\) => \{ if \(!cancelled && n === 0\) enter\(\); \}\);\s*\}, dwell\);/);
  // Short, unless the beat has a sentence to read.
  assert.match(effect, /const dwell = isTrial \|\| waitingFolder > 0 \? CELEBRATE_READ_MS : CELEBRATE_MS;/);
  const ms = (name) => Number(success.match(new RegExp(`const ${name} = (\\d+);`))?.[1]);
  assert.ok(ms('CELEBRATE_MS') <= 1200, 'a plain purchase enters the app within about a second');
  assert.ok(ms('CELEBRATE_READ_MS') > ms('CELEBRATE_MS'), 'a beat with a sentence to read stays long enough to read it');

  const router = read('auth/TierRouter.jsx');
  assert.match(router, /<PricingSuccess onEnter=\{enterApp\} \/>/);
  const enter = router.slice(router.indexOf('const enterApp = useCallback('), router.indexOf('}, []);', router.indexOf('const enterApp = useCallback(')));
  assert.match(enter, /bootMark\('enter', \{ from: 'checkout' \}\);/);
  assert.match(enter, /window\.history\.replaceState\(\{\}, '', '\/'\);/);
  assert.match(enter, /catch \(_\) \{ window\.location\.assign\('\/'\); return; \}/);
  assert.match(enter, /setEntered\(\(n\) => n \+ 1\);/);

  const app = read('App.jsx');
  assert.match(app, /appOpenTimed = true;\s*if \(bootAt\('enter'\) == null\) \{/);
  assert.match(app, /bootMark\('paint', \{ source, cards: cards\.length \}\);[\s\S]{0,240}if \(bootAt\('enter'\) != null\) return;\s*const ms = bootAt\('paint'\);/,
    'the paint is marked for what waits on it, and board_ready stays a boot measure');
});
