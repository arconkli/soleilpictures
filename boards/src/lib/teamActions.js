// teamActions — what each action the Team page dispatches does on a real
// team: the RPC or team-billing call, and how its failure reads. Pure but
// for the injected `api` (the real one is { ...teamsApi, ...teamBillingApi }),
// so node can pass fakes.
//
// runTeamAction → { ok:true, data } | { ok:false, refusal }.
// refusal.code is a TEAM_HINT for a team refusal (plus `needed` for
// team_seats_needed), the server's error code for a team-billing refusal
// (its other fields kept), 'unsupported', 'not_yet' or 'failed'.
//
// A person's id in get_team is a user id; an invite's is 'invite:<uuid>'
// (org_invites, a team invite, revocable) or 'pending:<uuid>' (a workspace
// invite in pending_invites, which revoke_team_invite can't handle).

import { teamRefusal } from './teamHints.js';

// The link's role in the page is editor | viewer; set_team_link takes
// member | viewer (0534).
const LINK_ROLE = { editor: 'member', viewer: 'viewer' };
const INVITE_ROLE = { editor: 'member', viewer: 'viewer', admin: 'admin', member: 'member' };

// "Münich.de " → "xn--mnich-kva.de". An unparseable name is left as typed
// (lowercased), and the server refuses it with team_domain_invalid.
export function normalizeDomain(input) {
  const d = String(input || '').trim().toLowerCase().replace(/^@/, '');
  if (!d) return d;
  try { return new URL('https://' + d).hostname; } catch (_) { return d; }
}

export async function runTeamAction(api, orgId, type, payload = {}) {
  const p = payload || {};
  const org = { p_org_id: orgId };
  try {
    switch (type) {
      case 'rename':
        return ok(await api.renameTeam({ ...org, p_name: p.name, p_color: p.color ?? null }));
      case 'role':
        return ok(await api.setTeamRole({ ...org, p_user_id: p.personId, p_role: p.role, p_add_seats: !!p.addSeats }));
      case 'remove':
        return ok(await api.removeFromTeam({ ...org, p_user_id: p.personId }));
      case 'revoke': {
        const id = String(p.personId || '');
        if (!id.startsWith('invite:')) return { ok: false, refusal: { code: 'unsupported' } };
        return ok(await api.revokeTeamInvite({ p_invite_id: id.slice('invite:'.length) }));
      }
      case 'resend':
        return { ok: false, refusal: { code: 'not_yet' } };
      case 'approve':
        return ok(await api.approveTeamRequest({ p_request_id: p.requestId, p_add_seat: !!p.addSeat }));
      case 'keepViewer':
        return ok(await api.keepTeamRequestViewer({ p_request_id: p.requestId }));
      case 'removeSeat':
        return ok(await api.removeTeamSeat(org));
      case 'addSeats':
        return billing(await api.addTeamSeats(orgId, p.seats, { requestId: p.requestId, prorationDate: p.prorationDate }));
      case 'whenFull':
      case 'monthlyLimit': {
        const cur = p.current || {};
        const mode = type === 'whenFull' ? p.mode : cur.mode;
        const v = type === 'monthlyLimit' ? p.value : cur.monthlyLimit;
        const limit = v == null || v === '' || !(Number(v) > 0) ? null : Math.floor(Number(v));
        return ok(await api.setTeamWhenFull({ ...org, p_mode: mode, p_monthly_limit: limit }));
      }
      case 'invite':
        return ok(await api.inviteToTeam({
          ...org, p_emails: p.emails, p_role: INVITE_ROLE[p.role] || 'member', p_add_seats: !!p.addSeats,
        }));
      case 'link':
        return ok(await api.setTeamLink({ ...org, p_on: !!p.on }));
      case 'linkRole':
        return ok(await api.setTeamLink({ ...org, p_role: LINK_ROLE[p.role] || 'viewer' }));
      case 'newLink':
        return ok(await api.resetTeamLink(org));
      case 'domainOn': {
        // The page's switch turns every domain on or off (the reducer does);
        // set_team_domain_on takes one, so `domains` lists them (or `domain`).
        const list = Array.isArray(p.domains) ? p.domains : [p.domain];
        const out = [];
        for (const d of list) out.push(await api.setTeamDomainOn({ ...org, p_domain: normalizeDomain(d), p_on: !!p.on }));
        return ok(out);
      }
      case 'addDomain':
        return ok(await api.addTeamDomain({ ...org, p_domain: normalizeDomain(p.domain) }));
      case 'removeDomain':
        return ok(await api.removeTeamDomain({ ...org, p_domain: normalizeDomain(p.domain) }));
      case 'checkDomain':
        return billing(await api.checkTeamDomain(orgId, normalizeDomain(p.domain)));
      case 'close':
        return ok(await api.closeTeam(org));
      case 'leave':
        return ok(await api.leaveTeam(org));
      case 'portal':
        return billing(await api.openTeamPortal(orgId));
      case 'seatPerk':
        return ok(await api.setTeamSeatPerk({ ...org, p_on: !!p.on }));
      default:
        return { ok: false, refusal: { code: 'unsupported' } };
    }
  } catch (err) {
    const r = teamRefusal(err);
    if (r) return { ok: false, refusal: { code: r.kind, needed: r.needed } };
    return { ok: false, refusal: { code: 'failed', message: err?.message ?? null } };
  }
}

function ok(data) {
  return { ok: true, data };
}

// A teamBillingApi answer: { ok:false, error, ...server fields } is a refusal.
function billing(res) {
  if (res && res.ok === false) {
    const { ok: _ok, error, ...rest } = res;
    return { ok: false, refusal: { ...rest, code: error } };
  }
  return { ok: true, data: res };
}
