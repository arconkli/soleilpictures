// What the review player says on screen, briefly, when something changes that
// nothing else on screen shows (components/film/FilmHud.jsx). Frame steps
// aren't announced — the timecode already says where you are, and a pill over
// the picture is in the way of checking it.
export function shuttleText({ dir, rate }) {
  if (!dir) return null;
  const r = `${rate}×`;
  if (dir > 0) return rate === 1 ? null : `▶▶ ${r}`;
  return rate === 1 ? `◀ ${r}` : `◀◀ ${r}`;
}

export function hudText(event, ctx = {}) {
  switch (event) {
    case 'firstFrame': return 'First frame';
    case 'lastFrame': return 'Last frame';
    case 'loopOn': return ctx.whole ? 'Loop on · whole clip' : 'Loop on';
    case 'loopOff': return 'Loop off';
    case 'cleared': return 'In and out cleared';
    case 'in': return `In ${ctx.tc}`;
    case 'out': return ctx.frames ? `Out ${ctx.tc} · ${ctx.frames} fr` : `Out ${ctx.tc}`;
    case 'speed': return `Speed ${ctx.rate}×`;
    case 'slow': return ctx.dir < 0 ? '◀ 0.25×' : '▶ 0.25×';
    case 'muted': return 'Muted';
    case 'volume': return `Volume ${Math.round((ctx.volume || 0) * 100)}%`;
    case 'guide': return ctx.label ? `Guides ${ctx.label}` : 'Guides off';
    case 'side': return `${ctx.side} · ${ctx.label}`;
    case 'copied': return `Copied ${ctx.tc}`;
    case 'copiedLink': return `Link to ${ctx.tc} copied`;
    case 'buffering': return 'Buffering…';
    case 'mutedAutoplay': return 'Playing muted — press M for sound';
    case 'noPrevComment': return 'No comment before this frame';
    case 'noNextComment': return 'No comment after this frame';
    default: return null;
  }
}
