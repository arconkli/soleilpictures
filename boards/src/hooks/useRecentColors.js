import { useEffect, useState } from 'react';
import { getRecentColors, subscribeRecent } from '../lib/recentColors.js';

export function useRecentColors() {
  const [colors, setColors] = useState(() => getRecentColors());
  useEffect(() => subscribeRecent(setColors), []);
  return colors;
}
