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
// The state is plain JSON arrays so it can sit in a React reducer unchanged.
// The saved form is just `manual`, which is the same JSON array the sidebar
// already stored under soleil.boards.sb.expanded.<workspaceId>, so an old save
// loads straight in.

const dedup = (ids) => [...new Set((ids || []).filter((id) => id != null && id !== ''))].map(String);

export function initialExpandState(manualIds = []) {
  return { manual: dedup(Array.isArray(manualIds) ? manualIds : []), auto: [], closed: [], search: [] };
}

export function isExpanded(state, id) {
  if (state.search.includes(id)) return true;
  return (state.manual.includes(id) || state.auto.includes(id)) && !state.closed.includes(id);
}

export function expandReducer(state, action) {
  switch (action && action.type) {
    case 'navigate':
      return { ...state, auto: dedup([...(action.ancestorIds || []), action.activeId]), closed: [] };
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
