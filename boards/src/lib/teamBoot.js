// teamBoot — the Team plan's joins at boot (Team S4 Task 7), run by App once a
// signed-in person's app mounts and held by teamsAllowed():
//   1. the note a team link left (a sign-in's claim, a card's join), as a toast;
//   2. an email invite waiting from ?teaminvite=, accepted (the email's
//      "Join the team" was the yes);
//   3. once per tab session: invites to this address (claim_my_team_invites),
//      and a verified company domain whose team admits this account without
//      asking (my_team_offers, mode 'auto'). 'ask' offers wait for their
//      dialog, whose look the owner picks first.
// Never throws. Returns { changed }: whether the person's teams changed.

import { teamJoinLine, teamDomainJoinLine, teamInviteRefusalLine, teamInvitesClaimedLine } from './teamCopy.js';
import { takeTeamNote, readTeamLink, clearTeamLink } from './teamLinks.js';

const first = (d) => (Array.isArray(d) ? d[0] : d);

export function domainOf(email) {
  const s = String(email || '');
  const i = s.lastIndexOf('@');
  return i < 0 ? '' : s.slice(i + 1).trim().toLowerCase();
}

// True the first time per tab session for this person; storage errors mean "run".
function firstBootThisSession(userId) {
  const key = `soleil.boards.team.boot.${userId}`;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
  } catch (_) {}
  return true;
}

export async function runTeamBoot({ userId, email, toast, onChanged }, api = null) {
  let changed = false;
  try {
    const say = (m) => { if (m) { try { toast?.(m); } catch (_) {} } };
    const note = takeTeamNote();
    if (note) say(note);

    const a = api || await import('./teamsApi.js');

    const pending = readTeamLink();
    if (pending && pending.kind === 'invite') {
      clearTeamLink();
      try {
        const row = first(await a.acceptTeamInvite({ p_token: pending.token }));
        let name = '';
        if ((row?.status === 'joined' || row?.status === 'already') && row.org_id) {
          try {
            const teams = await a.listMyTeams();
            name = (Array.isArray(teams) ? teams : []).find((t) => t.org_id === row.org_id)?.name || '';
          } catch (_) {}
        }
        say(teamJoinLine(row?.status, name, row?.role));
        if (row?.status === 'joined') changed = true;
      } catch (e) {
        say(teamInviteRefusalLine(e));
      }
    }

    if (userId && firstBootThisSession(userId)) {
      let n = 0;
      try { n = Number(await a.claimMyTeamInvites()) || 0; } catch (_) {}
      if (n > 0) { say(teamInvitesClaimedLine(n)); changed = true; }

      let offers = [];
      try { const d = await a.myTeamOffers(); offers = Array.isArray(d) ? d : []; } catch (_) {}
      for (const o of offers) {
        if (!o || o.mode !== 'auto') continue;
        try {
          const row = first(await a.answerTeamOffer({ p_org_id: o.org_id, p_join: true }));
          if (row?.status === 'joined') { say(teamDomainJoinLine(o.name, domainOf(email))); changed = true; }
          else if (row?.status === 'requested') { say(teamJoinLine('requested', o.name)); changed = true; }
        } catch (_) { /* asked again next session */ }
      }
    }

    if (changed) onChanged?.();
  } catch (e) {
    console.warn('[team-boot]', e);
  }
  return { changed };
}
