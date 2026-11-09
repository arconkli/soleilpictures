// True once `active` has stayed true for `ms`: the "it is taking longer than
// usual" flag the viewers share. Goes back to false when `active` does.

import { useEffect, useState } from 'react';

export function useSlow(active, ms = 15000) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) { setSlow(false); return undefined; }
    const t = setTimeout(() => setSlow(true), ms);
    return () => { clearTimeout(t); setSlow(false); };
  }, [active, ms]);
  return slow;
}
