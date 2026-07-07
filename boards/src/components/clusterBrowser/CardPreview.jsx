// Single source of truth for a list-item's visual, so the Table thumbnail and
// the Gallery tile never diverge. Given a normalized ListItem (its `preview`
// descriptor, built in lib/listItem.js) it returns the cheapest REAL preview:
//   • r2         → R2Image (progressive) — image / pdf-thumb / video-poster / audio-cover
//   • file       → typed iconForFile glyph + extension badge
//   • swatches   → palette swatch grid
//   • note/shape → tinted glyph
//   • placeholder→ ImagePlaceholder (pending / missing src)
//   • icon       → typed KindIcon fallback
import { R2Image } from '../R2Image.jsx';
import { ImagePlaceholder } from '../primitives.jsx';
import { KindIcon } from '../cards.jsx';
import { Icon } from '../Icon.jsx';
import { iconForFile } from '../cards/FileCard.jsx';
import { Headphones, Clapperboard } from '../../lib/icons.js';

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
  if (p.mode === 'note') {
    return <div className="cbp-note" style={p.tone ? { background: p.tone } : undefined}><KindIcon kind="note" /></div>;
  }
  if (p.mode === 'shape') {
    return (
      <div className="cbp-shape" style={{
        background: p.fill && p.fill !== 'transparent' ? p.fill : 'transparent',
        borderColor: p.stroke || 'var(--line-3)',
      }} />
    );
  }
  if (p.mode === 'placeholder') {
    return <ImagePlaceholder tone={p.tone} aspect="1/1" />;
  }
  // icon fallback — video/audio get their own glyphs; everything else KindIcon.
  if (p.kind === 'video') return <div className="cbp-glyph"><Icon as={Clapperboard} size={glyphSize} /></div>;
  if (p.kind === 'audio') return <div className="cbp-glyph"><Icon as={Headphones} size={glyphSize} /></div>;
  return <div className="cbp-glyph"><KindIcon kind={p.kind} /></div>;
}
