// Single source of truth for whether the AI tagger engine is active.
// Default ON for everyone; explicit "0" in localStorage disables. Kept
// as a localStorage key so users can opt out from the console without
// a code change, and so a future settings UI has a place to flip it.

export function isAiTaggerEnabled() {
  try { return localStorage.getItem('soleil.ai_tagger') !== '0'; }
  catch { return true; }
}
