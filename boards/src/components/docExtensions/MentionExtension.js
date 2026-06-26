import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';

// Unique plugin key — keeps this Suggestion plugin from colliding with any
// other default-keyed @tiptap/suggestion plugin.
const MENTION_KEY = new PluginKey('soleilMention');

// `@`-trigger that opens the EntityPicker at the caret. The picker is
// mounted by React via callbacks supplied by the consumer. The
// extension's only job is the trigger char + range tracking + the
// command that turns the typed @text into a Link mark.
//
// options:
//   onStart(props)   — called once on `@`. Receives { range, query, clientRect }.
//                      Caller mounts the picker. Must return a cleanup fn.
//   onUpdate(props)  — called on each char typed after `@`.
//   onKeyDown(props) — optional; return true to consume keys (e.g. arrows).
export const MentionExtension = (options) => Extension.create({
  name: 'soleilMention',

  addProseMirrorPlugins() {
    return [
      Suggestion({
        pluginKey: MENTION_KEY,
        editor: this.editor,
        char: '@',
        startOfLine: false,
        // No internal items list — picker is fully React-driven.
        items: () => [],
        command: ({ editor, range, props }) => {
          // props supplied by the React caller's onCommit:
          //   { linkId, text }
          const { linkId, text } = props || {};
          if (!linkId || !text) return;
          editor.chain().focus()
            .deleteRange(range)
            .insertContent(text)
            .setTextSelection({ from: range.from, to: range.from + text.length })
            .setMark('link', { linkId })
            .run();
        },
        render: () => {
          let cleanup = null;
          return {
            onStart: (props) => {
              try { cleanup = options.onStart?.(props); }
              catch (e) { console.warn('mention onStart failed', e); }
            },
            onUpdate: (props) => {
              try { options.onUpdate?.(props); }
              catch (e) { console.warn('mention onUpdate failed', e); }
            },
            onKeyDown: (props) => {
              return options.onKeyDown ? !!options.onKeyDown(props) : false;
            },
            onExit: () => {
              try { cleanup?.(); } catch (_) {}
              cleanup = null;
            },
          };
        },
      }),
    ];
  },
});
