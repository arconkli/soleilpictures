// One answer to "may this workspace's content go to an AI model?".
//
// Off when the workspace's owner turned AI suggestions off (Settings →
// Workspace, workspaces.ai_tagger_enabled) or this browser opted out
// (lib/aiTaggerFlag.js). Every client path that sends card or doc text to a
// model asks this first: the embedding tagger, the doc paragraph cascade, the
// doc mention verdicts and the candidate-name classifier. Before, only the
// embedding tagger read the workspace switch, so an opted-out workspace's
// docs still went to the models.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { isAiTaggerEnabled } from '../lib/aiTaggerFlag.js';

export const AI_SETTING_CHANGED = 'soleil-ai-setting-changed';

const cache = new Map(); // workspaceId → Promise<boolean>

export function readWorkspaceAiEnabled(workspaceId) {
  if (!workspaceId || !supabase) return Promise.resolve(false);
  if (!isAiTaggerEnabled()) return Promise.resolve(false);
  if (!cache.has(workspaceId)) {
    cache.set(workspaceId, (async () => {
      const { data, error } = await supabase.from('workspaces')
        .select('ai_tagger_enabled')
        .eq('id', workspaceId)
        .maybeSingle();
      if (error) {
        cache.delete(workspaceId);
        return false; // unknown: send nothing this time, ask again next time
      }
      return data?.ai_tagger_enabled !== false;
    })());
  }
  return cache.get(workspaceId);
}

// The settings toggle calls this after saving, so open editors follow it.
export function announceAiSettingChanged(workspaceId) {
  cache.delete(workspaceId);
  try { document.dispatchEvent(new CustomEvent(AI_SETTING_CHANGED, { detail: { workspaceId } })); } catch (_) {}
}

// null until known, then true / false.
export function useWorkspaceAiEnabled(workspaceId) {
  const [enabled, setEnabled] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      readWorkspaceAiEnabled(workspaceId).then((v) => { if (alive) setEnabled(v); });
    };
    setEnabled(null);
    load();
    const onChange = (e) => {
      if (!e?.detail?.workspaceId || e.detail.workspaceId === workspaceId) load();
    };
    document.addEventListener(AI_SETTING_CHANGED, onChange);
    return () => { alive = false; document.removeEventListener(AI_SETTING_CHANGED, onChange); };
  }, [workspaceId]);
  return enabled;
}
