// What a doc's bar lights, and the choices it offers: today's bar
// (components/DocToolbar.jsx) and the doc look's (components/doc/DocBarA.jsx)
// read the same thing the same way.

export const HEADING_OPTIONS = [
  { value: 'p', label: 'Body' },
  { value: 'h1', label: 'Heading 1' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
  { value: 'h4', label: 'Heading 4' },
  { value: 'h5', label: 'Heading 5' },
  { value: 'h6', label: 'Heading 6' },
];

export const FONTS = [
  { id: 'sans', label: 'Sans', css: 'Inter, system-ui, sans-serif' },
  { id: 'serif', label: 'Serif', css: 'ui-serif, Georgia, "Iowan Old Style", serif' },
  { id: 'mono', label: 'Mono', css: 'JetBrains Mono, ui-monospace, monospace' },
];

export const SIZES = [12, 14, 16, 18, 22, 28, 36];

// The text colours, with the names a swatch is called by.
export const DOC_COLORS = [
  { c: '#f5f5f6', name: 'White' },
  { c: '#0a0a0c', name: 'Black' },
  { c: '#ef4444', name: 'Red' },
  { c: '#f59e0b', name: 'Amber' },
  { c: '#10b981', name: 'Green' },
  { c: '#3b82f6', name: 'Blue' },
  { c: '#8b5cf6', name: 'Violet' },
  { c: '#ec4899', name: 'Pink' },
];
export const COLORS = DOC_COLORS.map((x) => x.c);

// Everything the bar lights, as one flat object. `heading` is '' (a neutral
// placeholder) when the caret is in a block the style picker can't name —
// code, a quote, a list — rather than claiming "Body".
export const NO_BAR = {
  heading: 'p', spElement: '', dual: false, fontFamily: '', fontSize: null, color: '',
  bold: false, italic: false, underline: false, strike: false, code: false, highlight: false,
  bulletList: false, orderedList: false, taskList: false, blockquote: false, codeBlock: false,
  align: 'left', hasSelection: false,
};
export function readBar(editor) {
  if (!editor || editor.isDestroyed) return NO_BAR;
  const on = (name, attrs) => editor.isActive(name, attrs) || false;
  let heading = '';
  for (let l = 1; l <= 6 && !heading; l++) if (on('heading', { level: l })) heading = 'h' + l;
  if (!heading) {
    heading = (on('codeBlock') || on('blockquote') || on('bulletList') || on('orderedList') || on('taskList')) ? '' : 'p';
  }
  const inSp = on('screenplayBlock');
  const sp = inSp ? (editor.getAttributes('screenplayBlock') || {}) : {};
  const style = editor.getAttributes('textStyle') || {};
  const px = style.fontSize ? parseInt(style.fontSize, 10) : NaN;
  return {
    heading,
    // Screenplay element <select> (replaces the block-style picker in script mode).
    spElement: inSp ? (sp.element || 'action') : '',
    dual: inSp && !!sp.dual,
    fontFamily: style.fontFamily || '',
    fontSize: Number.isFinite(px) ? px : null,
    color: style.color || '',
    bold: on('bold'),
    italic: on('italic'),
    underline: on('underline'),
    strike: on('strike'),
    code: on('code'),
    highlight: on('highlight'),
    bulletList: on('bulletList'),
    orderedList: on('orderedList'),
    taskList: on('taskList'),
    blockquote: on('blockquote'),
    codeBlock: on('codeBlock'),
    align: on({ textAlign: 'center' }) ? 'center' : on({ textAlign: 'right' }) ? 'right'
      : on({ textAlign: 'justify' }) ? 'justify' : 'left',
    hasSelection: !editor.state.selection.empty,
  };
}
