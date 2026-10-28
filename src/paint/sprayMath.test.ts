import { describe, expect, it } from 'vitest';
import {
  MAX_SPRAY_DISTANCE,
  dripWeight,
  sprayFlow,
  sprayRadius,
  stampAlpha,
  stampCount,
} from './sprayMath';

describe('sprayRadius', () => {
  it('widens with distance', () => {
    expect(sprayRadius(0.1, 0.3)).toBeLessThan(sprayRadius(0.1, 1));
    expect(sprayRadius(0.1, 1)).toBeCloseTo(0.1);
    expect(sprayRadius(0.1, 2.5)).toBeLessThan(sprayRadius(0.1, 3));
  });

  it('clamps very close and very far distances', () => {
    expect(sprayRadius(0.1, 0)).toBe(sprayRadius(0.1, 0.12));
    expect(sprayRadius(0.1, 10)).toBe(sprayRadius(0.1, MAX_SPRAY_DISTANCE));
  });
});

describe('sprayFlow', () => {
  it('is strongest up close and fades to nothing at max range', () => {
    expect(sprayFlow(6, 0.2)).toBeGreaterThan(sprayFlow(6, 1));
    expect(sprayFlow(6, 1)).toBeGreaterThan(sprayFlow(6, 2));
    expect(sprayFlow(6, MAX_SPRAY_DISTANCE)).toBe(0);
    expect(sprayFlow(6, 5)).toBe(0);
  });
});

describe('stampCount', () => {
  it('uses a single stamp when the aim stays put', () => {
    expect(stampCount(0, 0.05)).toBe(1);
  });

  it('spaces stamps a quarter radius apart and caps the total', () => {
    expect(stampCount(0.1, 0.04)).toBe(10);
    expect(stampCount(100, 0.04)).toBe(48);
  });
});

describe('stampAlpha', () => {
  it('returns the frame alpha for a single stamp', () => {
    expect(stampAlpha(0.3, 1)).toBeCloseTo(0.3);
  });

  it('splits the alpha so n stamps composite back to the frame alpha', () => {
    const a = stampAlpha(0.3, 5);
    expect(1 - (1 - a) ** 5).toBeCloseTo(0.3);
  });

  it('never returns full opacity', () => {
    expect(stampAlpha(5, 1)).toBeLessThan(1);
  });
});

describe('dripWeight', () => {
  it('favours narrow spray and stays within bounds', () => {
    expect(dripWeight(0.02)).toBeGreaterThan(dripWeight(0.1));
    expect(dripWeight(0.001)).toBe(3);
    expect(dripWeight(10)).toBe(0.2);
  });
});
