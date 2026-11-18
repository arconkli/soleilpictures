// The one text a card is embedded from.
//
// Every writer of card_embeddings builds it here: the server embedder
// (lib/serverEmbed.js, the API work) and the picture-reading job. It starts
// from the card's card_index projection (cardIndexRow.js: the indexed title
// and body), so content_hash agrees and no writer re-embeds over another.
// Board and group names are never stored in a card's embedding.

import { contentHash } from './clusterMath.js';

function clean(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// card: { title, body } as card_index stores them. description: an image's
// stored description and keywords, or null.
export function embedTextForCard(card, description = null) {
  return [clean(card?.title), clean(card?.body), clean(description)].filter(Boolean).join(' ');
}

// Images and videos are embedded by the server, with their descriptions. A
// client write without the description would replace the richer vector.
export function clientEmbedsKind(kind) {
  return kind !== 'image' && kind !== 'video';
}

// The content_hash every writer stores beside the vector.
export const embedHash = contentHash;
