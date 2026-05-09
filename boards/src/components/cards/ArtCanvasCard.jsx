// Art canvas card — a bounded drawing surface within a board. Renders
// just the background color; strokes are painted by the shared
// CardStrokesOverlay (mounted on every card by CanvasSurface), so
// every card kind picks up the same draw-tool routing.

export function ArtCanvasCard({ bg = '#ffffff' }) {
  return (
    <div className="art-canvas-card" style={{ background: bg, width: '100%', height: '100%' }} />
  );
}
