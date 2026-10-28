import * as THREE from 'three';
import type { Drips } from './Drips';
import type { PaintRenderer } from './PaintRenderer';
import type { PaintSurface } from './PaintSurface';
import {
  MAX_SPRAY_DISTANCE,
  NOZZLE_CAPS,
  dripWeight,
  sprayFlow,
  sprayRadius,
  stampAlpha,
  stampCount,
} from './sprayMath';

const MAX_UNDO = 10;
/** Pooled paint needed before a drip starts running. */
const DRIP_THRESHOLD = 30;
const AIM_RANGE = 12;
/** The can is held out in front of the eyes, so it's this much closer to the wall. */
const NOZZLE_REACH = 0.3;

export interface AimInfo {
  /** What the crosshair is on, if it's a paintable surface. */
  surface: PaintSurface | null;
  u: number;
  v: number;
  distance: number;
  /** Distance from the nozzle to the wall. */
  sprayDistance: number;
  point: THREE.Vector3 | null;
  /** Spray radius at this distance with the current nozzle. */
  radius: number;
}

type UndoEntry = Map<PaintSurface, THREE.WebGLRenderTarget | null>;

/** Turns the trigger, aim and selected colour into paint on the walls. */
export class PaintSystem {
  color = new THREE.Color('#ff3b30');
  nozzleIndex = 1;
  /** Trigger held down. */
  spraying = false;
  aim: AimInfo = { surface: null, u: 0, v: 0, distance: Infinity, sprayDistance: Infinity, point: null, radius: 0 };

  private readonly raycaster = new THREE.Raycaster();
  private readonly center = new THREE.Vector2(0, 0);
  private lastHit: { surface: PaintSurface; u: number; v: number } | null = null;
  private stroke: UndoEntry | null = null;
  private readonly undoStack: UndoEntry[] = [];
  private time = 0;

  constructor(
    private readonly camera: THREE.Camera,
    private readonly targets: THREE.Object3D[],
    private readonly painter: PaintRenderer,
    private readonly drips: Drips,
  ) {
    this.raycaster.far = AIM_RANGE;
  }

  get nozzle() {
    return NOZZLE_CAPS[this.nozzleIndex];
  }

  /** True while paint is actually landing on a wall. */
  get hitting(): boolean {
    return this.spraying && this.aim.surface !== null && this.aim.sprayDistance < MAX_SPRAY_DISTANCE;
  }

  cycleNozzle(dir: number): void {
    const n = NOZZLE_CAPS.length;
    this.nozzleIndex = (((this.nozzleIndex + dir) % n) + n) % n;
  }

  update(dt: number): void {
    this.time += dt;
    this.updateAim();

    if (!this.spraying) {
      this.endStroke();
      return;
    }
    this.stroke ??= new Map();

    const { surface, sprayDistance } = this.aim;
    if (!surface || sprayDistance >= MAX_SPRAY_DISTANCE) {
      this.lastHit = null;
      return;
    }

    for (const s of [surface, surface.left, surface.right]) {
      if (s && !this.stroke.has(s)) this.stroke.set(s, this.painter.snapshot(s));
    }

    const radius = this.aim.radius;
    const frameAlpha = sprayFlow(this.nozzle.flow, sprayDistance) * dt;
    const from = this.lastHit?.surface === surface ? this.lastHit : { u: this.aim.u, v: this.aim.v };
    const travel = Math.hypot((this.aim.u - from.u) * surface.width, (this.aim.v - from.v) * surface.height);
    const n = stampCount(travel, radius);
    const alpha = stampAlpha(frameAlpha, n);
    const weight = dripWeight(radius);

    for (let i = 1; i <= n; i++) {
      const t = i / n;
      // A little hand jitter keeps lines from looking machine-drawn.
      const jitter = radius * 0.04;
      const u = from.u + (this.aim.u - from.u) * t + ((Math.random() - 0.5) * jitter) / surface.width;
      const v = from.v + (this.aim.v - from.v) * t + ((Math.random() - 0.5) * jitter) / surface.height;
      this.painter.queueStamp(surface, { u, v, radius, color: this.color, alpha });
      if (surface.addLoad(u, v, alpha * weight, this.time) > DRIP_THRESHOLD) {
        surface.resetLoad(u, v);
        this.drips.spawn(surface, u, v, radius, this.color);
      }
    }
    this.lastHit = { surface, u: this.aim.u, v: this.aim.v };
  }

  /** Wipes the wall under the crosshair. Undoable. */
  clearAimed(): boolean {
    const surface = this.aim.surface;
    if (!surface?.painted) return false;
    this.endStroke();
    this.pushUndo(new Map([[surface, this.painter.snapshot(surface)]]));
    this.drips.cancel(surface);
    this.painter.clear(surface);
    return true;
  }

  undo(): boolean {
    this.endStroke();
    const entry = this.undoStack.pop();
    if (!entry) return false;
    for (const [surface, snapshot] of entry) {
      this.drips.cancel(surface);
      this.painter.restore(surface, snapshot);
      surface.clearLoad();
      snapshot?.dispose();
    }
    return true;
  }

  private endStroke(): void {
    this.lastHit = null;
    if (this.stroke && this.stroke.size > 0) this.pushUndo(this.stroke);
    this.stroke = null;
  }

  private pushUndo(entry: UndoEntry): void {
    this.undoStack.push(entry);
    while (this.undoStack.length > MAX_UNDO) {
      for (const snapshot of this.undoStack.shift()!.values()) snapshot?.dispose();
    }
  }

  private updateAim(): void {
    this.raycaster.setFromCamera(this.center, this.camera);
    const hit = this.raycaster.intersectObjects(this.targets, false)[0];
    const aim = this.aim;
    aim.surface = null;
    aim.point = hit?.point ?? null;
    aim.distance = hit?.distance ?? Infinity;
    aim.sprayDistance = Math.max(0, aim.distance - NOZZLE_REACH);
    aim.radius = sprayRadius(this.nozzle.radius, aim.sprayDistance);
    const surface = hit?.object.userData.paintSurface as PaintSurface | undefined;
    if (surface && hit?.uv) {
      aim.surface = surface;
      aim.u = hit.uv.x;
      aim.v = hit.uv.y;
    }
  }
}
