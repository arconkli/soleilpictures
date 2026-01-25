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

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function map(n, start1, end1, start2, end2) {
  return ((n - start1) / (end1 - start1)) * (end2 - start2) + start2;
}

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
function tick() {
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
  requestAnimationFrame(tick);
}

// Start animation
tick();

// Color Palette Class - Warmer golden/amber tones for sun-like feel
class ColorPalette {
  constructor() {
    this.setColors();
    this.setCustomProperties();
  }

  setColors() {
    this.hue = 25; // Back to orange
    this.complimentaryHue1 = 22.5;
    this.complimentaryHue2 = 27.5;
    this.saturation = 95;
    this.lightness = 50; // Original brightness

    this.baseColor = hslToHex(this.hue, this.saturation, this.lightness);
    this.complimentaryColor1 = hslToHex(
      this.complimentaryHue1,
      this.saturation,
      this.lightness
    );
    this.complimentaryColor2 = hslToHex(
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
    return this.colorChoices[Math.floor(random(0, this.colorChoices.length))].replace(
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

// Orb Class - Enhanced for elegant sun-like effect
class Orb {
  constructor(fill = 0x000000, index = 0, total = 10) {
    this.index = index;
    this.total = total;
    this.bounds = this.setBounds();
    this.x = random(this.bounds["x"].min, this.bounds["x"].max);
    this.y = random(this.bounds["y"].min, this.bounds["y"].max);
    this.scale = 1;
    this.fill = fill;
    // Larger orbs that overlap to form cohesive sun shape
    const sizeVariation = random(0.8, 1.4);
    this.radius = (window.innerHeight / 3.5) * sizeVariation;
    this.xOff = random(0, 1000);
    this.yOff = random(0, 1000);
    // Slower animation for elegance
    this.inc = 0.001;
    // Each orb has its own speed multiplier for organic movement
    this.speedMult = random(0.5, 1.2);
    // Pulsing phase offset for breathing effect
    this.pulseOffset = random(0, Math.PI * 2);
    this.graphics = new PIXI.Graphics();
    this.graphics.alpha = 0.75;

    window.addEventListener(
      "resize",
      debounce(() => {
        this.bounds = this.setBounds();
      }, 250)
    );
  }

  setBounds() {
    // Position orbs to emanate from bottom-right corner like sun glow
    const maxDist =
      window.innerWidth < 1000 ? window.innerWidth / 2.5 : window.innerWidth / 4;
    const originX = window.innerWidth * 0.85;
    const originY =
      window.innerWidth < 1000
        ? window.innerHeight * 0.9
        : window.innerHeight * 0.75;

    return {
      x: {
        min: originX - maxDist,
        max: originX + maxDist * 0.5
      },
      y: {
        min: originY - maxDist,
        max: originY + maxDist * 0.5
      }
    };
  }

  update() {
    this.xOff += this.inc * this.speedMult;
    this.yOff += this.inc * this.speedMult;

    // Shared global time for synchronized breathing (all orbs breathe together)
    const globalTime = Date.now() * 0.001;
    const time = globalTime * this.speedMult;

    // Sun origin in bottom-right, slightly in from corners
    const originX = window.innerWidth * 0.78;
    const originY = window.innerHeight * 0.78;

    // Big breathing cycle - slow expansion then contraction (12 second cycle)
    // Use sine wave: 0 to 1 to 0 range for smooth breathing
    const breathCycle = (Math.sin(globalTime * 0.15 - Math.PI / 2) + 1) / 2;

    // Expansion range: from small to almost filling page
    const minExpansion = 100;
    const maxExpansion = Math.min(window.innerWidth, window.innerHeight) * 0.8;
    const breathExpansion = minExpansion + breathCycle * (maxExpansion - minExpansion);

    // Each orb has a unique angle (spread around the sun)
    const angle = (this.index / this.total) * Math.PI * 2 + this.pulseOffset * 0.5;

    // Keep orbs close together - slight variation so they overlap like a sun
    const orbLayer = 0.15 + (this.index % 4) * 0.08; // 0.15, 0.23, 0.31, 0.39 - tight cluster
    const distance = breathExpansion * orbLayer;

    // Position based on angle and distance from origin
    const radialX = Math.cos(angle) * distance;
    const radialY = Math.sin(angle) * distance;

    // Subtle shimmer drift
    const driftX = Math.sin(time * 0.5 + this.xOff) * 20;
    const driftY = Math.cos(time * 0.4 + this.yOff) * 15;

    // Position = origin + radial position + drift
    this.x = originX + radialX + driftX;
    this.y = originY + radialY + driftY;

    // Scale also breathes - orbs stay large to overlap and form cohesive sun
    const baseScale = 1.0 + breathCycle * 0.5; // 1.0 to 1.5 - bigger to overlap
    const individualPulse = Math.sin(time * 0.8 + this.pulseOffset) * 0.08;
    this.scale = baseScale + individualPulse;

    // Very slow rotation
    this.graphics.rotation += 0.0005;
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

// Create PixiJS app once the document is loaded
document.addEventListener('DOMContentLoaded', () => {
  const app = new PIXI.Application({
    view: document.querySelector(".orb-canvas"),
    resizeTo: window,
    transparent: true,
    backgroundAlpha: 0
  });

  // Create subtle background stars (no blur - added directly to stage first)
  const starsContainer = new PIXI.Graphics();
  app.stage.addChild(starsContainer);

  const stars = [];
  const numStars = 80;

  for (let i = 0; i < numStars; i++) {
    stars.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      radius: Math.random() * 1.5 + 0.5, // Small crisp stars
      baseAlpha: Math.random() * 0.2 + 0.08, // Subtle: 0.08 to 0.28
      twinkleSpeed: Math.random() * 0.5 + 0.2,
      twinkleOffset: Math.random() * Math.PI * 2
    });
  }

  // Extra ultra-dim stars you can barely see
  for (let i = 0; i < 100; i++) {
    stars.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      radius: Math.random() * 0.5 + 0.3, // Tiny: 0.3 to 0.8px
      baseAlpha: Math.random() * 0.06 + 0.02, // Barely visible: 0.02 to 0.08
      twinkleSpeed: Math.random() * 0.3 + 0.1,
      twinkleOffset: Math.random() * Math.PI * 2
    });
  }

  // Pale blue dot - Earth in the top left
  const earth = {
    x: window.innerWidth * 0.12,
    y: window.innerHeight * 0.15,
    radius: 2.4,
    baseAlpha: 0.45,
    color: 0x6b8cae // Pale blue
  };

  // Create color palette
  const colorPalette = new ColorPalette();

  // Container for sun orbs (blur applied only to this)
  const sunContainer = new PIXI.Container();
  app.stage.addChild(sunContainer);

  // Apply blur only to sun container
  if (window.PIXI.filters.KawaseBlurFilter) {
    sunContainer.filters = [new PIXI.filters.KawaseBlurFilter(35, 12, true)];
  }

  // Create orbs inside sun container
  const orbs = [];
  const numOrbs = 10;

  for (let i = 0; i < numOrbs; i++) {
    const orb = new Orb(colorPalette.randomColor(), i, numOrbs);
    sunContainer.addChild(orb.graphics);
    orbs.push(orb);
  }

  // Create center glow inside sun container
  const centerGlow = new PIXI.Graphics();
  sunContainer.addChild(centerGlow);

  // Animation
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    app.ticker.add(() => {
      // Render subtle twinkling stars
      const time = Date.now() * 0.001;
      starsContainer.clear();
      stars.forEach((star) => {
        // Very subtle twinkle
        const twinkle = Math.sin(time * star.twinkleSpeed + star.twinkleOffset) * 0.5 + 0.5;
        const alpha = star.baseAlpha * (0.7 + twinkle * 0.3);
        starsContainer.beginFill(0xffffff, alpha);
        starsContainer.drawCircle(star.x, star.y, star.radius);
        starsContainer.endFill();
      });

      // Pale blue dot - tiny Earth with subtle shimmer
      const earthShimmer = Math.sin(time * 0.4) * 0.08;
      starsContainer.beginFill(earth.color, earth.baseAlpha + earthShimmer);
      starsContainer.drawCircle(earth.x, earth.y, earth.radius);
      starsContainer.endFill();

      orbs.forEach((orb) => {
        orb.update();
        orb.render();
      });

      // Update center glow - gets brighter/whiter as sun expands
      const globalTime = Date.now() * 0.001;
      const breathCycle = (Math.sin(globalTime * 0.15 - Math.PI / 2) + 1) / 2;

      const originX = window.innerWidth * 0.78;
      const originY = window.innerHeight * 0.78;

      // Very subtle warmth shift - barely noticeable
      const saturation = 95 - breathCycle * 10; // 95 -> 85 (stays very orange)
      const lightness = 55 + breathCycle * 10;  // 55 -> 65 (gentle brighten)
      const glowColor = hslToHex(25, saturation, lightness).replace('#', '0x');

      // Large size - covers most of the sun
      const maxExpansion = Math.min(window.innerWidth, window.innerHeight) * 0.8;
      const glowRadius = (100 + breathCycle * maxExpansion) * 0.7;

      // Very transparent - just a hint
      centerGlow.alpha = 0.15 + breathCycle * 0.1; // 0.15 -> 0.25

      centerGlow.clear();
      centerGlow.beginFill(parseInt(glowColor, 16));
      centerGlow.drawCircle(originX, originY, glowRadius);
      centerGlow.endFill();
    });
  } else {
    // Static stars for reduced motion
    stars.forEach((star) => {
      starsContainer.beginFill(0xffffff, star.baseAlpha);
      starsContainer.drawCircle(star.x, star.y, star.radius);
      starsContainer.endFill();
    });

    orbs.forEach((orb) => {
      orb.update();
      orb.render();
    });
  }

  // Color change button handler
  const colorButton = document.querySelector(".overlay__btn--colors");
  if (colorButton) {
    colorButton.addEventListener("click", () => {
      colorPalette.setColors();
      colorPalette.setCustomProperties();

      orbs.forEach((orb) => {
        orb.fill = colorPalette.randomColor();
      });
    });
  }
});
