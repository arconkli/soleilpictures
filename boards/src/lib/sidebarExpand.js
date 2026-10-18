// Which clusters are unfolded in the sidebar — "follow me" unfolding.
//
// The cluster you are in, and its ancestors, unfold on their own; when you move
// on, they fold back — unless you unfolded them by hand. A cluster you fold by
// hand stays folded until you navigate again. A search shows its hits'
// clusters for as long as it lasts. Four id lists carry that:
//   manual  unfolded by hand (the only part that is saved)
//   auto    the active cluster and its ancestors
//   closed  auto clusters the person folded since the last navigation
//   search  clusters holding a search hit
//
// A cluster's OWN files fold separately from its sub-clusters (filesUnfolded):
// the clusters above the one you're in show theirs as one labeled line, so
// what you're looking at is never buried under — or confused with — the files
// of the clusters around it. `active`, `filesOpen` and `filesClosed` carry
// that, and reset whenever you navigate.
//
// The state is plain JSON arrays so it can sit in a React reducer unchanged.
// The saved form is just `manual`, which is the same JSON array the sidebar
// already stored under soleil.boards.sb.expanded.<workspaceId>, so an old save
// loads straight in.

const dedup = (ids) => [...new Set((ids || []).filter((id) => id != null && id !== ''))].map(String);

export function initialExpandState(manualIds = []) {
  return {
    manual: dedup(Array.isArray(manualIds) ? manualIds : []), auto: [], closed: [], search: [],
    active: null, filesOpen: [], filesClosed: [],
  };
}

export function isExpanded(state, id) {
  if (state.search.includes(id)) return true;
  return (state.manual.includes(id) || state.auto.includes(id)) && !state.closed.includes(id);
}

// Whether a cluster's own files show in full, or as its one folded line. In
// order: a search shows its hits; a fold or unfold by hand wins; the cluster
// you're in shows its files; the workspace's root keeps its own folded (they
// would sit at the very bottom, under every other cluster); a cluster you
// unfolded by hand shows them; a cluster unfolded only because you're inside
// it folds them to one line.
export function filesUnfolded(state, id, rootId = null) {
  if ((state.search || []).includes(id)) return true;
  if ((state.filesClosed || []).includes(id)) return false;
  if ((state.filesOpen || []).includes(id)) return true;
  if (id === state.active) return true;
  if (rootId != null && id === rootId) return false;
  return state.manual.includes(id);
}

export function expandReducer(state, action) {
  switch (action && action.type) {
    case 'navigate':
      return {
        ...state,
        auto: dedup([...(action.ancestorIds || []), action.activeId]),
        closed: [],
        active: action.activeId == null ? null : String(action.activeId),
        filesOpen: [],
        filesClosed: [],
      };
    case 'toggleFiles': {
      const { id } = action;
      if (filesUnfolded(state, id, action.rootId)) {
        return {
          ...state,
          filesOpen: (state.filesOpen || []).filter((x) => x !== id),
          filesClosed: dedup([...(state.filesClosed || []), id]),
        };
      }
      return {
        ...state,
        filesClosed: (state.filesClosed || []).filter((x) => x !== id),
        filesOpen: dedup([...(state.filesOpen || []), id]),
      };
    }
    case 'toggle': {
      const { id } = action;
      if (isExpanded(state, id)) {
        return {
          ...state,
          manual: state.manual.filter((x) => x !== id),
          search: state.search.filter((x) => x !== id),
          closed: state.auto.includes(id) ? dedup([...state.closed, id]) : state.closed,
        };
      }
      return {
        ...state,
        manual: dedup([...state.manual, id]),
        closed: state.closed.filter((x) => x !== id),
      };
    }
    case 'search':
      return { ...state, search: dedup(action.ids) };
    case 'clearSearch':
      return { ...state, search: [] };
    case 'collapseAll':
      return { ...state, manual: [], search: [], closed: [...state.auto] };
    // Another workspace's saved state, loaded whole when the workspace changes.
    case 'reset':
      return action.state || initialExpandState();
    default:
      return state;
  }
}

export function persistManual(state) {
  return state.manual;
}

export function shelfKey(boardId, shelfId) {
  return `${boardId}:${shelfId}`;
}

// field is 'open' (a fold shelf's rows showing) or 'expanded' (past the peek).
export function toggleShelf(map, key, field) {
  const cur = map[key] || { open: false, expanded: false };
  return { ...map, [key]: { open: !!cur.open, expanded: !!cur.expanded, [field]: !cur[field] } };
}
