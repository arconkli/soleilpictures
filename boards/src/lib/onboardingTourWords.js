// The first-run tour's words, read through Lingui. App-only mirror of the copy
// in onboardingTour.js: a Playwright spec (tests/onboarding-tour-engine.spec.js)
// imports that module in node, so it stays English and macro-free.
// onboardingTourWords.test.mjs pins this file's English to that one's.
//
// Keyed by step id (ids are unique across the three tours). The project tour's
// content step picks its title by the intent, so that title is keyed by its
// English, which is what the step carries.
import { t } from '@lingui/core/macro';

const COPY = {
  create: () => ({
    title: t`Make your first cluster`,
    body: t`Grab the Cluster tool, then click the canvas to drop a cluster — a home for images, notes & scripts.`,
    touch: t`Tap the Cluster tool, then tap the canvas to drop your first cluster.`,
  }),
  rename: () => ({
    title: t`Name it`,
    body: t`Give your cluster a name so it’s easy to find later.`,
    touch: t`Type a name for your cluster.`,
  }),
  open: () => ({
    title: t`Step inside`,
    body: t`Click your cluster to open it.`,
    touch: t`Tap your cluster to open it.`,
  }),
  nav: () => ({
    title: t`Find your way back`,
    body: t`This trail is how you get around — click Studio anytime to pop back out.`,
    touch: t`This trail is how you navigate — tap Studio to go back.`,
    cta: t`Got it`,
  }),
  content: () => ({
    title: t`Now add anything`,
    body: t`An image, a note, a doc, a file — drop in whatever you want. This is your canvas.`,
    touch: t`Add your first photos — or anything else. This is your canvas.`,
    touchLabel: t`Add photos`,
  }),
  list: () => ({
    title: t`Every cluster is also a drive`,
    body: t`Every file you add is in Files, in the sidebar. Open it full screen (or press F) to browse this cluster like a drive. Free covers images and small media; Creator stores any file, any size.`,
    touch: t`Every file you add is in Files, in the sidebar. Tap here to browse this cluster full screen, like a drive. Free covers images and small media; Creator stores any file, any size.`,
    cta: t`Got it`,
  }),
  add_photos: () => ({
    title: t`Add your photos`,
    body: t`Pick a few from your camera roll — they land right on your canvas.`,
    touch: t`Pick a few from your camera roll — they land right on your canvas.`,
    touchLabel: t`Add photos`,
  }),
  group: () => ({
    title: t`Group them into a cluster`,
    body: t`Tap + then New cluster to group these — drag photos in, name it.`,
    touch: t`Tap + then New cluster to group these — drag photos in, name it.`,
    cta: t`Done`,
  }),
  pick_intent: () => ({
    title: t`What are you working on?`,
    body: t`Pick one and we’ll shape your first steps around it — or skip and start blank.`,
    touch: t`Pick one and we’ll shape your first steps around it — or skip and start blank.`,
  }),
  add_content: () => ({
    title: t`Now drop your images in`,
    body: t`Paste or drag images from any tab, or drop a whole folder — video, scripts and PDFs too. This is your workspace.`,
    touch: t`Add your first images — or anything else. This is your canvas.`,
    touchLabel: t`Add photos`,
  }),
};

// The project tour's content step names the material the person said they were
// bringing (onboardingTour.js copyFor): its English title picks the words.
const DROP_TITLES = {
  'Now drop your references in': () => t`Now drop your references in`,
  'Now drop your frames in': () => t`Now drop your frames in`,
  'Now drop your images in': () => t`Now drop your images in`,
};

// The intent buttons on the project tour's first step, by key.
const INTENT_LABELS = {
  moodboard: () => t`A moodboard`,
  storyboard: () => t`A storyboard`,
  references: () => t`Collecting references`,
  exploring: () => t`Just exploring`,
};

// The welcome block on a tour's first card (onboardingTour.js TOUR_WELCOME),
// its kinds by key.
const WELCOME_KINDS = {
  pictures: () => t`Pictures`,
  video: () => t`Video`,
  scripts: () => t`Scripts`,
  docs: () => t`Docs`,
  files: () => t`Files`,
  links: () => t`Links`,
};

export function tourWelcomeWords(welcome) {
  return {
    title: t`Welcome to Clusters`,
    body: t`One workspace for all your creative work.`,
    kinds: (welcome?.kinds || []).map((k) => ({ key: k.key, label: WELCOME_KINDS[k.key]?.() ?? k.label })),
  };
}

// { title, body, touch, cta, touchLabel } for a step the engine handed back.
// Anything this file doesn't know reads as the step's own English.
export function tourStepWords(step) {
  const w = COPY[step?.id]?.() || {};
  const title = step?.id === 'add_content'
    ? (DROP_TITLES[step.copy?.title]?.() ?? w.title ?? step.copy?.title)
    : (w.title ?? step?.copy?.title);
  return {
    title,
    body: w.body ?? step?.copy?.body,
    touch: w.touch ?? step?.copy?.touch,
    cta: step?.cta ? (w.cta ?? step.cta) : undefined,
    touchLabel: step?.touchAction ? (w.touchLabel ?? step.touchAction.label) : undefined,
  };
}

export function tourChoiceLabel(choice) {
  return INTENT_LABELS[choice?.key]?.() ?? choice?.label;
}
