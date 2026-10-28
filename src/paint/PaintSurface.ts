import * as THREE from 'three';

const PIXELS_PER_METRE = 120;
const MAX_RESOLUTION = 2048;
/** Gap between the wall and the paint layer, so the two never z-fight. */
const SURFACE_OFFSET = 0.003;
/** Size of the cells that track paint build-up for drips. */
const LOAD_CELL = 0.05;
/** How quickly built-up paint stops being runny, per second. */
const LOAD_DECAY = 0.3;

export interface PaintSurfaceOptions {
  /** Centre of the wall face. */
  center: THREE.Vector3;
  /** Outward horizontal normal of the face. */
  normal: THREE.Vector3;
  width: number;
  height: number;
  /** Wall material, so paint can follow its bumps (e.g. brick mortar lines). */
  wallMaterial?: THREE.MeshStandardMaterial;
  /** Distance from the wall face's left edge to this segment's left edge, for texture alignment. */
  offsetU?: number;
}

/**
 * A paintable wall face: a transparent plane sitting just in front of the wall whose texture
 * is a render target the brush stamps into. The render target is only created on the first
 * hit, so unpainted walls cost nothing.
 */
export class PaintSurface {
  readonly mesh: THREE.Mesh;
  readonly width: number;
  readonly height: number;
  readonly resX: number;
  readonly resY: number;
  target: THREE.WebGLRenderTarget | null = null;
  /** Adjacent segments of the same wall face, so strokes carry across the seam. */
  left: PaintSurface | null = null;
  right: PaintSurface | null = null;

  private readonly material: THREE.MeshStandardMaterial;
  private readonly loadCols: number;
  private readonly load: Float32Array;
  private readonly loadTime: Float32Array;

  constructor(opts: PaintSurfaceOptions) {
    this.width = opts.width;
    this.height = opts.height;
    this.resX = THREE.MathUtils.clamp(Math.round(opts.width * PIXELS_PER_METRE), 64, MAX_RESOLUTION);
    this.resY = THREE.MathUtils.clamp(Math.round(opts.height * PIXELS_PER_METRE), 64, MAX_RESOLUTION);

    const geometry = new THREE.PlaneGeometry(opts.width, opts.height);
    this.material = new THREE.MeshStandardMaterial({
      transparent: true,
      depthWrite: false,
      roughness: 0.55,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    // Hidden until painted. Raycasts ignore material visibility, so it can still be hit.
    this.material.visible = false;
    this.material.onBeforeCompile = (shader) => {
      // The render target stores premultiplied colour; undo that before lighting.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n\tdiffuseColor.rgb /= max(diffuseColor.a, 0.0001);',
      );
    };

    const wall = opts.wallMaterial;
    if (wall?.normalMap) {
      // A second UV set lined up with the wall's own texture tiling, so the paint
      // picks up the same relief.
      const tile = (wall.userData.tileSize as number | undefined) ?? 1;
      const uv = geometry.getAttribute('uv');
      const uv1 = new Float32Array(uv.count * 2);
      for (let i = 0; i < uv.count; i++) {
        uv1[i * 2] = (uv.getX(i) * opts.width + (opts.offsetU ?? 0)) / tile;
        uv1[i * 2 + 1] = (uv.getY(i) * opts.height) / tile;
      }
      geometry.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
      const normalMap = wall.normalMap.clone();
      normalMap.channel = 1;
      this.material.normalMap = normalMap;
      this.material.normalScale.copy(wall.normalScale);
    }

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.copy(opts.center).addScaledVector(opts.normal, SURFACE_OFFSET);
    this.mesh.rotation.y = Math.atan2(opts.normal.x, opts.normal.z);
    this.mesh.receiveShadow = true;
    this.mesh.userData.paintSurface = this;
    this.mesh.renderOrder = 1;

    this.loadCols = Math.max(1, Math.ceil(opts.width / LOAD_CELL));
    const rows = Math.max(1, Math.ceil(opts.height / LOAD_CELL));
    this.load = new Float32Array(this.loadCols * rows);
    this.loadTime = new Float32Array(this.loadCols * rows);
  }

  get painted(): boolean {
    return this.target !== null;
  }

  /** Creates the render target on first use. Returns true if it was just created. */
  ensureTarget(anisotropy: number): boolean {
    if (this.target) return false;
    const target = new THREE.WebGLRenderTarget(this.resX, this.resY, {
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: THREE.SRGBColorSpace,
    });
    target.texture.anisotropy = anisotropy;
    this.target = target;
    this.material.map = target.texture;
    this.material.visible = true;
    this.material.needsUpdate = true;
    return true;
  }

  /**
   * Adds wet paint at a UV position and returns how much has pooled there. Older paint
   * decays lazily, based on when the cell was last touched.
   */
  addLoad(u: number, v: number, amount: number, now: number): number {
    const col = THREE.MathUtils.clamp(Math.floor(u * this.loadCols), 0, this.loadCols - 1);
    const rows = this.load.length / this.loadCols;
    const row = THREE.MathUtils.clamp(Math.floor(v * rows), 0, rows - 1);
    const i = row * this.loadCols + col;
    const decayed = this.load[i] * Math.exp(-(now - this.loadTime[i]) * LOAD_DECAY);
    this.load[i] = decayed + amount;
    this.loadTime[i] = now;
    return this.load[i];
  }

  resetLoad(u: number, v: number): void {
    const col = THREE.MathUtils.clamp(Math.floor(u * this.loadCols), 0, this.loadCols - 1);
    const rows = this.load.length / this.loadCols;
    const row = THREE.MathUtils.clamp(Math.floor(v * rows), 0, rows - 1);
    this.load[row * this.loadCols + col] = 0;
  }

  clearLoad(): void {
    this.load.fill(0);
  }
}
