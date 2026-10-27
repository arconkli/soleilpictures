// teamModel — the Team page's rules, apart from React (the owner's pick B,
// 2026-10-21: a page of its own, tabs People · Seats & billing · Joining).
//
// The page renders a TeamSnapshot. Until the server lands (S2a–S4), the only
// snapshot is Settings › Preview's test team (lib/teamSample.js), and
// teamReducer below is how it answers clicks: look only, nothing leaves the
// browser. The server will return the same shape, already cut to the viewer's
// role (a member never receives an email address, a seat count or a card),
// and the reducer's actions become RPCs.
//
// TeamSnapshot = {
//   id, name, letter, color, sample,
//   status: 'active' | 'view_only',
//   me: { id, role: 'owner' | 'admin' | 'member' },
//   admins: [{ id, name }],                  // the owner first, then admins
//   people: Person[],
//   requests: Request[] | null,              // owner and admins only
//   plan: { interval: 'year' | 'month', seats, renewsAt, card: { brand, last4, exp }, receiptsTo } | null,
//   storage: { usedBytes, quotaBytes } | null,
//   whenFull: { mode: 'ask' | 'auto', monthlyLimit: number | null } | null,
//   joining: { link: { on, token, role: 'editor' | 'viewer' }, domains: [{ domain, verified, on }] } | null,
//   unpaid: { failedAt, deleteAt } | null,
//   workspaces: [{ id, name, letter, color, private }],
// }
// Person = { id, name, email (null for a member), role: 'owner' | 'admin' |
//   'member' | 'guest' | 'viewer', outside (a guest, or a viewer from outside
//   the team), everywhere, where: string[], online, lastSeenAt, color,
//   invited: { role: 'editor' | 'viewer', sentAt } | null }
// Request = { id, personId, name, workspace, color }
//
// Prices here are the owner's decisions of 2026-10-20 and drive the preview
// only. S3 makes Stripe's Team prices the source and moves the claim into
// billingCopy.js, which names the code enforcing every price.

export const TEAM_SEAT_MIN = 3;
// Self-serve stops here; past it, Talk to us (start_team_checkout, 0538).
export const TEAM_SEAT_MAX = 100;
export const TEAM_SEAT_PRICE = Object.freeze({ month: 25, year: 240 });
export const TEAM_STORAGE_BLOCK_MONTHLY = 25;
export const TEAM_STORAGE_PER_SEAT = 1e12;
export const TEAM_STORAGE_FLOOR = 1e12;
// The seat perk: a seat holder's own workspaces get this much more drive
// (_seat_perk_storage_bytes, 0536: 50 GiB), in decimal like the sizes above.
export const SEAT_PERK_STORAGE = 50e9;

const DAY = 864e5;
const PERIOD_MS = { month: 30 * DAY, year: 365 * DAY };

export const ROLE_LABEL = Object.freeze({
  owner: 'Owner', admin: 'Admin', member: 'Member', guest: 'Guest', viewer: 'Viewer',
});

// ── Who may do what ─────────────────────────────────────────────────────
// The owner: everything. Admins: people, seats, joining and the when-full
// rule, never the card, the plan, storage or closing the team. Members: look
// at People (names and where they edit).
const CAN = {
  seeBilling: ['owner', 'admin'],
  seeJoining: ['owner', 'admin'],
  seeEmails: ['owner', 'admin'],
  managePeople: ['owner', 'admin'],
  makeAdmins: ['owner'],
  addSeats: ['owner', 'admin'],
  setWhenFull: ['owner', 'admin'],
  changeCard: ['owner'],
  changePlan: ['owner'],
  addStorage: ['owner'],
  closeTeam: ['owner'],
  leaveTeam: ['admin', 'member'],
  renameTeam: ['owner', 'admin'],
};

export function teamCan(role, action) {
  return (CAN[action] || []).includes(role);
}

// A seat is anyone who can edit, guests too, and an editor invite until it's
// answered. Viewers are free.
export function holdsSeat(p) {
  return p.invited ? p.invited.role !== 'viewer' : p.role !== 'viewer';
}

export function seatsUsed(people) {
  return people.filter(holdsSeat).length;
}

export function seatsFree(team) {
  if (!team.plan) return 0;
  return Math.max(0, team.plan.seats - seatsUsed(team.people));
}

// The roles a manager can give this person, or null when theirs is fixed.
export function roleChoices(team, person) {
  const role = team.me.role;
  if (!teamCan(role, 'managePeople')) return null;
  if (person.invited || person.id === team.me.id || person.role === 'owner') return null;
  if (person.role === 'admin' && !teamCan(role, 'makeAdmins')) return null;
  if (person.outside) return ['guest', 'viewer'];
  return teamCan(role, 'makeAdmins') ? ['admin', 'member', 'viewer'] : ['member', 'viewer'];
}

// ── The People list ─────────────────────────────────────────────────────
export function peopleCounts(people) {
  let edit = 0;
  let view = 0;
  let invited = 0;
  for (const p of people) {
    if (p.invited) invited += 1;
    else if (p.role === 'viewer') view += 1;
    else edit += 1;
  }
  return { all: edit + view + invited, edit, view, invited };
}

// show: 'all' lists everyone who can edit and every invite, with the viewers
// folded into one row below (viewersFolded); a search finds viewers too.
export function filterPeople(people, { query = '', show = 'all' } = {}) {
  const q = query.trim().toLowerCase();
  const hit = (p) => !q || p.name.toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q);
  const isViewer = (p) => !p.invited && p.role === 'viewer';
  const inShow = (p) => {
    if (show === 'edit') return !p.invited && p.role !== 'viewer';
    if (show === 'view') return isViewer(p);
    if (show === 'invited') return !!p.invited;
    return q ? true : !isViewer(p);
  };
  const rows = people.filter((p) => inShow(p) && hit(p));
  const viewersFolded = show === 'all' && !q ? people.filter(isViewer).length : 0;
  return { rows, viewersFolded };
}

export function whereLabel(p) {
  return p.everywhere ? 'Everywhere' : p.where.join(', ');
}

export function lastHereLabel(p, now = Date.now()) {
  if (p.invited) return `Sent ${agoLabel(p.invited.sentAt, now).toLowerCase()}`;
  if (p.online) return 'Here now';
  if (!p.lastSeenAt) return '';
  return agoLabel(p.lastSeenAt, now);
}

function agoLabel(at, now) {
  const mins = (now - at) / 60000;
  if (mins < 60) return `${Math.max(1, Math.round(mins))} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 6) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const start = midnight.getTime();
  if (at >= start) return 'Today';
  if (at >= start - DAY) return 'Yesterday';
  const days = Math.floor((start - at) / DAY) + 1;
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'Last week';
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return 'A while ago';
}

// "Alex and Ben", "Alex, Ben and Mia": the owner and admins by first name,
// for the line a member reads under the list.
export function adminNames(team) {
  const names = team.admins.map((a) => a.name.split(' ')[0]);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// ── Money and sizes ─────────────────────────────────────────────────────
export function money(n) {
  const cents = Math.round(n * 100);
  const whole = cents % 100 === 0;
  return '$' + (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
  });
}

// The pricing hero's Team sentence, on the preview's /pricing only. The caller
// passes the editor limit, so this module imports nothing: the public pricing
// page's lazy Team card pulls it, and an app import here would split the app.
export function teamHeroLine(editorLimit) {
  return `Teams with more than ${editorLimit} people who edit pay ${money(TEAM_SEAT_PRICE.month)} a seat.`;
}

export function seatPrice(plan) {
  return TEAM_SEAT_PRICE[plan.interval];
}

export function seatPriceLabel(plan) {
  return `${money(seatPrice(plan))} a ${plan.interval}`;
}

// What one seat costs today: the rest of the period, prorated by the day.
export function proratedToday(plan, now = Date.now()) {
  const left = Math.max(0, Math.min(PERIOD_MS[plan.interval], plan.renewsAt - now));
  return Math.round(seatPrice(plan) * (left / PERIOD_MS[plan.interval]) * 100) / 100;
}

export function seatAddLine(plan, n = 1, now = Date.now()) {
  const each = n === 1 ? '' : ' each';
  return `${seatPriceLabel(plan)}${each}, ${money(proratedToday(plan, now) * n)} today`;
}

// The line under a join request: a free seat is used first; only when none
// is left does approving buy one.
export function approveLine(team, now = Date.now()) {
  const free = seatsFree(team);
  if (free > 0) return `Approving uses one of the ${free} free seat${free === 1 ? '' : 's'}.`;
  return `Approving adds a seat: ${seatAddLine(team.plan, 1, now)}.`;
}

export function storageQuota(seats) {
  return Math.max(TEAM_STORAGE_FLOOR, TEAM_STORAGE_PER_SEAT * seats);
}

export function sizeLabel(bytes) {
  if (bytes >= 1e12) return `${trim(bytes / 1e12)} TB`;
  return `${trim(bytes / 1e9)} GB`;
}

function trim(n) {
  return String(Math.round(n * 100) / 100);
}

export function dateLabel(ms) {
  return new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// The link AuthGate captures (lib/teamLinks.js); a live team on preview passes its own host.
export function joinUrl(token, host = 'clusters.soleilpictures.com') {
  return `${host}/?teamjoin=${token}`;
}

// ── The test team's answers to clicks (look only) ───────────────────────
// Every action keeps plan.seats at or above the seats in use: anything that
// would need one more seat buys it, as an admin's explicit action does.
export function teamReducer(team, action) {
  switch (action.type) {
    case 'role': {
      const people = team.people.map((p) => (p.id === action.personId ? { ...p, role: action.role } : p));
      return withSeats({ ...team, people });
    }
    case 'remove':
    case 'revoke': {
      return { ...team, people: team.people.filter((p) => p.id !== action.personId) };
    }
    case 'resend': {
      return {
        ...team,
        people: team.people.map((p) => (p.id === action.personId && p.invited
          ? { ...p, invited: { ...p.invited, sentAt: action.now } }
          : p)),
      };
    }
    case 'approve': {
      const req = (team.requests || []).find((r) => r.id === action.requestId);
      if (!req) return team;
      const people = team.people.map((p) => (p.id === req.personId
        ? { ...p, role: p.outside ? 'guest' : 'member', where: [req.workspace] }
        : p));
      return withSeats({ ...team, people, requests: team.requests.filter((r) => r.id !== req.id) });
    }
    case 'keepViewer': {
      return { ...team, requests: (team.requests || []).filter((r) => r.id !== action.requestId) };
    }
    case 'addSeats': {
      return withPlan(team, { seats: team.plan.seats + Math.max(1, action.n | 0) });
    }
    case 'removeSeat': {
      const floor = Math.max(TEAM_SEAT_MIN, seatsUsed(team.people));
      if (team.plan.seats <= floor) return team;
      return withPlan(team, { seats: team.plan.seats - 1 });
    }
    case 'whenFull': {
      return { ...team, whenFull: { ...team.whenFull, mode: action.mode } };
    }
    case 'monthlyLimit': {
      const v = action.value;
      const limit = v == null || v === '' || !(Number(v) > 0) ? null : Math.floor(Number(v));
      return { ...team, whenFull: { ...team.whenFull, monthlyLimit: limit } };
    }
    case 'invite': {
      const have = new Set(team.people.map((p) => (p.email || '').toLowerCase()));
      const fresh = action.emails
        .map((e) => e.trim().toLowerCase())
        .filter((e, i, all) => e && !have.has(e) && all.indexOf(e) === i);
      const people = [...team.people, ...fresh.map((email, i) => ({
        id: `invite-${action.now}-${i}`,
        name: email,
        email,
        role: action.role === 'viewer' ? 'viewer' : 'member',
        outside: false,
        everywhere: false,
        where: [],
        online: false,
        lastSeenAt: null,
        color: 'transparent',
        invited: { role: action.role === 'viewer' ? 'viewer' : 'editor', sentAt: action.now },
      }))];
      return withSeats({ ...team, people });
    }
    case 'link': {
      return withJoining(team, { link: { ...team.joining.link, on: !!action.on } });
    }
    case 'linkRole': {
      return withJoining(team, { link: { ...team.joining.link, role: action.role } });
    }
    case 'newLink': {
      return withJoining(team, { link: { ...team.joining.link, token: action.token } });
    }
    case 'domainOn': {
      return withJoining(team, {
        domains: team.joining.domains.map((d) => ({ ...d, on: !!action.on })),
      });
    }
    case 'addDomain': {
      const domain = String(action.domain || '').trim().toLowerCase().replace(/^@/, '');
      if (!domain || team.joining.domains.some((d) => d.domain === domain)) return team;
      return withJoining(team, {
        domains: [...team.joining.domains, { domain, verified: false, on: true }],
      });
    }
    case 'rename': {
      const name = String(action.name || '').trim();
      return name ? { ...team, name, letter: name.charAt(0).toUpperCase() } : team;
    }
    default:
      return team;
  }
}

function withSeats(team) {
  if (!team.plan) return team;
  const used = seatsUsed(team.people);
  return used > team.plan.seats ? withPlan(team, { seats: used }) : team;
}

function withPlan(team, patch) {
  const plan = { ...team.plan, ...patch };
  const storage = team.storage ? { ...team.storage, quotaBytes: storageQuota(plan.seats) } : team.storage;
  return { ...team, plan, storage };
}

function withJoining(team, patch) {
  return { ...team, joining: { ...team.joining, ...patch } };
}
