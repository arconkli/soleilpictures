import { mentionSegments } from '../../lib/commentMentionText.js';
import './commentsLook.css';

// A comment's words, line breaks kept, with each "@Name" of a mentioned
// person drawn as a chip. The chip is an ink tint, never gold.
//   body      the words
//   mentions  [{ id, name }] the people mentioned in them
//   as        the element to draw ('div' by default)
export function MentionText({ body, mentions, as: Tag = 'div', className = 'cmt-text' }) {
  const parts = mentionSegments(body, mentions);
  return (
    <Tag className={className}>
      {parts.map((p, i) => (p.type === 'mention'
        ? <span key={i} className="cmt-at" data-mention={p.id}>@{p.name}</span>
        : p.text))}
    </Tag>
  );
}
