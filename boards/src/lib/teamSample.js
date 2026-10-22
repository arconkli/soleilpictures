// teamSample — Settings › Preview's test team, Northlight Films, the team in
// the owner's mockups (2026-10-21), as a TeamSnapshot (lib/teamModel.js).
//
// sampleTeam(as) answers the way the server will: already cut to the
// viewer's role. A member gets names and where people edit, and nothing else:
// no email address, no last-here, no invites, no seats, plan, card or joining.
// 'unpaid' is the owner of a team whose payment failed, past its 14 days of
// grace: view-only, kept 12 months, then deleted.
//
// Dates are relative to `now`, so a renewal is always ahead and the prorated
// price of a seat is always real arithmetic.
import { storageQuota } from './teamModel.js';

const DAY = 864e5;
const C = ['#5b8def', '#6b8090', '#9a6b88', '#c9a577', '#6b9088', '#b88958'];

export const SAMPLE_TEAM_ID = 'sample-northlight';

// The workspaces the buying walk-through offers to move in (TeamSetup): the
// first three are the test team's, and their editors' union is its 12 seats.
export const SAMPLE_SETUP_WORKSPACES = Object.freeze([
  { id: 'sample-ws-studio', name: 'Studio', letter: 'S', color: '#5b8def',
    editors: ['p-alex', 'p-ben', 'p-maya', 'p-jon', 'p-omar', 'p-theo', 'p-rosa', 'p-chloe'] },
  { id: 'sample-ws-commercials', name: 'Commercials', letter: 'C', color: '#9a6b88',
    editors: ['p-alex', 'p-ben', 'p-maya', 'p-priya', 'p-june'] },
  { id: 'sample-ws-music', name: 'Music videos', letter: 'M', color: '#c9a577',
    editors: ['p-alex', 'p-ben', 'p-omar', 'p-sam', 'p-kai'] },
  { id: 'sample-ws-pitch', name: 'Pitch decks', letter: 'P', color: '#b88958',
    editors: ['p-alex'] },
]);

// `name` (the team name typed in the walk-through) replaces "Northlight Films".
export function sampleTeam(as = 'owner', now = Date.now(), { name } = {}) {
  const member = as === 'member';
  const unpaid = as === 'unpaid';
  const role = member ? 'member' : as === 'admin' ? 'admin' : 'owner';
  const meId = member ? 'p-maya' : role === 'admin' ? 'p-ben' : 'p-alex';
  const ago = (ms) => now - ms;
  const min = 60e3;
  const hour = 60 * min;

  const editor = (id, name, email, r, where, last, color, more = {}) => ({
    id, name, email, role: r, outside: r === 'guest', everywhere: where === 'everywhere',
    where: where === 'everywhere' ? [] : where, online: last === 'now',
    lastSeenAt: last === 'now' ? ago(2 * min) : ago(last), color, invited: null, ...more,
  });

  let people = [
    editor('p-alex', 'Alex Rivera', 'alex@northlight.studio', 'owner', 'everywhere', 'now', C[3]),
    editor('p-ben', 'Ben Okafor', 'ben@northlight.studio', 'admin', 'everywhere', 2 * hour, C[0]),
    editor('p-maya', 'Maya Chen', 'maya@northlight.studio', 'member', ['Studio', 'Commercials'], 'now', C[2]),
    editor('p-jon', 'Jon Bauer', 'jon@northlight.studio', 'member', ['Studio'], 'now', C[4]),
    editor('p-priya', 'Priya Shah', 'priya@northlight.studio', 'member', ['Commercials'], 1.2 * DAY, C[5]),
    editor('p-omar', 'Omar Haddad', 'omar@northlight.studio', 'member', ['Studio', 'Music videos'], 7 * hour, C[1]),
    editor('p-june', 'June Park', 'june@northlight.studio', 'member', ['Commercials'], 1.1 * DAY, C[0]),
    editor('p-theo', 'Theo Martin', 'theo@northlight.studio', 'member', ['Studio'], 8 * DAY, C[2]),
    editor('p-sam', 'Sam Lee', 'sam@northlight.studio', 'member', ['Music videos'], 3 * DAY, C[4]),
    editor('p-rosa', 'Rosa Vidal', 'rosa@vidal.studio', 'guest', ['Feature film, one cluster'], 2 * DAY, C[5]),
    editor('p-kai', 'Kai Nakamura', 'kai@n.tv', 'guest', ['Music videos'], 5 * DAY, C[3]),
    editor('p-chloe', 'Chloe Dubois', 'chloe@northlight.studio', 'member', ['Studio'], 0, 'transparent', {
      online: false, lastSeenAt: null, invited: { role: 'editor', sentAt: ago(2 * DAY) },
    }),
    editor('p-lena', 'Lena Fischer', 'lena@northlight.studio', 'viewer', ['Commercials'], 4 * hour, C[1]),
    editor('p-nadia', 'Nadia Brooks', 'nadia@brooksagency.com', 'viewer', ['Commercials'], 2 * DAY, C[2], { outside: true }),
    editor('p-owen', 'Owen Price', 'owen@northlight.studio', 'viewer', ['Studio'], 6 * DAY, C[0]),
    editor('p-ines', 'Ines Moreau', 'ines@moreau.fr', 'viewer', ['Music videos'], 9 * DAY, C[4], { outside: true }),
    editor('p-felix', 'Felix Wong', 'felix@northlight.studio', 'viewer', ['Studio', 'Commercials'], 1.3 * DAY, C[3]),
    editor('p-grace', 'Grace Kim', 'grace@northlight.studio', 'viewer', ['Commercials'], 12 * DAY, C[5]),
    editor('p-leo', 'Leo Santos', 'leo@santos.tv', 'viewer', ['Music videos'], 20 * DAY, C[1], { outside: true }),
  ];

  const workspaces = [
    { id: 'sample-ws-studio', name: 'Studio', letter: 'S', color: '#5b8def', private: false },
    { id: 'sample-ws-commercials', name: 'Commercials', letter: 'C', color: '#9a6b88', private: false },
    { id: 'sample-ws-music', name: 'Music videos', letter: 'M', color: '#c9a577', private: true },
  ];

  const seats = 15;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const failedAt = midnight.getTime() - 17 * DAY;

  const teamName = String(name ?? '').trim() || 'Northlight Films';
  const team = {
    id: SAMPLE_TEAM_ID,
    name: teamName,
    letter: teamName.charAt(0).toUpperCase(),
    color: '#c9a577',
    sample: true,
    status: unpaid ? 'view_only' : 'active',
    me: { id: meId, role },
    admins: [{ id: 'p-alex', name: 'Alex Rivera' }, { id: 'p-ben', name: 'Ben Okafor' }],
    people,
    requests: [{ id: 'r-lena', personId: 'p-lena', name: 'Lena Fischer', workspace: 'Commercials', color: C[1] }],
    plan: {
      interval: 'year',
      seats,
      renewsAt: midnight.getTime() + 133 * DAY,
      card: { brand: 'Visa', last4: '4242', exp: '08/28' },
      receiptsTo: 'alex@northlight.studio',
    },
    storage: { usedBytes: 1.2e12, quotaBytes: storageQuota(seats) },
    whenFull: { mode: 'ask', monthlyLimit: 5 },
    joining: {
      link: { on: true, token: 'nl-7f3k2q', role: 'editor' },
      domains: [{ domain: 'northlight.studio', verified: true, on: true }],
    },
    unpaid: unpaid ? { failedAt, deleteAt: failedAt + 14 * DAY + 365 * DAY } : null,
    workspaces,
  };

  if (!member) return team;

  // A member's cut: what the server will send them.
  const mine = people.find((p) => p.id === meId);
  people = people
    .filter((p) => !p.invited)
    .map((p) => ({ ...p, email: null, online: false, lastSeenAt: null }));
  return {
    ...team,
    people,
    requests: null,
    plan: null,
    storage: null,
    whenFull: null,
    joining: null,
    workspaces: workspaces.filter((w) => !w.private || mine.where.includes(w.name)),
  };
}
