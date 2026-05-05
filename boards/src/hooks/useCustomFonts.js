import { useEffect, useState } from 'react';
import { getCustomFonts, subscribeFonts, getRecentFonts, subscribeRecentFonts } from '../lib/customFonts.js';

export function useCustomFonts() {
  const [fonts, setFonts] = useState(() => getCustomFonts());
  useEffect(() => {
    setFonts(getCustomFonts());
    return subscribeFonts(setFonts);
  }, []);
  return fonts;
}

export function useRecentFonts() {
  const [fonts, setFonts] = useState(() => getRecentFonts());
  useEffect(() => {
    setFonts(getRecentFonts());
    return subscribeRecentFonts(setFonts);
  }, []);
  return fonts;
}
