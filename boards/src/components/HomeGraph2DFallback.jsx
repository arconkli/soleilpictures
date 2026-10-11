import ForceGraph2D from 'react-force-graph-2d';

// backgroundColor comes from HomeGraph's theme map; a hard-coded near-black
// left a dark rectangle inside the light theme.
export function HomeGraph2DFallback({ data, width, height, backgroundColor = '#0a0908', onNodeClick, onNodeRightClick }) {
  return (
    <ForceGraph2D
      graphData={data}
      width={width}
      height={height}
      backgroundColor={backgroundColor}
      nodeColor={n => n.color}
      nodeVal={n => n.val}
      nodeLabel={n => n.name}
      linkColor={l => l.kind === 'structural' ? 'rgba(91,87,78,.45)' : 'rgba(255,165,0,.55)'}
      onNodeClick={onNodeClick}
      onNodeRightClick={onNodeRightClick}
    />
  );
}
