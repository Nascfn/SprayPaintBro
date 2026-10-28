import * as THREE from 'three';

const MAX_PARTICLES = 900;
const EMIT_RATE = 520;

/** The visible cloud of mist travelling from the nozzle to the wall. */
export class SprayParticles {
  readonly points: THREE.Points;
  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly alphas = new Float32Array(MAX_PARTICLES);
  private readonly velocities = new Float32Array(MAX_PARTICLES * 3);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly maxLife = new Float32Array(MAX_PARTICLES);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private cursor = 0;
  private carry = 0;
  private readonly dir = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor() {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color() },
        uScale: { value: 600 },
      },
      vertexShader: /* glsl */ `
        attribute float alpha;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 0.012 * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          if (r > 1.0 || vAlpha <= 0.0) discard;
          gl_FragColor = vec4(uColor, vAlpha * (1.0 - r) * 0.55);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  setViewportHeight(height: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = height / 2 / Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
  }

  /**
   * Emits mist from `origin` towards `target`. `distance` caps how far it travels (to the wall
   * when there is one) and `spread` is the cone's radius where it lands.
   */
  emit(dt: number, origin: THREE.Vector3, target: THREE.Vector3, distance: number, spread: number, color: THREE.Color): void {
    (this.material.uniforms.uColor.value as THREE.Color).copy(color);
    this.dir.subVectors(target, origin).normalize();
    this.side.crossVectors(this.dir, THREE.Object3D.DEFAULT_UP).normalize();
    this.up.crossVectors(this.side, this.dir).normalize();
    const reach = Math.max(0.05, Math.min(distance, 2.5));
    const angle = spread / Math.max(distance, 0.1);

    this.carry += EMIT_RATE * dt;
    const count = Math.floor(this.carry);
    this.carry -= count;
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      // Uniform point in a disc for the cone direction.
      const r = Math.sqrt(Math.random()) * angle;
      const theta = Math.random() * Math.PI * 2;
      const speed = 6 + Math.random() * 4;
      const vx = this.dir.x + (this.side.x * Math.cos(theta) + this.up.x * Math.sin(theta)) * r;
      const vy = this.dir.y + (this.side.y * Math.cos(theta) + this.up.y * Math.sin(theta)) * r;
      const vz = this.dir.z + (this.side.z * Math.cos(theta) + this.up.z * Math.sin(theta)) * r;
      this.velocities[i * 3] = vx * speed;
      this.velocities[i * 3 + 1] = vy * speed;
      this.velocities[i * 3 + 2] = vz * speed;
      this.positions[i * 3] = origin.x;
      this.positions[i * 3 + 1] = origin.y;
      this.positions[i * 3 + 2] = origin.z;
      this.maxLife[i] = (reach / speed) * (0.85 + Math.random() * 0.15);
      this.life[i] = 0;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] >= this.maxLife[i]) {
        this.alphas[i] = 0;
        continue;
      }
      this.life[i] += dt;
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
      this.alphas[i] = 1 - this.life[i] / this.maxLife[i];
    }
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('alpha').needsUpdate = true;
  }
}
