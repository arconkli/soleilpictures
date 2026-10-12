// What the player says on screen for a moment (lib/filmHud.js has the words):
// shuttle speed, an edge reached, a copy, a loop turned on. Placed in the
// letterbox above the picture when there's room for it, else in the picture's
// top-left corner — never over the middle of the frame being checked.
// Mirrored to a polite live region for screen readers.
export function FilmHud({ hud, picture }) {
  const text = hud?.text || '';
  const roomy = picture && picture.y >= 44;
  const style = !picture ? { left: 12, top: 12 }
    : roomy ? { left: picture.x + picture.w / 2, top: Math.max(6, (picture.y - 30) / 2), transform: 'translateX(-50%)' }
    : { left: picture.x + 12, top: picture.y + 12 };
  return (
    <>
      {text && (
        <div key={hud.id} className={`film-hud${hud.persist ? ' is-persist' : ''}`} style={style} aria-hidden="true">
          {text}
        </div>
      )}
      <span className="film-sr" aria-live="polite">{text}</span>
    </>
  );
}
