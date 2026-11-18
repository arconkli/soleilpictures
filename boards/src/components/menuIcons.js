// The right-click menu's icons by Phosphor name: a menu row says
// `icon: 'Trash'`, the renderer asks menuIcon('Trash'). Components come from
// lib/icons.js (the one place icons are re-exported). Named imports and an
// object literal, not `import *`: a namespace read by dynamic keys can't be
// tree-shaken and would ship every icon icons.js re-exports. A new row's icon
// is added to both lists.
import {
  ArrowsOut, UserPlus, SlidersHorizontal, PencilSimple, PaperPlaneTilt, LinkSimple, ShareNetwork,
  DownloadSimple, ChatCircle, ListChecks, Folder, FolderPlus, Stack, Scissors, Copy,
  PlusSquare, Info, Trash, BoundingBox, Broom, Plus, ClipboardText, SelectionAll, CornersOut,
  PaintBucket, Export, Eraser, NotePencil, Image, FileText, Link, ArrowSquareOut, Paperclip,
  GridFour, Calendar, Square, Palette, Scribble, ArrowRight, Star, DotsThree, MagnifyingGlass,
  TrayArrowDown, Check, CaretRight, CaretLeft, ArrowBendUpLeft, PlayCircle, ArrowsInLineVertical,
  Shapes, LineSegment, ArrowsOutLineHorizontal, ListNumbers, Layout, Table, CalendarBlank,
  CalendarCheck, Eyedropper, ImageSquare, TextAa, TextAlignLeft, UploadSimple, Repeat, MapPin,
  Timer, X, ImageBroken, ChatsCircle, CopySimple, SignOut, ArrowLineUp, ArrowUp, ArrowDown,
  ArrowLineDown, AlignCenterHorizontal, AlignRight, AlignTop, AlignCenterVertical, AlignBottom,
  ArrowsHorizontal, ArrowsVertical, Rows, Columns, FloppyDisk, ArrowCounterClockwise, TextT,
  Selection, SelectionSlash, BezierCurve, ArrowsLeftRight, LineSegments, CheckCircle, CheckSquare, FilePdf,
  FolderSimple, ArrowUpRight, FolderOpen, MinusCircle, Eye, Crosshair, ArrowSquareIn, EyeSlash,
  FilePlus, ArrowsMerge, TextB, TextItalic, TextUnderline, PushPin, PushPinSlash, AlignCardsLeft,
} from '../lib/icons.js';

const MAP = {
  ArrowsOut, UserPlus, SlidersHorizontal, PencilSimple, PaperPlaneTilt, LinkSimple, ShareNetwork,
  DownloadSimple, ChatCircle, ListChecks, Folder, FolderPlus, Stack, Scissors, Copy,
  PlusSquare, Info, Trash, BoundingBox, Broom, Plus, ClipboardText, SelectionAll, CornersOut,
  PaintBucket, Export, Eraser, NotePencil, Image, FileText, Link, ArrowSquareOut, Paperclip,
  GridFour, Calendar, Square, Palette, Scribble, ArrowRight, Star, DotsThree, MagnifyingGlass,
  TrayArrowDown, Check, CaretRight, CaretLeft, ArrowBendUpLeft, PlayCircle, ArrowsInLineVertical,
  Shapes, LineSegment, ArrowsOutLineHorizontal, ListNumbers, Layout, Table, CalendarBlank,
  CalendarCheck, Eyedropper, ImageSquare, TextAa, TextAlignLeft, UploadSimple, Repeat, MapPin,
  Timer, X, ImageBroken, ChatsCircle, CopySimple, SignOut, ArrowLineUp, ArrowUp, ArrowDown,
  ArrowLineDown, AlignCenterHorizontal, AlignRight, AlignTop, AlignCenterVertical, AlignBottom,
  ArrowsHorizontal, ArrowsVertical, Rows, Columns, FloppyDisk, ArrowCounterClockwise, TextT,
  Selection, SelectionSlash, BezierCurve, ArrowsLeftRight, LineSegments, CheckCircle, CheckSquare, FilePdf,
  FolderSimple, ArrowUpRight, FolderOpen, MinusCircle, Eye, Crosshair, ArrowSquareIn, EyeSlash,
  FilePlus, ArrowsMerge, TextB, TextItalic, TextUnderline, PushPin, PushPinSlash,
  AlignLeft: AlignCardsLeft,
};

export const NAMES = Object.keys(MAP);

export function menuIcon(name) {
  return (typeof name === 'string' && MAP[name]) || null;
}
