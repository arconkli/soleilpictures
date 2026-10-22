// The weight an icon is drawn at, given a floor its surroundings ask for.
// Phosphor's thin and light read as hairlines beside the files sidebar's
// regular icons; a surface in the sidebar's look (the full Files page and
// Quick look, direction A) lifts them to its floor and leaves every weight
// chosen on purpose (regular, bold, fill, duotone) alone. A floor only lifts.
const ORDER = ['thin', 'light', 'regular'];

export function shownWeight(weight, floor) {
  const w = ORDER.indexOf(weight);
  const f = ORDER.indexOf(floor);
  return w >= 0 && f > w ? floor : weight;
}
