import * as PIXI from "https://cdnjs.cloudflare.com/ajax/libs/pixi.js/5.3.12/pixi.min.js";
import { KawaseBlurFilter } from "https://cdn.jsdelivr.net/npm/@pixi/filter-kawase-blur@3.2.0/dist/filter-kawase-blur.min.js";
import SimplexNoise from "https://cdn.jsdelivr.net/npm/simplex-noise@3.0.0/dist/esm/simplex-noise.js";

// Utility Functions
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function hslToHex(h, s, l) {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hsl(h, s, l) {
  return hslToHex(h, s, l);
}

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function map(n, start1, end1, start2, end2) {
  return ((n - start1) / (end1 - start1)) * (end2 - start2) + start2;
}

// Clear console for clean output
console.clear();

// Mouse tracking setup
const circleElement = document.querySelector('.circle');
const mouse = { x: 0, y: 0 };
const previousMouse = { x: 0, y: 0 };
const circle = { x: 0, y: 0 };
let currentScale = 0;
let currentAngle = 0;

// Mouse movement handler
window.addEventListener('mousemove', (e) => {
  mouse.x = e.x;
  mouse.y = e.y;
});

// Animation speed
const speed = 0.17;

// Animation tick function
const tick = () => {
  // Movement
  circle.x += (mouse.x - circle.x) * speed;
  circle.y += (mouse.y - circle.y) * speed;
  const translateTransform = `translate(${circle.x}px, ${circle.y}px)`;

  // Squeeze effect
  const deltaMouseX = mouse.x - previousMouse.x;
  const deltaMouseY = mouse.y - previousMouse.y;
  previousMouse.x = mouse.x;
  previousMouse.y = mouse.y;
  const mouseVelocity = Math.min(Math.sqrt(deltaMouseX**2 + deltaMouseY**2) * 4, 150);
  const scaleValue = (mouseVelocity / 150) * 0.5;
  currentScale += (scaleValue - currentScale) * speed;
  const scaleTransform = `scale(${1 + currentScale}, ${1 - currentScale})`;

  // Rotation
  const angle = Math.atan2(deltaMouseY, deltaMouseX) * 180 / Math.PI;
  if (mouseVelocity > 20) {
    currentAngle = angle;
  }
  const rotateTransform = `rotate(${currentAngle}deg)`;

  // Apply transforms
  circleElement.style.transform = `${translateTransform} ${rotateTransform} ${scaleTransform}`;

  // Continue animation
  window.requestAnimationFrame(tick);
};

// Start animation
tick();

// Create simplex noise instance
const simplex = new SimplexNoise();

// Color Palette Class
class ColorPalette {
  constructor() {
    this.setColors();
    this.setCustomProperties();
  }

  setColors() {
    this.hue = 25;
    this.complimentaryHue1 = 22.5;
    this.complimentaryHue2 = 27.5;
    this.saturation = 95;
    this.lightness = 50;

    this.baseColor = hsl(this.hue, this.saturation, this.lightness);
    this.complimentaryColor1 = hsl(
      this.complimentaryHue1,
      this.saturation,
      this.lightness
    );
    this.complimentaryColor2 = hsl(
      this.complimentaryHue2,
      this.saturation,
      this.lightness
    );

    this.colorChoices = [
      this.baseColor,
      this.complimentaryColor1,
      this.complimentaryColor2
    ];
  }

  randomColor() {
    return this.colorChoices[~~random(0, this.colorChoices.length)].replace(
      "#",
      "0x"
    );
  }

  setCustomProperties() {
    document.documentElement.style.setProperty("--hue", this.hue);
    document.documentElement.style.setProperty(
      "--hue-complimentary1",
      this.complimentaryHue1
    );
    document.documentElement.style.setProperty(
      "--hue-complimentary2",
      this.complimentaryHue2
    );
  }
}

// Orb Class
class Orb {
  constructor(fill = 0x000000) {
    this.bounds = this.setBounds();
    this.x = random(this.bounds["x"].min, this.bounds["x"].max);
    this.y = random(this.bounds["y"].min, this.bounds["y"].max);
    this.scale = 1;
    this.fill = fill;
    this.radius = random(window.innerHeight / 6, window.innerHeight / 3);
    this.xOff = random(0, 1000);
    this.yOff = random(0, 1000);
    this.inc = 0.002;
    this.graphics = new PIXI.Graphics();
    this.graphics.alpha = 0.825;

    window.addEventListener(
      "resize",
      debounce(() => {
        this.bounds = this.setBounds();
      }, 250)
    );
  }

  setBounds() {
    const maxDist =
      window.innerWidth < 1000 ? window.innerWidth / 3 : window.innerWidth / 5;
    const originX = window.innerWidth / 1.25;
    const originY =
      window.innerWidth < 1000
        ? window.innerHeight
        : window.innerHeight / 1.375;

    return {
      x: {
        min: originX - maxDist,
        max: originX + maxDist
      },
      y: {
        min: originY - maxDist,
        max: originY + maxDist
      }
    };
  }

  update() {
    const xNoise = simplex.noise2D(this.xOff, this.xOff);
    const yNoise = simplex.noise2D(this.yOff, this.yOff);
    const scaleNoise = simplex.noise2D(this.xOff, this.yOff);

    this.x = map(xNoise, -1, 1, this.bounds["x"].min, this.bounds["x"].max);
    this.y = map(yNoise, -1, 1, this.bounds["y"].min, this.bounds["y"].max);
    this.scale = map(scaleNoise, -1, 1, 0.5, 1);

    this.inc = 0.00075;

    const pulse = Math.sin(this.xOff * 0.5) * 0.2;
    this.scale += pulse;

    this.graphics.rotation += 0.001;

    this.xOff += this.inc;
    this.yOff += this.inc;
  }

  render() {
    this.graphics.x = this.x;
    this.graphics.y = this.y;
    this.graphics.scale.set(this.scale);

    this.graphics.clear();
    this.graphics.beginFill(this.fill);
    this.graphics.drawCircle(0, 0, this.radius);
    this.graphics.endFill();
  }
}

// Create PixiJS app
const app = new PIXI.Application({
  view: document.querySelector(".orb-canvas"),
  resizeTo: window,
  transparent: false
});

app.stage.filters = [new KawaseBlurFilter(30, 10, true)];

// Create color palette
const colorPalette = new ColorPalette();

// Create orbs
const orbs = [];
const numOrbs = 15;
const orbRadius = window.innerHeight / 4;

for (let i = 0; i < numOrbs; i++) {
  const orb = new Orb(colorPalette.randomColor());
  orb.radius = orbRadius;
  app.stage.addChild(orb.graphics);
  orbs.push(orb);
}

// Create central orb
const centralOrb = new Orb(0xffffff);
centralOrb.radius = window.innerHeight / 5;
centralOrb.x = window.innerWidth / 2;
centralOrb.y = window.innerHeight / 2;

// Animation
if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  app.ticker.add(() => {
    app.renderer.clear();
    orbs.forEach((orb) => {
      orb.update();
      orb.render();
    });
  });
} else {
  orbs.forEach((orb) => {
    orb.update();
    orb.render();
  });
}

// Color change button handler
document
  .querySelector(".overlay__btn--colors")
  ?.addEventListener("click", () => {
    colorPalette.setColors();
    colorPalette.setCustomProperties();

    orbs.forEach((orb) => {
      orb.fill = colorPalette.randomColor();
    });
  });

// Bento grid functionality
const bentoElements = document.querySelectorAll('.bento');
const container = document.querySelector('.bento-container');

bentoElements.forEach(element => {
  element.addEventListener('mouseover', () => {
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    const maxScale = Math.min(
      (containerRect.width - elementRect.left) / elementRect.width,
      (containerRect.right - elementRect.right) / elementRect.width,
      (containerRect.height - elementRect.top) / elementRect.height,
      (containerRect.bottom - elementRect.bottom) / elementRect.height
    );

    element.style.transform = `scale(${maxScale})`;
  });

  element.addEventListener('mouseout', () => {
    element.style.transform = 'scale(1)';
  });
});

// Project details buttons
const detailsBtns = document.querySelectorAll('.details-btn');

detailsBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const projectId = btn.dataset.projectId;
    console.log(`Showing details for project ${projectId}`);
  });
});
