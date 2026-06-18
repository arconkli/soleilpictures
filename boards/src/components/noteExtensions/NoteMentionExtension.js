import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';

// `@`-trigger for notes — opens the EntityPicker at the caret (mounted by React
// via the supplied callbacks) and, on commit, inserts a `noteMention` node
// carrying the chosen entity ref + label. Mirrors the doc MentionExtension but
// inserts the note chip node (which renders the .tt-link[data-entity-ref]
// contract) instead of a link mark.
const NOTE_MENTION_KEY = new PluginKey('soleilNoteMention');

export const NoteMentionExtension = (options) => Extension.create({
  name: 'soleilNoteMention',

  addProseMirrorPlugins() {
    return [
      Suggestion({
        pluginKey: NOTE_MENTION_KEY,
        editor: this.editor,
        char: '@',
        startOfLine: false,
        items: () => [],
        command: ({ editor, range, props }) => {
          const { ref, label } = props || {};
          if (!ref || !label) return;
          editor.chain().focus()
            .deleteRange(range)
            .insertContent([
              { type: 'noteMention', attrs: { entityRef: ref, label } },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        render: () => {
          let cleanup = null;
          return {
            onStart: (props) => {
              try { cleanup = options.onStart?.(props); }
              catch (e) { console.warn('note mention onStart failed', e); }
            },
            onUpdate: (props) => {
              try { options.onUpdate?.(props); }
              catch (e) { console.warn('note mention onUpdate failed', e); }
            },
            onKeyDown: (props) => (options.onKeyDown ? !!options.onKeyDown(props) : false),
            onExit: () => { try { cleanup?.(); } catch (_) {} cleanup = null; },
          };
        },
      }),
    ];
  },
});
