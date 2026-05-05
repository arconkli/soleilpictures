import { Icon } from './Icon.jsx';
import { Search, RotateCcw } from '../lib/icons.js';

const KIND_LABELS = { board: 'Boards', doc: 'Docs', card: 'Cards', url: 'URLs' };

export function HomeGraphHud({ kinds, setKinds, structural, setStructural, search, setSearch, onReset, onSearchPulse }) {
  const toggle = (k) => {
    const next = new Set(kinds);
    next.has(k) ? next.delete(k) : next.add(k);
    setKinds(next);
  };
  return (
    <div className="home-graph-hud surface-frosted">
      <div className="home-graph-chips">
        {Object.keys(KIND_LABELS).map(k => (
          <button key={k} className={`home-graph-chip ${kinds.has(k) ? 'on' : ''}`} onClick={() => toggle(k)}>
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <label className="home-graph-toggle">
        <input type="checkbox" checked={structural} onChange={e => setStructural(e.target.checked)} />
        <span>Structural edges</span>
      </label>
      <form className="home-graph-search" onSubmit={(e) => { e.preventDefault(); onSearchPulse?.(); }}>
        <Icon as={Search} size={14} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a node…" />
      </form>
      <button className="home-graph-reset" onClick={onReset} title="Reset view">
        <Icon as={RotateCcw} size={14} />
      </button>
    </div>
  );
}
