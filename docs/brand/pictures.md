# Soleil Pictures: the studio register

soleilpictures.com is the worked example of the studio register: a night sky, one slow sun, a typed name, and posters that bring their own colour. Its files sit at the repo root: `index.html`, `about-us.html`, `projects.html`, `style.css` and `script.js`. Back to the [brand book](README.md).

## The sun orb

The home page has no hero image and no tagline. It has the studio's name and a sun.

The sun is drawn live in `script.js` at the repo root with PixiJS on a full-screen canvas behind the page: ten soft circles in three close oranges around `sunset-glow` (`#f96b06`), fused into one glow by a heavy Kawase blur, with a dimmer glow at the centre. It sits low on the right of the screen, at about 78% across and 78% down, as if setting. It does not follow the pointer or the scroll; the sun is not a toy.

`sunset-glow` exists only here, as light. It is never a flat fill, never text and never a control. A product that wants this feeling takes a soft `soleil` glow behind its mark instead (see the [brand book](README.md#two-registers)).

## Night sky and stars

The ground is night. Over it the canvas scatters two layers of stars, a brighter eighty and a hundred barely visible ones, each with a slow twinkle, and a single pale blue point high on the left: the Earth, a small cool answer to the warm sun. Then the grain lies under everything, below the canvas, so the stars and the sun stay sharp. The ground today is a slightly bluer near-black than night; that is in [drift.md](drift.md).

## The slow breath

The sun and the wordmark breathe together on one shared cycle of about 42 seconds (`script.js`): the orbs drift apart and swell, and the glow around the name grows and fades with them. On a phone the sun is smaller and moves less. The breath is slow on purpose. It should be noticed after a while, not at once.

With reduced motion on, the sun is drawn once and holds still, and the stars do not twinkle.

## The letter entrance

The name arrives letter by letter. Each letter of SOLEIL PICTURES rises 6px out of a 4px blur to full opacity over .75s on `cubic-bezier(0.2, 0.6, 0.2, 1)`, each 35ms after the one before (`style.css` and `script.js`, `.logo-letter`). Words are wrapped so a line only breaks between them. Reduced motion skips the entrance.

## The typed wordmark

The studio's wordmark is type: an `h1` reading SOLEIL PICTURES, in Brandon Grotesque 700, 3rem, tracked 1rem, centred, in a warm white (`--light-color` in `style.css`), with a soft white glow that moves with the breath. On phones it is 2rem, tracked .4rem. On inner pages it sits small at the top centre. The tracking is wider than anything in a product because the name stands alone, as on a title card.

The half-sun mark is not on the page. It is the favicon and the link image, and it appears on the posters. See [marks.md](marks.md).

## White chrome

Everything the visitor touches is white on glass, and nothing is gold. The only warm thing on screen is the sun.

- **Hierarchy is alpha.** Text is white at .85 to .9 for primary, .8 for body, .6 for secondary, .4 to .5 for hints; borders .1 to .3; glass fills .04 to .2.
- **Navigation** is one glass pill fixed at the bottom of the screen: a dark tint, a white hairline, `blur(16px)`, fully round, with 44px tap targets and safe-area padding.
- **Focus** is a white double ring. Hover is a faint white fill, and only on devices that can hover.
- **Type**: Brandon capitals tracked wide for names, titles and navigation; Aileron for small labels, tags and counters; prose in sentence case.
- **Motion** in the chrome is `0.3s ease`; small lifts of 2px on hover.

This is deliberately different from a product, where gold marks state. In the studio register the sun is the atmosphere, so the controls stay out of its colour.

## Posters

The Projects page is a horizontal, scroll-driven carousel, one poster per screen, with a counter ("01 / 03") and dots. Each poster sits in a quiet frame: a 12px-radius white hairline, a faint glass fill and a soft shadow, the image itself at 6px radius, shown whole (`object-fit: contain`). Beside it: the title in Brandon capitals, the format ("Feature Film", "TV Series"), the status ("In Development", "Pre-Production") as small pills, genre tags and the logline in italic.

The studio lockup on a poster is the outline half-sun above "SOLEIL PICTURES" in small tracked capitals, set in a corner where it does not compete with the title.

## Films and their own grades

Each film keeps its own look, and the site does not pull them together:

- **YAHWEH**: near-black, white veil, a splash of red, an electric-blue rim light, a dithered scan-line finish.
- **Deep Dive**: black-and-white ink panels, stippled, a heavy white title.
- **Lost Time**: flat pop colour on a saturated crimson ground.

The neutral chrome is what lets three such different pictures sit side by side. The same films are the sample content in Clusters' link card and sign-in backdrop, which is how the two registers meet.

## Grain on the studio site

The studio site uses the shared grain at .03, fixed under the canvas (`.grain-bg` in `style.css`). Today it is an animated GIF (`assets/grain.gif`) on three pages only. The guide's grain is still and everywhere the ground shows; see [drift.md](drift.md).
