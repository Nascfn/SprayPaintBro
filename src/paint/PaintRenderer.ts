import * as THREE from 'three';
import type { PaintSurface } from './PaintSurface';

export interface Stamp {
  /** Centre in surface UV space. */
  u: number;
  v: number;
  /** Outer radius in metres. */
  radius: number;
  color: THREE.Color;
  alpha: number;
  /** Hard-edged round brush (drips) instead of a soft, speckled spray. */
  hard?: boolean;
}

const MAX_STAMPS = 512;

const brushVertex = /* glsl */ `
  attribute vec2 aCenter;
  attribute vec2 aRadius;
  attribute vec4 aColor;
  attribute vec2 aParams;
  varying vec2 vLocal;
  varying vec4 vColor;
  varying vec2 vParams;
  void main() {
    vLocal = position.xy;
    vColor = aColor;
    vParams = aParams;
    vec2 p = aCenter + position.xy * aRadius;
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const brushFragment = /* glsl */ `
  varying vec2 vLocal;
  varying vec4 vColor;
  varying vec2 vParams; // x: per-stamp seed, y: hard brush flag

  float hash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    float r = length(vLocal);
    if (r > 1.0) discard;
    float a;
    if (vParams.y > 0.5) {
      a = vColor.a * (1.0 - smoothstep(0.7, 1.0, r));
    } else {
      // Gaussian cone of mist. Faint coverage is drawn as sparse droplets at a fixed
      // opacity rather than a thin wash: it reads like real overspray and avoids 8-bit
      // precision loss on very low alphas.
      float target = vColor.a * exp(-r * r * 3.2);
      vec2 cell = floor(gl_FragCoord.xy);
      const float q = 0.12;
      if (target >= q) {
        a = target * (0.8 + 0.4 * hash(vec3(cell + 17.0, vParams.x)));
      } else {
        a = hash(vec3(cell, vParams.x)) < target / q ? q : 0.0;
      }
    }
    if (a <= 0.0) discard;
    gl_FragColor = vec4(vColor.rgb * a, a);
  }
`;

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * Draws brush stamps into paint surfaces on the GPU. Stamps are queued during the frame and
 * drawn with one instanced draw call per surface in `flush`.
 */
export class PaintRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  private readonly brush: THREE.Mesh;
  private readonly brushGeometry: THREE.InstancedBufferGeometry;
  private readonly aCenter: THREE.InstancedBufferAttribute;
  private readonly aRadius: THREE.InstancedBufferAttribute;
  private readonly aColor: THREE.InstancedBufferAttribute;
  private readonly aParams: THREE.InstancedBufferAttribute;
  private readonly quad: THREE.Mesh;
  private readonly copyMaterial: THREE.ShaderMaterial;
  private readonly fillMaterial: THREE.ShaderMaterial;
  private readonly queue = new Map<PaintSurface, Stamp[]>();
  private readonly anisotropy: number;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const plane = new THREE.PlaneGeometry(2, 2);
    this.brushGeometry = new THREE.InstancedBufferGeometry();
    this.brushGeometry.index = plane.index;
    this.brushGeometry.setAttribute('position', plane.getAttribute('position'));
    const attr = (size: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aCenter = attr(2);
    this.aRadius = attr(2);
    this.aColor = attr(4);
    this.aParams = attr(2);
    this.brushGeometry.setAttribute('aCenter', this.aCenter);
    this.brushGeometry.setAttribute('aRadius', this.aRadius);
    this.brushGeometry.setAttribute('aColor', this.aColor);
    this.brushGeometry.setAttribute('aParams', this.aParams);

    const brushMaterial = new THREE.ShaderMaterial({
      vertexShader: brushVertex,
      fragmentShader: brushFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.brush = new THREE.Mesh(this.brushGeometry, brushMaterial);
    this.brush.frustumCulled = false;

    this.copyMaterial = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: null } },
      vertexShader: quadVertex,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMap;
        varying vec2 vUv;
        void main() { gl_FragColor = texture2D(tMap, vUv); }
      `,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.fillMaterial = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fillMaterial);
    this.quad.frustumCulled = false;
  }

  queueStamp(surface: PaintSurface, stamp: Stamp): void {
    this.enqueue(surface, stamp);
    // Stamps that overhang a seam are also drawn on the neighbouring segment.
    const ru = stamp.radius / surface.width;
    if (surface.left && stamp.u - ru < 0) {
      this.enqueue(surface.left, { ...stamp, u: 1 + (stamp.u * surface.width) / surface.left.width });
    }
    if (surface.right && stamp.u + ru > 1) {
      this.enqueue(surface.right, { ...stamp, u: ((stamp.u - 1) * surface.width) / surface.right.width });
    }
  }

  private enqueue(surface: PaintSurface, stamp: Stamp): void {
    let list = this.queue.get(surface);
    if (!list) {
      list = [];
      this.queue.set(surface, list);
    }
    list.push({ ...stamp, color: stamp.color.clone() });
  }

  /** Draws all queued stamps into their surfaces. */
  flush(): void {
    if (this.queue.size === 0) return;
    const prev = this.renderer.getRenderTarget();
    for (const [surface, stamps] of this.queue) {
      this.prepare(surface);
      for (let start = 0; start < stamps.length; start += MAX_STAMPS) {
        const batch = stamps.slice(start, start + MAX_STAMPS);
        batch.forEach((s, i) => {
          this.aCenter.setXY(i, s.u, s.v);
          this.aRadius.setXY(i, s.radius / surface.width, s.radius / surface.height);
          this.aColor.setXYZW(i, s.color.r, s.color.g, s.color.b, s.alpha);
          this.aParams.setXY(i, Math.random() * 1000, s.hard ? 1 : 0);
        });
        for (const a of [this.aCenter, this.aRadius, this.aColor, this.aParams]) a.needsUpdate = true;
        this.brushGeometry.instanceCount = batch.length;
        this.renderer.setRenderTarget(surface.target);
        this.renderer.render(this.brush, this.camera);
      }
    }
    this.queue.clear();
    this.renderer.setRenderTarget(prev);
  }

  /** Copies a surface's current paint into a new render target (for undo). */
  snapshot(surface: PaintSurface): THREE.WebGLRenderTarget | null {
    if (!surface.target) return null;
    const copy = surface.target.clone();
    this.blit(surface.target.texture, copy);
    return copy;
  }

  /** Restores paint from a snapshot, or clears the surface when there is none. */
  restore(surface: PaintSurface, snapshot: THREE.WebGLRenderTarget | null): void {
    if (!surface.target) return;
    this.queue.delete(surface);
    if (snapshot) this.blit(snapshot.texture, surface.target);
    else this.clear(surface);
  }

  clear(surface: PaintSurface): void {
    if (!surface.target) return;
    this.queue.delete(surface);
    surface.clearLoad();
    this.blit(null, surface.target);
  }

  cancel(surface: PaintSurface): void {
    this.queue.delete(surface);
  }

  private prepare(surface: PaintSurface): void {
    if (surface.ensureTarget(this.anisotropy)) this.blit(null, surface.target!);
  }

  /** Draws a full-screen quad into `target`: a copy of `source`, or transparent black. */
  private blit(source: THREE.Texture | null, target: THREE.WebGLRenderTarget): void {
    const prev = this.renderer.getRenderTarget();
    if (source) {
      this.copyMaterial.uniforms.tMap.value = source;
      this.quad.material = this.copyMaterial;
    } else {
      this.quad.material = this.fillMaterial;
    }
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quad, this.camera);
    this.renderer.setRenderTarget(prev);
    this.copyMaterial.uniforms.tMap.value = null;
  }
}
