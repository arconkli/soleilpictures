// A comment reply's @-mentions, as text: the thread popover
// (components/CommentInlinePopover.jsx) and the doc look's Comments panel
// (components/doc/DocCommentsTab.jsx) both type them the same way.

// The unbroken "@word" the caret is at the end of, scanning back from it
// (the rule MessageComposer and InlineComposer use): { tokenStart, query },
// or null when the caret isn't in one.
export function detectMentionToken(text, caret) {
  let i = caret - 1;
  while (i >= 0 && /\S/.test(text[i]) && text[i] !== '@') i--;
  if (i < 0 || text[i] !== '@') return null;
  return { tokenStart: i, query: text.slice(i + 1, caret) };
}

// The ids of the people picked whose @name is still in the text when it's
// sent: someone can pick a person and then delete the mention again.
export function matchMentions(body, picked) {
  return [...new Set(picked.filter((m) => body.includes('@' + m.name)).map((m) => m.id))];
}
