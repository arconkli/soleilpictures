// AccountEditorsCard — Settings › Members › "People who can edit": everyone
// who can edit anything in the account, against the plan's 10 (the owner's
// pick B, 2026-10-21). The account's owner sees who holds each place and can
// free one: Make viewer keeps the person in, Remove takes them out, Revoke
// cancels a waiting invite. A co-owner sees the count alone:
// list_my_account_editors is the owner's.
//
// Access changes ask first, as Members' Remove does; they aren't content
// deletes, so there is no undo toast.
import { useEffect, useState } from 'react';
import { SettingsCategory } from './fields.jsx';
import { useFeedback } from '../AppFeedback.jsx';
import { pickPresenceColor } from '../../lib/presenceColor.js';
import {
  setWorkspaceMemberRole, shareBoard, removeWorkspaceMember, unshareBoard, revokePendingInvite,
} from '../../lib/boardsApi.js';
import { editorLimitStage, makeViewerOps, removeOps, revokeOps } from '../../lib/editorLimit.js';
import { accountEditorSub } from '../../lib/editorLimitWords.js';
import { logEvent } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { initialOf } from '../../lib/graphemes.js';
import { t, ph } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

const exampleTitle = () => t`An example person, for the preview`;

const RUN = {
  member_role: (o) => setWorkspaceMemberRole({ workspaceId: o.workspaceId, userId: o.userId, role: o.role }),
  share_role: (o) => shareBoard({ boardId: o.boardId, email: o.email, role: o.role }),
  unshare: (o) => unshareBoard({ boardId: o.boardId, userId: o.userId }),
  remove_member: (o) => removeWorkspaceMember({ workspaceId: o.workspaceId, userId: o.userId }),
  revoke: (o) => revokePendingInvite(o.inviteId),
};

export function AccountEditorsCard({ cap, editors = [], ownerName = null, selfId = null, onChanged, previewing = false }) {
  const feedback = useFeedback();
  const [busy, setBusy] = useState(null);   // the slot_key whose change is running
  const owner = !!cap?.isAccountOwner;

  useEffect(() => {
    try { logEvent(EV.EDITOR_LIMIT_SEEN, { surface: 'members', stage: editorLimitStage(cap), owner }); } catch (_) {}
    // Once a mount: what the card read when it opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const desc = owner
    ? t`Across all your workspaces. Your plan has room for ${ph({ limit: cap.limit })}, and viewers don’t count. Making someone a viewer frees their place and keeps them in.`
    : ownerName
      ? t`Across all of ${ph({ owner: ownerName })}’s workspaces. ${ph({ owner: ownerName })}’s plan has room for ${ph({ limit: cap.limit })}, and viewers don’t count.`
      : t`Across all of the owner’s workspaces. The owner’s plan has room for ${ph({ limit: cap.limit })}, and viewers don’t count.`;

  const nameOf = (row) => row.display_name || row.email || t`Someone`;

  const run = async (row, action, ops, done) => {
    setBusy(row.slot_key);
    let failed = 0;
    for (const o of ops) {
      try { await RUN[o.op](o); } catch (e) { failed += 1; console.warn(`[editors] ${o.op} failed`, e); }
    }
    setBusy(null);
    try { logEvent(EV.EDITOR_LIMIT_MAKE_ROOM, { action, ok: failed === 0, grants: ops.length }); } catch (_) {}
    feedback.toast(failed === 0
      ? { type: 'success', message: done }
      : { type: 'warning', message: t`Some of that didn’t go through. Try again.`, ttl: 8000 });
    await onChanged?.();
  };

  const makeViewer = async (row) => {
    const who = nameOf(row);
    const ok = await feedback.confirm({
      title: t`Make ${who} a viewer?`,
      message: t`They’ll still open everything they can now, but they won’t be able to change anything. Their place frees up.`,
      confirmLabel: t`Make viewer`,
    });
    if (!ok) return;
    run(row, 'make_viewer', makeViewerOps(row), `${who} can view now. Their place is free.`);
  };

  const remove = async (row) => {
    const who = nameOf(row);
    const ok = await feedback.confirm({
      title: t`Remove ${who}?`,
      message: t`They’ll lose access to everything they can edit in your workspaces. Anything they can only view stays as it is.`,
      confirmLabel: t`Remove`,
      danger: true,
    });
    if (!ok) return;
    run(row, 'remove', removeOps(row), `Removed ${who}.`);
  };

  // Same words as Members' own Revoke.
  const revoke = async (row) => {
    const ok = await feedback.confirm({
      title: t`Revoke invite to ${ph({ email: row.email })}?`,
      message: t`They'll no longer get access if they sign up.`,
      confirmLabel: t`Revoke`,
      danger: true,
    });
    if (!ok) return;
    run(row, 'revoke', revokeOps(row), `Revoked the invite to ${row.email}.`);
  };

  return (
    <SettingsCategory title={t`People who can edit`} aside={t`${ph({ taken: cap.taken })} of ${ph({ limit: cap.limit })}`} desc={desc}>
      {owner && (
        <ul className="settings-editor-list">
          {editors.map((row) => {
            const pending = row.source === 'pending';
            const name = nameOf(row);
            return (
              <li key={row.slot_key} className={`settings-editor-row${busy === row.slot_key ? ' is-busy' : ''}`}>
                <span className={`settings-editor-av${pending ? ' is-neutral' : ''}`}
                      style={pending ? undefined : { background: pickPresenceColor(row.user_id || row.email) }}
                      aria-hidden="true">{initialOf(name, '')}</span>
                <span className="settings-editor-who">
                  <span className="settings-editor-name">{name}{row.user_id && row.user_id === selfId ? t` (you)` : ''}</span>
                  <span className="settings-editor-sub">{accountEditorSub(row)}</span>
                </span>
                {row.source === 'owner' ? (
                  <span className="settings-editor-role"><Trans>Owner</Trans></span>
                ) : (
                  <span className={`settings-editor-acts${pending ? ' is-pending' : ''}`}>
                    {pending ? (
                      <button type="button" className="settings-link-btn" disabled={!!busy}
                              onClick={() => revoke(row)}><Trans>Revoke</Trans></button>
                    ) : (
                      <>
                        <button type="button" className="settings-link-btn" disabled={!!busy || !!row.preview}
                                title={row.preview ? exampleTitle() : undefined}
                                onClick={() => makeViewer(row)}><Trans>Make viewer</Trans></button>
                        <button type="button" className="settings-link-btn is-danger" disabled={!!busy || !!row.preview}
                                title={row.preview ? exampleTitle() : undefined}
                                onClick={() => remove(row)}><Trans>Remove</Trans></button>
                      </>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {previewing && (
        <p className="settings-section-hint"><Trans>Preview: pretend numbers and example people, only you see them. Settings › Preview turns it off.</Trans></p>
      )}
    </SettingsCategory>
  );
}
