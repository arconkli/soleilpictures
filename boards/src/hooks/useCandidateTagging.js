// Shared client logic for in-context candidate-name discovery, used by BOTH
// the doc editor (DocPageEditor) and the note editor (NoteTiptapSurface).
//
// It owns the parts that are identical across editors:
//   - the candidate-name index (from useCandidateNames) + forcing the
//     ProseMirror plugin to repaint when that index identity changes,
//   - the tap-prompt state (which candidate the user is deciding on),
//   - promote (ensureTag + tags.entity_type, then an editor-specific apply)
//     and dismiss (workspace-wide entity_ignore_terms tombstone).
//
// What differs between editors is ONLY how a promoted tag is attached to the
// thing you tapped in — a doc pins the exact span (tagDocRange), a note tags
// the card (tagCard). That's injected as `applyPromotedTag`.
//
//   editorRef        — ref to the Tiptap editor (for the force-repaint dispatch)
//   workspaceId, userId
//   applyPromotedTag(tag, candidate) — optional async; best-effort editor apply.
//       Return truthy if it attached the tag (drives the `applied` analytic).
//   notify({type,message}) — optional toast callback.
//
// Returns { candidateIndexRef, candidatePrompt, setCandidatePrompt,
//           candidateBusy, promoteCandidate, dismissCandidate }.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useCandidateNames } from './useCandidateNames.js';
import { ensureTag, setTagEntityType } from '../lib/tagsApi.js';
import { entityTypeLabel } from '../lib/entityTypes.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { CANDIDATE_NAME_KEY } from '../components/docExtensions/CandidateNamePlugin.js';

export function useCandidateTagging({ editorRef, workspaceId, userId, applyPromotedTag, notify }) {
  const { index: candidateIndex } = useCandidateNames(workspaceId);
  const candidateIndexRef = useRef(candidateIndex);
  useEffect(() => {
    candidateIndexRef.current = candidateIndex;
    const ed = editorRef?.current;
    if (ed?.view) {
      ed.view.dispatch(ed.state.tr.setMeta(CANDIDATE_NAME_KEY, { changed: true }));
    }
  }, [candidateIndex]);

  // Which candidate the in-context prompt is open on: { anchor, name, count, sample, el }.
  const [candidatePrompt, setCandidatePrompt] = useState(null);
  const [candidateBusy, setCandidateBusy] = useState(false);

  const promoteCandidate = async (entityType) => {
    const c = candidatePrompt;
    if (!c || !workspaceId) return;
    setCandidateBusy(true);
    let applied = false;
    try {
      const tag = await ensureTag({ workspaceId, name: c.name, kind: 'user', createdBy: userId || null });
      if (tag?.id && entityType) {
        try { await setTagEntityType(tag.id, entityType); } catch (_) {}
      }
      if (tag?.id && applyPromotedTag) {
        try { applied = !!(await applyPromotedTag(tag, c)); } catch (_) {}
      }
      try { logEvent(EV.TAG_CANDIDATE_PROMOTE, { entity_type: entityType, count: c.count || 0, applied }); } catch (_) {}
      notify?.({ type: 'success', message: `“${c.name}” is now a ${(entityTypeLabel(entityType) || 'tag').toLowerCase()}` });
    } catch (err) {
      notify?.({ type: 'error', message: 'Could not create tag: ' + (err?.message || err) });
    } finally {
      setCandidateBusy(false);
      setCandidatePrompt(null);
      // It's no longer a candidate — refresh this editor (and any others).
      document.dispatchEvent(new CustomEvent('soleil-candidates-changed'));
    }
  };

  const dismissCandidate = async () => {
    const c = candidatePrompt;
    if (!c || !workspaceId) return;
    setCandidateBusy(true);
    try {
      await supabase.from('entity_ignore_terms').insert({
        workspace_id: workspaceId,
        scope: 'workspace',
        scope_id: null,
        term: c.name,
        created_by: userId || null,
      });
    } catch (err) {
      // Unique violation (already dismissed) is fine; surface anything else.
      if (err?.code && err.code !== '23505') {
        notify?.({ type: 'error', message: 'Could not dismiss: ' + (err?.message || err) });
      }
    } finally {
      try { logEvent(EV.TAG_CANDIDATE_DISMISS, { count: c.count || 0 }); } catch (_) {}
      setCandidateBusy(false);
      setCandidatePrompt(null);
      document.dispatchEvent(new CustomEvent('soleil-candidates-changed'));
    }
  };

  return {
    candidateIndexRef,
    candidatePrompt, setCandidatePrompt,
    candidateBusy,
    promoteCandidate, dismissCandidate,
  };
}
