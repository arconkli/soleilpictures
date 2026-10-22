// Words for Messages in the files sidebar's card look (components/
// messagesLook.js). Pure, for the panel and its tests.

const first = (label) => String(label || '').trim().split(/\s+/)[0];

// Under a group's name: "Lena, Jon, Sam and you"; a bigger group names two
// and counts the rest, you included: "Lena, Jon and 4 others".
export function membersLine(labels) {
  const names = (labels || []).map(first).filter(Boolean);
  if (!names.length) return 'Just you';
  if (names.length <= 3) return `${names.join(', ')} and you`;
  return `${names[0]}, ${names[1]} and ${names.length - 1} others`;
}

// A conversation matches a find when every word of it is in its title, its
// people's names or its last message, in any case.
export function conversationMatches({ title = '', names = [], preview = '' } = {}, query = '') {
  const words = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [title, ...(names || []), preview].join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

// A message as one line for the conversation list: its words without the
// markdown the thread draws (fenced and inline code, bold, italics, quotes,
// list marks), spaces folded. '' when there are no words (attachments only).
export function previewText(body) {
  let s = String(body || '');
  s = s.replace(/```[^\n]*\n?([\s\S]*?)```/g, ' $1 ');
  s = s.replace(/^[ \t]*>[ \t]?/gm, '');
  s = s.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '');
  s = s.replace(/`([^`\n]+)`/g, '$1');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1$2');
  return s.replace(/\s+/g, ' ').trim();
}

// "Here now" under a direct message's name, from the same presence the
// sidebar's "Maya and Jon are here" reads; nothing when they aren't (a line
// that says "Direct message" told you nothing).
export function dmSubline(peerHere) {
  return peerHere ? 'Here now' : '';
}
