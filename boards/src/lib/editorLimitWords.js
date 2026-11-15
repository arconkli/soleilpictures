// editorLimitWords — the editor limit's sentences, read through Lingui.
// App only: editorLimit.js (the numbers, the stages, the ids and firstName's
// check of the English stand-ins) stays as it is, because gen-docs and the
// Playwright specs read it. This module says the same things keyed by the same
// ids; editorLimitWords.test.mjs holds the two English versions together.
//
// The stage logic is editorLimitStage()'s, imported, never copied.

import { t as tr, plural } from '@lingui/core/macro';
import { editorLimitStage, EDITOR_LIMIT } from './editorLimit.js';
import { formatDate } from './intlFormat.js';

// The note at the top of the share panel's invite area, or null when there is
// nothing to say. Same shape as editorLimitNote(): { stage, lead, body, seeWho, ask, done }.
export function editorLimitNote(cap, { ownerName = null, asked = false, canBuySeat = false } = {}) {
  const stage = editorLimitStage(cap);
  if (!stage || stage === 'room') return null;
  const { limit, taken } = cap;
  if (cap.subject === 'team') {
    const none = { seeWho: null, ask: null, done: null };
    if (stage === 'full') {
      return {
        stage, lead: tr`All ${limit} of the team’s seats are in use.`,
        body: !cap.isAccountOwner ? tr`Invite people to view. An admin of the team can add a seat.`
          : canBuySeat ? tr`Inviting someone to edit adds a seat.`
            : tr`Invite people to view, or add a seat on the team’s page.`,
        ...none,
      };
    }
    if (!cap.isAccountOwner) return null;
    const left = limit - taken;
    return {
      stage, lead: tr`${plural(left, { one: '# seat left on the team.', other: '# seats left on the team.' })}`,
      body: tr`Each person who can edit uses a seat. Viewers are free.`,
      ...none,
    };
  }
  if (cap.isAccountOwner) {
    if (stage === 'over') {
      return {
        stage, lead: plural(taken, {
          one: `# person can edit, and your plan has room for ${limit}.`,
          other: `# people can edit, and your plan has room for ${limit}.`,
        }),
        body: tr`Everyone keeps editing. Nobody new can edit until you’re under ${limit}.`,
        seeWho: 'button', ask: null, done: null,
      };
    }
    if (stage === 'full') {
      return {
        stage, lead: tr`No places left for people who can edit.`,
        body: tr`Your plan has room for ${limit}, across all your workspaces. Invite people to view, or make room.`,
        seeWho: 'button', ask: null, done: null,
      };
    }
    const left = limit - taken;
    return {
      stage, lead: tr`${plural(left, { one: '# place left for people who can edit.', other: '# places left for people who can edit.' })}`,
      body: tr`Your plan has room for ${limit}, across all your workspaces.`,
      seeWho: 'link', ask: null, done: null,
    };
  }
  if (stage === 'near') return null;
  // One whole sentence per case, so each language words "the owner" itself.
  if (ownerName) {
    return {
      stage,
      lead: tr`No places left for people who can edit.`,
      body: tr`${ownerName}’s plan has room for ${limit}. Invite people to view, or ask ${ownerName} to make room.`,
      seeWho: null,
      ask: asked ? null : tr`Ask ${ownerName} for room`,
      done: asked ? tr`We told ${ownerName} you’d like to add an editor.` : null,
    };
  }
  return {
    stage,
    lead: tr`No places left for people who can edit.`,
    body: tr`The owner’s plan has room for ${limit}. Invite people to view, or ask the owner to make room.`,
    seeWho: null,
    ask: asked ? null : tr`Ask the owner for room`,
    done: asked ? tr`We told the owner you’d like to add an editor.` : null,
  };
}

// A door's refusal (editorLimitRefusal) as one sentence for a toast.
export function editorLimitRefusalMessage(refusal, { ownerName = null, limit = EDITOR_LIMIT } = {}) {
  if (!refusal) return '';
  if (refusal.team) {
    return refusal.ask
      ? tr`All of the team’s seats are in use. Invite them to view, or ask an admin of the team for a seat.`
      : tr`All of the team’s seats are in use. Invite them to view, or add a seat on the team’s page.`;
  }
  if (!refusal.ask) {
    return tr`No places left for people who can edit: your plan has room for ${limit}. Invite them to view, or make room.`;
  }
  // One whole sentence per case, so each language words "the owner" itself.
  return ownerName
    ? tr`No places left for people who can edit: ${ownerName}’s plan has room for ${limit}. Invite them to view, or ask ${ownerName} to make room.`
    : tr`No places left for people who can edit: the owner’s plan has room for ${limit}. Invite them to view, or ask the owner to make room.`;
}

// A live notice as its toast says it: "title — body", except the person an
// edit link let in as a viewer, who reads two sentences. The title and body
// are the server's own words and stay as they came; only the frame is ours.
export function noticeToastText(n) {
  const title = String(n?.title ?? '');
  const body = String(n?.body ?? '');
  if (!body) return title;
  return n?.kind === 'editors.joined_as_viewer' ? tr`${title}. ${body}` : tr`${title} — ${body}`;
}

const MEMBER_ROLES_OWNING = ['coowner', 'owner'];

function grantPhrase(g) {
  const ws = g.workspace_name || tr`a workspace`;
  const boardName = g.board_name;
  const board = boardName ? tr`“${boardName}”` : tr`a cluster`;
  if (g.source === 'member') return MEMBER_ROLES_OWNING.includes(g.role) ? tr`Co-owner of ${ws}` : tr`Edits ${ws}`;
  if (g.source === 'share') return tr`Can edit ${board} in ${ws}`;
  return g.board_id ? tr`Invited to edit ${board} in ${ws}` : tr`Invited to edit ${ws}`;
}

const MEMBER_RANK = { owner: 0, coowner: 0, admin: 1, editor: 1 };
const grantRank = (g) => (g.source === 'member' ? (MEMBER_RANK[g.role] ?? 1) : g.source === 'share' ? 2 : 3);

// The line under a person in "People who can edit": where they can edit, the
// widest place first, and for a waiting invite when it went and what it holds.
export function accountEditorSub(row) {
  if (!row) return '';
  if (row.source === 'owner') { const email = row.email; return tr`${email} · every workspace`; }
  const grants = (row.grants || []).filter((g) => g && g.source !== 'owner')
    .slice().sort((a, b) => grantRank(a) - grantRank(b));
  if (grants.length === 0) return row.email || '';
  let s = grantPhrase(grants[0]);
  if (grants.length > 1) {
    const more = grants.length - 1;
    s = tr`${s}, and ${more} more`;
  }
  if (row.source === 'pending') {
    const sent = grants.map((g) => g.sent_at).filter(Boolean).sort()[0];
    if (sent) {
      const when = formatDate(new Date(sent));
      s = tr`${s} · sent ${when}`;
    }
    s = tr`${s} · holds a place until it’s accepted`;
  }
  return s;
}
