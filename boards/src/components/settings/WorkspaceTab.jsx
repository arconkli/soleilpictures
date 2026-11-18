// The shared half of the panel — the two tabs under "This workspace".
//
// General is what the workspace IS: its name and icon. Those were in two
// different places before (name behind the switcher popover's ⋯ menu, icon
// buried inside the defaults tab), which is most of why the panel felt
// arbitrary. Card defaults is what new cards START as, which is a genuinely
// different question and keeps its own tab.
//
// Editable by workspace editors, co-owners and owners; viewers see the values
// for context but the inputs are disabled. Naming and the icon belong to the
// owner and co-owners (0391/0392 enforce it server-side); Recovery stays the
// owner's alone — it rewinds every cluster at once.
import { useEffect, useState } from 'react';
import { updateWorkspaceSettings, renameWorkspace, getWorkspaceAiEnabled, setWorkspaceAiEnabled } from '../../lib/boardsApi.js';
import { announceAiSettingChanged } from '../../hooks/useWorkspaceAiEnabled.js';
import { uploadImage } from '../../lib/uploads.js';
import { pickPresenceColor } from '../../lib/presenceColor.js';
import { useFeedback } from '../AppFeedback.jsx';
import { HARDCODED_FALLBACKS } from '../../hooks/useResolvedDefaults.js';
import { SHAPES, DASH_STYLES } from '../../lib/shapeOptions.js';
import { Field, SettingsCategory, SwatchInput, FontField, AvatarUploadRow, Toggle } from './fields.jsx';
import { useSettingsSave } from './saveState.jsx';
import { canManageWorkspace, canWriteWorkspace } from '../../lib/workspaceRoles.js';
import { isComposingKey } from '../../lib/composerKeys.js';
import { initialOf } from '../../lib/graphemes.js';
import { t, ph } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { shownError } from '../../lib/errorWords.js';

const ROLE_COPY = {
  get owner()   { return t`Owner — you can rename it, change the icon, and delete it.`; },
  get coowner() { return t`Co-owner — you can rename it and change the icon. Only the owner can delete it or hand it over.`; },
  get editor()  { return t`Editor — you can change what new cards start as, but not the name or icon.`; },
  get viewer()  { return t`Viewer — you can see these settings but not change them.`; },
};

export function WorkspaceGeneralTab({
  workspaceId, workspaceName, user, role, workspaceSettings,
  refresh, onWorkspacesChanged, onOpenRecovery,
}) {
  const feedback = useFeedback();
  const save = useSettingsSave();
  const isOwner = role === 'owner';
  const canManage = canManageWorkspace(role);

  // Name is a text field, so it holds a draft and commits on blur/Enter
  // rather than per keystroke. Re-seeds when the active workspace changes
  // underneath (switching workspaces with the panel open).
  const [name, setName] = useState(workspaceName || '');
  useEffect(() => { setName(workspaceName || ''); }, [workspaceName, workspaceId]);

  const commitName = () => {
    const trimmed = name.trim();
    if (!canManage || !workspaceId) return;
    if (!trimmed) { setName(workspaceName || ''); return; }
    if (trimmed === (workspaceName || '')) return;
    save(async () => {
      await renameWorkspace(workspaceId, trimmed);
      await onWorkspacesChanged?.();
    });
  };

  // The workspace's AI switch. Everyone sees it; the owner and co-owners
  // change it. null while loading.
  const [aiOn, setAiOn] = useState(null);
  useEffect(() => {
    let alive = true;
    setAiOn(null);
    if (workspaceId) {
      getWorkspaceAiEnabled(workspaceId)
        .then((v) => { if (alive) setAiOn(v); })
        .catch(() => { if (alive) setAiOn(null); });
    }
    return () => { alive = false; };
  }, [workspaceId]);
  const changeAi = (next) => {
    if (!canManage || !workspaceId || aiOn === null) return;
    setAiOn(next);
    save(async () => {
      try {
        await setWorkspaceAiEnabled(workspaceId, next);
      } catch (err) {
        setAiOn(!next);
        throw err;
      }
      announceAiSettingChanged(workspaceId);
    });
  };

  // Workspace icon upload — top-level key on workspaces.settings so the
  // sidebar can read it from the workspace row without an extra query.
  // Owner / co-owner edit; everyone else sees the section read-only so the
  // icon is at least visible.
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const iconSrc = workspaceSettings?.icon_url || '';
  const setIcon = async (nextSrc) => {
    if (!canManage || !workspaceId) return;
    await save(async () => {
      await updateWorkspaceSettings(workspaceId, { icon_url: nextSrc || null });
      await refresh?.();
      await onWorkspacesChanged?.();
    });
  };
  const onIconPick = async (file) => {
    if (!file || !workspaceId || !user?.id) return;
    setUploadingIcon(true);
    try {
      const { src } = await uploadImage({
        file, workspaceId, boardId: null, userId: user.id,
      });
      await setIcon(src);
    } catch (err) {
      feedback.toast({ type: 'error', code: 'workspace_icon_failed', message: t`Upload failed: ${ph({ reason: shownError(err) })}` });
    } finally {
      setUploadingIcon(false);
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title"><Trans>General</Trans></h3>
      <p className="settings-section-hint">
        {ROLE_COPY[role] || t`These settings belong to the workspace, not to you — everyone in it sees the same values.`}
      </p>

      <SettingsCategory title={t`Identity`} desc={t`Shows in the sidebar and the workspace switcher`}>
        <Field label={t`Name`}>
          <input className="settings-input" dir="auto"
                 value={name}
                 placeholder={t`e.g. Soleil Studio`}
                 disabled={!canManage}
                 onChange={(e) => setName(e.target.value)}
                 onBlur={commitName}
                 onKeyDown={(e) => {
                   if (isComposingKey(e)) return;
                   if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                   if (e.key === 'Escape') { e.preventDefault(); setName(workspaceName || ''); }
                 }} />
        </Field>
        <Field label={t`Icon`}>
          <AvatarUploadRow
            src={iconSrc}
            fallbackColor={pickPresenceColor(workspaceId || '')}
            fallbackInitial={initialOf(name || workspaceName)}
            uploading={uploadingIcon}
            disabled={!canManage}
            shape="square"
            onPick={onIconPick}
            onRemove={() => setIcon('')}
          />
        </Field>
      </SettingsCategory>

      <SettingsCategory title={t`AI`} desc={t`What may go to an AI model`}>
        {canManage ? (
          <Toggle label={t`AI for pictures and search`}
                  desc={t`Describes the pictures people add, so search finds them by what's in them and More like this finds similar ones, and translates searches typed in another language. A small copy of each picture and those searches go to Cloudflare Workers AI. Off, Clusters sends nothing and picture descriptions are deleted.`}
                  value={aiOn !== false}
                  onChange={changeAi} />
        ) : (
          <Field label={t`AI for pictures and search`}>
            <span className="settings-toggle-desc">
              {aiOn === null ? t`… · only the owner or a co-owner can change this`
                : aiOn ? t`On · only the owner or a co-owner can change this`
                  : t`Off · only the owner or a co-owner can change this`}
            </span>
          </Field>
        )}
      </SettingsCategory>

      {isOwner && onOpenRecovery && (
        <SettingsCategory
          title={t`Recovery`}
          desc={t`Rewinds every cluster in this workspace at once — for after an accidental mass-delete. The pre-rewind state is kept, so the rewind itself is reversible.`}>
          <button type="button" className="settings-link-btn" onClick={onOpenRecovery}>
            <Trans>Open recovery →</Trans>
          </button>
        </SettingsCategory>
      )}
    </div>
  );
}

export function CardDefaultsTab({ workspaceId, role, workspaceSettings, refresh }) {
  const save = useSettingsSave();
  const canEdit = canWriteWorkspace(role) && role !== 'service';
  const disabled = !canEdit;

  // What we have written but not yet seen come back. merge_workspace_settings
  // replaces a whole top-level category (`settings || patch`), so a patch built
  // from the last FETCHED value silently drops any change made since — change
  // the shape and then the line style before the refetch lands and the shape
  // reverts. Cleared whenever a new workspaceSettings object arrives, which is
  // the moment the server value becomes authoritative again.
  const [local, setLocal] = useState({});
  useEffect(() => { setLocal({}); }, [workspaceSettings]);
  const cat = (name) => local[name] || workspaceSettings[name] || {};

  const setKey = (name, key, value) => savePatch(name, { [key]: value });
  const savePatch = (name, patch) => {
    if (!canEdit || !workspaceId) return;
    const merged = { ...cat(name), ...patch };
    // Prune empties so the hardcoded fallback shines through.
    for (const k of Object.keys(merged)) {
      if (merged[k] === null || merged[k] === undefined || merged[k] === '') delete merged[k];
    }
    setLocal((prev) => ({ ...prev, [name]: merged }));
    save(async () => {
      await updateWorkspaceSettings(workspaceId, { [name]: merged });
      refresh?.();
    });
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title"><Trans>Card defaults</Trans></h3>
      <p className="settings-section-hint">
        <Trans>These set the starting look of every new card on this workspace.</Trans>{' '}
        {canEdit
          ? t`Anything you create now will pick these up; existing cards aren’t changed.`
          : t`You have viewer access — only editors, co-owners and owners can change them.`}
      </p>

      {/* NOTES */}
      <SettingsCategory title={t`Notes`} desc={t`When you create a sticky note`}>
        <Field label={t`Background`}>
          <SwatchInput
            value={cat('note').bgColor ?? null}
            fallback={HARDCODED_FALLBACKS.note.bgColor}
            disabled={disabled}
            onChange={(v) => setKey('note', 'bgColor', v)} />
        </Field>
        <Field label={t`Text color`}>
          <SwatchInput
            value={cat('note').textColor ?? null}
            fallback={HARDCODED_FALLBACKS.note.textColor}
            disabled={disabled}
            onChange={(v) => setKey('note', 'textColor', v)} />
        </Field>
        <Field label={t`Font`}>
          <FontField value={cat('note').fontFamily ?? null}
                     disabled={disabled}
                     onChange={(v) => setKey('note', 'fontFamily', v)} />
        </Field>
        <Field label={t`Font size`}>
          <input type="number" min="8" max="36"
                 className="settings-input"
                 placeholder="12.5"
                 value={cat('note').fontSize ?? ''}
                 disabled={disabled}
                 onChange={(e) => {
                   const v = e.target.value;
                   setKey('note', 'fontSize', v === '' ? null : Number(v));
                 }} />
        </Field>
      </SettingsCategory>

      {/* BOARDS */}
      <SettingsCategory title={t`Clusters`} desc={t`When you create a new cluster`}>
        <Field label={t`Default view`}>
          <select className="settings-input"
                  value={cat('board').view ?? 'canvas'}
                  disabled={disabled}
                  onChange={(e) => setKey('board', 'view', e.target.value)}>
            <option value="canvas">{t`Board`}</option>
            <option value="list">{t`Files`}</option>
          </select>
        </Field>
      </SettingsCategory>

      {/* DOCS */}
      <SettingsCategory title={t`Docs`} desc={t`When you create a new doc`}>
        <Field label={t`Font`}>
          <FontField value={cat('doc').fontFamily ?? null}
                     disabled={disabled}
                     onChange={(v) => setKey('doc', 'fontFamily', v)} />
        </Field>
      </SettingsCategory>

      {/* SHAPES. Kind and line style are read by the add-shape mutator exactly
          like stroke/fill/width below — they just never had a control, so the
          workspace could set three of the five things a new shape starts as. */}
      <SettingsCategory title={t`Shapes`} desc={t`When you draw a shape`}>
        <Field label={t`Shape`}>
          <select className="settings-input"
                  value={cat('shape').shape ?? HARDCODED_FALLBACKS.shape.shape}
                  disabled={disabled}
                  onChange={(e) => setKey('shape', 'shape', e.target.value)}>
            {SHAPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        <Field label={t`Stroke`}>
          <SwatchInput
            value={cat('shape').stroke ?? null}
            fallback={HARDCODED_FALLBACKS.shape.stroke}
            disabled={disabled}
            onChange={(v) => setKey('shape', 'stroke', v)} />
        </Field>
        <Field label={t`Fill`}>
          <SwatchInput
            value={cat('shape').fill ?? null}
            fallback={HARDCODED_FALLBACKS.shape.fill}
            allowTransparent
            disabled={disabled}
            onChange={(v) => setKey('shape', 'fill', v)} />
        </Field>
        <Field label={t`Stroke width`}>
          <input type="number" min="1" max="12"
                 className="settings-input"
                 value={cat('shape').strokeWidth ?? HARDCODED_FALLBACKS.shape.strokeWidth}
                 disabled={disabled}
                 onChange={(e) => setKey('shape', 'strokeWidth', Number(e.target.value) || 2)} />
        </Field>
        <Field label={t`Line style`}>
          <select className="settings-input"
                  value={cat('shape').dash ?? HARDCODED_FALLBACKS.shape.dash}
                  disabled={disabled}
                  onChange={(e) => setKey('shape', 'dash', e.target.value)}>
            {DASH_STYLES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </Field>
      </SettingsCategory>
    </div>
  );
}
