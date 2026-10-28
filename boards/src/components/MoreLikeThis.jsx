// More like this — the pictures in the workspace nearest to the one being
// looked at, as a strip under it, in Quick look and in the canvas's viewer
// (the owner's pick of the mockups, direction A, 2026-10-28). Nearest by
// similar_pictures (0596): the card embeddings, which carry each picture's
// description. A click opens that picture in the same viewer.
//
// Nothing shows when nothing is close enough (lib/similarPictures.js), and
// the AI's words never show: a thumbnail is its picture, and its name is the
// one the card already has.
//
// Lazy in both viewers (lazyWithReload), so the app's own script and CSS
// carry none of it. Signed-in only: the read is closed to anon, and the
// viewers don't mount it on a public page.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { pickSimilar, similarCardOf, SIMILAR_LIMIT } from '../lib/similarPictures.js';
import { toListItem } from '../lib/listItem.js';
import { primeImageMeta } from '../lib/imageMeta.js';
import { CardPreview } from './clusterBrowser/CardPreview.jsx';
import './moreLikeThis.css';

// Per picture, for a few minutes: stepping back and forth through a walk
// asks once.
const CACHE = new Map();
const TTL_MS = 5 * 60 * 1000;
const keyOf = (boardId, cardId) => `${boardId}:${cardId}`;
function cached(boardId, cardId) {
  const hit = CACHE.get(keyOf(boardId, cardId));
  return hit && Date.now() - hit.at < TTL_MS ? hit.items : null;
}

async function loadSimilar(boardId, cardId, boards) {
  const { data, error } = await supabase.rpc('similar_pictures', { p_board: boardId, p_card: String(cardId), p_limit: SIMILAR_LIMIT });
  if (error) throw error;
  const near = pickSimilar(data);
  let items = [];
  if (near.length) {
    // The read hands back ids; the cards say which picture each one shows.
    const { data: rows, error: rowsError } = await supabase.from('card_index')
      .select('board_id, card_id, title, meta')
      .in('board_id', [...new Set(near.map((n) => n.boardId))])
      .in('card_id', near.map((n) => n.cardId));
    if (rowsError) throw rowsError;
    const byKey = new Map((rows || []).map((r) => [keyOf(r.board_id, r.card_id), r]));
    for (const n of near) {
      const card = similarCardOf(byKey.get(keyOf(n.boardId, n.cardId)));
      const item = card ? toListItem(card, { boards, boardId: n.boardId }) : null;
      if (item) items.push(item);
    }
    // The small stored sizes, before the first paint: without them a
    // thumbnail is the original, megabytes for 116 pixels.
    await primeImageMeta(items.map((it) => it.card.src.slice(3))).catch(() => {});
  }
  if (CACHE.size > 200) CACHE.clear();
  CACHE.set(keyOf(boardId, cardId), { at: Date.now(), items });
  return items;
}

const stop = (e) => e.stopPropagation();

export default function MoreLikeThis({ boardId, cardId, boards = {}, onOpen = null, className = '' }) {
  const [items, setItems] = useState(() => (boardId && cardId ? cached(boardId, cardId) : null));

  useEffect(() => {
    let off = false;
    const hit = boardId && cardId ? cached(boardId, cardId) : null;
    setItems(hit);
    if (hit || !boardId || !cardId) return undefined;
    // A beat after the picture lands, so a quick walk through doesn't ask
    // for every picture it passes.
    const t = setTimeout(() => {
      loadSimilar(boardId, cardId, boards).then(
        (list) => { if (!off) setItems(list); },
        () => { if (!off) setItems([]); },
      );
    }, 150);
    return () => { off = true; clearTimeout(t); };
    // `boards` only names the clusters on the items; a new map is no new ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, cardId]);

  if (!items?.length) return null;
  return (
    // Clicks stay here: the viewers close on a click that reaches their room.
    <section className={`mlt${className ? ` ${className}` : ''}`} aria-label="More like this"
             onClick={stop} onPointerDown={stop} onDoubleClick={stop}>
      <div className="mlt-head">
        <span className="mlt-title">More like this</span>
        <span className="mlt-scope">From this workspace</span>
      </div>
      <ul className="mlt-row">
        {items.map((it) => (
          <li key={keyOf(it.boardId, it.id)}>
            <button type="button" className="mlt-th" title={it.name} aria-label={`Open ${it.name}`}
                    onClick={() => onOpen?.(it)}>
              <CardPreview item={it} size="tile" px={120} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
