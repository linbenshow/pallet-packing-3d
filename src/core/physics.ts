import type {
  LayerSummary,
  PackingConfig,
  PackingMetrics,
  PalletSpec,
  PlacedBox,
} from './types';

export const EPS = 1e-4;
export const Z_CONTACT_TOLERANCE = 0.15; // cm tolerance for top/bottom face contact

export interface Rect2D {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export function rectOverlapArea(a: Rect2D, b: Rect2D): number {
  const ox = Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x);
  if (ox <= EPS) return 0;
  const oy = Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y);
  if (oy <= EPS) return 0;
  return ox * oy;
}

export function rectsOverlapWithGap(a: Rect2D, b: Rect2D, gap: number): boolean {
  const g = Math.max(0, gap);
  const sepX = a.x + a.dx + g <= b.x + EPS || b.x + b.dx + g <= a.x + EPS;
  const sepY = a.y + a.dy + g <= b.y + EPS || b.y + b.dy + g <= a.y + EPS;
  return !(sepX || sepY);
}

export function isWithinPallet(
  box: { x: number; y: number; z: number; dx: number; dy: number; dz: number },
  pallet: PalletSpec
): boolean {
  return (
    box.x >= -EPS &&
    box.y >= -EPS &&
    box.z >= -EPS &&
    box.x + box.dx <= pallet.length + EPS &&
    box.y + box.dy <= pallet.width + EPS &&
    box.z + box.dz <= pallet.maxHeight + EPS
  );
}

export interface SupportEvaluation {
  supportRatio: number;
  supportingBoxes: { box: PlacedBox; overlapArea: number }[];
  isInterlocked: boolean;
}

/**
 * Computes exact bottom surface support ratio and supporting lower boxes.
 * Note: A supporting box only counts toward interlocking if it contributes a meaningful
 * portion of support (>= 5% of the upper box's footprint) so hairline edge grazing
 * does not falsely count as cross-tie interlocking.
 */
export function evaluateSupport(
  candidate: { x: number; y: number; z: number; dx: number; dy: number },
  placedBoxes: PlacedBox[]
): SupportEvaluation {
  if (candidate.z <= Z_CONTACT_TOLERANCE) {
    return {
      supportRatio: 1,
      supportingBoxes: [],
      isInterlocked: false,
    };
  }

  const area = candidate.dx * candidate.dy;
  if (area <= EPS) {
    return { supportRatio: 0, supportingBoxes: [], isInterlocked: false };
  }

  let supportedArea = 0;
  const supportingBoxes: { box: PlacedBox; overlapArea: number }[] = [];

  for (const lower of placedBoxes) {
    const lowerTop = lower.z + lower.dz;
    if (Math.abs(lowerTop - candidate.z) > Z_CONTACT_TOLERANCE) continue;

    const overlap = rectOverlapArea(candidate, lower);
    if (overlap > EPS) {
      supportedArea += overlap;
      supportingBoxes.push({ box: lower, overlapArea: overlap });
    }
  }

  const supportRatio = Math.min(1, supportedArea / area);
  const meaningfulSupporters = supportingBoxes.filter(
    (s) => s.overlapArea / area >= 0.05
  );

  return {
    supportRatio,
    supportingBoxes,
    isInterlocked: meaningfulSupporters.length >= 2,
  };
}

/**
 * Propagates downward weight from top layers to bottom layers proportionally
 * to each supporting box's contact area. Updates `loadOnTop`, `loadUtilization`,
 * `supportRatio`, `supportingBoxIds`, and `isInterlocked` on every box.
 * Returns true if all boxes satisfy their individual `maxLoad`.
 */
export function propagateLoadsAndSupport(boxes: PlacedBox[]): boolean {
  // Reset computed fields
  for (const b of boxes) {
    b.loadOnTop = 0;
    b.loadUtilization = 0;
  }

  // Sort top-to-bottom (highest z first)
  const topDown = [...boxes].sort((a, b) => b.z - a.z);

  for (const box of topDown) {
    const evalRes = evaluateSupport(box, boxes);
    box.supportRatio = evalRes.supportRatio;
    box.supportingBoxIds = evalRes.supportingBoxes.map((s) => s.box.instanceId);
    box.isInterlocked = evalRes.isInterlocked;

    if (evalRes.supportingBoxes.length === 0) continue;

    const totalContactArea = evalRes.supportingBoxes.reduce(
      (sum, s) => sum + s.overlapArea,
      0
    );
    if (totalContactArea <= EPS) continue;

    const downwardLoad = box.weight + box.loadOnTop;
    for (const sup of evalRes.supportingBoxes) {
      const share = sup.overlapArea / totalContactArea;
      sup.box.loadOnTop += downwardLoad * share;
    }
  }

  let allSafe = true;
  for (const b of boxes) {
    if (b.maxLoad <= 0) {
      b.loadUtilization = b.loadOnTop > EPS ? Infinity : 0;
    } else {
      b.loadUtilization = b.loadOnTop / b.maxLoad;
    }
    if (b.loadOnTop > b.maxLoad + EPS) {
      allSafe = false;
    }
  }

  return allSafe;
}

/**
 * Checks whether adding `extraBoxes` to `existingBoxes` keeps every box within its `maxLoad`.
 * Does not mutate `existingBoxes`.
 */
export function checkLoadSafetyWithAddition(
  existingBoxes: PlacedBox[],
  extraBoxes: PlacedBox[]
): boolean {
  const cloned: PlacedBox[] = [...existingBoxes, ...extraBoxes].map((b) => ({
    ...b,
    supportingBoxIds: [...b.supportingBoxIds],
  }));
  return propagateLoadsAndSupport(cloned);
}

/**
 * Computes exact 3D Center of Gravity for a set of boxes.
 */
export function computeCoG(
  boxes: PlacedBox[],
  pallet: PalletSpec
): { x: number; y: number; z: number } {
  let totalW = 0;
  let wx = 0;
  let wy = 0;
  let wz = 0;

  for (const b of boxes) {
    const cx = b.x + b.dx / 2;
    const cy = b.y + b.dy / 2;
    const cz = b.z + b.dz / 2;
    totalW += b.weight;
    wx += b.weight * cx;
    wy += b.weight * cy;
    wz += b.weight * cz;
  }

  if (totalW <= EPS) {
    return { x: pallet.length / 2, y: pallet.width / 2, z: 0 };
  }

  return {
    x: wx / totalW,
    y: wy / totalW,
    z: wz / totalW,
  };
}

/**
 * Assigns a collision-free stacking sequence suitable for both human operators
 * and robotic palletizers:
 *   1. Strictly bottom-to-top by layerIndex (then z).
 *   2. Within each layer, back-to-front (y ascending) and left-to-right (x ascending),
 *      preventing deep pockets or reaching over placed boxes.
 */
export function assignStackingSequence(boxes: PlacedBox[]): PlacedBox[] {
  const sorted = [...boxes].sort((a, b) => {
    if (a.layerIndex !== b.layerIndex) return a.layerIndex - b.layerIndex;
    if (Math.abs(a.z - b.z) > Z_CONTACT_TOLERANCE) return a.z - b.z;
    // Quantize Y slightly so boxes in the same visual row go cleanly left-to-right
    const rowA = Math.round(a.y / 2);
    const rowB = Math.round(b.y / 2);
    if (rowA !== rowB) return rowA - rowB;
    return a.x - b.x;
  });

  sorted.forEach((b, idx) => {
    b.sequence = idx + 1;
  });

  return sorted;
}

/**
 * Computes comprehensive quality & stability metrics for the final pallet load.
 */
export function computeMetrics(
  boxes: PlacedBox[],
  layers: LayerSummary[],
  pallet: PalletSpec,
  config: PackingConfig,
  totalBoxesRequested: number
): PackingMetrics {
  const totalBoxesPlaced = boxes.length;
  const totalWeight = boxes.reduce((s, b) => s + b.weight, 0);
  const weightUtilization = pallet.maxWeight > 0 ? totalWeight / pallet.maxWeight : 0;

  const usedHeight = boxes.reduce((m, b) => Math.max(m, b.z + b.dz), 0);
  const placedVolume = boxes.reduce((s, b) => s + b.dx * b.dy * b.dz, 0);
  const compactEnvelope = pallet.length * pallet.width * Math.max(usedHeight, EPS);
  const maxEnvelope = pallet.length * pallet.width * Math.max(pallet.maxHeight, EPS);

  const compactVolumeUtilization = totalBoxesPlaced > 0 ? placedVolume / compactEnvelope : 0;
  const totalVolumeUtilization = totalBoxesPlaced > 0 ? placedVolume / maxEnvelope : 0;

  const cog = computeCoG(boxes, pallet);
  const dx = cog.x - pallet.length / 2;
  const dy = cog.y - pallet.width / 2;
  const normX = Math.abs(dx) / Math.max(pallet.length / 2, EPS);
  const normY = Math.abs(dy) / Math.max(pallet.width / 2, EPS);
  const isBalanced =
    normX <= config.maxCogOffsetRatio + EPS &&
    normY <= config.maxCogOffsetRatio + EPS;

  const upperBoxes = boxes.filter((b) => b.z > Z_CONTACT_TOLERANCE);
  const interlockedUpper = upperBoxes.filter((b) => b.isInterlocked).length;
  const interlockRate =
    upperBoxes.length > 0 ? interlockedUpper / upperBoxes.length : 1;

  const avgSupportRatio =
    totalBoxesPlaced > 0
      ? boxes.reduce((s, b) => s + b.supportRatio, 0) / totalBoxesPlaced
      : 1;
  const minSupportRatioFound =
    totalBoxesPlaced > 0
      ? Math.min(...boxes.map((b) => b.supportRatio))
      : 1;

  const maxLoadUtilization =
    totalBoxesPlaced > 0
      ? Math.max(...boxes.map((b) => b.loadUtilization))
      : 0;
  const isLoadSafe = boxes.every((b) => b.loadOnTop <= b.maxLoad + EPS);
  const isOverhangFree = boxes.every((b) => isWithinPallet(b, pallet));

  // Ease of stacking score (0 - 100):
  // 1) Layer flatness: low height variance within each layer (35 pts)
  // 2) SKU grouping: fewer distinct SKUs per layer (30 pts)
  // 3) Clear layering & alignment: regular patterns & high support (35 pts)
  let flatnessScore = 35;
  let groupingScore = 30;
  let regularityScore = 35;

  if (layers.length > 0 && totalBoxesPlaced > 0) {
    let totalHeightVar = 0;
    let totalSkuSwitches = 0;
    let totalPairs = 0;
    let regularLayers = 0;

    for (const layer of layers) {
      const lBoxes = boxes.filter((b) => b.layerIndex === layer.layerIndex);
      if (lBoxes.length === 0) continue;
      const heights = lBoxes.map((b) => b.dz);
      const maxH = Math.max(...heights);
      const minH = Math.min(...heights);
      totalHeightVar += maxH > EPS ? (maxH - minH) / maxH : 0;

      // Count SKU switches along the stacking sequence within the layer
      const seqBoxes = [...lBoxes].sort((a, b) => a.sequence - b.sequence);
      for (let i = 1; i < seqBoxes.length; i++) {
        totalPairs++;
        if (seqBoxes[i].cargoId !== seqBoxes[i - 1].cargoId) {
          totalSkuSwitches++;
        }
      }

      if (!layer.patternName.startsWith('混裝')) {
        regularLayers++;
      }
    }

    const avgVar = totalHeightVar / layers.length;
    flatnessScore = Math.max(0, 35 * (1 - avgVar * 1.5));

    const switchRate = totalPairs > 0 ? totalSkuSwitches / totalPairs : 0;
    groupingScore = Math.max(0, 30 * (1 - switchRate));

    const regRatio = regularLayers / layers.length;
    regularityScore = 20 * avgSupportRatio + 15 * (0.4 + 0.6 * regRatio);
  }

  const easeOfStackingScore = Math.round(
    Math.min(100, Math.max(0, flatnessScore + groupingScore + regularityScore))
  );

  return {
    totalBoxesPlaced,
    totalBoxesRequested,
    totalWeight,
    weightUtilization,
    compactVolumeUtilization,
    totalVolumeUtilization,
    usedHeight,
    cog,
    cogOffset: { dx, dy, normX, normY, isBalanced },
    interlockRate,
    avgSupportRatio,
    minSupportRatioFound,
    maxLoadUtilization,
    isLoadSafe,
    isOverhangFree,
    easeOfStackingScore,
  };
}
