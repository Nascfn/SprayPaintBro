import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const RADIUS = 0.35;
const HEIGHT = 1.8;
const EYE_HEIGHT = 1.65;
/** Ledges up to this height (curbs) are walked onto rather than blocking. */
const STEP_HEIGHT = 0.35;
const WALK_SPEED = 3.8;
const SPRINT_SPEED = 6.5;
const ACCELERATION = 14;
const AIR_CONTROL = 0.25;
const GRAVITY = 20;
const JUMP_SPEED = 6.4;
const STRIDE = 1.5;

/** First-person movement: pointer-lock mouse look, WASD, sprint, jump and box collisions. */
export class PlayerController {
  readonly controls: PointerLockControls;
  /** Feet position. */
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  onGround = true;
  /** Walk cycle phase in radians, used for head bob and the viewmodel sway. */
  bobPhase = 0;
  /** 0..1, how much of full walking speed the player is moving at. */
  moveAmount = 0;
  onStep: (() => void) | null = null;

  private readonly keys = new Set<string>();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly wish = new THREE.Vector3();
  private strideDistance = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    private readonly colliders: THREE.Box3[],
  ) {
    this.controls = new PointerLockControls(camera, dom);
    this.controls.pointerSpeed = 0.9;
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  teleport(x: number, y: number, z: number, yaw?: number, pitch = 0): void {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    if (yaw !== undefined) this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    this.syncCamera();
  }

  update(dt: number, inputEnabled: boolean): void {
    const k = (code: string) => inputEnabled && this.keys.has(code);
    this.camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    this.forward.normalize();
    this.right.crossVectors(this.forward, THREE.Object3D.DEFAULT_UP);

    this.wish.set(0, 0, 0);
    if (k('KeyW') || k('ArrowUp')) this.wish.add(this.forward);
    if (k('KeyS') || k('ArrowDown')) this.wish.sub(this.forward);
    if (k('KeyD') || k('ArrowRight')) this.wish.add(this.right);
    if (k('KeyA') || k('ArrowLeft')) this.wish.sub(this.right);
    if (this.wish.lengthSq() > 0) this.wish.normalize();
    const speed = k('ShiftLeft') || k('ShiftRight') ? SPRINT_SPEED : WALK_SPEED;
    this.wish.multiplyScalar(speed);

    const accel = ACCELERATION * (this.onGround ? 1 : AIR_CONTROL);
    const blend = 1 - Math.exp(-accel * dt);
    this.velocity.x += (this.wish.x - this.velocity.x) * blend;
    this.velocity.z += (this.wish.z - this.velocity.z) * blend;

    if (this.onGround && k('Space')) {
      this.velocity.y = JUMP_SPEED;
      this.onGround = false;
    }

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.collideHorizontal();

    const prevY = this.position.y;
    this.velocity.y -= GRAVITY * dt;
    this.position.y += this.velocity.y * dt;
    const ground = this.groundHeight(prevY);
    if (this.position.y <= ground) {
      this.position.y = ground;
      this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }
    this.collideCeiling();

    const horizontal = Math.hypot(this.velocity.x, this.velocity.z);
    this.moveAmount = this.onGround ? Math.min(1, horizontal / WALK_SPEED) : 0;
    if (this.onGround && horizontal > 0.3) {
      this.bobPhase += (horizontal * dt * Math.PI) / STRIDE;
      this.strideDistance += horizontal * dt;
      if (this.strideDistance >= STRIDE) {
        this.strideDistance -= STRIDE;
        this.onStep?.();
      }
    }
    this.syncCamera();
  }

  private syncCamera(): void {
    const bob = Math.abs(Math.sin(this.bobPhase)) * 0.045 * this.moveAmount;
    this.camera.position.set(this.position.x, this.position.y + EYE_HEIGHT + bob, this.position.z);
  }

  /** Pushes the player's circle out of any box that overlaps their body vertically. */
  private collideHorizontal(): void {
    const p = this.position;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const box of this.colliders) {
        if (box.max.y <= p.y + STEP_HEIGHT || box.min.y >= p.y + HEIGHT) continue;
        const cx = THREE.MathUtils.clamp(p.x, box.min.x, box.max.x);
        const cz = THREE.MathUtils.clamp(p.z, box.min.z, box.max.z);
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= RADIUS * RADIUS) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const nz = dz / d;
          p.x += nx * (RADIUS - d);
          p.z += nz * (RADIUS - d);
          const vn = this.velocity.x * nx + this.velocity.z * nz;
          if (vn < 0) {
            this.velocity.x -= vn * nx;
            this.velocity.z -= vn * nz;
          }
        } else {
          // Centre is inside the box: leave through the nearest side.
          const exits = [
            [box.min.x - RADIUS - p.x, 0],
            [box.max.x + RADIUS - p.x, 0],
            [0, box.min.z - RADIUS - p.z],
            [0, box.max.z + RADIUS - p.z],
          ];
          exits.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
          p.x += exits[0][0];
          p.z += exits[0][1];
        }
        moved = true;
      }
      if (!moved) break;
    }
  }

  /** Highest box top under the player that they could stand on from `fromY`. */
  private groundHeight(fromY: number): number {
    let ground = 0;
    const p = this.position;
    const r = RADIUS * 0.6;
    for (const box of this.colliders) {
      if (box.max.y > fromY + STEP_HEIGHT || box.max.y <= ground) continue;
      if (p.x < box.min.x - r || p.x > box.max.x + r || p.z < box.min.z - r || p.z > box.max.z + r) continue;
      ground = box.max.y;
    }
    return ground;
  }

  private collideCeiling(): void {
    if (this.velocity.y <= 0) return;
    const p = this.position;
    const head = p.y + HEIGHT;
    for (const box of this.colliders) {
      if (box.min.y > head || box.min.y < p.y + STEP_HEIGHT) continue;
      if (p.x < box.min.x || p.x > box.max.x || p.z < box.min.z || p.z > box.max.z) continue;
      p.y = box.min.y - HEIGHT;
      this.velocity.y = 0;
    }
  }
}
