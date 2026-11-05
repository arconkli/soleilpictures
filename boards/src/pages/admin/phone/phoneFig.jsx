/* A numbered figure whose header (dek, caption) depends on the data it shows:
   the frame is always there, the body is the call's value, or its quiet states
   (loading, couldn't load, nothing to show) through Held. The pages' calls can
   each fail alone, so a figure never takes the page down with it. */
import { Figure } from './phoneCharts.jsx';
import { Held } from './PhonePageShell.jsx';

/**
 * @param {{n:number, topic?:string, title:string, value:any, error?:any, onRetry?:()=>void, h?:number, empty?:string,
 *   build:(v:any)=>({dek?:string, note?:string, body:any}|null)}} props
 *   `build` makes the figure's dek, caption and body from the loaded value; null means "nothing to show".
 */
export function Fig({ n, topic, title, value, error, onRetry, h = 140, empty = 'Nothing to show yet.', build }) {
  const built = value != null ? build(value) : null;
  return (
    <Figure n={n} topic={topic} title={title} dek={built?.dek} note={built?.note}>
      {built
        ? built.body
        : <Held value={value == null ? value : null} error={error} onRetry={onRetry} h={h} empty={empty}>{() => null}</Held>}
    </Figure>
  );
}

/** A big numeral and its label above a plain chart (the .ap-ro the scrubbable charts use). */
export function Readout({ value, label }) {
  return (
    <div className="ap-ro">
      <span className="ap-ro-v">{value}</span>
      <span className="ap-ro-l">{label}</span>
    </div>
  );
}
