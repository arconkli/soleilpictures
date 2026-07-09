// Single source of truth for a list-item's visual, so the Table thumbnail and
// the Gallery tile never diverge. Given a normalized ListItem (its `preview`
// descriptor, built in lib/listItem.js) it returns the cheapest REAL preview:
//   • r2         → R2Image (progressive) — image / pdf-thumb / video-poster / audio-cover
//   • file       → typed iconForFile glyph + extension badge
//   • swatches   → palette swatch grid
//   • grid       → subdivision schematic (GridMark)
//   • doc        → title + text-line schematic (DocMark)
//   • schedule   → row schematic (ScheduleMark)
//   • shape      → real shape silhouette (ShapeMark)
//   • note       → the note's real text on its tint (NoteMark)
//   • link       → favicon + domain (LinkMark)
//   • placeholder→ ImagePlaceholder (pending / missing src)
//   • icon       → typed KindIcon fallback
import { R2Image } from '../R2Image.jsx';
import { ImagePlaceholder } from '../primitives.jsx';
import { KindIcon } from '../cards.jsx';
import { Icon } from '../Icon.jsx';
import { iconForFile } from '../cards/FileCard.jsx';
import { Headphones, Clapperboard } from '../../lib/icons.js';
import { GridMark, DocMark, ScheduleMark, ShapeMark, NoteMark, LinkMark } from './marks.jsx';
import { GridContentPreview } from './GridContentPreview.jsx';

// `size`: 'row' (40px thumb) or 'tile' (large gallery preview). Controls the
// R2Image displayed-px hint + glyph size.
export function CardPreview({ item, size = 'row' }) {
  const p = item?.preview || { mode: 'icon', kind: item?.kind };
  const glyphSize = size === 'tile' ? 40 : 22;
  const displayPx = size === 'tile' ? 320 : 48;

  if (p.mode === 'r2' && p.src) {
    return <R2Image src={p.src} alt="" className="cbp-img" draggable="false"
                    w={displayPx} h={displayPx} />;
  }
  if (p.mode === 'file') {
    const GlyphIcon = iconForFile(p.ext, p.mime);
    return (
      <div className="cbp-file">
        <Icon as={GlyphIcon} size={glyphSize} />
        {p.ext && <span className="cbp-ext">{String(p.ext).toUpperCase().slice(0, 4)}</span>}
      </div>
    );
  }
  if (p.mode === 'swatches') {
    const sw = (p.swatches || []).slice(0, 4);
    if (sw.length) {
      return (
        <div className="cbp-swatches">
          {sw.map((hex, i) => <div key={i} className="cbp-sw" style={{ background: hex }} />)}
        </div>
      );
    }
    return <KindIcon kind="palette" />;
  }
  if (p.mode === 'grid') {
    // Real cell content when the live model resolved (App threads getGridModel);
    // else the abstract subdivision schematic (pure/local path); else a glyph.
    if (p.model && p.model.layout) return <GridContentPreview model={p.model} size={size} />;
    if (p.rects && p.rects.length) return <GridMark rects={p.rects} cells={p.cells} />;
    return <div className="cbp-glyph"><KindIcon kind="grid" /></div>;
  }
  if (p.mode === 'doc') return <DocMark title={p.title} lines={p.lines} />;
  if (p.mode === 'schedule') return <ScheduleMark rows={p.rows} />;
  if (p.mode === 'shape') return <ShapeMark shape={p.shape} fill={p.fill} stroke={p.stroke} dash={p.dash} />;
  if (p.mode === 'note') {
    const text = (p.text || '').trim();
    if (text) return <NoteMark text={text} tone={p.tone} size={size} />;
    return <div className="cbp-note" style={p.tone ? { background: p.tone } : undefined}><KindIcon kind="note" /></div>;
  }
  if (p.mode === 'link') return <LinkMark favicon={p.favicon} source={p.source} size={size} />;
  if (p.mode === 'placeholder') {
    return <ImagePlaceholder tone={p.tone} aspect="1/1" />;
  }
  // icon fallback — video/audio get their own glyphs; everything else KindIcon.
  if (p.kind === 'video') return <div className="cbp-glyph"><Icon as={Clapperboard} size={glyphSize} /></div>;
  if (p.kind === 'audio') return <div className="cbp-glyph"><Icon as={Headphones} size={glyphSize} /></div>;
  return <div className="cbp-glyph"><KindIcon kind={p.kind} /></div>;
}
