import {
  Folder as FolderIcon, Image as ImagePh, StickyNote, Link as LinkPh,
  Palette as PalettePh, FileText, Calendar as CalendarPh, Square as SquarePh,
  Circle as CirclePh, FilePdf, Paperclip, Headphones, Clapperboard, ArrowSquareOut,
} from '../lib/icons.js';
import { Icon } from './Icon.jsx';

// A card kind's glyph: list-board rows, the cluster browser, the files
// sidebar, a shortcut, a comment's card. Sized to fill a 22px tile by
// default; the cluster browser passes its own size, and the files sidebar its
// own weight (regular: thin is a hairline at 16px on its glass).
//
// A module of its own so that what only needs the glyph (the comment parts)
// does not import cards.jsx and the canvas with it.
//
// audio/video used to be missing here, so a list-board row drew a generic
// circle for a loop while the cluster browser drew headphones for the same
// card — one kind, two glyphs, depending which list you were looking at.
export function KindIcon({ kind, size = 22, weight }) {
  if (kind === 'board' || kind === 'list' || kind === 'boardlink') {
    return <Icon as={FolderIcon} size={size} weight={weight} />;
  }
  if (kind === 'image')    return <Icon as={ImagePh} size={size} weight={weight} />;
  if (kind === 'note')     return <Icon as={StickyNote} size={size} weight={weight} />;
  if (kind === 'link')     return <Icon as={LinkPh} size={size} weight={weight} />;
  if (kind === 'palette')  return <Icon as={PalettePh} size={size} weight={weight} />;
  if (kind === 'doc')      return <Icon as={FileText} size={size} weight={weight} />;
  if (kind === 'schedule') return <Icon as={CalendarPh} size={size} weight={weight} />;
  if (kind === 'shape')    return <Icon as={SquarePh} size={size} weight={weight} />;
  if (kind === 'pdf')      return <Icon as={FilePdf} size={size} weight={weight} />;
  if (kind === 'audio')    return <Icon as={Headphones} size={size} weight={weight} />;
  if (kind === 'video')    return <Icon as={Clapperboard} size={size} weight={weight} />;
  if (kind === 'file')     return <Icon as={Paperclip} size={size} weight={weight} />;
  if (kind === 'shortcut') return <Icon as={ArrowSquareOut} size={size} weight={weight} />;
  return <Icon as={CirclePh} size={size} weight={weight} />;
}
