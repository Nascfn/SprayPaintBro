import * as THREE from 'three';
import type { PaintRenderer } from './PaintRenderer';
import type { PaintSurface } from './PaintSurface';

const MAX_DRIPS = 48;

interface Drip {
  surface: PaintSurface;
  /** Position of the drip's head in surface metres, origin bottom-left. */
  x: number;
  y: number;
  length: number;
  remaining: number;
  speed: number;
  width: number;
  color: THREE.Color;
}

/** Runs of paint that slide down the wall where too much has pooled. */
export class Drips {
  private readonly drips: Drip[] = [];

  constructor(private readonly painter: PaintRenderer) {}

  get count(): number {
    return this.drips.length;
  }

  spawn(surface: PaintSurface, u: number, v: number, sprayRadius: number, color: THREE.Color): void {
    if (this.drips.length >= MAX_DRIPS) return;
    const length = 0.08 + Math.random() * 0.45;
    this.drips.push({
      surface,
      x: u * surface.width + (Math.random() - 0.5) * sprayRadius * 0.5,
      y: v * surface.height - sprayRadius * 0.2,
      length,
      remaining: length,
      speed: 0.1 + Math.random() * 0.15,
      width: THREE.MathUtils.clamp(sprayRadius * 0.12, 0.004, 0.014),
      color: color.clone(),
    });
  }

  /** Stops drips on a surface, e.g. after it was cleared or undone. */
  cancel(surface: PaintSurface): void {
    for (let i = this.drips.length - 1; i >= 0; i--) {
      if (this.drips[i].surface === surface) this.drips.splice(i, 1);
    }
  }

  update(dt: number): void {
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i];
      const step = Math.min(d.speed * dt, d.remaining, d.y);
      // Runs slow down as the paint thins out.
      d.speed = Math.max(0.025, d.speed * Math.exp(-dt * 0.7));
      // Thins towards the tail end of the run.
      const taper = 0.55 + 0.45 * (d.remaining / d.length);
      const radius = d.width * taper;
      const spacing = radius * 0.4;
      for (let travelled = 0; travelled < step; travelled += spacing) {
        this.stamp(d, d.y - travelled, radius);
      }
      d.y -= step;
      d.remaining -= step;
      if (d.remaining <= 1e-4 || d.y <= 1e-4) {
        // A small bead of paint collects at the end of the run.
        this.stamp(d, d.y, d.width * 0.9);
        this.drips.splice(i, 1);
      }
    }
  }

  private stamp(d: Drip, y: number, radius: number): void {
    this.painter.queueStamp(d.surface, {
      u: d.x / d.surface.width,
      v: y / d.surface.height,
      radius,
      color: d.color,
      alpha: 0.85,
      hard: true,
    });
  }
}
