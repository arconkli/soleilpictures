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
