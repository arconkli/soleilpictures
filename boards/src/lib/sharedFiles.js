// Pure helpers for the Shared page (components/shared/SharedPage.jsx), kept
// apart so node --test can reach them.

import { t, plural } from '@lingui/core/macro';

// Called at render, so the words follow the current language.
const kindWord = (kind) => ({ video: t`Video`, audio: t`Audio`, image: t`Image`, pdf: t`PDF`, file: t`File`, doc: t`Doc` })[kind];

// The little tile a row shows when it has no picture: the extension, else the kind.
export function typeTile(item) {
  const ext = String(item?.ext || '').slice(0, 4).toUpperCase();
  return ext || (kindWord(item?.kind) || t`File`).toUpperCase().slice(0, 5);
}

// "Anyone with the link can view · 2 people" for a row of Shared by me.
export function accessSummary(row) {
  const n = Number(row?.people_count) || 0;
  const people = n ? plural(n, { one: '# person', other: '# people' }) : null;
  const link = row?.link_access === 'comment' ? t`Anyone with the link can comment`
    : row?.link_access === 'edit' ? t`Anyone with the link can edit`
    : row?.link_access === 'view' ? t`Anyone with the link can view`
    : null;
  return [link || (people ? t`Only people added` : null), people].filter(Boolean).join(' · ');
}
