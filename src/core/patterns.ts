import { EPS, rectOverlapArea } from './physics';
import type { Box2D, InterlockStrategy, OptimizationPriority } from './types';

export interface LayerPattern {
  name: string;
  boxes: Box2D[];
}

export interface InterlockingPatternPair {
  oddPattern: LayerPattern;
  evenPattern: LayerPattern;
  interlockScore: number; // 0..1 average bidirectional cross-tie ratio
  minSupportRatio: number; // minimum bottom support ratio between odd <-> even
  transformLabel: string;
}

/** How many boxes of size `d` fit in span `S` with inter-box gap `g` (zero overhang) */
function fitCount(span: number, boxSize: number, gap: number): number {
  if (boxSize <= EPS || span + EPS < boxSize) return 0;
  return Math.floor((span + gap + EPS) / (boxSize + gap));
}

/** Centers a 2D pattern symmetrically on the pallet [0, L] x [0, W] */
export function centerPattern(boxes: Box2D[], L: number, W: number): Box2D[] {
  if (boxes.length === 0) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.dx);
    maxY = Math.max(maxY, b.y + b.dy);
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const offsetX = Math.max(0, (L - spanX) / 2) - minX;
  const offsetY = Math.max(0, (W - spanY) / 2) - minY;

  return boxes.map((b) => ({
    ...b,
    x: round4(b.x + offsetX),
    y: round4(b.y + offsetY),
  }));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function generateGrid(
  startX: number,
  startY: number,
  spanX: number,
  spanY: number,
  dx: number,
  dy: number,
  rotated: boolean,
  gap: number
): Box2D[] {
  const nx = fitCount(spanX, dx, gap);
  const ny = fitCount(spanY, dy, gap);
  const boxes: Box2D[] = [];
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      boxes.push({
        x: round4(startX + ix * (dx + gap)),
        y: round4(startY + iy * (dy + gap)),
        dx,
        dy,
        rotated,
      });
    }
  }
  return boxes;
}

export function transformPattern(
  boxes: Box2D[],
  L: number,
  W: number,
  mode: 'mirror-x' | 'mirror-y' | 'rotate-180'
): Box2D[] {
  return boxes.map((b) => {
    if (mode === 'mirror-x') {
      return { ...b, x: round4(L - (b.x + b.dx)) };
    }
    if (mode === 'mirror-y') {
      return { ...b, y: round4(W - (b.y + b.dy)) };
    }
    return {
      ...b,
      x: round4(L - (b.x + b.dx)),
      y: round4(W - (b.y + b.dy)),
    };
  });
}

/**
 * Generates all classical industrial single-SKU pallet layer patterns for box (l, w)
 * on pallet (L, W) with clearance `gap`.
 */
export function generateSingleSkuPatterns(
  L: number,
  W: number,
  l: number,
  w: number,
  gap: number
): LayerPattern[] {
  const g = Math.max(0, gap);
  const patterns: LayerPattern[] = [];

  // 1. Block-0 (0° orientation)
  const b0 = centerPattern(generateGrid(0, 0, L, W, l, w, false, g), L, W);
  if (b0.length > 0) patterns.push({ name: '並列 0° (Block)', boxes: b0 });

  // 2. Block-90 (90° orientation)
  if (Math.abs(l - w) > EPS) {
    const b90 = centerPattern(generateGrid(0, 0, L, W, w, l, true, g), L, W);
    if (b90.length > 0) patterns.push({ name: '並列 90° (Block-R)', boxes: b90 });
  }

  // 3. Split-X (Two-Block Brick along X)
  if (Math.abs(l - w) > EPS) {
    let bestSplitX: Box2D[] = [];
    const maxCols0 = fitCount(L, l, g);
    for (let c = 1; c < maxCols0; c++) {
      const usedX = c * l + (c - 1) * g;
      const remX = L - usedX - g;
      if (remX + EPS < w) continue;
      const left = generateGrid(0, 0, usedX, W, l, w, false, g);
      const right = generateGrid(usedX + g, 0, remX, W, w, l, true, g);
      if (right.length === 0) continue;
      const combined = centerPattern([...left, ...right], L, W);
      if (combined.length > bestSplitX.length) {
        bestSplitX = combined;
      }
    }
    // Also try rotated on left, normal on right
    const maxCols90 = fitCount(L, w, g);
    for (let c = 1; c < maxCols90; c++) {
      const usedX = c * w + (c - 1) * g;
      const remX = L - usedX - g;
      if (remX + EPS < l) continue;
      const left = generateGrid(0, 0, usedX, W, w, l, true, g);
      const right = generateGrid(usedX + g, 0, remX, W, l, w, false, g);
      if (right.length === 0) continue;
      const combined = centerPattern([...left, ...right], L, W);
      if (combined.length > bestSplitX.length) {
        bestSplitX = combined;
      }
    }
    if (bestSplitX.length > 0) {
      patterns.push({ name: '雙區交錯-X (Split-X)', boxes: bestSplitX });
    }
  }

  // 4. Split-Y (Two-Block Brick along Y)
  if (Math.abs(l - w) > EPS) {
    let bestSplitY: Box2D[] = [];
    const maxRows0 = fitCount(W, w, g);
    for (let r = 1; r < maxRows0; r++) {
      const usedY = r * w + (r - 1) * g;
      const remY = W - usedY - g;
      if (remY + EPS < l) continue;
      const back = generateGrid(0, 0, L, usedY, l, w, false, g);
      const front = generateGrid(0, usedY + g, L, remY, w, l, true, g);
      if (front.length === 0) continue;
      const combined = centerPattern([...back, ...front], L, W);
      if (combined.length > bestSplitY.length) {
        bestSplitY = combined;
      }
    }
    const maxRows90 = fitCount(W, l, g);
    for (let r = 1; r < maxRows90; r++) {
      const usedY = r * l + (r - 1) * g;
      const remY = W - usedY - g;
      if (remY + EPS < w) continue;
      const back = generateGrid(0, 0, L, usedY, w, l, true, g);
      const front = generateGrid(0, usedY + g, L, remY, l, w, false, g);
      if (front.length === 0) continue;
      const combined = centerPattern([...back, ...front], L, W);
      if (combined.length > bestSplitY.length) {
        bestSplitY = combined;
      }
    }
    if (bestSplitY.length > 0) {
      patterns.push({ name: '雙區交錯-Y (Split-Y)', boxes: bestSplitY });
    }
  }

  // 5. Pinwheel (4-Quadrant Rotational Interlock)
  if (Math.abs(l - w) > EPS) {
    let bestPinwheel: Box2D[] = [];
    // Try split coordinates (sx, sy) formed by integer multiples of box dims
    const maxA = fitCount(L, l, g);
    const maxB = fitCount(W, l, g);
    for (let a = 1; a <= maxA; a++) {
      const spanA = a * l + (a - 1) * g;
      const remX = L - spanA - g;
      if (remX + EPS < w) continue;
      for (let b = 1; b <= maxB; b++) {
        const spanB = b * l + (b - 1) * g;
        const remY = W - spanB - g;
        if (remY + EPS < w) continue;

        // Top-Left: l x w (spanA x remY_top? Use classical 4-block pinwheel):
        // Q1 (back-left): [0, spanA] x [0, remY] -> l x w
        // Q2 (back-right): [spanA+g, L] x [0, spanB] -> w x l
        // Q3 (front-right): [L-spanA, L] x [spanB+g, W] -> l x w
        // Q4 (front-left): [0, remX] x [remY+g, W] -> w x l
        // Valid without overlap when remX <= spanA and remY <= spanB (or vice versa)
        if (remX <= L - spanA - g + EPS && remY <= W - spanB - g + EPS) {
          const q1 = generateGrid(0, 0, spanA, remY, l, w, false, g);
          const q2 = generateGrid(spanA + g, 0, remX, spanB, w, l, true, g);
          const q3 = generateGrid(L - spanA, spanB + g, spanA, remY, l, w, false, g);
          const q4 = generateGrid(0, remY + g, remX, spanB, w, l, true, g);
          const combined = [...q1, ...q2, ...q3, ...q4];
          if (combined.length > bestPinwheel.length && isNonOverlapping(combined, g)) {
            bestPinwheel = centerPattern(combined, L, W);
          }
        }
      }
    }
    if (bestPinwheel.length > 0) {
      patterns.push({ name: '風車互鎖 (Pinwheel)', boxes: bestPinwheel });
    }
  }

  // 6. Alternating Rows (Brick-Row)
  if (Math.abs(l - w) > EPS) {
    const altBoxes: Box2D[] = [];
    let curY = 0;
    let rowIdx = 0;
    while (true) {
      const useRot = rowIdx % 2 === 1;
      const dx = useRot ? w : l;
      const dy = useRot ? l : w;
      if (curY + dy > W + EPS) break;
      const row = generateGrid(0, curY, L, dy, dx, dy, useRot, g);
      if (row.length === 0) break;
      altBoxes.push(...row);
      curY += dy + g;
      rowIdx++;
    }
    if (altBoxes.length > 0) {
      patterns.push({
        name: '交錯列 (Brick-Row)',
        boxes: centerPattern(altBoxes, L, W),
      });
    }
  }

  return patterns;
}

function isNonOverlapping(boxes: Box2D[], gap: number): boolean {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const sepX = a.x + a.dx + gap <= b.x + EPS || b.x + b.dx + gap <= a.x + EPS;
      const sepY = a.y + a.dy + gap <= b.y + EPS || b.y + b.dy + gap <= a.y + EPS;
      if (!sepX && !sepY) return false;
    }
  }
  return true;
}

/**
 * Evaluates support & cross-tie interlocking when `upper` layer sits directly on `lower` layer.
 */
function evaluateLayerTransition(
  upper: Box2D[],
  lower: Box2D[]
): { minSupport: number; interlockRatio: number } {
  if (upper.length === 0) return { minSupport: 1, interlockRatio: 0 };
  let minSupport = 1;
  let interlocked = 0;

  for (const u of upper) {
    const uArea = u.dx * u.dy;
    let supported = 0;
    let meaningfulCount = 0;

    for (const lo of lower) {
      const ov = rectOverlapArea(u, lo);
      if (ov > EPS) {
        supported += ov;
        if (ov / uArea >= 0.05) {
          meaningfulCount++;
        }
      }
    }

    const ratio = Math.min(1, supported / uArea);
    if (ratio < minSupport) minSupport = ratio;
    if (meaningfulCount >= 2) interlocked++;
  }

  return {
    minSupport,
    interlockRatio: interlocked / upper.length,
  };
}

/**
 * Selects the optimal (Odd Layer, Even Layer) pair for a single SKU.
 * Maximizes box count per layer while achieving strong odd/even interlocking
 * and strictly respecting `minSupportRatio`.
 */
export function selectBestSingleSkuPair(
  L: number,
  W: number,
  l: number,
  w: number,
  gap: number,
  minSupportRatio: number,
  enableInterlocking: boolean,
  strategy: InterlockStrategy,
  priority: OptimizationPriority = 'balanced'
): InterlockingPatternPair | null {
  const candidates = generateSingleSkuPatterns(L, W, l, w, gap);
  if (candidates.length === 0) return null;

  const maxCount = Math.max(...candidates.map((c) => c.boxes.length));

  if (!enableInterlocking) {
    const best = candidates.find((c) => c.boxes.length === maxCount)!;
    return {
      oddPattern: best,
      evenPattern: best,
      interlockScore: 0,
      minSupportRatio: 1,
      transformLabel: '柱狀同向堆疊',
    };
  }

  let bestPair: InterlockingPatternPair | null = null;
  let bestScore = -Infinity;

  const transforms: { mode: 'mirror-x' | 'mirror-y' | 'rotate-180'; label: string }[] =
    strategy === 'auto'
      ? [
          { mode: 'rotate-180', label: '偶數層旋轉 180°' },
          { mode: 'mirror-x', label: '偶數層 X 軸鏡像' },
          { mode: 'mirror-y', label: '偶數層 Y 軸鏡像' },
        ]
      : [
          {
            mode: strategy,
            label:
              strategy === 'rotate-180'
                ? '偶數層旋轉 180°'
                : strategy === 'mirror-x'
                ? '偶數層 X 軸鏡像'
                : '偶數層 Y 軸鏡像',
          },
        ];

  const evaluatePair = (
    odd: LayerPattern,
    even: LayerPattern,
    label: string
  ) => {
    const oddToEven = evaluateLayerTransition(even.boxes, odd.boxes);
    const evenToOdd = evaluateLayerTransition(odd.boxes, even.boxes);
    const minSup = Math.min(oddToEven.minSupport, evenToOdd.minSupport);

    if (minSup + EPS < minSupportRatio) return;

    const avgCount = (odd.boxes.length + even.boxes.length) / 2;
    const interlock = (oddToEven.interlockRatio + evenToOdd.interlockRatio) / 2;
    const densityRatio = avgCount / Math.max(1, maxCount);

    // Enforce hard density floor so interlocking strategy never unreasonably destroys fill rate
    const maxSacrifice =
      priority === 'fill-rate' ? 0.0 : priority === 'interlock' ? 0.15 : 0.05;
    if (densityRatio + EPS < 1 - maxSacrifice) return;

    const interlockWeight =
      priority === 'fill-rate' ? 8 : priority === 'interlock' ? 22 : 12;
    const score = densityRatio * 100 + interlock * interlockWeight + minSup * 4;

    if (score > bestScore) {
      bestScore = score;
      bestPair = {
        oddPattern: odd,
        evenPattern: even,
        interlockScore: interlock,
        minSupportRatio: minSup,
        transformLabel: label,
      };
    }
  };

  // 1. Evaluate each candidate paired with its own transforms
  for (const cand of candidates) {
    for (const tf of transforms) {
      const evenBoxes = transformPattern(cand.boxes, L, W, tf.mode);
      evaluatePair(
        cand,
        { name: `${cand.name} · ${tf.label}`, boxes: evenBoxes },
        tf.label
      );
    }
    // Also allow identical stacking as fallback
    evaluatePair(cand, cand, '同向堆疊');
  }

  // 2. When strategy is 'auto', also evaluate cross-pattern pairs (e.g. Block-0 on odd + Block-90 on even!)
  if (strategy === 'auto') {
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        evaluatePair(
          candidates[i],
          candidates[j],
          `交替模式 (${candidates[j].name})`
        );
      }
    }
  }

  return bestPair;
}
