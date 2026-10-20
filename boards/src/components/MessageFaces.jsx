// People's faces in Messages' card look, drawn as the files sidebar draws
// "Maya and Jon are here": a circle in their colour with a dark initial. One
// face for a person, two overlapping for a group (the first two besides you).
//   people — [{ id, name, color }]
//   size   — one face's width in px; a pair draws smaller faces in the same box
export function MessageFaces({ people, size = 28, className = '' }) {
  const shown = (people || []).slice(0, 2);
  const pair = shown.length > 1;
  return (
    <span className={`msg-faces${pair ? ' is-pair' : ''}${className ? ` ${className}` : ''}`}
          style={{ '--msg-face': `${size}px` }} aria-hidden="true">
      {shown.length === 0
        ? <span className="msg-face" />
        : shown.map((p) => (
          <span key={p.id} className="msg-face" style={{ background: p.color }}>
            {String(p.name || '?').trim().charAt(0).toUpperCase()}
          </span>
        ))}
    </span>
  );
}
