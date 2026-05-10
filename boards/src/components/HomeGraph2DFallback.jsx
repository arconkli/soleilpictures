import ForceGraph2D from 'react-force-graph-2d';

export function HomeGraph2DFallback({ data, width, height, onNodeClick }) {
  return (
    <ForceGraph2D
      graphData={data}
      width={width}
      height={height}
      backgroundColor="#0a0908"
      nodeColor={n => n.color}
      nodeVal={n => n.val}
      nodeLabel={n => n.name}
      linkColor={l => l.kind === 'structural' ? 'rgba(91,87,78,.45)' : 'rgba(255,165,0,.55)'}
      onNodeClick={onNodeClick}
    />
  );
}
