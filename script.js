import * as PIXI from "https://cdn.skypack.dev/pixi.js@5.x";
import { KawaseBlurFilter } from "https://cdn.skypack.dev/@pixi/filter-kawase-blur@3.2.0";
import SimplexNoise from "https://cdn.skypack.dev/simplex-noise@3.0.0";
import hsl from "https://cdn.skypack.dev/hsl-to-hex";
import debounce from "https://cdn.skypack.dev/debounce";

console.clear();

  // Select the circle element
  const circleElement = document.querySelector('.circle');
  
  // Create objects to track mouse position and custom cursor position
  const mouse = { x: 0, y: 0 }; // Track current mouse position
  const previousMouse = { x: 0, y: 0 } // Store the previous mouse position
  const circle = { x: 0, y: 0 }; // Track the circle position
  
  // Initialize variables to track scaling and rotation
  let currentScale = 0; // Track current scale value
  let currentAngle = 0; // Track current angle value
  
  // Update mouse position on the 'mousemove' event
  window.addEventListener('mousemove', (e) => {
    mouse.x = e.x;
    mouse.y = e.y;
  });
  
  // Smoothing factor for cursor movement speed (0 = smoother, 1 = instant)
  const speed = 0.17;
  
  // Start animation
  const tick = () => {
    // MOVE
    // Calculate circle movement based on mouse position and smoothing
    circle.x += (mouse.x - circle.x) * speed;
    circle.y += (mouse.y - circle.y) * speed;
    // Create a transformation string for cursor translation
    const translateTransform = `translate(${circle.x}px, ${circle.y}px)`;
  
    // SQUEEZE
    // 1. Calculate the change in mouse position (deltaMouse)
    const deltaMouseX = mouse.x - previousMouse.x;
    const deltaMouseY = mouse.y - previousMouse.y;
    // Update previous mouse position for the next frame
    previousMouse.x = mouse.x;
    previousMouse.y = mouse.y;
    // 2. Calculate mouse velocity using Pythagorean theorem and adjust speed
    const mouseVelocity = Math.min(Math.sqrt(deltaMouseX**2 + deltaMouseY**2) * 4, 150); 
    // 3. Convert mouse velocity to a value in the range [0, 0.5]
    const scaleValue = (mouseVelocity / 150) * 0.5;
    // 4. Smoothly update the current scale
    currentScale += (scaleValue - currentScale) * speed;
    // 5. Create a transformation string for scaling
    const scaleTransform = `scale(${1 + currentScale}, ${1 - currentScale})`;
  
    // ROTATE
    // 1. Calculate the angle using the atan2 function
    const angle = Math.atan2(deltaMouseY, deltaMouseX) * 180 / Math.PI;
    // 2. Check for a threshold to reduce shakiness at low mouse velocity
    if (mouseVelocity > 20) {
      currentAngle = angle;
    }
    // 3. Create a transformation string for rotation
    const rotateTransform = `rotate(${currentAngle}deg)`;
  
    // Apply all transformations to the circle element in a specific order: translate -> rotate -> scale
    circleElement.style.transform = `${translateTransform} ${rotateTransform} ${scaleTransform}`;
  
    // Request the next frame to continue the animation
    window.requestAnimationFrame(tick);
  }
  
  // Start the animation loop
  tick();


// return a random number within a range
function random(min, max) {
  return Math.random() * (max - min) + min;
}

// map a number from 1 range to another
function map(n, start1, end1, start2, end2) {
  return ((n - start1) / (end1 - start1)) * (end2 - start2) + start2;
}

// Create a new simplex noise instance
const simplex = new SimplexNoise();

// ColorPalette class
class ColorPalette {
  constructor() {
    this.setColors();
    this.setCustomProperties();
  }

  setColors() {
    // Set specific hue values
    this.hue = 25; // Orange
    this.complimentaryHue1 = 22.5; // Red
    this.complimentaryHue2 = 27.5; // Yellow
    // define a fixed saturation and lightness
    this.saturation = 95;
    this.lightness = 50;

    // define a base color
    this.baseColor = hsl(this.hue, this.saturation, this.lightness);
    // define a complimentary color, 30 degrees away from the base
    this.complimentaryColor1 = hsl(
      this.complimentaryHue1,
      this.saturation,
      this.lightness
    );
    // define a second complimentary color, 60 degrees away from the base
    this.complimentaryColor2 = hsl(
      this.complimentaryHue2,
      this.saturation,
      this.lightness
    );

    // store the color choices in an array
    this.colorChoices = [
      this.baseColor,
      this.complimentaryColor1,
      this.complimentaryColor2
    ];
  }

  randomColor() {
    // pick a random color
    return this.colorChoices[~~random(0, this.colorChoices.length)].replace(
      "#",
      "0x"
    );
  }

  setCustomProperties() {
    // set CSS custom properties so that the colors defined here can be used throughout the UI
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

// Orb class
class Orb {
  // Pixi takes hex colors as hexidecimal literals (0x rather than a string with '#')
  constructor(fill = 0x000000) {
    // bounds = the area an orb is "allowed" to move within
    this.bounds = this.setBounds();
    // initialise the orb's { x, y } values to a random point within it's bounds
    this.x = random(this.bounds["x"].min, this.bounds["x"].max);
    this.y = random(this.bounds["y"].min, this.bounds["y"].max);

    // how large the orb is vs it's original radius (this will modulate over time)
    this.scale = 1;

    // what color is the orb?
    this.fill = fill;

    // the original radius of the orb, set relative to window height
    this.radius = random(window.innerHeight / 6, window.innerHeight / 3);

    // starting points in "time" for the noise/self similar random values
    this.xOff = random(0, 1000);
    this.yOff = random(0, 1000);
    // how quickly the noise/self similar random values step through time
    this.inc = 0.002;

    // PIXI.Graphics is used to draw 2d primitives (in this case a circle) to the canvas
    this.graphics = new PIXI.Graphics();
    this.graphics.alpha = 0.825;

    // 250ms after the last window resize event, recalculate orb positions.
    window.addEventListener(
      "resize",
      debounce(() => {
        this.bounds = this.setBounds();
      }, 250)
    );
  }

  setBounds() {
    // how far from the { x, y } origin can each orb move
    const maxDist =
      window.innerWidth < 1000 ? window.innerWidth / 3 : window.innerWidth / 5;
    // the { x, y } origin for each orb (the bottom right of the screen)
    const originX = window.innerWidth / 1.25;
    const originY =
      window.innerWidth < 1000
        ? window.innerHeight
        : window.innerHeight / 1.375;

    // allow each orb to move x distance away from it's x / y origin
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
    // self similar "psuedo-random" or noise values at a given point in "time"
    const xNoise = simplex.noise2D(this.xOff, this.xOff);
    const yNoise = simplex.noise2D(this.yOff, this.yOff);
    const scaleNoise = simplex.noise2D(this.xOff, this.yOff);

    // map the xNoise/yNoise values (between -1 and 1) to a point within the orb's bounds
    this.x = map(xNoise, -1, 1, this.bounds["x"].min, this.bounds["x"].max);
    this.y = map(yNoise, -1, 1, this.bounds["y"].min, this.bounds["y"].max);
    // map scaleNoise (between -1 and 1) to a scale value somewhere between half of the orb's original size, and 100% of it's original size
    this.scale = map(scaleNoise, -1, 1, 0.5, 1);

    // Decrease the increment value for slower movement
    this.inc = 0.00075;

    // Add a slight pulsing effect (adjust amplitude and frequency as needed)
    const pulse = Math.sin(this.xOff * 0.5) * 0.2; 
    this.scale += pulse; 

this.graphics.rotation += 0.001; // Add a small rotation value

    // step through "time"
    this.xOff += this.inc;
    this.yOff += this.inc;
}


  render() {
    
    // update the PIXI.Graphics position and scale values
    this.graphics.x = this.x;
    this.graphics.y = this.y;
    this.graphics.scale.set(this.scale);

    // clear anything currently drawn to graphics
    this.graphics.clear();

    // tell graphics to fill any shapes drawn after this with the orb's fill color
    this.graphics.beginFill(this.fill);
    // draw a circle at { 0, 0 } with it's size set by this.radius
    this.graphics.drawCircle(0, 0, this.radius);
    // let graphics know we won't be filling in any more shapes
    this.graphics.endFill();
  }
}

// Create PixiJS app
const app = new PIXI.Application({
  // render to <canvas class="orb-canvas"></canvas>
  view: document.querySelector(".orb-canvas"),
  // auto adjust size to fit the current window
  resizeTo: window,
  // transparent background, we will be creating a gradient background later using CSS
  transparent: false
});

app.stage.filters = [new KawaseBlurFilter(30, 10, true)];



// Create colour palette
const colorPalette = new ColorPalette();

// Create orbs (more uniform size)
const orbs = [];
const numOrbs = 15; // Adjust the number of orbs as needed
const orbRadius = window.innerHeight / 4; // Set a consistent radius

for (let i = 0; i < numOrbs; i++) {
  const orb = new Orb(colorPalette.randomColor());
  orb.radius = orbRadius; // Set the consistent radius
  app.stage.addChild(orb.graphics);
  orbs.push(orb);
}

// Add a central circle (adjust size and color as needed)
const centralOrb = new Orb(0xffffff); // White color
centralOrb.radius = window.innerHeight / 8; // Larger radius
centralOrb.x = window.innerWidth / 2; // Centered horizontally
centralOrb.y = window.innerHeight / 2; // Centered vertically
centralOrb.radius = window.innerHeight / 5; // Larger radius

// Add the central orb to the stage 
app.stage.addChild(centralOrb.graphics); 


// Animate!
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

document
  .querySelector(".overlay__btn--colors")
  .addEventListener("click", () => {
    colorPalette.setColors();
    colorPalette.setCustomProperties();

    orbs.forEach((orb) => {
      orb.fill = colorPalette.randomColor();
    });
  });

const bentoElements = document.querySelectorAll('.bento'); 
const container = document.querySelector('.bento-container'); 
  
  bentoElements.forEach(element => {
    element.addEventListener('mouseover', () => {
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
  
      // Uniform scaling factor based on the smallest available space 
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
  
// Password Protection
const detailsBtns = document.querySelectorAll('.details-btn');

detailsBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const projectId = btn.dataset.projectId; // Get project ID from data attribute

    // Replace this with your logic to show project details based on the project ID
    // You might use this ID to fetch data from an API or display different content.
    alert(`You clicked on project ${projectId}`); 

    // Example: Show the password prompt if needed
    passwordPrompt.style.display = 'block'; 
  });
});


