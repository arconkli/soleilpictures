// How an amount of storage reads in the app: "212 GB", "1.2 GB", "1 TB".
// Binary units under the decimal names people use, as billingCopy labels a
// drive. Settings → Billing and the sidebar's meter both print with this, so
// the two never disagree about how full the same account is.
export function fmtBytes(b) {
  if (b == null) return '—';
  const tb = b / (1024 ** 4);
  if (tb >= 1) return `${tb >= 10 ? Math.round(tb) : Math.round(tb * 10) / 10} TB`;
  const gb = b / (1024 ** 3);
  if (gb >= 1) return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`;
  const mb = b / (1024 ** 2);
  if (mb >= 1) return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
  return `${Math.round(b / 1024)} KB`;
}
