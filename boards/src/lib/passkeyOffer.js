// passkeyOffer.js — "Skip the code next time?" (2026-10-29). Lazy: App.jsx
// imports it only when passkeyOfferDue() says a code sign-in just happened on
// an account older than a day, on a device never asked before.
//
// One note in the house toast look, with Save a passkey / Not now and the ×.
// It is marked as offered the moment it shows, so a device is asked once
// whichever way it goes; Settings › Profile › Passkeys is there for later.
import { supabase } from './supabase.js';
import { passkeySupport, savePasskey, passkeyRows } from './passkeys.js';
import { PASSKEY_OFFER_KEY } from './passkeyGate.js';
import { passkeyErrorWords, passkeyFailReason } from './passkeyWords.js';
import { logEvent } from './analytics.js';
import { EV } from './analyticsEvents.js';

let asked = false;

export async function offerPasskey({ feedback }) {
  if (asked || !feedback?.toast) return;
  asked = true;
  // Only a device that can hold one itself (Touch ID, Face ID, Windows Hello).
  const support = await passkeySupport();
  if (!support.platform) return;
  // Nothing to offer someone who already has one.
  const { data: list, error } = await supabase.auth.passkey.list();
  if (error || !list || passkeyRows(list).length > 0) return;
  try { localStorage.setItem(PASSKEY_OFFER_KEY, String(Date.now())); } catch (_) {}
  try { logEvent(EV.PASSKEY_OFFER_SEEN); } catch (_) {}
  const dismissed = () => { try { logEvent(EV.PASSKEY_OFFER_DISMISSED); } catch (_) {} };
  feedback.toast({
    type: 'info',
    message: 'Skip the code next time? Save a passkey and sign in on this device with your face or fingerprint.',
    ttl: 20000,
    actions: [
      { label: 'Save a passkey', onClick: () => { save(feedback); } },
      { label: 'Not now', onClick: dismissed },
    ],
    onDismiss: dismissed,
  });
}

async function save(feedback) {
  const { error } = await savePasskey();
  if (!error) {
    try { logEvent(EV.PASSKEY_SAVED, { via: 'offer' }); } catch (_) {}
    feedback.toast({ type: 'success', message: 'Passkey saved. Next time, tap the email box and pick it.' });
    return;
  }
  try { logEvent(EV.PASSKEY_SAVE_FAILED, { via: 'offer', reason: passkeyFailReason(error) }); } catch (_) {}
  const words = passkeyErrorWords(error, { saving: true });
  if (words) feedback.toast({ type: 'error', code: 'passkey_save_failed', message: `${words} You can add one any time in Settings › Profile.` });
}
