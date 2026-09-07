// captureIdentity — a persona to film with, instead of your own inbox.
//
// The app puts your identity on screen in more places than anyone remembers:
// the sidebar avatar falls back to the first letter of your email, a shared
// workspace says "Shared by <address>", the share panel lists collaborators by
// address, and — least obviously — your display name defaults to your email's
// local part and is broadcast as your CURSOR FLAG, so it appears in everyone
// else's recording too, not just yours.
//
// Blanking those out leaves holes that read as a broken build in a screenshot.
// A persona keeps the shot looking like a working product, and gives the
// synthetic collaborators a cast to belong to.
//
// ── The property that makes this safe to ship ──────────────────────────────
// With capture off, every function here returns its INPUT BY IDENTITY (===).
// Not an equal copy — the same reference. So the diff at each of the eight
// call sites is inert in normal operation: no re-render is triggered by a
// changed object identity, and nothing can be masked by accident.

import { isPersonaOn } from './captureState.js';
import { pickPresenceColor } from './presenceColor.js';

// Crew names, because a cluster full of film people should be filmed by film
// people. Kept deliberately ordinary — a cast of memorable names pulls the eye
// away from the product, which is the opposite of the point.
const PERSONAS = Object.freeze([
  { name: 'Ava Reyes',      email: 'ava@stillwater.studio' },
  { name: 'Marcus Bell',    email: 'marcus@stillwater.studio' },
  { name: 'Noor Haddad',    email: 'noor@stillwater.studio' },
  { name: 'Theo Lindqvist', email: 'theo@stillwater.studio' },
  { name: 'Priya Raman',    email: 'priya@stillwater.studio' },
  { name: 'Jonah Okafor',   email: 'jonah@stillwater.studio' },
  { name: 'Elena Vasquez',  email: 'elena@stillwater.studio' },
  { name: 'Sam Whitfield',  email: 'sam@stillwater.studio' },
]);

// The same hash pickPresenceColor uses, so a persona's colour is derived the
// way a real user's is rather than assigned from a second scheme.
function hash(str) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Stable persona for a seed. The same seed always gets the same person. */
export function personaFor(seed) {
  return PERSONAS[hash(seed) % PERSONAS.length];
}

// Through the app's own picker rather than a private copy of the palette. That
// palette deliberately excludes brand gold — gold means YOUR selection — so a
// persona drawing its colour from anywhere else could hand a fake collaborator
// the one colour reserved for you.
export function personaColor(seed) {
  return pickPresenceColor(`persona:${seed}`);
}

/** Mask a display name. Returns the input unchanged when capture is off. */
export function maskName(name, seed) {
  if (!isPersonaOn()) return name;
  if (!name) return name;
  return personaFor(seed ?? name).name;
}

/**
 * Mask an email address. Returns the input unchanged when capture is off.
 *
 * The seed defaults to the address itself, so the SAME address always maps to
 * the same persona — two rows in the share panel that are really one person
 * stay one person on camera.
 */
export function maskEmail(email, seed) {
  if (!isPersonaOn()) return email;
  if (!email) return email;
  return personaFor(seed ?? email).email;
}

/**
 * Mask a userProfiles cache entry — { name, email, color, … }.
 *
 * This is the single choke point the app already resolves every display name
 * through, so masking here covers comments, messages, the inbox and the share
 * panel in one place rather than eight.
 */
export function maskProfile(userId, entry) {
  if (!isPersonaOn() || !entry) return entry;
  const p = personaFor(userId ?? entry.email ?? entry.name);
  return { ...entry, name: p.name, email: p.email, color: personaColor(userId ?? p.email) };
}

export { PERSONAS };
