import { PersonFace } from '../PersonFace.jsx';
import { t as tr } from '@lingui/core/macro';

// A person's face in a comment: their picture when it loads, their initial on
// their colour when it doesn't (PersonFace.jsx, which every other face in the
// app is drawn with). 24px in a row and on a pin, smaller in a list.
//   name      whose face (the initial comes from it)
//   userId    whose picture: read from the profile cache by id. None (a shared
//             file's rows carry no author id, a signed-out page has no
//             profiles to read) shows the initial.
//   color     their colour, behind the initial
//   size      px, 24 by default
//   onProfile your own face, where it is the way to your profile: a press
//             runs this and reaches nothing under it (PersonFace `isolate`)
//   as        'span' when the face sits inside a button
export function CommentFace({ name = '', userId = null, color = null, size = 24, className = '', onProfile = null, as }) {
  const cls = `cmt-face${color ? ' has-color' : ''}${size < 24 ? ' is-small' : ''}${className ? ' ' + className : ''}`;
  const act = onProfile
    ? { onClick: onProfile, isolate: true, title: tr`Edit profile`, ariaLabel: tr`Edit profile`, as }
    : { ariaHidden: true };
  return (
    <PersonFace userId={userId} name={name} color={color || undefined}
                className={cls} style={{ '--cmt-face': `${size}px` }} {...act} />
  );
}
