// Rolling — a figure whose digits roll, as an odometer's do, when it changes.
//
// The figure stays in the DOM as plain text, only transparent, so its
// accessible name, its textContent and innerText (which the specs read), a
// selection, its width and its baseline are exactly the plain figure's. Over it
// sits an aria-hidden face with one column per character: a digit is a strip of
// 0 to 9 that slides to its place (`--d`, admin.css), anything else (a comma,
// the K of 17.3K, the "h " of 16d 10h) stands still.
//
// Columns are keyed by their place from the right, so when 999 becomes 1,000
// the units, tens and hundreds roll and the thousands simply appear. A column
// is drawn at its digit on first paint, so nothing rolls when a page loads.
// Under reduced motion the digits change in place (admin.css).
export function Rolling({ text }) {
  const s = text == null ? '' : String(text);
  const chars = Array.from(s);
  return (
    <span className="adm-roll">
      <span className="adm-roll-text">{s}</span>
      <span className="adm-roll-face" aria-hidden="true">
        {chars.map((ch, i) => {
          const place = chars.length - i;
          return ch >= '0' && ch <= '9'
            ? <span key={place} className="adm-roll-d" style={{ '--d': ch }} />
            : <span key={place} className="adm-roll-c" data-c={ch} />;
        })}
      </span>
    </span>
  );
}
