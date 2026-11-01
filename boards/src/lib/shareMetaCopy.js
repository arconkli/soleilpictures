// The words of a /share/<token> link preview: the title, the description and
// the picture's alt text that worker.js injectShareMeta puts in the page.
// Pure, so a node test pins every branch.
//
//   kind 'invite'  an edit link ("<Sharer> invited you to edit …")
//   kind 'view'    a view link, the default
//
// `name` flows into the page through the Worker's escaping setters only.

const MAX_NAME = 60;

export function shareMetaName(name) {
  const n = String(name ?? '').trim();
  if (!n) return 'Untitled cluster';
  const chars = Array.from(n);
  return chars.length > MAX_NAME ? `${chars.slice(0, MAX_NAME - 1).join('')}…` : n;
}

export function shareMetaCopy({ kind, sharerName, name, cardCount } = {}) {
  const n = shareMetaName(name);
  const sharer = String(sharerName ?? '').trim();
  const quoted = `“${n}”`;
  const invite = kind === 'invite';

  const title = !sharer
    ? `${quoted} on Clusters`
    : invite
      ? `${sharer} invited you to edit ${quoted}`
      : `${sharer} shared ${quoted} with you`;

  const count = Number(cardCount);
  const description = invite
    ? 'Join free to add your own cards, notes and ideas.'
    : Number.isFinite(count) && count > 0
      ? `${count} ${count === 1 ? 'card' : 'cards'} on Clusters. Have a look, then join to follow along.`
      : 'Have a look on Clusters, then join to follow along.';

  return { title, description, alt: `${quoted}, a cluster on Clusters` };
}
