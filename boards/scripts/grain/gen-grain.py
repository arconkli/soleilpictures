"""The film-grain tile the app tiles on its surfaces.

Makes grain-2x.webp (384 px) and grain-1x.webp (192 px), both shown at 192 CSS
px through styles.css --grain-url.

White noise is blurred with wrap-around FFT gaussians at three sizes, so the
tile is seamless: fine crystals with a little clumping. The tile is white where
the field is above zero and black below, with alpha |v| / 3 sigma in 7 steps,
so it textures a ground without tinting it. The 1x tile averages 2x2 blocks of
the same field, so a 1x screen gets the same grain at its own pixel size.

The strength is not in the tile; it is styles.css --grain-o.

usage (from boards/): python3 scripts/grain/gen-grain.py [OUTDIR]
OUTDIR defaults to src/assets/grain. Needs numpy and Pillow. The seed is fixed
(1977), so a re-run gives the same pixels.
"""
import os
import sys
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'assets', 'grain')
N = 384
OCTAVES = [(0.45, 0.82), (1.0, 0.15), (2.2, 0.03)]
CLIP = 3.0
LEVELS = 7
SEED = 1977


def lowpass(field, sigma):
    """Gaussian blur with wrap-around (FFT), so the tile is seamless."""
    n = field.shape[0]
    f = np.fft.fftfreq(n)
    fx, fy = np.meshgrid(f, f)
    h = np.exp(-2 * (np.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(field) * h))


def unit(x):
    x = x - x.mean()
    return x / x.std()


def grain_field(n, octaves, seed):
    """octaves: [(sigma_px, variance_weight)]: fine crystals plus clumps."""
    rng = np.random.default_rng(seed)
    acc = np.zeros((n, n))
    for sigma, w in octaves:
        acc += np.sqrt(w) * unit(lowpass(rng.standard_normal((n, n)), sigma))
    return unit(acc)


def encode(v, clip, levels):
    """v ~ N(0,1). Alpha = |v|/clip (clamped) quantised to `levels` steps;
    white where v > 0, black where v < 0. Returns an LA uint8 array."""
    a = np.clip(np.abs(v) / clip, 0, 1)
    a = np.round(a * levels) / levels
    L = np.where(v > 0, 255, 0).astype(np.uint8)
    A = np.round(a * 255).astype(np.uint8)
    return np.dstack([L, A])


def save(arr, path):
    im = Image.fromarray(arr, 'LA')
    im.convert('RGBA').save(path, 'WEBP', lossless=True, quality=100, method=6)
    return os.path.getsize(path)


os.makedirs(OUT, exist_ok=True)
v = grain_field(N, OCTAVES, SEED)
# 1x: average 2x2 blocks of the field, then re-normalise.
v1 = unit(v.reshape(N // 2, 2, N // 2, 2).mean(axis=(1, 3)))
for name, field in (('grain-2x.webp', v), ('grain-1x.webp', v1)):
    path = os.path.join(OUT, name)
    print(name, save(encode(field, CLIP, LEVELS), path), 'bytes')
