// Pre-filled share intents for the referral link.
//
// Desktop browsers don't get navigator.share, so the Invite & earn tab used to
// fall back to a single "Copy link" that copied a BARE url with no pitch — the
// good message was locked inside the mobile-only native share sheet. This module
// is the single source of truth for the pitch + the reliable per-channel
// deep-links, so every surface (InviteTab, cap modal, native sheet) says the
// same thing and the value prop rides every paste.
//
// Messenger / Facebook are intentionally omitted: the send dialog needs an FB
// app_id + redirect and the sharer strips custom text, so they'd be broken or
// pitch-less buttons. navigator.share covers mobile (where those apps live).

export const REFERRAL_PITCH =
  'I’m using Clusters to organize ideas on an infinite canvas — here are 25 free cards to start.';

// One message that carries pitch + link, for clipboard / SMS / WhatsApp where a
// single text field holds everything.
export function referralMessage(link, pitch = REFERRAL_PITCH) {
  return link ? `${pitch} ${link}` : pitch;
}

// Reliable, no-app-id share channels. Each href is a deep-link the browser/OS
// opens in a new tab/app, pre-filled with the pitch + link.
export function buildShareTargets(link, pitch = REFERRAL_PITCH) {
  if (!link) return [];
  const msg = encodeURIComponent(referralMessage(link, pitch));
  const eLink = encodeURIComponent(link);
  const ePitch = encodeURIComponent(pitch);
  const eSubject = encodeURIComponent('Here are 25 free cards on Clusters');
  return [
    { key: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${msg}` },
    { key: 'x',        label: 'X',        href: `https://twitter.com/intent/tweet?text=${ePitch}&url=${eLink}` },
    { key: 'email',    label: 'Email',    href: `mailto:?subject=${eSubject}&body=${msg}` },
    // sms:?&body= is the most cross-platform form (iOS wants the leading &).
    { key: 'sms',      label: 'Text',     href: `sms:?&body=${msg}` },
  ];
}
