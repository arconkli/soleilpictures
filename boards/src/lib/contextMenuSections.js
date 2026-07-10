// Shared context-menu section composition.
//
// Right-click menus (canvas card, canvas background, sidebar cluster) all use
// the SAME grouped vocabulary so the menu language is consistent everywhere:
// a header-less primary action group at top, then labeled sections in a fixed
// order, then a header-less meta group (info / backlinks / delete) at the bottom.
//
// composeMenuSections turns a list of named buckets into the flat item array the
// CardContextMenu / BackgroundContextMenu renderers consume:
//   - empty buckets vanish entirely (so a plain note never shows an empty header)
//   - a bucket WITH a header emits a {header} row as its own separator
//   - a header-less, non-first bucket is separated by a plain {divider}
// Handlers/labels/submenus are untouched — this only orders + separates them.

export const SECTION = {
  EDIT: 'EDIT',
  ANNOTATE: 'ANNOTATE',
  ARRANGE: 'ARRANGE',
  CLIPBOARD: 'CLIPBOARD',
};

// sections: ordered array of { header?: string, items: any[] }.
// A section with a header ALWAYS emits its header row (even when it's the first
// visible section) so labeled groups stay consistent across card kinds; the
// header's own top spacing is the separator. A header-less, non-first section is
// separated by a plain divider.
export function composeMenuSections(sections) {
  const out = [];
  for (const sec of sections || []) {
    const items = (sec?.items || []).filter(Boolean);
    if (!items.length) continue;
    if (sec.header) out.push({ header: sec.header });
    else if (out.length) out.push({ divider: true });
    out.push(...items);
  }
  return out;
}
