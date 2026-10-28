import * as THREE from 'three';

/**
 * Procedurally generated, seamlessly tiling surface textures. Everything is drawn on a
 * canvas at startup so the game ships without any image assets.
 */
export interface SurfaceTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** World size in metres that one repeat of the texture covers. */
  tileSize: number;
}

type RGB = [number, number, number];

interface Pixel {
  r: number;
  g: number;
  b: number;
  a: number;
  /** Height in [0,1], used to derive the normal map. */
  h: number;
}

export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise that wraps every `px` x `py` lattice cells, so it tiles. */
function tileNoise(px: number, py: number, rand: () => number) {
  const grid = new Float32Array(px * py);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  return (x: number, y: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % px) + px) % px;
    const y0 = ((yi % py) + py) % py;
    const x1 = (x0 + 1) % px;
    const y1 = (y0 + 1) % py;
    const a = grid[y0 * px + x0];
    const b = grid[y0 * px + x1];
    const c = grid[y1 * px + x0];
    const d = grid[y1 * px + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/** Tileable fractal noise in [0,1]. `u`,`v` span [0,1) across the texture. */
function makeFbm(baseX: number, baseY: number, octaves: number, seed: number) {
  const rand = mulberry32(seed);
  const layers = Array.from({ length: octaves }, (_, i) => tileNoise(baseX << i, baseY << i, rand));
  return (u: number, v: number): number => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += layers[i](u * (baseX << i), v * (baseY << i)) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Runs `shade` for every pixel, then builds an sRGB colour texture plus a tangent-space
 * normal map derived from the height channel.
 */
function buildTexture(
  width: number,
  height: number,
  tileSize: number,
  normalStrength: number,
  shade: (x: number, y: number, u: number, v: number, out: Pixel) => void,
): SurfaceTextures {
  const color = document.createElement('canvas');
  color.width = width;
  color.height = height;
  const ctx = color.getContext('2d')!;
  const img = ctx.createImageData(width, height);
  const heights = new Float32Array(width * height);
  const px: Pixel = { r: 0, g: 0, b: 0, a: 1, h: 0.5 };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      px.a = 1;
      shade(x, y, x / width, y / height, px);
      const i = y * width + x;
      img.data[i * 4] = clamp01(px.r) * 255;
      img.data[i * 4 + 1] = clamp01(px.g) * 255;
      img.data[i * 4 + 2] = clamp01(px.b) * 255;
      img.data[i * 4 + 3] = clamp01(px.a) * 255;
      heights[i] = px.h;
    }
  }
  ctx.putImageData(img, 0, 0);

  const normal = document.createElement('canvas');
  normal.width = width;
  normal.height = height;
  const nctx = normal.getContext('2d')!;
  const nimg = nctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const yu = (y - 1 + height) % height;
    const yd = (y + 1) % height;
    for (let x = 0; x < width; x++) {
      const xl = (x - 1 + width) % width;
      const xr = (x + 1) % width;
      const dx = (heights[y * width + xr] - heights[y * width + xl]) * normalStrength;
      // Canvas rows run top-down while texture v runs bottom-up, hence the sign flip.
      const dy = (heights[yd * width + x] - heights[yu * width + x]) * normalStrength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * width + x) * 4;
      nimg.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);

  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(normal);
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return { map, normalMap, tileSize };
}

function setRGB(out: Pixel, c: RGB, k: number) {
  out.r = (c[0] / 255) * k;
  out.g = (c[1] / 255) * k;
  out.b = (c[2] / 255) * k;
}

export function brickTexture(brick: RGB, mortar: RGB, seed: number): SurfaceTextures {
  const size = 1024;
  const courses = 12;
  const perRow = 4;
  const courseH = size / courses;
  const brickW = size / perRow;
  const mortarPx = 7;
  const grime = makeFbm(4, 4, 4, seed);
  const grain = makeFbm(64, 64, 2, seed + 1);
  const chips = makeFbm(32, 32, 2, seed + 2);

  return buildTexture(size, size, 0.9, 2.2, (x, y, u, v, out) => {
    const row = Math.floor(y / courseH);
    const offset = row % 2 ? brickW / 2 : 0;
    const bx = (x + offset) % size;
    const col = Math.floor(bx / brickW);
    const lx = bx - col * brickW;
    const ly = y - row * courseH;
    const edge = Math.min(lx, brickW - lx, ly, courseH - ly);
    const g = grain(u, v);
    const dirt = 0.82 + grime(u, v) * 0.3;

    // Mortar sits in the gaps; ragged edges come from the chip noise.
    if (edge < mortarPx + (chips(u, v) - 0.5) * 5) {
      setRGB(out, mortar, (0.85 + g * 0.25) * dirt);
      out.h = 0.15 + g * 0.1;
      return;
    }
    const id = hash2(row, col % perRow, seed);
    const id2 = hash2(col % perRow, row, seed + 7);
    let k = 0.78 + id * 0.35;
    if (id2 > 0.9) k *= 0.62; // occasional over-fired dark brick
    const tint = (hash2(row, col, seed + 3) - 0.5) * 0.12;
    out.r = (brick[0] / 255) * k * (1 + tint) * (0.88 + g * 0.24) * dirt;
    out.g = (brick[1] / 255) * k * (0.88 + g * 0.24) * dirt;
    out.b = (brick[2] / 255) * k * (1 - tint) * (0.88 + g * 0.24) * dirt;
    const bevel = Math.min(1, (edge - mortarPx) / 6);
    out.h = 0.55 + bevel * 0.35 + g * 0.12;
  });
}

export function concreteTexture(base: RGB, seed: number, formed = false): SurfaceTextures {
  const size = 1024;
  const tile = 2.5;
  const large = makeFbm(4, 4, 5, seed);
  const fine = makeFbm(96, 96, 2, seed + 1);
  // Stretched vertically: rain streaks running down the wall.
  const streaks = makeFbm(48, 2, 3, seed + 2);
  const seamPx = size / 2;

  return buildTexture(size, size, tile, 3.0, (x, y, u, v, out) => {
    const l = large(u, v);
    const f = fine(u, v);
    const s = streaks(u, v);
    let k = 0.72 + l * 0.32 + (f - 0.5) * 0.12 - Math.max(0, s - 0.55) * 0.5;
    let h = 0.5 + (f - 0.5) * 0.3;
    // Air bubbles / pits.
    if (hash2(x, y, seed) > 0.996) {
      k *= 0.55;
      h = 0.1;
    }
    if (formed) {
      const sx = Math.min(x % seamPx, seamPx - (x % seamPx));
      const sy = Math.min(y % seamPx, seamPx - (y % seamPx));
      if (Math.min(sx, sy) < 2) {
        k *= 0.7;
        h = 0.2;
      }
      // Form-tie holes on a regular grid.
      const tx = (x % (seamPx / 2)) - seamPx / 4;
      const ty = (y % (seamPx / 2)) - seamPx / 4;
      const tr = Math.hypot(tx, ty);
      if (tr < 9) {
        k *= 0.45 + tr / 30;
        h = 0.1 + tr / 30;
      }
    }
    setRGB(out, base, k);
    out.h = h;
  });
}

export function stuccoTexture(base: RGB, seed: number): SurfaceTextures {
  const size = 512;
  const large = makeFbm(3, 3, 4, seed);
  const fine = makeFbm(128, 128, 2, seed + 1);
  const streaks = makeFbm(32, 2, 3, seed + 2);
  return buildTexture(size, size, 2, 4.0, (_x, _y, u, v, out) => {
    const f = fine(u, v);
    const k = 0.86 + large(u, v) * 0.2 + (f - 0.5) * 0.08 - Math.max(0, streaks(u, v) - 0.58) * 0.45;
    setRGB(out, base, k);
    out.h = f;
  });
}

export function asphaltTexture(seed: number): SurfaceTextures {
  const size = 1024;
  const patches = makeFbm(4, 4, 4, seed);
  const fine = makeFbm(128, 128, 2, seed + 1);
  return buildTexture(size, size, 4, 2.5, (x, y, u, v, out) => {
    const r = hash2(x, y, seed);
    let k = 0.75 + patches(u, v) * 0.35 + (fine(u, v) - 0.5) * 0.2;
    let h = 0.4 + fine(u, v) * 0.2;
    if (r > 0.94) {
      k += 0.45 * (r - 0.94) * 16;
      h += 0.3;
    } else if (r < 0.05) {
      k *= 0.7;
      h -= 0.2;
    }
    setRGB(out, [58, 58, 60], k);
    out.h = h;
  });
}

export function sidewalkTexture(seed: number): SurfaceTextures {
  const size = 512;
  const large = makeFbm(3, 3, 4, seed);
  const fine = makeFbm(96, 96, 2, seed + 1);
  return buildTexture(size, size, 1.5, 3.0, (x, y, u, v, out) => {
    const edge = Math.min(x, size - 1 - x, y, size - 1 - y);
    const f = fine(u, v);
    let k = 0.78 + large(u, v) * 0.25 + (f - 0.5) * 0.12;
    let h = 0.5 + f * 0.2;
    if (edge < 3) {
      k *= 0.55;
      h = 0.1;
    } else if (edge < 6) {
      h = 0.35;
    }
    if (hash2(x, y, seed) > 0.995) k *= 0.7;
    setRGB(out, [168, 165, 158], k);
    out.h = h;
  });
}

export function corrugatedTexture(seed: number): SurfaceTextures {
  const size = 512;
  const rust = makeFbm(2, 2, 6, seed);
  const fine = makeFbm(64, 64, 2, seed + 1);
  const slats = 16;
  return buildTexture(size, size, 1, 6.0, (_x, y, u, v, out) => {
    const phase = (y / size) * slats * Math.PI * 2;
    const ridge = Math.sin(phase) * 0.5 + 0.5;
    const r = rust(u, v);
    const f = fine(u, v);
    const shade = 0.82 + ridge * 0.22 + (f - 0.5) * 0.1;
    if (r > 0.66) {
      const t = Math.min(1, (r - 0.66) * 5);
      out.r = (0.47 * (1 - t) + 0.45 * t) * shade;
      out.g = (0.5 * (1 - t) + 0.25 * t) * shade;
      out.b = (0.53 * (1 - t) + 0.14 * t) * shade;
    } else {
      setRGB(out, [120, 128, 136], shade);
    }
    out.h = ridge * 0.8 + f * 0.1;
  });
}

export function paintedMetalTexture(base: RGB, seed: number): SurfaceTextures {
  const size = 256;
  const dirt = makeFbm(4, 4, 4, seed);
  const fine = makeFbm(64, 64, 2, seed + 1);
  return buildTexture(size, size, 1, 2.0, (x, y, u, v, out) => {
    const d = dirt(u, v);
    let k = 0.75 + (1 - d) * 0.3 + (fine(u, v) - 0.5) * 0.08;
    // Scuffs where the paint has worn off to bare metal.
    if (hash2(x >> 2, y >> 3, seed) > 0.985) {
      out.r = out.g = out.b = 0.45;
      out.h = 0.4;
      return;
    }
    k *= d > 0.7 ? 0.85 : 1;
    setRGB(out, base, k);
    out.h = 0.5 + fine(u, v) * 0.1;
  });
}

export function dirtTexture(seed: number): SurfaceTextures {
  const size = 512;
  const large = makeFbm(4, 4, 5, seed);
  const fine = makeFbm(128, 128, 2, seed + 1);
  return buildTexture(size, size, 3, 4.0, (x, y, u, v, out) => {
    const l = large(u, v);
    const f = fine(u, v);
    const pebble = hash2(x >> 1, y >> 1, seed) > 0.97;
    const k = 0.7 + l * 0.4 + (f - 0.5) * 0.25 + (pebble ? 0.25 : 0);
    const grass = l > 0.62 ? (l - 0.62) * 2.2 : 0;
    out.r = (0.42 - grass * 0.12) * k;
    out.g = (0.36 + grass * 0.1) * k;
    out.b = (0.27 - grass * 0.06) * k;
    out.h = f * 0.6 + (pebble ? 0.4 : 0);
  });
}

/** Diamond wire mesh with an alpha channel, for alpha-tested fences. */
export function chainLinkTexture(): SurfaceTextures {
  const size = 256;
  const cells = 4;
  const cell = size / cells;
  return buildTexture(size, size, 0.24, 1.0, (x, y, _u, _v, out) => {
    const a = (x + y) % cell;
    const b = (x - y + size) % cell;
    const d = Math.min(a, cell - a, b, cell - b);
    const wire = d < 2.2;
    out.r = out.g = out.b = 0.62;
    out.a = wire ? 1 : 0;
    out.h = wire ? 1 - d / 2.2 : 0;
  });
}

export interface MaterialOptions {
  color?: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
}

/** Wraps a texture set in a standard material, remembering its tile size for UV scaling. */
export function surfaceMaterial(tex: SurfaceTextures, opts: MaterialOptions = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: tex.map,
    normalMap: tex.normalMap,
    color: opts.color ?? 0xffffff,
    roughness: opts.roughness ?? 0.9,
    metalness: opts.metalness ?? 0,
  });
  const ns = opts.normalScale ?? 1;
  mat.normalScale.set(ns, ns);
  mat.userData.tileSize = tex.tileSize;
  return mat;
}
