// What a guest may paste into a doc shared with them (DocPageEditor, guest
// mode): the text and its formatting, without what the doc's room refuses from
// a guest (lib/docRoomBridge.js validateGuestUpdate). A refused frame is
// refused whole, and the guest's copy then starts over from the room, so a
// paste carrying one image would cost every keystroke around it.
//
// Dropped: images and cluster embeds (a guest cannot bring files or clusters
// into someone else's doc), and links that are not http(s) or mailto (the
// app's own soleil:// links point into a workspace the guest is not in).
import { Fragment, Slice } from '@tiptap/pm/model';

export const GUEST_DROPPED_NODES = Object.freeze(new Set(['image', 'boardEmbed']));
const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

const keepMark = (m) => m.type.name !== 'link' || SAFE_HREF.test(String(m.attrs?.href || ''));

// The same fragment when nothing in it needed to go.
function clean(fragment) {
  let changed = false;
  const out = [];
  fragment.forEach((node) => {
    if (GUEST_DROPPED_NODES.has(node.type.name)) { changed = true; return; }
    const marks = node.marks.filter(keepMark);
    let next = marks.length === node.marks.length ? node : node.mark(marks);
    if (!node.isText && node.content.size) {
      const inner = clean(node.content);
      if (inner !== node.content) next = next.copy(inner);
    }
    if (next !== node) changed = true;
    out.push(next);
  });
  return changed ? Fragment.fromArray(out) : fragment;
}

// For ProseMirror's transformPasted: the slice itself when it is all allowed.
// When something was taken out the remainder is opened as far as it goes, so
// what is left still joins the text it lands in.
export function guestPasteSlice(slice) {
  if (!slice || !slice.content) return slice;
  const content = clean(slice.content);
  if (content === slice.content) return slice;
  if (!content.size) return Slice.empty;
  return Slice.maxOpen(content);
}
