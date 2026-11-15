// The semantic type of a tag (tags.entity_type) — what KIND of thing the
// tag is about. Orthogonal to `kind` (provenance: user/auto/ai). Drives the
// candidate promote prompt's buttons, the promote toast, and the hover-card
// header label, so the four types stay consistent everywhere.
//
// The DB CHECK (migration 0161) permits exactly these five values (or null).
// Note the value 'concept' surfaces to users as "Topic" — the catch-all for
// anything that isn't a character/setting/organization/thing (e.g. Pricing).

import { t } from '@lingui/core/macro';
import { User, Pin, Hash, Hexagon, Users } from './icons.js';

export const ENTITY_TYPES = [
  { value: 'character',    get label() { return t`Character`; }, Icon: User },
  { value: 'setting',      get label() { return t`Setting`; }, Icon: Pin },
  { value: 'organization', get label() { return t`Organization`; }, Icon: Users },
  { value: 'concept',      get label() { return t`Topic`; }, Icon: Hash },
  { value: 'thing',        get label() { return t`Thing`; }, Icon: Hexagon },
];

const BY_VALUE = new Map(ENTITY_TYPES.map((t) => [t.value, t]));

export function entityTypeLabel(value) {
  return BY_VALUE.get(value)?.label || (value ? String(value) : null);
}

// Plural of the label, each its own message (not `${label}s`). An unknown value
// keeps the old `${value}s`.
export function entityTypePluralLabel(value) {
  switch (value) {
    case 'character': return t`Characters`;
    case 'setting': return t`Settings`;
    case 'organization': return t`Organizations`;
    case 'concept': return t`Topics`;
    case 'thing': return t`Things`;
    default: return `${value}s`;
  }
}

export function entityTypeIcon(value) {
  return BY_VALUE.get(value)?.Icon || null;
}

// Client mirror of the SQL guess_entity_type (migration 0153): a single
// Capitalized token reads as a proper-name character (Yahweh, Enoch); anything
// multi-word or lowercase reads as a Topic (concept). Used when adopting a
// discovered name so it lands already typed; the one-tap switch fixes the rest.
export function guessEntityType(name) {
  return /^[A-Z][A-Za-z'\-]*$/.test((name || '').trim()) ? 'character' : 'concept';
}
