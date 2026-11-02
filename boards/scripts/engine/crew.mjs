// crew.mjs — the people behind an engine board's comments and votes (the
// owner, 11-01, #183: they show on the live boards too, not only in the shots).
//
// A comment has an author and a vote one ballot a person, so the boards need
// people: eight made-up crew, each a real account in the Showcase workspace
// that nobody signs in to. Each one is:
//   - at showcase+crew-<key>@soleilpictures.com, our own mailbox, so nothing
//     sent there bounces;
//   - made with no metadata, so the signup trigger's ad and referral paths
//     never fire;
//   - an internal account (`internal_accounts`), so no number counts it and no
//     lifecycle email goes to it (every lifecycle_due_* skips _internal_user_ids);
//   - set to want no email at all (profiles.notification_prefs) before it joins
//     the workspace, so neither the "you were added" mail nor a reply to its
//     comment sends anything;
//   - named (member_profiles), so its comments read as a person's;
//   - an editor of the Showcase workspace (eight and the owner: under the
//     ten-editor limit).
// ensureCrew is safe to run every time: it finds the ones already made.

import { createHash } from 'node:crypto';

export const CREW = Object.freeze([
  { key: 'priya', name: 'Priya Shah', color: '#5b8def' },
  { key: 'sam', name: 'Sam Okafor', color: '#6b8090' },
  { key: 'jonah', name: 'Jonah Reyes', color: '#9a6b88' },
  { key: 'mei', name: 'Mei Lin', color: '#6b9088' },
  { key: 'tomas', name: 'Tomás Varga', color: '#b88958' },
  { key: 'ada', name: 'Ada Brennan', color: '#5b8def' },
  { key: 'kofi', name: 'Kofi Mensah', color: '#9a6b88' },
  { key: 'lena', name: 'Lena Holt', color: '#6b8090' },
]);

/** The first names a recipe's comments may be signed with. */
export const CREW_FIRST = Object.freeze(CREW.map((c) => c.name.split(' ')[0]));

export const crewEmail = (key) => `showcase+crew-${key}@soleilpictures.com`;

const EMAIL_KEYS = ['email_board_shared', 'email_comment_replies', 'email_invite_accepted', 'email_lifecycle', 'email_mentions',
  'email_schedule', 'email_share_activity', 'email_workspace_invite'];
const NO_EMAIL = Object.fromEntries(EMAIL_KEYS.map((k) => [k, 'false']));
const REASON = 'internal — made-up crew who comment and vote on the boards engine\'s example boards (boards engine, 11-01)';

/** The crew member a comment is signed by ("Priya", "Priya, DP", "priya shah"), or null. Pure. */
export function crewOf(by) {
  const first = String(by || '').trim().split(/[\s,]+/)[0]?.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!first) return null;
  return CREW.find((c) => c.name.split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') === first) || null;
}

/** Stable made-up ids for a run that writes nothing (--dry-run): Map(key → uuid-shaped id). Pure. */
export function fakeCrewIds() {
  return new Map(CREW.map((c) => {
    const h = createHash('sha1').update(`crew:${c.key}`).digest('hex');
    return [c.key, `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`];
  }));
}

const must = (r, what) => { if (r?.error) throw new Error(`${what}: ${r.error.message}`); return r?.data; };

async function findUser(supa, email) {
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supa.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = (data?.users || []).find((u) => (u.email || '').toLowerCase() === email);
    if (hit) return hit;
    if ((data?.users || []).length < 1000) return null;
  }
  return null;
}

/**
 * Make sure every crew member exists and is set up. → Map(key → user id)
 *   supa: the service-role client; workspaceId: the Showcase workspace
 */
export async function ensureCrew(supa, { workspaceId, log = () => {} }) {
  const ids = new Map();
  for (const c of CREW) {
    const email = crewEmail(c.key);
    let user = await findUser(supa, email);
    if (!user) {
      const { data, error } = await supa.auth.admin.createUser({ email, email_confirm: true });
      if (error) throw new Error(`createUser ${c.key}: ${error.message}`);
      user = data.user;
      log(`crew: made ${c.name}`);
    }
    const id = user.id;
    // Internal and mail-free first, then named, then a member.
    must(await supa.from('internal_accounts').upsert({ user_id: id, reason: REASON }, { onConflict: 'user_id' }), 'internal_accounts');
    const prof = must(await supa.from('profiles').select('notification_prefs').eq('user_id', id).maybeSingle(), 'profiles read');
    const prefs = { ...(prof?.notification_prefs || {}), ...NO_EMAIL };
    must(await supa.from('profiles').update({ notification_prefs: prefs }).eq('user_id', id), 'profiles prefs');
    must(await supa.from('member_profiles').upsert({ user_id: id, display_name: c.name, color: c.color }, { onConflict: 'user_id' }), 'member_profiles');
    const member = must(await supa.from('workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', id).maybeSingle(), 'member read');
    if (!member) must(await supa.from('workspace_members').insert({ workspace_id: workspaceId, user_id: id, role: 'editor' }), 'workspace_members');
    ids.set(c.key, id);
  }
  return ids;
}
