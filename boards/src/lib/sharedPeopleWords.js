// sharedPeopleWords — the words for shared workspaces and clusters, by person.
// Lingui inside functions only. The matching and grouping are in sharedPeople.js.

import { t, ph } from '@lingui/core/macro';
import { isUnnamedWorkspace } from './sharedPeople.js';

const named = (s) => typeof s === 'string' && s.trim() !== '';

export function isOwnWorkspace(ws, selfId) {
  return ws?._myRole === 'owner' || !!(selfId && ws?.created_by === selfId);
}

export function titleNamesOwner(ws, { ownerName, isOwn } = {}) {
  return !isOwn && named(ownerName) && isUnnamedWorkspace(ws?.name);
}

export function workspaceTitle(ws, { ownerName = null, isOwn = false } = {}) {
  if (titleNamesOwner(ws, { ownerName, isOwn })) {
    const owner = ownerName.trim();
    return t`${ph({ owner })}'s workspace`;
  }
  const name = typeof ws?.name === 'string' ? ws.name.trim() : '';
  return name || t`Workspace`;
}

// What a workspace's tile takes its letter from: the owner's name when the
// title is theirs ("Рабочее пространство: Sam Lee" still shows S), else the title.
export function workspaceTileName(ws, { ownerName = null, isOwn = false } = {}) {
  return titleNamesOwner(ws, { ownerName, isOwn }) ? ownerName.trim() : workspaceTitle(ws, { ownerName, isOwn });
}

export function workspaceOwnerLine(ws, { ownerName = null, isOwn = false, role = null } = {}) {
  if (isOwn) return null;
  const coowner = role === 'coowner';
  if (titleNamesOwner(ws, { ownerName, isOwn })) {
    return coowner ? t`Shared with you · you co-own it` : t`Shared with you`;
  }
  if (named(ownerName)) {
    const owner = ownerName.trim();
    return coowner ? t`Owned by ${ph({ owner })} · you co-own it` : t`Owned by ${ph({ owner })}`;
  }
  return coowner ? t`You co-own this` : t`Shared with you`;
}

// "From Sam Lee"; the workspace's name when the sharer is unknown.
export function sharedGroupHead(group) {
  const name = named(group?.personName) ? group.personName.trim()
    : (named(group?.workspaceName) ? group.workspaceName.trim() : t`Workspace`);
  return t`From ${ph({ name })}`;
}
