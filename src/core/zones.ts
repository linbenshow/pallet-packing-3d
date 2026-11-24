import type { PalletSpec, ZoneRect } from './types';

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export interface ZoneLayoutSpec {
  id: 'full' | 'half-y' | 'half-x' | 'hybrid-y' | 'quarter';
  name: string;
  complexityPenalty: number;
  zones: ZoneRect[];
}

/**
 * Generates standard modular pallet zone layouts:
 * - 1/1 Full Layer
 * - 1/2 Half Layer (split along Y or X)
 * - 1/2 + 2×1/4 Hybrid (one half for large/long cargo + two quarters for medium/small cargo)
 * - 4×1/4 Quarter Layer (2×2 quadrants)
 * Inter-zone clearance `gapCm` is strictly reserved between adjacent zones.
 */
export function buildZoneLayouts(
  pallet: PalletSpec,
  gapCm: number
): Record<ZoneLayoutSpec['id'], ZoneLayoutSpec> {
  const L = pallet.length;
  const W = pallet.width;
  const g = Math.max(0, gapCm);

  const halfL = round4((L - g) / 2);
  const halfW = round4((W - g) / 2);
  const x2 = round4(halfL + g);
  const y2 = round4(halfW + g);

  return {
    full: {
      id: 'full',
      name: '1/1 整層',
      complexityPenalty: 0,
      zones: [{ id: 'z-full', label: '1/1 整層', x: 0, y: 0, dx: L, dy: W }],
    },
    'half-y': {
      id: 'half-y',
      name: '1/2 前後雙區',
      complexityPenalty: 1.5,
      zones: [
        { id: 'z-hy-1', label: '1/2-後區', x: 0, y: 0, dx: L, dy: halfW },
        { id: 'z-hy-2', label: '1/2-前區', x: 0, y: y2, dx: L, dy: halfW },
      ],
    },
    'half-x': {
      id: 'half-x',
      name: '1/2 左右雙區',
      complexityPenalty: 1.5,
      zones: [
        { id: 'z-hx-1', label: '1/2-左區', x: 0, y: 0, dx: halfL, dy: W },
        { id: 'z-hx-2', label: '1/2-右區', x: x2, y: 0, dx: halfL, dy: W },
      ],
    },
    'hybrid-y': {
      id: 'hybrid-y',
      name: '1/2 + 雙1/4 混合區',
      complexityPenalty: 2.2,
      zones: [
        { id: 'z-hyb-1', label: '1/2-後區', x: 0, y: 0, dx: L, dy: halfW },
        { id: 'z-hyb-2', label: '1/4-前左', x: 0, y: y2, dx: halfL, dy: halfW },
        { id: 'z-hyb-3', label: '1/4-前右', x: x2, y: y2, dx: halfL, dy: halfW },
      ],
    },
    quarter: {
      id: 'quarter',
      name: '4×1/4 四分區',
      complexityPenalty: 2.8,
      zones: [
        { id: 'z-q1', label: '1/4-後左', x: 0, y: 0, dx: halfL, dy: halfW },
        { id: 'z-q2', label: '1/4-後右', x: x2, y: 0, dx: halfL, dy: halfW },
        { id: 'z-q3', label: '1/4-前左', x: 0, y: y2, dx: halfL, dy: halfW },
        { id: 'z-q4', label: '1/4-前右', x: x2, y: y2, dx: halfL, dy: halfW },
      ],
    },
  };
}
