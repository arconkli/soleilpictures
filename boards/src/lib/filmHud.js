import { t, ph } from '@lingui/core/macro';

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
    case 'firstFrame': return t`First frame`;
    case 'lastFrame': return t`Last frame`;
    case 'loopOn': return ctx.whole ? t`Loop on · whole clip` : t`Loop on`;
    case 'loopOff': return t`Loop off`;
    case 'cleared': return t`In and out cleared`;
    case 'in': return t`In ${ph({ tc: ctx.tc })}`;
    case 'out': return ctx.frames ? t`Out ${ph({ tc: ctx.tc })} · ${ph({ frames: ctx.frames })} fr` : t`Out ${ph({ tc: ctx.tc })}`;
    case 'speed': return t`Speed ${ph({ rate: ctx.rate })}×`;
    case 'slow': return ctx.dir < 0 ? '◀ 0.25×' : '▶ 0.25×';
    case 'muted': return t`Muted`;
    case 'volume': return t`Volume ${ph({ percent: Math.round((ctx.volume || 0) * 100) })}%`;
    case 'guide': return ctx.label ? t`Guides ${ph({ label: ctx.label })}` : t`Guides off`;
    case 'side': return `${ctx.side} · ${ctx.label}`;
    case 'copied': return t`Copied ${ph({ tc: ctx.tc })}`;
    case 'copiedLink': return t`Link to ${ph({ tc: ctx.tc })} copied`;
    case 'buffering': return t`Buffering…`;
    case 'bufferingOffline': return t`Offline · it resumes when you’re back online`;
    case 'mutedAutoplay': return t`Playing muted — press M for sound`;
    case 'noPrevComment': return t`No comment before this frame`;
    case 'noNextComment': return t`No comment after this frame`;
    default: return null;
  }
}
