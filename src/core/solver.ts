import { selectBestSingleSkuPair, type InterlockingPatternPair } from './patterns';
import {
  EPS,
  Z_CONTACT_TOLERANCE,
  assignStackingSequence,
  checkLoadSafetyWithAddition,
  computeCoG,
  computeMetrics,
  evaluateSupport,
  isWithinPallet,
  propagateLoadsAndSupport,
  rectsOverlapWithGap,
} from './physics';
import type {
  Box2D,
  CargoItem,
  LayerSummary,
  MultiPalletResult,
  PackingConfig,
  PackingResult,
  PalletSpec,
  PalletTemplateGroup,
  PlacedBox,
  UnplacedItem,
} from './types';

interface RemainingSku {
  item: CargoItem;
  remaining: number;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Sorts boxes within a partial pattern so that if we don't have enough boxes
 * to fill the whole layer, we pick a symmetrical subset centered on the pallet
 * to preserve CoG balance.
 */
function selectBalancedSubset(
  patternBoxes: Box2D[],
  count: number,
  pallet: PalletSpec
): Box2D[] {
  if (count >= patternBoxes.length) return patternBoxes;
  const cx = pallet.length / 2;
  const cy = pallet.width / 2;

  const remaining = [...patternBoxes];
  const selected: Box2D[] = [];
  let sumX = 0;
  let sumY = 0;

  while (selected.length < count && remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const b = remaining[i];
      const bx = b.x + b.dx / 2;
      const by = b.y + b.dy / 2;
      const newCx = (sumX + bx) / (selected.length + 1);
      const newCy = (sumY + by) / (selected.length + 1);
      // Combine resulting CoG distance to center + individual distance to center
      const cogDist = Math.hypot(newCx - cx, newCy - cy);
      const selfDist = Math.hypot(bx - cx, by - cy);
      const score = cogDist * 3 + selfDist * 0.5;
      if (score < bestDist) {
        bestDist = score;
        bestIdx = i;
      }
    }

    const chosen = remaining.splice(bestIdx, 1)[0];
    selected.push(chosen);
    sumX += chosen.x + chosen.dx / 2;
    sumY += chosen.y + chosen.dy / 2;
  }

  return selected;
}

/**
 * Generates candidate (x, y) placement points on the pallet at elevation `z`
 * considering existing boxes in the current layer and lower-layer edges for interlocking.
 */
function generateCandidatePoints(
  currentLayerBoxes: PlacedBox[],
  lowerLayerBoxes: PlacedBox[],
  pallet: PalletSpec,
  dx: number,
  dy: number,
  gap: number,
  reverseX: boolean,
  reverseY: boolean
): { x: number; y: number }[] {
  const xs = new Set<number>([0, round4(Math.max(0, pallet.length - dx))]);
  const ys = new Set<number>([0, round4(Math.max(0, pallet.width - dy))]);

  // Center coordinates for balanced placement
  if (pallet.length >= dx) xs.add(round4((pallet.length - dx) / 2));
  if (pallet.width >= dy) ys.add(round4((pallet.width - dy) / 2));

  // Extreme points from boxes already in the current layer
  for (const b of currentLayerBoxes) {
    const right = round4(b.x + b.dx + gap);
    if (right + dx <= pallet.length + EPS) xs.add(right);
    const left = round4(b.x - gap - dx);
    if (left >= -EPS) xs.add(Math.max(0, left));
    xs.add(round4(b.x));

    const front = round4(b.y + b.dy + gap);
    if (front + dy <= pallet.width + EPS) ys.add(front);
    const back = round4(b.y - gap - dy);
    if (back >= -EPS) ys.add(Math.max(0, back));
    ys.add(round4(b.y));
  }

  // Also include lower-layer box edges and midpoints to facilitate cross-tie interlocking
  for (const lo of lowerLayerBoxes) {
    if (lo.x + dx <= pallet.length + EPS) xs.add(round4(lo.x));
    const midX = round4(lo.x + lo.dx / 2);
    if (midX + dx <= pallet.length + EPS) xs.add(midX);
    const alignRight = round4(lo.x + lo.dx - dx);
    if (alignRight >= -EPS && alignRight + dx <= pallet.length + EPS) {
      xs.add(Math.max(0, alignRight));
    }

    if (lo.y + dy <= pallet.width + EPS) ys.add(round4(lo.y));
    const midY = round4(lo.y + lo.dy / 2);
    if (midY + dy <= pallet.width + EPS) ys.add(midY);
    const alignFront = round4(lo.y + lo.dy - dy);
    if (alignFront >= -EPS && alignFront + dy <= pallet.width + EPS) {
      ys.add(Math.max(0, alignFront));
    }
  }

  const xArr = Array.from(xs).filter((v) => v >= -EPS && v + dx <= pallet.length + EPS);
  const yArr = Array.from(ys).filter((v) => v >= -EPS && v + dy <= pallet.width + EPS);

  xArr.sort((a, b) => (reverseX ? b - a : a - b));
  yArr.sort((a, b) => (reverseY ? b - a : a - b));

  // Cap grid size for snappy interactive performance
  const maxCoords = 18;
  const trimmedX = xArr.slice(0, maxCoords);
  const trimmedY = yArr.slice(0, maxCoords);

  const points: { x: number; y: number }[] = [];
  for (const y of trimmedY) {
    for (const x of trimmedX) {
      points.push({ x: Math.max(0, x), y: Math.max(0, y) });
    }
  }
  return points;
}

/**
 * Packs a single mixed (heterogeneous) layer at elevation `z`.
 */
function packMixedLayer(
  z: number,
  layerIndex: number,
  parity: 'odd' | 'even',
  remainingSkus: RemainingSku[],
  allPlaced: PlacedBox[],
  pallet: PalletSpec,
  config: PackingConfig,
  currentWeight: number,
  nextId: () => string
): { layerBoxes: PlacedBox[]; layerHeight: number; patternName: string } {
  const g = Math.max(0, config.gapCm);
  const lowerLayerBoxes = allPlaced.filter(
    (b) => Math.abs(b.z + b.dz - z) <= Z_CONTACT_TOLERANCE
  );

  // Filter SKUs that can physically fit in height, weight, and footprint
  const eligible = remainingSkus.filter((s) => {
    if (s.remaining <= 0) return false;
    if (z + s.item.height > pallet.maxHeight + EPS) return false;
    if (currentWeight + s.item.weight > pallet.maxWeight + EPS) return false;
    const fitsNormal =
      s.item.length <= pallet.length + EPS && s.item.width <= pallet.width + EPS;
    const fitsRot =
      s.item.width <= pallet.length + EPS && s.item.length <= pallet.width + EPS;
    return fitsNormal || fitsRot;
  });

  if (eligible.length === 0) {
    return { layerBoxes: [], layerHeight: 0, patternName: '' };
  }

  // Sort eligible SKUs:
  // If prioritizeHeavyBottom: stronger maxLoad & heavier items first;
  // also prefer items that can form a flat, sturdy base layer.
  const ranked = [...eligible].sort((a, b) => {
    if (config.prioritizeHeavyBottom) {
      // Sturdiness score: load-bearing capacity + weight
      const sturdA = a.item.maxLoad * 1.5 + a.item.weight * 2;
      const sturdB = b.item.maxLoad * 1.5 + b.item.weight * 2;
      if (Math.abs(sturdB - sturdA) > 0.5) return sturdB - sturdA;
    }
    const volA = a.item.length * a.item.width * a.item.height;
    const volB = b.item.length * b.item.width * b.item.height;
    return volB - volA;
  });

  // Pick anchor height from the top-priority SKU; allow slightly shorter or very close heights
  // in the same layer (prefer exact height match first for flat layers!)
  const anchorHeight = ranked[0].item.height;
  const heightTolerance = Math.max(2, anchorHeight * 0.15);

  const layerPool = ranked.filter(
    (s) => Math.abs(s.item.height - anchorHeight) <= heightTolerance
  );
  // Sort pool so exact height matches come first, then by sturdiness, keeping same SKU grouped
  layerPool.sort((a, b) => {
    const diffA = Math.abs(a.item.height - anchorHeight);
    const diffB = Math.abs(b.item.height - anchorHeight);
    if (Math.abs(diffA - diffB) > 0.5) return diffA - diffB;
    if (config.prioritizeHeavyBottom) {
      const sturdA = a.item.maxLoad * 1.5 + a.item.weight * 2;
      const sturdB = b.item.maxLoad * 1.5 + b.item.weight * 2;
      if (Math.abs(sturdB - sturdA) > 0.5) return sturdB - sturdA;
    }
    return b.item.length * b.item.width - a.item.length * a.item.width;
  });

  // Even layers flip fill direction when interlocking is enabled to promote cross-ties
  const reverseX = config.enableInterlocking && parity === 'even';
  const reverseY =
    config.enableInterlocking &&
    parity === 'even' &&
    (config.interlockStrategy === 'rotate-180' ||
      config.interlockStrategy === 'mirror-y' ||
      config.interlockStrategy === 'auto');

  const layerBoxes: PlacedBox[] = [];
  let runningWeight = currentWeight;

  // Iterate through SKU pool (placing same SKU contiguously when groupSameSku is true)
  let progress = true;
  while (progress) {
    progress = false;

    for (const skuEntry of layerPool) {
      while (skuEntry.remaining > 0) {
        const item = skuEntry.item;
        if (runningWeight + item.weight > pallet.maxWeight + EPS) break;
        if (z + item.height > pallet.maxHeight + EPS) break;

        const orientations: { dx: number; dy: number; rotated: boolean }[] = [
          { dx: item.length, dy: item.width, rotated: false },
        ];
        if (Math.abs(item.length - item.width) > EPS) {
          orientations.push({ dx: item.width, dy: item.length, rotated: true });
        }
        // On even layers, try rotated orientation first to promote cross-tie interlocking
        if (config.enableInterlocking && parity === 'even' && orientations.length === 2) {
          orientations.reverse();
        }

        let bestPlacement: PlacedBox | null = null;
        let bestScore = -Infinity;

        const currentAll = [...allPlaced, ...layerBoxes];
        const curCog = computeCoG(currentAll, pallet);
        const totalWBefore = currentAll.reduce((s, b) => s + b.weight, 0);

        for (const ori of orientations) {
          if (ori.dx > pallet.length + EPS || ori.dy > pallet.width + EPS) continue;

          const candidates = generateCandidatePoints(
            layerBoxes,
            lowerLayerBoxes,
            pallet,
            ori.dx,
            ori.dy,
            g,
            reverseX,
            reverseY
          );

          for (const pt of candidates) {
            const candBox: PlacedBox = {
              instanceId: 'temp',
              cargoId: item.id,
              name: item.name,
              x: pt.x,
              y: pt.y,
              z,
              dx: ori.dx,
              dy: ori.dy,
              dz: item.height,
              rotated: ori.rotated,
              weight: item.weight,
              maxLoad: item.maxLoad,
              color: item.color,
              layerIndex,
              layerParity: parity,
              layerPattern: '混裝分層 (Mixed)',
              sequence: 0,
              supportRatio: 1,
              supportingBoxIds: [],
              isInterlocked: false,
              loadOnTop: 0,
              loadUtilization: 0,
            };

            if (!isWithinPallet(candBox, pallet)) continue;

            // Check collision with current layer boxes including gap
            let collides = false;
            for (const other of layerBoxes) {
              if (rectsOverlapWithGap(candBox, other, g)) {
                collides = true;
                break;
              }
            }
            if (collides) continue;

            // Evaluate bottom support
            const sup = evaluateSupport(candBox, allPlaced);
            if (sup.supportRatio + EPS < config.minSupportRatio) continue;

            // Evaluate load-bearing safety on lower boxes
            if (z > Z_CONTACT_TOLERANCE) {
              const safe = checkLoadSafetyWithAddition(allPlaced, [
                ...layerBoxes,
                candBox,
              ]);
              if (!safe) continue;
            }

            // Score this candidate placement:
            // 1. Interlocking bonus (if upper layer & enabled)
            const interlockBonus =
              config.enableInterlocking && sup.isInterlocked ? 35 : 0;

            // 2. CoG balance (closer to pallet center is better)
            const newW = totalWBefore + item.weight;
            const newCogX =
              (curCog.x * totalWBefore + (pt.x + ori.dx / 2) * item.weight) / newW;
            const newCogY =
              (curCog.y * totalWBefore + (pt.y + ori.dy / 2) * item.weight) / newW;
            const cogNorm = Math.hypot(
              (newCogX - pallet.length / 2) / Math.max(1, pallet.length / 2),
              (newCogY - pallet.width / 2) / Math.max(1, pallet.width / 2)
            );
            const balanceScore = Math.max(0, 30 * (1 - cogNorm));

            // 3. SKU grouping: reward adjacency to same-SKU boxes in this layer
            let groupingBonus = 0;
            if (config.groupSameSku) {
              for (const other of layerBoxes) {
                if (other.cargoId !== item.id) continue;
                const distX = Math.max(
                  0,
                  Math.max(other.x - (pt.x + ori.dx), pt.x - (other.x + other.dx))
                );
                const distY = Math.max(
                  0,
                  Math.max(other.y - (pt.y + ori.dy), pt.y - (other.y + other.dy))
                );
                if (distX <= g + 1 && distY <= g + 1) {
                  groupingBonus += 12;
                  break;
                }
              }
            }

            // 4. Compactness / corner hugging (avoid pockets)
            const targetX = reverseX ? pallet.length - (pt.x + ori.dx) : pt.x;
            const targetY = reverseY ? pallet.width - (pt.y + ori.dy) : pt.y;
            const cornerScore =
              20 *
              (1 -
                (targetX / Math.max(1, pallet.length) +
                  targetY / Math.max(1, pallet.width)) /
                  2);

            // 5. Higher support ratio bonus
            const supportBonus = sup.supportRatio * 15;

            const totalScore =
              interlockBonus +
              balanceScore +
              groupingBonus +
              cornerScore +
              supportBonus;

            if (totalScore > bestScore) {
              bestScore = totalScore;
              bestPlacement = candBox;
            }
          }
        }

        if (!bestPlacement) break;

        bestPlacement.instanceId = nextId();
        layerBoxes.push(bestPlacement);
        skuEntry.remaining--;
        runningWeight += item.weight;
        progress = true;

        // If groupSameSku is false, allow round-robin across SKUs
        if (!config.groupSameSku) break;
      }
    }
  }

  // If this is the bottom layer (z == 0), center the entire layer footprint on the pallet
  // to guarantee optimal CoG balance and symmetrical foundation for upper layers!
  if (z <= Z_CONTACT_TOLERANCE && layerBoxes.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of layerBoxes) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.dx);
      maxY = Math.max(maxY, b.y + b.dy);
    }
    const shiftX = (pallet.length - (maxX - minX)) / 2 - minX;
    const shiftY = (pallet.width - (maxY - minY)) / 2 - minY;
    for (const b of layerBoxes) {
      b.x = round4(b.x + shiftX);
      b.y = round4(b.y + shiftY);
    }
  }

  const distinctSkus = new Set(layerBoxes.map((b) => b.cargoId)).size;
  const patternLabel =
    distinctSkus <= 1
      ? `單品項補齊 (${parity === 'odd' ? '奇層' : '偶層'})`
      : `混裝分層 · ${distinctSkus} 品項 (${parity === 'odd' ? '奇層' : '偶層'})`;

  for (const b of layerBoxes) {
    b.layerPattern = patternLabel;
  }

  const layerHeight =
    layerBoxes.length > 0 ? Math.max(...layerBoxes.map((b) => b.dz)) : 0;

  return { layerBoxes, layerHeight, patternName: patternLabel };
}

/**
 * Main 3D Palletizing Solver.
 * Supports both homogeneous single-SKU optimal odd/even interlocking
 * and heterogeneous multi-SKU layer-building with strict physics constraints.
 */
export function solvePalletPacking(
  pallet: PalletSpec,
  items: CargoItem[],
  config: PackingConfig
): PackingResult {
  const validItems = items.filter(
    (it) =>
      it.quantity > 0 &&
      it.length > 0 &&
      it.width > 0 &&
      it.height > 0 &&
      it.weight > 0
  );

  const totalRequested = validItems.reduce((s, it) => s + it.quantity, 0);

  const remainingSkus: RemainingSku[] = validItems.map((item) => ({
    item,
    remaining: item.quantity,
  }));

  // Cache optimal single-SKU odd/even pattern pairs per cargoId
  const patternCache = new Map<string, InterlockingPatternPair | null>();
  const getSingleSkuPair = (item: CargoItem): InterlockingPatternPair | null => {
    if (!patternCache.has(item.id)) {
      patternCache.set(
        item.id,
        selectBestSingleSkuPair(
          pallet.length,
          pallet.width,
          item.length,
          item.width,
          config.gapCm,
          config.minSupportRatio,
          config.enableInterlocking,
          config.interlockStrategy
        )
      );
    }
    return patternCache.get(item.id) ?? null;
  };

  const placedBoxes: PlacedBox[] = [];
  const layers: LayerSummary[] = [];
  let currentZ = 0;
  let currentWeight = 0;
  let layerIndex = 1;
  let idCounter = 1;
  const nextId = () => `box-${idCounter++}`;

  while (true) {
    const activeSkus = remainingSkus.filter((s) => s.remaining > 0);
    if (activeSkus.length === 0) break;

    const parity: 'odd' | 'even' = layerIndex % 2 === 1 ? 'odd' : 'even';

    // Check if we can build a clean, high-efficiency Single-SKU Interlocking Layer!
    // Candidate SKUs sorted by sturdiness (heavy & high maxLoad at bottom)
    const sortedActive = [...activeSkus].sort((a, b) => {
      if (config.prioritizeHeavyBottom) {
        const sturdA = a.item.maxLoad * 1.5 + a.item.weight * 2;
        const sturdB = b.item.maxLoad * 1.5 + b.item.weight * 2;
        if (Math.abs(sturdB - sturdA) > 0.5) return sturdB - sturdA;
      }
      return b.remaining * b.item.length * b.item.width -
        a.remaining * a.item.length * a.item.width;
    });

    let builtLayerBoxes: PlacedBox[] = [];
    let builtLayerHeight = 0;
    let builtPatternName = '';

    // Try Single-SKU optimal interlocking layer if:
    // (a) only 1 active SKU remains, OR
    // (b) top-priority SKU has enough quantity to fill >= 70% of a full layer
    for (const candidateSku of sortedActive) {
      const item = candidateSku.item;
      if (currentZ + item.height > pallet.maxHeight + EPS) continue;
      if (currentWeight + item.weight > pallet.maxWeight + EPS) continue;

      const pair = getSingleSkuPair(item);
      if (!pair) continue;

      const chosenPat = parity === 'odd' ? pair.oddPattern : pair.evenPattern;
      const fullCount = chosenPat.boxes.length;
      if (fullCount === 0) continue;

      const isOnlySku = activeSkus.length === 1;
      const fillsMostOfLayer = candidateSku.remaining >= Math.ceil(fullCount * 0.7);
      if (!isOnlySku && !fillsMostOfLayer) continue;

      // How many boxes can we place on this layer given remaining qty & weight limit?
      const maxByWeight = Math.floor(
        (pallet.maxWeight - currentWeight + EPS) / item.weight
      );
      const targetCount = Math.min(candidateSku.remaining, fullCount, maxByWeight);
      if (targetCount <= 0) continue;

      const chosen2D = selectBalancedSubset(chosenPat.boxes, targetCount, pallet);

      // Validate each box against support ratio and cumulative load-bearing limit
      const validBoxesForLayer: PlacedBox[] = [];
      for (const b2d of chosen2D) {
        const cand: PlacedBox = {
          instanceId: nextId(),
          cargoId: item.id,
          name: item.name,
          x: b2d.x,
          y: b2d.y,
          z: currentZ,
          dx: b2d.dx,
          dy: b2d.dy,
          dz: item.height,
          rotated: b2d.rotated,
          weight: item.weight,
          maxLoad: item.maxLoad,
          color: item.color,
          layerIndex,
          layerParity: parity,
          layerPattern: chosenPat.name,
          sequence: 0,
          supportRatio: 1,
          supportingBoxIds: [],
          isInterlocked: false,
          loadOnTop: 0,
          loadUtilization: 0,
        };

        if (!isWithinPallet(cand, pallet)) continue;
        const sup = evaluateSupport(cand, placedBoxes);
        if (sup.supportRatio + EPS < config.minSupportRatio) continue;

        if (currentZ > Z_CONTACT_TOLERANCE) {
          const safe = checkLoadSafetyWithAddition(placedBoxes, [
            ...validBoxesForLayer,
            cand,
          ]);
          if (!safe) continue;
        }

        validBoxesForLayer.push(cand);
      }

      if (validBoxesForLayer.length > 0) {
        builtLayerBoxes = validBoxesForLayer;
        builtLayerHeight = item.height;
        builtPatternName = chosenPat.name;
        candidateSku.remaining -= validBoxesForLayer.length;
        break;
      }
    }

    // Fallback to Mixed (Heterogeneous) Layer Packer if single-SKU layer didn't apply
    if (builtLayerBoxes.length === 0) {
      const mixed = packMixedLayer(
        currentZ,
        layerIndex,
        parity,
        remainingSkus,
        placedBoxes,
        pallet,
        config,
        currentWeight,
        nextId
      );
      builtLayerBoxes = mixed.layerBoxes;
      builtLayerHeight = mixed.layerHeight;
      builtPatternName = mixed.patternName;
    }

    if (builtLayerBoxes.length === 0) break;

    placedBoxes.push(...builtLayerBoxes);
    const layerWeight = builtLayerBoxes.reduce((s, b) => s + b.weight, 0);
    currentWeight += layerWeight;

    // Recompute loads & support after committing this layer
    propagateLoadsAndSupport(placedBoxes);

    const interlockedInLayer = builtLayerBoxes.filter((b) => b.isInterlocked).length;
    layers.push({
      layerIndex,
      parity,
      zStart: round4(currentZ),
      zHeight: round4(builtLayerHeight),
      patternName: builtPatternName,
      boxCount: builtLayerBoxes.length,
      layerWeight: round4(layerWeight),
      interlockedCount: interlockedInLayer,
      interlockRate:
        layerIndex === 1
          ? 1
          : builtLayerBoxes.length > 0
            ? interlockedInLayer / builtLayerBoxes.length
            : 0,
    });

    currentZ = round4(currentZ + builtLayerHeight);
    layerIndex++;

    if (currentZ >= pallet.maxHeight - EPS) break;
  }

  // Final physics pass & collision-free stacking sequence assignment
  propagateLoadsAndSupport(placedBoxes);
  const sequencedBoxes = assignStackingSequence(placedBoxes);

  // Determine reasons for any unplaced items
  const unplacedItems: UnplacedItem[] = [];
  for (const entry of remainingSkus) {
    if (entry.remaining <= 0) continue;
    const it = entry.item;
    let reason = '受限於空間、底面支撐率或下層貨物耐壓上限';
    if (
      !(
        (it.length <= pallet.length + EPS && it.width <= pallet.width + EPS) ||
        (it.width <= pallet.length + EPS && it.length <= pallet.width + EPS)
      )
    ) {
      reason = '單箱尺寸超出棧板長寬（零超邊限制）';
    } else if (currentZ + it.height > pallet.maxHeight + EPS) {
      reason = '超出棧板最大允許堆疊高度';
    } else if (currentWeight + it.weight > pallet.maxWeight + EPS) {
      reason = '超出棧板最大允許承重上限';
    }

    unplacedItems.push({
      cargoId: it.id,
      name: it.name,
      remaining: entry.remaining,
      reason,
    });
  }

  const metrics = computeMetrics(
    sequencedBoxes,
    layers,
    pallet,
    config,
    totalRequested
  );

  return {
    placedBoxes: sequencedBoxes,
    unplacedItems,
    layers,
    metrics,
  };
}

function buildPalletSignature(result: PackingResult): string {
  const skuCounts = new Map<string, number>();
  for (const b of result.placedBoxes) {
    skuCounts.set(b.cargoId, (skuCounts.get(b.cargoId) ?? 0) + 1);
  }
  const skuPart = Array.from(skuCounts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, cnt]) => `${id}:${cnt}`)
    .join('|');
  const layerPart = result.layers
    .map((l) => `${l.layerIndex}:${l.boxCount}:${l.patternName}`)
    .join(';');
  return `${skuPart}#${layerPart}`;
}

function buildSkuSummary(result: PackingResult): string {
  const counts = new Map<string, number>();
  for (const b of result.placedBoxes) {
    counts.set(b.name, (counts.get(b.name) ?? 0) + 1);
  }
  const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  if (entries.length <= 2) {
    return entries.map(([name, cnt]) => `${name} ×${cnt}`).join('、');
  }
  return `${entries[0][0]} ×${entries[0][1]} 等 ${entries.length} 品項`;
}

/**
 * Multi-Pallet Auto-Splitting Solver.
 * Automatically splits large delivery orders across multiple pallets while preserving
 * odd/even interlocking, load-bearing safety, and CoG balance on every pallet.
 * Uses identical-pallet fast-cloning so 1,900+ boxes solve in milliseconds.
 */
export function solveMultiPalletPacking(
  pallet: PalletSpec,
  items: CargoItem[],
  config: PackingConfig,
  maxPallets = 200
): MultiPalletResult {
  const validItems = items.filter(
    (it) =>
      it.quantity > 0 &&
      it.length > 0 &&
      it.width > 0 &&
      it.height > 0 &&
      it.weight > 0
  );

  const totalBoxesRequested = validItems.reduce((s, it) => s + it.quantity, 0);
  const remainingMap = new Map<string, number>();
  for (const it of validItems) {
    remainingMap.set(it.id, it.quantity);
  }

  const pallets: PackingResult[] = [];
  let skippedLowUtilization: MultiPalletResult['summary']['skippedLowUtilization'];

  while (pallets.length < maxPallets) {
    const activeItems: CargoItem[] = [];
    for (const it of validItems) {
      const rem = remainingMap.get(it.id) ?? 0;
      if (rem > 0) {
        activeItems.push({ ...it, quantity: rem });
      }
    }
    if (activeItems.length === 0) break;

    const single = solvePalletPacking(pallet, activeItems, config);
    if (single.placedBoxes.length === 0) break;

    // Utilization gate: if enabled and BOTH total volume utilization and weight utilization
    // fall below minUtilizationRatio, choose NOT to load/dispatch this pallet.
    if (config.enableMinUtilization) {
      const volUtil = single.metrics.totalVolumeUtilization;
      const wtUtil = single.metrics.weightUtilization;
      const effUtil = Math.max(volUtil, wtUtil);
      if (effUtil + EPS < config.minUtilizationRatio) {
        skippedLowUtilization = {
          candidateBoxes: single.placedBoxes.length,
          effectiveUtilization: effUtil,
          volumeUtilization: volUtil,
          weightUtilization: wtUtil,
          threshold: config.minUtilizationRatio,
        };
        break;
      }
    }

    // Count how many boxes of each SKU were consumed by this pallet
    const usedBySku = new Map<string, number>();
    for (const b of single.placedBoxes) {
      usedBySku.set(b.cargoId, (usedBySku.get(b.cargoId) ?? 0) + 1);
    }

    // Determine how many identical pallets can be stamped out immediately
    let maxRepeats = Infinity;
    for (const [skuId, used] of usedBySku.entries()) {
      const rem = remainingMap.get(skuId) ?? 0;
      maxRepeats = Math.min(maxRepeats, Math.floor(rem / used));
    }
    const repeats = Math.max(
      1,
      Math.min(maxRepeats, maxPallets - pallets.length)
    );

    // Clean per-pallet result (no false "unplaced" warning inside an individual pallet)
    const cleanPalletResult: PackingResult = {
      ...single,
      unplacedItems: [],
      metrics: {
        ...single.metrics,
        totalBoxesRequested: single.placedBoxes.length,
      },
    };

    for (let r = 0; r < repeats; r++) {
      pallets.push(cleanPalletResult);
    }

    // Deduct consumed quantities
    for (const [skuId, used] of usedBySku.entries()) {
      const rem = remainingMap.get(skuId) ?? 0;
      remainingMap.set(skuId, Math.max(0, rem - used * repeats));
    }
  }

  // Group identical pallet layouts into template groups for easy warehouse operation
  const groupMap = new Map<string, PalletTemplateGroup>();
  const groups: PalletTemplateGroup[] = [];

  pallets.forEach((pRes, idx) => {
    const sig = buildPalletSignature(pRes);
    const existing = groupMap.get(sig);
    if (existing) {
      existing.palletNumbers.push(idx + 1);
      existing.count++;
    } else {
      const grp: PalletTemplateGroup = {
        groupIndex: groups.length + 1,
        signature: sig,
        palletNumbers: [idx + 1],
        count: 1,
        representativePalletIndex: idx,
        skuSummary: buildSkuSummary(pRes),
        boxesPerPallet: pRes.placedBoxes.length,
        weightPerPallet: pRes.metrics.totalWeight,
        volumeUtilization: pRes.metrics.compactVolumeUtilization,
        interlockRate: pRes.metrics.interlockRate,
      };
      groupMap.set(sig, grp);
      groups.push(grp);
    }
  });

  // Collect any genuinely unplaceable items or items held back due to low utilization
  const unplacedItems: UnplacedItem[] = [];
  const hitLimit = pallets.length >= maxPallets;
  for (const it of validItems) {
    const rem = remainingMap.get(it.id) ?? 0;
    if (rem <= 0) continue;

    let reason = hitLimit
      ? `已達單次規劃最大棧板上限 (${maxPallets} 板)`
      : skippedLowUtilization
        ? `未達最低利用率門檻（預估綜合利用率 ${(skippedLowUtilization.effectiveUtilization * 100).toFixed(1)}% < ${(skippedLowUtilization.threshold * 100).toFixed(0)}%，已選擇不裝貨）`
        : '單箱尺寸或重量超出空棧板物理限制';

    if (
      !(
        (it.length <= pallet.length + EPS && it.width <= pallet.width + EPS) ||
        (it.width <= pallet.length + EPS && it.length <= pallet.width + EPS)
      )
    ) {
      reason = '單箱尺寸超出棧板長寬（零超邊限制）';
    } else if (it.height > pallet.maxHeight + EPS) {
      reason = '單箱高度超出棧板最大允許堆高';
    } else if (it.weight > pallet.maxWeight + EPS) {
      reason = '單箱重量超出棧板最大承重上限';
    }

    unplacedItems.push({
      cargoId: it.id,
      name: it.name,
      remaining: rem,
      reason,
    });
  }

  const totalPallets = pallets.length;
  const totalBoxesPlaced = pallets.reduce((s, p) => s + p.placedBoxes.length, 0);
  const totalWeight = pallets.reduce((s, p) => s + p.metrics.totalWeight, 0);
  const avgCompactVolumeUtilization =
    totalPallets > 0
      ? pallets.reduce((s, p) => s + p.metrics.compactVolumeUtilization, 0) /
        totalPallets
      : 0;
  const avgInterlockRate =
    totalPallets > 0
      ? pallets.reduce((s, p) => s + p.metrics.interlockRate, 0) / totalPallets
      : 1;
  const avgEaseOfStackingScore =
    totalPallets > 0
      ? Math.round(
          pallets.reduce((s, p) => s + p.metrics.easeOfStackingScore, 0) /
            totalPallets
        )
      : 100;
  const allPalletsSafe = pallets.every(
    (p) => p.metrics.isOverhangFree && p.metrics.isLoadSafe
  );

  return {
    pallets,
    groups,
    unplacedItems,
    summary: {
      totalPallets,
      uniquePatterns: groups.length,
      totalBoxesPlaced,
      totalBoxesRequested,
      totalWeight,
      avgCompactVolumeUtilization,
      avgInterlockRate,
      avgEaseOfStackingScore,
      allPalletsSafe,
      skippedLowUtilization,
    },
  };
}

