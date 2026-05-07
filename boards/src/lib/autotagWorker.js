// Web worker host for the autotag engine.
//
// Lifecycle messages from the main thread:
//
//   { type: 'init', workspaceId, tags, corpus, ignored }
//     Build the inverted index and replace any prior state.
//
//   { type: 'tags', tags }
//     Replace the workspace tag list (name/alias/slug changes).
//
//   { type: 'addApplied', tagId, text, sourceKey }
//     Incremental: a new applied link arrived. Append text to the
//     tag's document and rebuild that tag's TF (cheap; we only
//     touch one tag's column).
//
//   { type: 'removeApplied', tagId, text, sourceKey }
//     Best-effort decrement. We rebuild the index from scratch on
//     a debounce instead of trying to negate term frequencies
//     individually — keeps the math correct in the face of
//     repeated apply/unapply churn.
//
//   { type: 'setIgnored', ignored }
//     Replace the per-target ignored set (used at scoring time).
//
//   { type: 'score', requestId, content, ignoredForTarget }
//     Rank suggestions for the given content, scoped by the
//     per-target ignored set if provided. Replies with
//     { type: 'scored', requestId, suggestions }.

import { buildIndex, scoreContent, tokenize } from './autotagEngine.js';

let state = {
  workspaceId: null,
  tags: [],
  // corpus is kept around so we can rebuild on demand after churn
  corpus: [],
  index: null,
  // workspace-wide ignored pairs: Map<targetKey, Set<tagId>>
  ignored: new Map(),
  pendingRebuild: 0,
};

function rebuild() {
  state.index = buildIndex(state.corpus);
}

function scheduleRebuild() {
  clearTimeout(state.pendingRebuild);
  state.pendingRebuild = setTimeout(rebuild, 250);
}

self.onmessage = (event) => {
  const msg = event.data || {};
  switch (msg.type) {
    case 'init': {
      state.workspaceId = msg.workspaceId || null;
      state.tags = Array.isArray(msg.tags) ? msg.tags.slice() : [];
      state.corpus = Array.isArray(msg.corpus) ? msg.corpus.slice() : [];
      state.ignored = new Map();
      if (msg.ignored && typeof msg.ignored === 'object') {
        for (const k of Object.keys(msg.ignored)) {
          state.ignored.set(k, new Set(msg.ignored[k]));
        }
      }
      rebuild();
      self.postMessage({ type: 'ready', workspaceId: state.workspaceId });
      return;
    }
    case 'tags': {
      state.tags = Array.isArray(msg.tags) ? msg.tags.slice() : [];
      return;
    }
    case 'addApplied': {
      if (!msg.tagId) return;
      state.corpus.push({ tagId: msg.tagId, text: msg.text || '', key: msg.sourceKey });
      scheduleRebuild();
      return;
    }
    case 'removeApplied': {
      if (!msg.tagId || !msg.sourceKey) return;
      state.corpus = state.corpus.filter(r => !(r.tagId === msg.tagId && r.key === msg.sourceKey));
      scheduleRebuild();
      return;
    }
    case 'setIgnored': {
      state.ignored = new Map();
      if (msg.ignored && typeof msg.ignored === 'object') {
        for (const k of Object.keys(msg.ignored)) {
          state.ignored.set(k, new Set(msg.ignored[k]));
        }
      }
      return;
    }
    case 'score': {
      const { requestId, content, targetKey } = msg;
      const ignoredSet = (targetKey && state.ignored.get(targetKey)) || new Set();
      const suggestions = scoreContent({
        tags: state.tags,
        index: state.index,
        content,
        ignoredTagIds: ignoredSet,
      });
      self.postMessage({ type: 'scored', requestId, suggestions });
      return;
    }
    case 'tokenize': {
      // Debug helper — not used at runtime, handy from devtools.
      self.postMessage({ type: 'tokens', requestId: msg.requestId, tokens: tokenize(msg.text) });
      return;
    }
    default:
      // ignore unknown types
      return;
  }
};
