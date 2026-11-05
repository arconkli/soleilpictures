/* The frame every phone admin page shares: "‹ Today" and the time · date line,
   the eyebrow, the Brandon title, the intro, then the page's own tiles, chips
   and figures as children (class map in adminPhone.css). The props below are
   the contract the page files are written against. */
import { mastModel } from '../../../lib/phoneInsights.js';

const Back = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
);

/**
 * "‹ Today" and the time · date line, the eyebrow, the Brandon title, the
 * intro, then the page's own tiles, chips and figures as children.
 * @param {{id:string, kicker:string, title:string, intro?:string, now:number, onBack:()=>void, children?:any}} props
 */
export function PageShell({ id, kicker, title, intro, now, onBack, children }) {
  const m = mastModel(now);
  return (
    <article className="ap-page" data-testid={`ap-page-${id}`} aria-labelledby={`ap-pt-${id}`}>
      <div className="ap-nav">
        <button type="button" className="ap-bk" onClick={onBack}><Back />Today</button>
        <span className="ap-nv">{m.clock}{m.clock && m.date ? ' · ' : ''}{m.date}</span>
      </div>
      <p className="ap-kick ap-pk">{kicker}</p>
      <h1 className="ap-ptitle" id={`ap-pt-${id}`}>{title}</h1>
      {intro ? <p className="ap-lede">{intro}</p> : null}
      {children}
    </article>
  );
}

/**
 * One call's value, or its quiet states. `value` and `error` are usePhoneData's
 * values[key] and errors[key]:
 *   undefined -> never loaded: a quiet placeholder `h` px tall
 *   null + error -> couldn't load: a line with Try again (onRetry)
 *   null, no error -> answered nothing: the `empty` line
 *   anything else -> children(value)
 * @param {{value:any, error?:any, onRetry?:()=>void, h?:number, empty?:string, children:(v:any)=>any}} props
 */
export function Held({ value, error, onRetry, h = 120, empty = 'Nothing to show yet.', children }) {
  if (value === undefined) return <div className="ap-skel" style={{ height: h }} aria-hidden="true" />;
  if (value == null) {
    if (error) {
      return (
        <p className="ap-fail" role="status">
          Couldn’t load this.{' '}
          <button type="button" className="ap-link" onClick={onRetry}>Try again</button>
        </p>
      );
    }
    return <p className="ap-wait" role="status">{empty}</p>;
  }
  return children(value);
}

/** "Open full admin": the desktop view this page summarises. */
export function FullAdmin({ href }) {
  return <a className="ap-wide" href={href}>Open full admin</a>;
}
