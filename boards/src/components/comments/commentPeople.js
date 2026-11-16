import { useEffect, useMemo, useReducer, useState } from 'react';
import * as userProfiles from '../../lib/userProfiles.js';
import { listWorkspaceMembers, listBoardShares, listInheritedBoardShares } from '../../lib/boardsApi.js';
import { createPeopleCache } from '../../lib/commentPeopleCache.js';
import { mentionCandidates } from '../../lib/commentCardPlace.js';

// Who "@" offers in a comment on this cluster: the people who can see it.
// The workspace's members, the people it is shared with (an editor may list
// those; a viewer's list is the members and whoever has written here), and
// the authors of its comments. Loaded the first time a conversation opens.
//
// The lists are kept for as long as this cluster is the one open (the card
// is mounted afresh on every press, and would otherwise ask again each time):
// one ask per workspace : cluster : may-edit, dropped when the cluster changes.
// A list that could not be fetched is not kept, so the next open asks again.
const peopleCache = createPeopleCache();
export function useCommentPeople({ workspaceId, boardId, comments, meId, canEdit = false, enabled = false }) {
  const key = `${workspaceId || ''}:${boardId || ''}:${canEdit ? 1 : 0}`;
  const [lists, setLists] = useState(() => ({ key, ...(peopleCache.peek(boardId, key) || { key: null, members: [], shares: [] }) }));
  const [tick, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => userProfiles.subscribe(bump), []);
  const have = lists.key === key;
  useEffect(() => {
    if (!enabled || !boardId || have) return undefined;
    let off = false;
    peopleCache.get(boardId, key, async () => {
      let ok = true;
      const quiet = (fn) => Promise.resolve().then(fn).then((v) => v || [], () => { ok = false; return []; });
      const [members, own, inherited] = await Promise.all([
        quiet(() => listWorkspaceMembers(workspaceId)),
        canEdit ? quiet(() => listBoardShares(boardId)) : [],
        canEdit ? quiet(() => listInheritedBoardShares(boardId)) : [],
      ]);
      return { value: { members, shares: [...own, ...inherited] }, keep: ok };
    }).then((v) => {
      if (!off) setLists({ key, ...v });
    });
    return () => { off = true; };
  }, [enabled, boardId, workspaceId, canEdit, key, have]);
  return useMemo(() => {
    const authors = [...new Set((comments || []).map((r) => r && r.author).filter(Boolean))];
    return mentionCandidates({
      members: have ? lists.members : [],
      shares: have ? lists.shares : [],
      authors, meId,
      nameOf: (id) => {
        const p = userProfiles.resolve(id);
        return p ? { name: p.name || null, email: p.email || null, avatar: p.avatar_url || p.avatar || null, color: p.color || null } : null;
      },
    });
    // tick: a name arrived in the profile cache
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, have, comments, meId, tick]);
}
