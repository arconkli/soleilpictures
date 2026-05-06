// Image preview — shows the thumbnail inline. R2Image handles `r2:<key>`
// sentinels and bare http(s) URLs; we just hand it whatever src lives
// in the card's meta.

import { R2Image } from '../R2Image.jsx';

export function previewMini(row) {
  const src = row?.meta?.src;
  if (!src) return null;
  return (
    <div className="ent-prev-image">
      <R2Image src={src} alt={row?.meta?.alt || row?.title || ''} />
    </div>
  );
}

export function previewFull(row) {
  const src = row?.meta?.src;
  if (!src) return null;
  return (
    <div className="ent-prev-image ent-prev-image-full">
      <R2Image src={src} alt={row?.meta?.alt || row?.title || ''} />
    </div>
  );
}
