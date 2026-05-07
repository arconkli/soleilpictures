// Pluggable entity-kind registry. Every linking surface (picker,
// hover popover, backlinks panel, navigate hook, auto-detect scanner)
// reads from this single Map so adding a new kind later is one
// `register(kind, def)` call instead of touching every surface.
//
// Definition shape:
//   {
//     label,          // "Board", "Palette", "Image card"
//     kindPriority,   // sort weight in popover ENTITIES section (lower first)
//     icon,           // React component (lib/icons.js export)
//     previewMini,    // (row) => ReactNode — small inline render
//     previewFull,    // (row) => ReactNode — backlinks-panel render
//   }
//
// Navigation per kind lives in App.jsx (it needs setStack / setTweak
// closures); this registry is concerned with picking + rendering.

import { LayoutGrid, FileText, StickyNote, Image, Palette, Calendar, Link, User, MessageSquare, Folder, Tag } from './icons.js';
import * as BoardP    from '../components/entityPreviews/BoardPreview.jsx';
import * as DocP      from '../components/entityPreviews/DocPreview.jsx';
import * as PaletteP  from '../components/entityPreviews/PalettePreview.jsx';
import * as ImageP    from '../components/entityPreviews/ImagePreview.jsx';
import * as NoteP     from '../components/entityPreviews/NotePreview.jsx';
import * as CardP     from '../components/entityPreviews/CardPreview.jsx';
import * as UserP     from '../components/entityPreviews/UserPreview.jsx';
import * as MessageP  from '../components/entityPreviews/MessagePreview.jsx';
import * as UrlP      from '../components/entityPreviews/UrlPreview.jsx';
import * as GroupP    from '../components/entityPreviews/GroupPreview.jsx';
import * as TagP      from '../components/entityPreviews/TagPreview.jsx';

const REGISTRY = new Map();

export function register(kind, def) {
  const prev = REGISTRY.get(kind) || {};
  REGISTRY.set(kind, { ...prev, ...def });
}

export function getKind(kind) {
  return REGISTRY.get(kind) || null;
}

export function allKinds() {
  return [...REGISTRY.entries()].map(([kind, def]) => ({ kind, ...def }));
}

export function compareByPriority(a, b) {
  const pa = REGISTRY.get(a.kind)?.kindPriority ?? 999;
  const pb = REGISTRY.get(b.kind)?.kindPriority ?? 999;
  return pa - pb;
}

// v1 baseline registrations.
register('board',    { label: 'Board',     kindPriority: 10, icon: LayoutGrid,     previewMini: BoardP.previewMini,    previewFull: BoardP.previewFull });
register('group',    { label: 'Group',     kindPriority: 15, icon: Folder,         previewMini: GroupP.previewMini,    previewFull: GroupP.previewFull });
register('doc',      { label: 'Doc',       kindPriority: 20, icon: FileText,       previewMini: DocP.previewMini,      previewFull: DocP.previewFull });
register('docPos',   { label: 'Doc anchor',kindPriority: 25, icon: FileText,       previewMini: DocP.previewMini,      previewFull: DocP.previewFull });
register('palette',  { label: 'Palette',   kindPriority: 30, icon: Palette,        previewMini: PaletteP.previewMini,  previewFull: PaletteP.previewFull });
register('schedule', { label: 'Schedule',  kindPriority: 35, icon: Calendar,       previewMini: CardP.previewMini,     previewFull: CardP.previewFull });
register('card',     { label: 'Card',      kindPriority: 40, icon: StickyNote,     previewMini: CardP.previewMini,     previewFull: CardP.previewFull });
register('note',     { label: 'Note',      kindPriority: 42, icon: StickyNote,     previewMini: NoteP.previewMini,     previewFull: NoteP.previewFull });
register('image',    { label: 'Image',     kindPriority: 45, icon: Image,          previewMini: ImageP.previewMini,    previewFull: ImageP.previewFull });
register('link',     { label: 'Link card', kindPriority: 50, icon: Link,           previewMini: UrlP.previewMini,      previewFull: UrlP.previewFull });
register('message',  { label: 'Message',   kindPriority: 60, icon: MessageSquare,  previewMini: MessageP.previewMini,  previewFull: MessageP.previewFull });
register('user',     { label: 'Person',    kindPriority: 70, icon: User,           previewMini: UserP.previewMini,     previewFull: UserP.previewFull });
register('url',      { label: 'Link',      kindPriority: 80, icon: Link,           previewMini: UrlP.previewMini,      previewFull: UrlP.previewFull });
// Tags participate in the same picker / hover / backlinks surfaces
// as everything else now (see migration 0036). Priority sits between
// docs and palettes so they show up high in @-mention pickers but
// not above the more navigable kinds (boards / docs).
register('tag',      { label: 'Tag',       kindPriority: 22, icon: Tag,            previewMini: TagP.previewMini,      previewFull: TagP.previewFull });
