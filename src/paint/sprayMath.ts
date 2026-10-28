/** Beyond this distance (metres) the mist dissipates before it reaches the wall. */
export const MAX_SPRAY_DISTANCE = 3.0;
export const MIN_SPRAY_DISTANCE = 0.12;

export interface NozzleCap {
  name: string;
  /** Outer stamp radius in metres when spraying from 1 m away. */
  radius: number;
  /** Paint output; scales how quickly coverage builds up. */
  flow: number;
}

export const NOZZLE_CAPS: NozzleCap[] = [
  { name: 'Skinny', radius: 0.035, flow: 32 },
  { name: 'Medium', radius: 0.08, flow: 30 },
  { name: 'Fat', radius: 0.16, flow: 26 },
];

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The spray cone widens with distance: a tight line up close, a broad haze from far away. */
export function sprayRadius(baseRadius: number, distance: number): number {
  const d = clamp(distance, MIN_SPRAY_DISTANCE, MAX_SPRAY_DISTANCE);
  return baseRadius * (0.25 + 0.75 * d);
}

/** Opacity deposited per second of spraying at the centre of the cone. */
export function sprayFlow(flow: number, distance: number): number {
  if (distance >= MAX_SPRAY_DISTANCE) return 0;
  const d = Math.max(distance, MIN_SPRAY_DISTANCE);
  const falloff = 1 - d / MAX_SPRAY_DISTANCE;
  return (flow * falloff) / (0.5 + 0.5 * d);
}

/** Stamps needed to cover `travel` metres without gaps, at a quarter radius apart. */
export function stampCount(travel: number, radius: number, max = 48): number {
  const spacing = Math.max(radius * 0.25, 1e-4);
  return clamp(Math.ceil(travel / spacing), 1, max);
}

/**
 * Per-stamp opacity so that `n` stamps laid over the same spot add up to `frameAlpha`.
 * Spread along a fast stroke, each spot gets fewer stamps and the line comes out thinner.
 */
export function stampAlpha(frameAlpha: number, n: number): number {
  const a = clamp(frameAlpha, 0, 0.95);
  return 1 - Math.pow(1 - a, 1 / Math.max(1, n));
}

/** How much a stamp counts towards a drip. Narrow, concentrated spray pools faster. */
export function dripWeight(radius: number): number {
  return clamp((0.05 / Math.max(radius, 1e-3)) ** 2, 0.2, 3);
}
