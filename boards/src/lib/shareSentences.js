// shareSentences — a sharing fact as a sentence, for the admin's feeds.
//
//   ledgerSentence(row)  one row of 0745's admin_sharing_recent
//                        ("Maya copied the view link to “Pitch deck”")
//   eventSentence(row)   one live event with 0747's facts (admin_event_words),
//                        or null when the event isn't a sharing one
//
// Text only, so it is node-tested and the Universe (whose captions stay
// nameless) never needs it. A missing title reads "an untitled cluster", a
// deleted one "a deleted cluster", and titles are clipped at 40 characters.

import { ROUTES, titleOf } from './shareRoutes.js';

// The shortest name a feed can use: a display name, else the address's local
// part (an invitation's masked address stays as it is).
export function shortName(p, fallback = 'Someone') {
  if (!p) return fallback;
  if (p.name) return p.name;
  const e = p.email || '';
  if (!e) return fallback;
  return e.includes('•') ? e : e.split('@')[0];
}

const q = (o, kind) => {
  const t = titleOf(o, kind);
  return /^(an? |a deleted |an untitled |an unknown )/.test(t) ? t : `“${t}”`;
};
const linkWord = (route) => (route === 'edit_link' ? 'edit link' : route === 'view_link' ? 'view link'
  : route === 'workspace_link' ? 'workspace link' : route === 'referral_link' ? 'referral link'
  : route === 'file_share' ? 'file link' : route === 'explore' ? 'Explore page' : (ROUTES[route]?.short ?? 'share'));
const possessive = (name) => (name.endsWith('s') ? `${name}’` : `${name}’s`);

export function ledgerSentence(r) {
  if (!r || !r.fact) return null;
  const by = shortName(r.sharer);
  const to = shortName(r.recipient, 'someone');
  const obj = r.object ? q(r.object) : null;
  const on = obj ? ` to ${obj}` : '';
  const theirs = r.sharer ? `${possessive(by)} ` : 'a ';
  switch (r.fact) {
    case 'shared':
      switch (r.route) {
        case 'view_link': return `${by} made a view link${on}`;
        case 'edit_link': return `${by} made an edit link${on}`;
        case 'email_invite': return `${by} invited ${to}${on}`;
        case 'direct_share': return `${by} shared ${obj ?? 'a cluster'} with ${to}`;
        case 'workspace_add': return r.sharer ? `${by} added ${to} to ${obj ?? 'a workspace'}` : `${to} was added to ${obj ?? 'a workspace'} (who added them isn’t recorded)`;
        case 'workspace_link': return `${by} shared the workspace link${on}`;
        case 'file_share': return `${by} shared the file ${obj ?? 'a file'}${r.recipient ? ` with ${to}` : ''}`;
        case 'explore': return `${by} published ${obj ?? 'a cluster'} on Explore`;
        case 'referral_link': return `${by} shared a referral link`;
        default: return `${by} shared ${obj ?? 'something'}`;
      }
    case 'opened_panel': return `${by} opened the Share panel${obj ? ` on ${obj}` : ''}`;
    case 'copied': return `${by} copied the ${linkWord(r.route)}${on}`;
    case 'viewed': return `${obj ? `${obj.charAt(0).toUpperCase()}${obj.slice(1)}` : 'A cluster'} was opened through ${theirs}${linkWord(r.route)}`;
    case 'joined': return `${to} got into ${obj ?? 'it'} through ${theirs}${linkWord(r.route)}`;
    case 'new_account': return `${to} signed up through ${theirs}${linkWord(r.route)}${on}`;
    case 'made_something': return `${to}${r.sharer ? `, brought in by ${by},` : ''} made something`;
    case 'co_created': return `${to} is co-creating in ${r.sharer ? `${possessive(by)} ` : ''}${obj ?? 'a cluster'}`;
    case 'remixed': return `${to} remixed ${obj ?? 'a cluster'}${r.sharer ? ` from ${by}` : ''}`;
    default: return null;
  }
}

// A live event, in words. `r` is admin_event_words' row: event, email,
// actor_name, facts { board_title, board_deleted, owner_name, insider,
// file_title, kind, surface, role, how, link_kind, n, ... }.
export function eventSentence(r) {
  if (!r || !r.event) return null;
  const f = r.facts || {};
  if (!f || typeof f !== 'object' || !Object.keys(f).length) return null;
  const who = r.actor_name || (r.email ? r.email.split('@')[0] : null);
  const actor = who || 'Someone';
  const board = f.board_id || f.board_title != null
    ? q({ kind: 'cluster', title: f.board_title, deleted: f.board_deleted })
    : null;
  const on = board ? ` to ${board}` : '';
  const owner = f.owner_name && !f.insider ? f.owner_name : null;
  const kindLink = f.kind === 'invite' || f.link_kind === 'invite' ? 'edit link'
    : f.kind === 'view' || f.link_kind === 'view' ? 'view link'
    : f.link_kind === 'public' ? 'public page' : 'link';
  switch (r.event) {
    case 'share_open': return `${actor} opened the Share panel${board ? ` on ${board}` : ''}`;
    case 'share_link_copied': return `${actor} copied the ${kindLink}${on}`;
    case 'share_link_created': return `${actor} made a ${kindLink}${on}`;
    case 'share_access_changed': return `${actor} changed who can open ${board ?? 'a cluster'}`;
    case 'share_ask_taken': return `${actor} took up the nudge to share${board ? ` ${board}` : ''}`;
    case 'access_granted': return f.how === 'workspace'
      ? `${actor} added someone to the workspace${f.workspace_name ? ` “${f.workspace_name}”` : ''}`
      : `${actor} gave someone access${on}`;
    case 'co_creation_started': return `${actor} started co-creating in ${owner ? `${possessive(owner)} ` : ''}${board ?? 'a cluster'}`;
    case 'share_view':
      if (f.insider) return `${actor} opened their own ${kindLink}${on}`;
      return `${who ? actor : 'Someone'} opened ${owner ? `${possessive(owner)} ` : 'the '}${kindLink}${on}`;
    case 'share_cta_click': return `${who ? actor : 'A visitor'} clicked through from ${board ?? 'a shared cluster'}`;
    case 'invite_sent': return `${actor} sent ${Number(f.n) > 1 ? `${f.n} invitations` : 'an invitation'}${on}`;
    case 'invite_link_created': return `${actor} made an invite link${on}`;
    case 'invite_link_view': return `${who ? actor : 'Someone'} opened the invite link${on}`;
    case 'invite_link_join_click': return `${who ? actor : 'Someone'} clicked Join${board ? ` on ${board}` : ''}`;
    case 'invite_link_claimed': return `${actor} joined ${board ?? 'a cluster'} through the invite link`;
    case 'file_share_open': return `${actor} opened sharing on a file`;
    case 'file_share_access_set': return `${actor} changed who can open a file`;
    case 'file_share_people_add': return `${actor} shared a file with ${Number(f.n) > 1 ? `${f.n} people` : 'someone'}`;
    case 'file_share_link_copy': return `${actor} copied a file link`;
    case 'file_share_view': return `${who ? actor : 'Someone'} opened the shared file${f.file_title ? ` “${titleOf({ kind: 'file', title: f.file_title })}”` : ''}`;
    case 'file_share_download': return `${who ? actor : 'Someone'} downloaded a shared file`;
    case 'file_share_stop': return `${actor} stopped sharing a file`;
    case 'shared_file_open': return `${actor} opened a file shared with them`;
    case 'shared_file_save': return `${actor} saved a shared file to their own`;
    case 'workspace_link_shared': return `${actor} shared the workspace link`;
    case 'joiner_landed': return `${actor} landed in a workspace they joined`;
    case 'team_joined': return `${actor} joined a team`;
    case 'referral_link_copied': return `${actor} copied their referral link`;
    case 'referral_link_shared': return `${actor} shared their referral link`;
    case 'remix_clone': return `${actor} remixed ${board ?? 'a cluster'}`;
    default: return null;
  }
}
