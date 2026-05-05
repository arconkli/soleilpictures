// Custom Tiptap node: an inline embed that references another board (and
// optionally a specific card inside it). Renders as a small live tile in
// the doc. Click → opens the referenced board.
//
// Atomic block-level node (`atom: true`) — Tiptap treats it as a single
// editable unit, so users can backspace it as one chunk.

import { Node, mergeAttributes } from '@tiptap/core';

export const BoardEmbed = Node.create({
  name: 'boardEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      boardId: { default: null },
      cardId:  { default: null },  // optional — focus this card when opened
      label:   { default: null },  // cached display label
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-board-embed]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-board-embed': '' }, HTMLAttributes)];
  },

  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'tt-embed';
      dom.contentEditable = 'false';
      dom.draggable = false;
      const update = () => {
        const label = node.attrs.label || (node.attrs.cardId ? 'Card' : 'Board');
        dom.innerHTML = '';
        const icon = document.createElement('div');
        icon.className = 'tt-embed-icon';
        icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M2 6 H14" stroke="currentColor" stroke-width="1.4"/></svg>';
        const body = document.createElement('div');
        body.className = 'tt-embed-body';
        const kicker = document.createElement('div');
        kicker.className = 'tt-embed-kicker';
        kicker.textContent = node.attrs.cardId ? 'CARD ON BOARD' : 'BOARD';
        const title = document.createElement('div');
        title.className = 'tt-embed-title';
        title.textContent = label;
        body.appendChild(kicker); body.appendChild(title);
        const arrow = document.createElement('div');
        arrow.className = 'tt-embed-arrow';
        arrow.textContent = '→';
        dom.appendChild(icon); dom.appendChild(body); dom.appendChild(arrow);
      };
      update();
      dom.addEventListener('click', (e) => {
        e.preventDefault();
        const detail = { boardId: node.attrs.boardId, cardId: node.attrs.cardId };
        // Bubble through a custom event so the doc surface (or any host) can
        // route the navigation. Decoupled from boards/app routing here.
        document.dispatchEvent(new CustomEvent('soleil-open-embed', { detail }));
      });
      return {
        dom,
        update(updated) {
          if (updated.type.name !== 'boardEmbed') return false;
          if (updated.attrs.label !== node.attrs.label) update();
          return true;
        },
      };
    };
  },

  addCommands() {
    return {
      insertBoardEmbed: (attrs) => ({ chain }) =>
        chain().focus().insertContent({ type: 'boardEmbed', attrs }).run(),
    };
  },
});
