// What toListItem (lib/listItem.js) writes into an item, in the person's
// language: the type word, the name a card gets when it has none, and the line
// under it. A MIRROR of listItem.js's LIST_WORDS: that file stays English
// because tests/list-item-logic.spec.js reads it under Playwright, which can't
// read Lingui. The app passes this as toListItem's `words`.
// listItemWords.test.mjs keeps the two equal. App-only.
import { t, plural } from '@lingui/core/macro';
import { monthTitle } from './schedDatesWords.js';

function typeLabel(kind) {
  switch (kind) {
    case 'image': return t`Image`;
    case 'pdf': return 'PDF';
    case 'video': return t`Video`;
    case 'audio': return t`Audio`;
    case 'file': return t`File`;
    case 'note': return t`Note`;
    case 'link': return t`Link`;
    case 'doc': return t`Doc`;
    case 'palette': return t`Palette`;
    case 'schedule': return t`Schedule`;
    case 'shape': return t`Shape`;
    case 'grid': return t`Grid`;
    case 'board': return t`Cluster`;
    case 'boardlink': return t`Link`;
    case 'shortcut': return t`Shortcut`;
    default: return null;
  }
}

// What a file the card draws is called by its family (lib/fileView.js fileFamily).
function familyLabel(family) {
  switch (family) {
    case 'markdown': case 'text': return t`Text`;
    case 'code': return t`Code`;
    case 'table': return t`Spreadsheet`;
    case 'subtitles': return t`Subtitles`;
    case 'font': return t`Font`;
    case 'mail': return t`Email`;
    case 'design': return t`Design file`;
    case 'zip': case 'listed': return t`Archive`;
    default: return null;
  }
}

const itemName = () => t`Item`;

// What a card with no name of its own is called, by kind.
function fallbackName(kind) {
  switch (kind) {
    case 'image': return t`Image`;
    case 'pdf': return 'PDF';
    case 'video': return t`Video`;
    case 'audio': return t`Audio`;
    case 'file': return t`File`;
    case 'note': return t`Empty note`;
    case 'link': return t`Link`;
    case 'doc': return t`Doc`;
    case 'palette': return t`Palette`;
    case 'schedule': return t`Schedule`;
    case 'grid': return t`Grid`;
    case 'board': return t`Cluster`;
    case 'boardlink': return t`Linked cluster`;
    default: return itemName();
  }
}

export const listItemWords = Object.freeze({
  typeLabel,
  familyLabel,
  itemName,
  fallbackName,
  shapeName: (shape) => t`Shape (${shape})`,
  monthTitle,
  pages: (n) => plural(n, { one: '# page', other: '# pages' }),
  // English writes "1 lines" / "1 colors" / "1 rows" for one, as it always has.
  lines: (n) => plural(n, { other: '# lines' }),
  colors: (n) => plural(n, { other: '# colors' }),
  scheduleItems: (n) => plural(n, { one: '# item', other: '# items' }),
  scheduleRows: (n) => plural(n, { other: '# rows' }),
});
