// What a doc's Insert menu adds: content that has NO other home on the bar —
// Image, Table, Divider, Code block, Embed cluster. (Headings, lists, quote and
// bookmark are deliberately NOT here: they're already one click away as their
// own controls.) The doc look's Insert menu (components/doc/DocBarA.jsx) runs
// these rows.

import { safeRun } from '../lib/safeEditorCmd.js';
import { t } from '@lingui/core/macro';

// Each row runs on the live editor. An item whose handler is missing is left
// out (a guest in a shared doc has neither: DocSurface guestMode).
export function insertItems({ onInsertImage, onInsertBoardEmbed }) {
  return [
    { id: 'image', title: t`Image`, subtitle: t`Upload from your machine`,
      run: (e) => onInsertImage?.(e) },
    { id: 'table', title: t`Table`, subtitle: t`Insert 3×3 table`,
      run: (e) => safeRun(e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }), 'doc-insert:table') },
    { id: 'divider', title: t`Divider`, subtitle: t`Horizontal rule`,
      run: (e) => safeRun(e.chain().focus().setHorizontalRule(), 'doc-insert:divider') },
    // toggleCodeBlock → toggleNode → clearNodes when the block can't be set
    // directly: the same RangeError route the toolbar toggles are guarded on.
    { id: 'code', title: t`Code block`, subtitle: t`Monospace code`,
      run: (e) => safeRun(e.chain().focus().toggleCodeBlock(), 'doc-insert:code') },
    { id: 'embed', title: t`Embed cluster`, subtitle: t`Link to another cluster / card`,
      run: (e) => onInsertBoardEmbed?.(e) },
  ].filter((it) => (it.id === 'image' ? !!onInsertImage : it.id === 'embed' ? !!onInsertBoardEmbed : true));
}
