// inviteSubmit.js — sending invitations to a list of addresses, one way for
// every surface that sends them: the share panel, and the first-run setup's
// invite step and its one re-ask. Pure over an injected sender, so it runs in
// node and the surfaces only differ in what they say about the result.

import { editorLimitRefusal } from './editorLimit.js';

// Addresses out of a free-form field: commas, semicolons, whitespace or
// newlines between them. Loose on purpose: anything with "@" and a dot in the
// domain part. Invalid entries come back, so a typo'd address never looks like
// it was invited, and the same address twice in a paste is one person.
export function parseEmails(raw) {
  const parts = String(raw ?? '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const valid = parts.filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  const invalid = parts.filter((s) => !valid.includes(s));
  const seen = new Set();
  const unique = valid.filter((s) => {
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { valid: unique, invalid };
}

// The server's daily invite budget (0358) refuses with "invite limit reached:
// <why>". Once it does, every address after it would be refused the same way.
export const INVITE_LIMIT_RE = /invite limit reached/i;

export function inviteLimitReason(msg) {
  return String(msg ?? '').replace(/^invite limit reached:\s*/i, '');
}

// Which budget it was (0375), for the abuse read: an account paused while it
// is reviewed, a new account's first day, or the everyday one.
export function inviteLimitKind(msg) {
  const s = String(msg ?? '');
  if (/paused/i.test(s)) return 'paused';
  if (/first day/i.test(s)) return 'first_day';
  return 'daily';
}

// Send to each address in order. send(email) resolves 'granted' (they had an
// account; access is live now), 'pending' (no account yet: an invite email
// went out and it is claimed when they sign up) or 'already_member', and
// throws on a failure. Stops at the invite limit, returning the addresses it
// never reached, so a surface can keep them for tomorrow.
//   → { granted: [email], pending: [email], fail: [{email, reason}],
//       limit: null | { reason, unsent: [email] }                        (the invite budget)
//              | { kind: 'editors', ask, reason, unsent: [email] } }     (the 10-editor limit, 0521)
export async function runInvites(emails, send) {
  const granted = [];
  const pending = [];
  const fail = [];
  let limit = null;
  const list = Array.isArray(emails) ? emails : [];
  for (let i = 0; i < list.length; i += 1) {
    const email = list[i];
    try {
      const status = await send(email);
      if (status === 'already_member') { fail.push({ email, reason: 'already a member' }); continue; }
      if (status === 'pending') pending.push(email);
      else granted.push(email);
    } catch (e) {
      const msg = e?.message || String(e);
      if (INVITE_LIMIT_RE.test(msg)) { limit = { reason: inviteLimitReason(msg), unsent: list.slice(i) }; break; }
      // 0521: the account has no room for another editor. One run sends every
      // address with the same role, so the rest would be refused the same way.
      const full = editorLimitRefusal(e);
      if (full) { limit = { kind: 'editors', ask: full.ask, reason: msg, unsent: list.slice(i) }; break; }
      fail.push({ email, reason: msg });
    }
  }
  return { granted, pending, fail, limit };
}

// Send a list split by role, editors first. The invite budget stops the whole
// list: past it every address is refused the same way, so whatever it never
// reached comes back in budget.unsent. The editor limit (0521) stops only the
// editors: viewers never take a place, so they still go out.
//   byRole: { editor: [email], viewer: [email] }; sendFor(role) → send(email)
//   → { runs: [{ role, granted, pending, fail }],
//       budget: null | { reason, unsent: [email] },
//       editors: null | { ask, reason, unsent: [email] } }
export async function runInvitesByRole(byRole, sendFor) {
  const runs = [];
  let budget = null;
  let editors = null;
  for (const role of ['editor', 'viewer']) {
    const emails = Array.isArray(byRole?.[role]) ? byRole[role] : [];
    if (emails.length === 0) continue;
    if (budget) { budget.unsent.push(...emails); continue; }
    const r = await runInvites(emails, sendFor(role));
    runs.push({ role, granted: r.granted, pending: r.pending, fail: r.fail });
    if (r.limit?.kind === 'editors') editors = { ask: r.limit.ask, reason: r.limit.reason, unsent: [...r.limit.unsent] };
    else if (r.limit) budget = { reason: r.limit.reason, unsent: [...r.limit.unsent] };
  }
  return { runs, budget, editors };
}
