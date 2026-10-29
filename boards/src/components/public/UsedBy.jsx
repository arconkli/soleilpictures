// The "Used by" line: a small label over the companies our users make their
// work with (lib/usedBy.js holds the list and the rule — companies only, text
// only). Neutral ink, never gold. `variant="signin"` is the homepage's
// sign-in box, which floats over moving cards and needs a halo to stay legible.
import { USED_BY, USED_BY_LABEL } from '../../lib/usedBy.js';
import './usedBy.css';

export function UsedBy({ variant }) {
  return (
    <section className={`used-by${variant === 'signin' ? ' is-signin' : ''}`} aria-label={USED_BY_LABEL}>
      <p className="used-by-k">{USED_BY_LABEL}</p>
      <ul className="used-by-names">
        {USED_BY.map((name) => <li key={name}>{name}</li>)}
      </ul>
    </section>
  );
}
