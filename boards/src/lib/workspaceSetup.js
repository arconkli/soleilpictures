// workspaceSetup.js — the first-run setup's rules, before the canvas.
//
// A new signup names their workspace, says who's working in it and what kind
// of work it holds, and invites people; someone joining another person's
// workspace answers only the work question. Then the app opens. Activation was
// never the problem (most new accounts place a first card); coming back and
// bringing people in are, so every answer here has to visibly change something
// next: the name is the workspace's name, the team answer sets how the invite
// step asks, and the work answer is what the first board's headline and the
// tour's content step say.
//
// It runs as a randomized test (experiments.js `workspace_setup`): arm A is
// today's flow, arm B these steps. Skippers in arm B get exactly one more ask
// once their workspace has some work in it (reaskDue), never a third.
//
// Pure and node-testable, like firstBoardCopy.js: no React, no Supabase, no
// import.meta.env. The caller passes the host gate's answer in (appHost.js
// workspaceSetupAllowed) and the clock.

// Accounts created before this never see the steps, wherever the gate is open.
// A user who already has an `onboarding` record has been in the app either way.
export const SETUP_EPOCH = '2026-10-20T00:00:00Z';

export const NAME_MAX = 60;           // the invite emails cut names here too (safeLabel)
export const REASK_MIN_CARDS = 6;     // where day-one return stops climbing slowly
export const REASK_WINDOW_DAYS = 14;
export const MAX_INVITE_ROWS = 8;

export const TEAM_OPTIONS = Object.freeze([
  { id: 'solo', label: 'Just me' },
  { id: 'few', label: 'A few people' },
  { id: 'team', label: 'A team' },
]);

export const WORK_OPTIONS = Object.freeze([
  { id: 'film', label: 'Film & video' },
  { id: 'photo', label: 'Photo' },
  { id: 'design', label: 'Design' },
  { id: 'ads', label: 'Ads & brand' },
  { id: 'music', label: 'Music' },
  { id: 'school', label: 'School' },
  { id: 'personal', label: 'Personal' },
  { id: 'other', label: 'Something else' },
]);

const TEAM_IDS = new Set(TEAM_OPTIONS.map((o) => o.id));
const WORK_IDS = new Set(WORK_OPTIONS.map((o) => o.id));

export const SETUP_STEPS = Object.freeze(['name', 'who', 'invite']);
export const INVITEE_STEPS = Object.freeze(['invitee']);

export function stepsForSetup({ invitee } = {}) {
  return invitee ? INVITEE_STEPS : SETUP_STEPS;
}

// Who sees the steps at all. Zero queries: the tier read the app already makes
// carries `onboarding`, and only someone who passes this pays for the reads
// that decide where they resume.
export function isSetupCandidate({ allowed, createdAt, onboarding } = {}) {
  if (!allowed) return false;
  const created = Date.parse(createdAt || '');
  if (!Number.isFinite(created) || created < Date.parse(SETUP_EPOCH)) return false;
  if (onboarding && (onboarding.seeded || onboarding.done)) return false;
  return true;
}

// ── The name ────────────────────────────────────────────────────────────────

// Control characters (C0, DEL, C1) and the invisible ones (zero-width spaces
// and joiners, bidi controls, the BOM). Written as code point ranges so no
// tool rewrites them into the characters themselves.
const INVISIBLE = new RegExp('[' + [
  [0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0xfeff, 0xfeff],
].map(([a, b]) => `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`).join('') + ']', 'gu');

export function normalizeWorkspaceName(raw) {
  return String(raw ?? '').normalize('NFC').replace(INVISIBLE, ' ').replace(/\s+/gu, ' ').trim();
}

// { ok, name, reason }: reason is 'empty' or 'too_long'. Length is counted in
// characters a person sees, not UTF-16 units, so an emoji costs one.
export function validateWorkspaceName(raw) {
  const name = normalizeWorkspaceName(raw);
  if (!name) return { ok: false, name, reason: 'empty' };
  if ([...name].length > NAME_MAX) return { ok: false, name, reason: 'too_long' };
  return { ok: true, name, reason: null };
}

// ── What the answers change ─────────────────────────────────────────────────

// The work answer, as firstBoardCopy's kind: the empty board's headline and
// the tour's content step ("Now drop your frames in"). Null keeps the generic
// copy.
export function workToFirstBoardKind(work) {
  if (work === 'film') return 'storyboard';
  if (work === 'photo' || work === 'design' || work === 'ads') return 'moodboard';
  return null;
}

// How the invite step asks, by the team answer. The link leads and one email
// row follows it for every answer ("I tuned", owner 2026-10-20): people share
// links far more than they type addresses, and the people who came in through
// a link were the ones who went on to add cards. `rows` stays so the step has
// one place that says how many rows it opens with.
export function inviteCopyFor(team, workspaceName) {
  const ws = normalizeWorkspaceName(workspaceName) || 'your workspace';
  if (team === 'solo') {
    return { head: 'Want a second pair of eyes?', sub: `Invite a collaborator, a client or a friend to ${ws}. They see what you add, as you add it.`, rows: 1 };
  }
  if (team === 'few') {
    return { head: 'Invite the people you work with', sub: `They’ll see every cluster and file in ${ws}, and what you add as you add it.`, rows: 1 };
  }
  if (team === 'team') {
    return { head: `Bring your team into ${ws}`, sub: 'Add a few emails, or share one link with everyone.', rows: 1 };
  }
  return { head: `Invite people to ${ws}`, sub: 'They’ll see every cluster and file in it, and what you add as you add it.', rows: 1 };
}

// What a workspace invite link does, from its row (0451), never typed in: a
// new account's link is shorter and smaller than an older one's. null until
// the terms are known, and the step says only the first sentence.
export function linkTermsLine({ workspaceName, role, expiresAt, maxUses, uses = 0, now } = {}) {
  const ws = normalizeWorkspaceName(workspaceName) || 'your workspace';
  const lead = role === 'viewer'
    ? `Anyone with the link can join ${ws} and see everything in it.`
    : `Anyone with the link can join ${ws} and edit.`;
  const end = Date.parse(expiresAt || '');
  const at = Number.isFinite(now) ? now : Date.parse(now || '');
  const left = Math.max(0, (Number(maxUses) || 0) - (Number(uses) || 0));
  if (!Number.isFinite(end) || !Number.isFinite(at) || !(Number(maxUses) > 0)) return lead;
  const days = Math.max(1, Math.round((end - at) / 86400000));
  const span = days === 1 ? 'a day' : `${days} days`;
  const who = Number(uses) > 0
    ? (left === 1 ? 'one more person' : `${left} more people`)
    : (left === 1 ? 'one person' : `up to ${left} people`);
  return `${lead} It works for ${span}, for ${who}.`;
}

// ── Progress ────────────────────────────────────────────────────────────────

// The record kept in profiles.settings.welcome — its own key, because
// merge_profile_settings replaces keys whole and `onboarding` belongs to the
// tour. A reload resumes at `step`.
export function initialSetupState({ invitee = false } = {}) {
  return { v: 1, step: invitee ? 'invitee' : 'name', done: false, invitee: !!invitee, team: null, work: null, invite: null, named_at: null, done_at: null };
}

// One reducer for every move, so the component, the resume path and the tests
// agree on what each answer records. `now` is an ISO string from the caller.
// Moves: name {name}, who {team, work}, skip_who, back, invite_sent,
// invite_skipped, invitee_done {work}. Anything that doesn't apply returns the
// state unchanged.
export function nextSetupState(state, move) {
  const s = state && typeof state === 'object' ? state : initialSetupState();
  if (s.done || !move) return s;
  const now = move.now || null;
  const team = TEAM_IDS.has(move.team) ? move.team : null;
  const work = WORK_IDS.has(move.work) ? move.work : null;
  switch (move.type) {
    case 'name':
      if (s.step !== 'name' || !validateWorkspaceName(move.name).ok) return s;
      return { ...s, step: 'who', named_at: s.named_at || now };
    case 'who':
      if (s.step !== 'who') return s;
      return { ...s, step: 'invite', team, work };
    case 'skip_who':
      if (s.step !== 'who') return s;
      return { ...s, step: 'invite' };
    case 'back': {
      const i = SETUP_STEPS.indexOf(s.step);
      return i > 0 ? { ...s, step: SETUP_STEPS[i - 1] } : s;
    }
    case 'invite_sent':
    case 'invite_skipped':
      if (s.step !== 'invite') return s;
      return { ...s, step: 'done', done: true, invite: move.type === 'invite_sent' ? 'sent' : 'skipped', done_at: now };
    case 'invitee_done':
      if (s.step !== 'invitee') return s;
      return { ...s, step: 'done', done: true, work, done_at: now };
    default:
      return s;
  }
}

// ── The one re-ask ──────────────────────────────────────────────────────────

// Whether to ask a skipper once more, now. Only arm B, only someone who
// skipped the invite step, only once ever, only after their workspace has
// some work in it, and never over something else: an upload still landing, a
// tour, a dialog. Past the window it never shows.
export function reaskDue({ arm, welcome, reasked, ownCards, uploading, overlayOpen, createdAt, now } = {}) {
  if (arm !== 'B' || reasked) return false;
  if (!welcome || !welcome.done || welcome.invitee || welcome.invite !== 'skipped') return false;
  if (!(Number(ownCards) >= REASK_MIN_CARDS)) return false;
  if (uploading || overlayOpen) return false;
  const created = Date.parse(createdAt || '');
  const at = Date.parse(now || '');
  if (!Number.isFinite(created) || !Number.isFinite(at)) return false;
  return at - created <= REASK_WINDOW_DAYS * 86400000;
}
