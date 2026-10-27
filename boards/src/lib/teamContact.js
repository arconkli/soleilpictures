// teamContact — "Talk to us" on the pricing page's Team card (0542): what the
// form checks before it sends, the request itself and the words after it.
// request_team_contact checks the same things again, and anyone may send one,
// signed in or not. The words are the Talk to us mockup's (the Team canvas,
// 2026-10-27). The form hands sendTeamContact its Supabase client, so this
// stays importable under node.
import { TEAM_SEAT_MAX } from './teamModel.js';
import { SUPPORT_EMAIL } from './checkoutErrors.js';

export const TEAM_CONTACT_NEEDS = Object.freeze([
  { key: 'sso', label: 'Single sign-on (SSO)' },
  { key: 'invoices', label: 'Invoices or purchase orders' },
  { key: 'seats', label: `More than ${TEAM_SEAT_MAX} seats` },
  { key: 'other', label: 'Something else' },
]);

// 0542's limits, which its table and request_team_contact enforce.
export const TEAM_CONTACT_LIMITS = Object.freeze({ name: 120, company: 160, email: 254, message: 2000, editors: 1000000 });

const L = TEAM_CONTACT_LIMITS;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const NEED_KEYS = new Set(TEAM_CONTACT_NEEDS.map((n) => n.key));

// { ok: true, request } with the RPC's arguments, or { ok: false, field,
// message } for the first field that needs another look.
export function checkTeamContact(form = {}) {
  const name = String(form.name ?? '').trim();
  const email = String(form.email ?? '').trim().toLowerCase();
  const company = String(form.company ?? '').trim();
  const message = String(form.message ?? '').trim();
  const typed = String(form.editors ?? '').trim();
  const editors = typed === '' ? null : Number(typed);
  const refuse = (field, words) => ({ ok: false, field, message: words });

  if (!name) return refuse('name', 'Add your name.');
  if (name.length > L.name) return refuse('name', `A name of up to ${L.name} characters.`);
  if (email.length > L.email || !EMAIL_RE.test(email)) return refuse('email', 'Add an email we can write back to.');
  if (!company) return refuse('company', 'Add your company.');
  if (company.length > L.company) return refuse('company', `A company name of up to ${L.company} characters.`);
  if (editors !== null && !(Number.isInteger(editors) && editors >= 1 && editors <= L.editors)) {
    return refuse('editors', 'A number of people, or leave it empty.');
  }
  if (message.length > L.message) return refuse('message', `Up to ${L.message} characters.`);
  return {
    ok: true,
    request: {
      p_name: name,
      p_email: email,
      p_company: company,
      p_editors: editors,
      p_needs: [...new Set((Array.isArray(form.needs) ? form.needs : []).filter((k) => NEED_KEYS.has(k)))],
      p_message: message || null,
    },
  };
}

// { ok: true, status: 'sent' | 'already' } or { ok: false, error: 'invalid' |
// 'busy' | 'network' }. Never throws.
export async function sendTeamContact(client, request) {
  try {
    const { data, error } = await client.rpc('request_team_contact', request);
    if (error) {
      if (error.hint === 'team_contact_busy') return { ok: false, error: 'busy' };
      if (error.hint === 'team_contact_invalid') return { ok: false, error: 'invalid' };
      return { ok: false, error: 'network' };
    }
    return { ok: true, status: data === 'already' ? 'already' : 'sent' };
  } catch (_) {
    return { ok: false, error: 'network' };
  }
}

// What the form says after Send: { title, body }.
export function teamContactLine(result, { name = '', email = '' } = {}) {
  const first = String(name).trim().split(/\s+/)[0] || '';
  const to = String(email).trim().toLowerCase();
  if (result?.ok) {
    const title = result.status === 'already'
      ? `We already have your request${first ? `, ${first}` : ''}.`
      : `Thanks${first ? `, ${first}` : ''}. It’s with us.`;
    return {
      title,
      body: `We’ll write to ${to}. Meanwhile a Team trial works for up to ${TEAM_SEAT_MAX} seats, if you’d like to start now.`,
    };
  }
  if (result?.error === 'busy') {
    return { title: 'That didn’t send.', body: `A lot of requests came in just now. Try again in an hour, or write to ${SUPPORT_EMAIL}.` };
  }
  if (result?.error === 'invalid') {
    return { title: 'That didn’t send.', body: 'Something in the form needs another look.' };
  }
  return { title: 'That didn’t send.', body: 'Check your connection and try again.' };
}
