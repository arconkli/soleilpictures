// Pure helpers for the Shared page (components/shared/SharedPage.jsx), kept
// apart so node --test can reach them.

const KIND_WORD = { video: 'Video', audio: 'Audio', image: 'Image', pdf: 'PDF', file: 'File', doc: 'Doc' };

// The little tile a row shows when it has no picture: the extension, else the kind.
export function typeTile(item) {
  const ext = String(item?.ext || '').slice(0, 4).toUpperCase();
  return ext || (KIND_WORD[item?.kind] || 'File').toUpperCase().slice(0, 4);
}

// "Anyone with the link can view · 2 people" for a row of Shared by me.
export function accessSummary(row) {
  const n = Number(row?.people_count) || 0;
  const people = n ? `${n} ${n === 1 ? 'person' : 'people'}` : null;
  const link = row?.link_access === 'comment' ? 'Anyone with the link can comment'
    : row?.link_access === 'edit' ? 'Anyone with the link can edit'
    : row?.link_access === 'view' ? 'Anyone with the link can view'
    : null;
  return [link || (people ? 'Only people added' : null), people].filter(Boolean).join(' · ');
}
