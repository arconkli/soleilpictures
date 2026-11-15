// How an amount of storage reads in the app: "212 GB", "1.2 GB", "1 TB".
// Binary units under the decimal names people use, as billingCopy labels a
// drive. Settings → Billing and the sidebar's meter both print with this, so
// the two never disagree about how full the same account is.
import { sizeText } from './intlFormat.js';

export function fmtBytes(b) {
  if (b == null) return '—';
  const tb = b / (1024 ** 4);
  if (tb >= 1) {
    const v = tb >= 10 ? Math.round(tb) : Math.round(tb * 10) / 10;
    return sizeText(`${v} TB`, v, 'terabyte', Number.isInteger(v) ? 0 : 1);
  }
  const gb = b / (1024 ** 3);
  if (gb >= 1) {
    const v = gb >= 10 ? Math.round(gb) : Number(gb.toFixed(1));
    return sizeText(`${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`, v, 'gigabyte', gb >= 10 ? 0 : 1);
  }
  const mb = b / (1024 ** 2);
  if (mb >= 1) {
    const v = mb >= 10 ? Math.round(mb) : Number(mb.toFixed(1));
    return sizeText(`${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`, v, 'megabyte', mb >= 10 ? 0 : 1);
  }
  const kb = Math.round(b / 1024);
  return sizeText(`${kb} KB`, kb, 'kilobyte', 0);
}
