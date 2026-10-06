# Product education for retention — design (2026-10-06)

## The question

Do people leave because they never learn how much Clusters can do, and would
teaching them fix it?

## What the data said

Read-only pass over the live analytics, every day-one signal stratified by
depth band, load-bearing numbers re-derived by an independent critic. The
findings are recorded in the admin deck rather than here (the repo is public):

- Breadth is invisible in use — most people who place anything use one or two
  card kinds — but **day-one breadth does not predict return inside any depth
  band**, under 7-day, 14-day or built-return definitions.
- **Every surface that tells people about power is null for return**: the
  tour, the intent pick, the just-in-time reveals (ignored by the most
  habitual users, who reached the same features unprompted), the docs site
  (unreachable from inside the app except by a ⌘K command and a `?`-key
  overlay).
- What separates returners inside a band is **how the material arrived**:
  boards placed by hand, card by card, come back; boards that landed in a
  burst (a folder drop, a multi-file pick, an import) do not. "Stuck placing
  the first card" dissolved into this once split by gesture.
- Return visits are mostly **looks**; retrieval features (search, list view,
  download) are nearly unused even by habitual users, and search cannot find
  what people store, because most stored images carry no words.
- The specific, small how-to failures that do show up: a search that returns
  nothing, nested clusters left unnamed, grids left empty, a tool armed with
  nothing placed, the file picker opened and cancelled.

## What this changes

Education **where it demonstrably can work**, each piece graded on its own
conversion, never on return:

0. **Instruments** — `admin_feature_reach` (reach per signup week on day one
   and by day fourteen) and `admin_return_by_mode` (fixed-horizon return split
   by hand vs burst), both in migration 0365, with panels on RetentionView.
   Every later read of a day-one signal is stratified by import mode.
1. **Help that can be found** — a visible Help entry (topbar, sidebar, phone
   Settings): what can I add here, keyboard shortcuts, guides into `/docs`,
   what's new, send feedback. Pull, outside the ambient ask budget.
2. **Hints at the moment something fails** — search found nothing; tool armed
   and idle; picker cancelled; cluster left unnamed; grid left empty. Once per
   kind per device, never two at once, never during the tour.
3. **Email that teaches**, as a factorial arm the lifecycle optimizer grades.
4. **Open file types on free** within the card cap and per-file size ceilings
   (owner's decision), with every public claim about plans rewritten in the
   same commit and the public-claims lint updated to enforce the new truth.

Not built, on the evidence: another tour, a feature carousel, a "what's new"
interstitial, more reveals, a video course, AI captioning.

## Saved for later

The "creator database" needs three legs this pass found missing — retrieval
(words on images: captions, file names, source site), storage on free, and
capture from outside. The retrieval plan (no AI spend) is held in the owner's
plan file; capture-from-outside stays on its own revisit date.

## Measurement

Pre-registered in the plan file: search success, signed-in help and docs
opens, feature reach at day fourteen by signup week, unnamed-cluster rate,
picker-cancel recovery, hint conversion, free non-media uploads. Every read
stratified by depth band and import mode; never inside three days of a ship.
