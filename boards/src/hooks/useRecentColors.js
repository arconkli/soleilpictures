import { useEffect, useState } from 'react';
import { getRecentColors, subscribeRecent, getSavedColors, subscribeSaved } from '../lib/recentColors.js';

export function useRecentColors() {
  const [colors, setColors] = useState(() => getRecentColors());
  useEffect(() => subscribeRecent(setColors), []);
  return colors;
}

export function useSavedColors() {
  const [colors, setColors] = useState(() => getSavedColors());
  useEffect(() => subscribeSaved(setColors), []);
  return colors;
}
