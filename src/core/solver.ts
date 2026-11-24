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
  ZoneRect,
} from './types';
import { buildZoneLayouts, type ZoneLayoutSpec } from './zones';

interface RemainingSku {
  item: CargoItem;
  remaining: number;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Sorts boxes within a partial pattern so that if we don't have enough boxes
 * to fill the whole layer, we pick a symmetrical subset centered on the zone
 * to preserve CoG balance.
 */
function selectBalancedSubset(
  patternBoxes: Box2D[],
  count: number,
  zoneW: number,
  zoneD: number
): Box2D[] {
  if (count >= patternBoxes.length) return patternBoxes;
  const cx = zoneW / 2;
  const cy = zoneD / 2;

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
 * Generates candidate (x, y) placement points inside a zone [zone.x, zone.x + zone.dx]
 * x [zone.y, zone.y + zone.dy] at elevation `z`.
 */
function generateZoneCandidatePoints(
  zone: ZoneRect,
  currentLayerBoxes: PlacedBox[],
  lowerLayerBoxes: PlacedBox[],
  dx: number,
  dy: number,
  gap: number,
  reverseX: boolean,
  reverseY: boolean
): { x: number; y: number }[] {
  const minX = zone.x;
  const minY = zone.y;
  const maxX = zone.x + zone.dx;
  const maxY = zone.y + zone.dy;

  const xs = new Set<number>([round4(minX), round4(Math.max(minX, maxX - dx))]);
  const ys = new Set<number>([round4(minY), round4(Math.max(minY, maxY - dy))]);

  // Extreme points from boxes already in the current layer inside this zone
  for (const b of currentLayerBoxes) {
    const right = round4(b.x + b.dx + gap);
    if (right + dx <= maxX + EPS) xs.add(right);
    const left = round4(b.x - gap - dx);
    if (left >= minX - EPS) xs.add(Math.max(minX, left));
    xs.add(round4(b.x));

    const front = round4(b.y + b.dy + gap);
    if (front + dy <= maxY + EPS) ys.add(front);
    const back = round4(b.y - gap - dy);
    if (back >= minY - EPS) ys.add(Math.max(minY, back));
    ys.add(round4(b.y));
  }

  // Lower-layer box edges and midpoints inside this zone for cross-tie interlocking
  for (const lo of lowerLayerBoxes) {
    if (lo.x >= minX - EPS && lo.x + dx <= maxX + EPS) xs.add(round4(lo.x));
    const midX = round4(lo.x + lo.dx / 2);
    if (midX >= minX - EPS && midX + dx <= maxX + EPS) xs.add(midX);
    const alignRight = round4(lo.x + lo.dx - dx);
    if (alignRight >= minX - EPS && alignRight + dx <= maxX + EPS) {
      xs.add(Math.max(minX, alignRight));
    }

    if (lo.y >= minY - EPS && lo.y + dy <= maxY + EPS) ys.add(round4(lo.y));
    const midY = round4(lo.y + lo.dy / 2);
    if (midY >= minY - EPS && midY + dy <= maxY + EPS) ys.add(midY);
    const alignFront = round4(lo.y + lo.dy - dy);
    if (alignFront >= minY - EPS && alignFront + dy <= maxY + EPS) {
      ys.add(Math.max(minY, alignFront));
    }
  }

  const xArr = Array.from(xs).filter((v) => v >= minX - EPS && v + dx <= maxX + EPS);
  const yArr = Array.from(ys).filter((v) => v >= minY - EPS && v + dy <= maxY + EPS);

  xArr.sort((a, b) => (reverseX ? b - a : a - b));
  yArr.sort((a, b) => (reverseY ? b - a : a - b));

  const maxCoords = 22;
  const trimmedX = xArr.slice(0, maxCoords);
  const trimmedY = yArr.slice(0, maxCoords);

  const points: { x: number; y: number }[] = [];
  for (const y of trimmedY) {
    for (const x of trimmedX) {
      points.push({ x: Math.max(minX, x), y: Math.max(minY, y) });
    }
  }
  return points;
}

/**
 * Packs a single mixed (heterogeneous) layer inside `zone` at elevation `z`.
 * Uses corner-hugging tight packing (avoiding center fragmentation) and allows
 * shorter compatible items to fill remaining floor area within the zone.
 */
function packMixedZoneLayer(
  zone: ZoneRect,
  isFullPalletZone: boolean,
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
    (b) =>
      Math.abs(b.z + b.dz - z) <= Z_CONTACT_TOLERANCE &&
      b.x + b.dx > zone.x + EPS &&
      b.x < zone.x + zone.dx - EPS &&
      b.y + b.dy > zone.y + EPS &&
      b.y < zone.y + zone.dy - EPS
  );

  // Filter SKUs that can physically fit inside THIS zone, height, and weight
  const eligible = remainingSkus.filter((s) => {
    if (s.remaining <= 0) return false;
    if (z + s.item.height > pallet.maxHeight + EPS) return false;
    if (currentWeight + s.item.weight > pallet.maxWeight + EPS) return false;
    const fitsNormal =
      s.item.length <= zone.dx + EPS && s.item.width <= zone.dy + EPS;
    const fitsRot =
      s.item.width <= zone.dx + EPS && s.item.length <= zone.dy + EPS;
    return fitsNormal || fitsRot;
  });

  if (eligible.length === 0) {
    return { layerBoxes: [], layerHeight: 0, patternName: '' };
  }

  // Sort eligible SKUs: sturdy & heavy first at bottom, then largest footprint
  const ranked = [...eligible].sort((a, b) => {
    if (config.prioritizeHeavyBottom) {
      const sturdA = a.item.maxLoad * 1.5 + a.item.weight * 2;
      const sturdB = b.item.maxLoad * 1.5 + b.item.weight * 2;
      if (Math.abs(sturdB - sturdA) > 0.5) return sturdB - sturdA;
    }
    const areaA = a.item.length * a.item.width;
    const areaB = b.item.length * b.item.width;
    if (Math.abs(areaB - areaA) > 1) return areaB - areaA;
    return b.item.height - a.item.height;
  });

  // Three-tier pool:
  // Tier 1: exact / close height to anchorHeight (for clean flat top)
  // Tier 2: shorter items that fill leftover floor space without raising layerHeight
  // Tier 3: taller items that still fit under pallet.maxHeight (safe because zone tracks per-box zLevels!)
  const anchorHeight = ranked[0].item.height;
  const heightTolerance = Math.max(2, anchorHeight * 0.15);

  const primaryPool = ranked.filter(
    (s) => Math.abs(s.item.height - anchorHeight) <= heightTolerance
  );
  const secondaryPool = ranked.filter(
    (s) => s.item.height < anchorHeight - heightTolerance
  );
  const tertiaryPool = ranked.filter(
    (s) => s.item.height > anchorHeight + heightTolerance
  );

  primaryPool.sort((a, b) => {
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

  const orderedPool = [...primaryPool, ...secondaryPool, ...tertiaryPool];

  const reverseX = config.enableInterlocking && parity === 'even';
  const reverseY =
    config.enableInterlocking &&
    parity === 'even' &&
    (config.interlockStrategy === 'rotate-180' ||
      config.interlockStrategy === 'mirror-y' ||
      config.interlockStrategy === 'auto');

  const layerBoxes: PlacedBox[] = [];
  let runningWeight = currentWeight;

  const tryPlaceFromPool = (pool: RemainingSku[]) => {
    let progress = true;
    while (progress) {
      progress = false;

      for (const skuEntry of pool) {
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
          if (config.enableInterlocking && parity === 'even' && orientations.length === 2) {
            orientations.reverse();
          }

          let bestPlacement: PlacedBox | null = null;
          let bestScore = -Infinity;

          const currentAll = [...allPlaced, ...layerBoxes];
          const curCog = computeCoG(currentAll, pallet);
          const totalWBefore = currentAll.reduce((s, b) => s + b.weight, 0);

          for (const ori of orientations) {
            if (ori.dx > zone.dx + EPS || ori.dy > zone.dy + EPS) continue;

            const candidates = generateZoneCandidatePoints(
              zone,
              layerBoxes,
              lowerLayerBoxes,
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
                zoneLabel: zone.label,
                sequence: 0,
                supportRatio: 1,
                supportingBoxIds: [],
                isInterlocked: false,
                loadOnTop: 0,
                loadUtilization: 0,
              };

              if (!isWithinPallet(candBox, pallet)) continue;
              if (
                candBox.x + candBox.dx > zone.x + zone.dx + EPS ||
                candBox.y + candBox.dy > zone.y + zone.dy + EPS
              ) {
                continue;
              }

              // Check 3D collision with all already-placed boxes (including current layer)
              // whose vertical span intersects [z, z + candBox.dz]
              let collides = false;
              for (const other of currentAll) {
                if (
                  other.z + other.dz <= z + EPS ||
                  z + candBox.dz <= other.z + EPS
                ) {
                  continue;
                }
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

              // Tight corner-first scoring (prevents fragmenting the floor by dropping boxes in the middle!)
              const relX = (pt.x - zone.x) / Math.max(1, zone.dx);
              const relY = (pt.y - zone.y) / Math.max(1, zone.dy);
              const targetX = reverseX ? 1 - (relX + ori.dx / Math.max(1, zone.dx)) : relX;
              const targetY = reverseY ? 1 - (relY + ori.dy / Math.max(1, zone.dy)) : relY;
              const cornerScore = 38 * (1 - (targetX * 0.45 + targetY * 0.55));

              // Interlocking bonus (weighted by optimizationPriority)
              const interlockMult =
                config.optimizationPriority === 'fill-rate'
                  ? 12
                  : config.optimizationPriority === 'interlock'
                    ? 32
                    : 20;
              const interlockBonus =
                config.enableInterlocking && sup.isInterlocked ? interlockMult : 0;

              // Gentle CoG balance nudge (kept modest so it doesn't fragment 2D packing)
              const newW = totalWBefore + item.weight;
              const newCogX =
                (curCog.x * totalWBefore + (pt.x + ori.dx / 2) * item.weight) / newW;
              const newCogY =
                (curCog.y * totalWBefore + (pt.y + ori.dy / 2) * item.weight) / newW;
              const cogNorm = Math.hypot(
                (newCogX - pallet.length / 2) / Math.max(1, pallet.length / 2),
                (newCogY - pallet.width / 2) / Math.max(1, pallet.width / 2)
              );
              const balanceScore = Math.max(0, 10 * (1 - cogNorm));

              // SKU grouping bonus
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

              const supportBonus = sup.supportRatio * 14;
              const totalScore =
                cornerScore +
                interlockBonus +
                balanceScore +
                groupingBonus +
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

          if (!config.groupSameSku) break;
        }
      }
    }
  };

  tryPlaceFromPool(orderedPool);

  // Center bottom layer ONLY when using full 1/1 zone so multi-zone compartments stay crisp
  if (isFullPalletZone && z <= Z_CONTACT_TOLERANCE && layerBoxes.length > 0) {
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
  const zonePrefix = isFullPalletZone ? '' : `[${zone.label}] `;
  const patternLabel =
    distinctSkus <= 1
      ? `${zonePrefix}單品項 (${parity === 'odd' ? '奇層' : '偶層'})`
      : `${zonePrefix}混裝 · ${distinctSkus}品項 (${parity === 'odd' ? '奇層' : '偶層'})`;

  for (const b of layerBoxes) {
    b.layerPattern = patternLabel;
  }

  const layerHeight =
    layerBoxes.length > 0 ? Math.max(...layerBoxes.map((b) => b.dz)) : 0;

  return { layerBoxes, layerHeight, patternName: patternLabel };
}

/**
 * Packs a single pallet using a specific modular zone layout (1/1, 1/2, 1/2+1/4, or 4×1/4).
 * Each zone independently tracks its elevation Z and odd/even layer parity, while sharing
 * global remaining inventory, pallet maxWeight, and load-bearing safety.
 */
function solvePalletWithZoneLayout(
  pallet: PalletSpec,
  items: CargoItem[],
  config: PackingConfig,
  layout: ZoneLayoutSpec
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

  const isFullPallet = layout.id === 'full';

  // Cache single-SKU pattern pairs keyed by `${zone.id}:${cargoId}`
  const patternCache = new Map<string, InterlockingPatternPair | null>();
  const getZoneSingleSkuPair = (
    zone: ZoneRect,
    item: CargoItem
  ): InterlockingPatternPair | null => {
    const key = `${zone.id}:${item.id}`;
    if (!patternCache.has(key)) {
      patternCache.set(
        key,
        selectBestSingleSkuPair(
          zone.dx,
          zone.dy,
          item.length,
          item.width,
          config.gapCm,
          config.minSupportRatio,
          config.enableInterlocking,
          config.interlockStrategy,
          config.optimizationPriority
        )
      );
    }
    return patternCache.get(key) ?? null;
  };

  interface ZoneState {
    zone: ZoneRect;
    zLevels: number[];
    triedZ: Set<number>;
    layerIndex: number;
    preferredCargoId: string | null;
    done: boolean;
  }

  const zoneStates: ZoneState[] = layout.zones.map((zone) => ({
    zone,
    zLevels: [0],
    triedZ: new Set<number>(),
    layerIndex: 1,
    preferredCargoId: null,
    done: false,
  }));

  const getNextZ = (zs: ZoneState): number | null => {
    zs.zLevels.sort((a, b) => a - b);
    for (const z of zs.zLevels) {
      if (z < pallet.maxHeight - EPS && !zs.triedZ.has(z)) {
        return z;
      }
    }
    return null;
  };

  const addZLevel = (zs: ZoneState, newZ: number) => {
    const rz = round4(newZ);
    if (rz >= pallet.maxHeight - EPS) return;
    if (!zs.zLevels.some((existing) => Math.abs(existing - rz) <= Z_CONTACT_TOLERANCE)) {
      zs.zLevels.push(rz);
    }
  };

  const placedBoxes: PlacedBox[] = [];
  const layers: LayerSummary[] = [];
  let currentWeight = 0;
  let globalLayerCounter = 1;
  let idCounter = 1;
  const nextId = () => `box-${idCounter++}`;

  while (true) {
    const activeSkus = remainingSkus.filter((s) => s.remaining > 0);
    if (activeSkus.length === 0) break;

    // Pick the active zone with the lowest untried Z level (largest zone first on ties)
    const activeZones = zoneStates
      .map((zs) => ({ zs, nextZ: zs.done ? null : getNextZ(zs) }))
      .filter((entry): entry is { zs: ZoneState; nextZ: number } => entry.nextZ !== null);
    if (activeZones.length === 0) break;

    // In multi-zone mode (1/2 or 1/4), fill each zone vertically before moving to the next
    // so each zone forms a clean, height-consistent column without smearing one SKU across all zones.
    activeZones.sort((a, b) => {
      if (!isFullPallet) {
        const aStarted = a.zs.preferredCargoId !== null ? 0 : 1;
        const bStarted = b.zs.preferredCargoId !== null ? 0 : 1;
        if (aStarted !== bStarted) return aStarted - bStarted;
      }
      if (Math.abs(a.nextZ - b.nextZ) > 0.5) return a.nextZ - b.nextZ;
      return b.zs.zone.dx * b.zs.zone.dy - a.zs.zone.dx * a.zs.zone.dy;
    });

    const { zs, nextZ: currentZ } = activeZones[0];
    const { zone } = zs;
    const parity: 'odd' | 'even' = zs.layerIndex % 2 === 1 ? 'odd' : 'even';

    // Candidate SKUs that physically fit in this zone at currentZ
    const zoneFittingSkus = activeSkus.filter((s) => {
      const it = s.item;
      if (currentZ + it.height > pallet.maxHeight + EPS) return false;
      if (currentWeight + it.weight > pallet.maxWeight + EPS) return false;
      return (
        (it.length <= zone.dx + EPS && it.width <= zone.dy + EPS) ||
        (it.width <= zone.dx + EPS && it.length <= zone.dy + EPS)
      );
    });

    if (zoneFittingSkus.length === 0) {
      zs.triedZ.add(currentZ);
      continue;
    }

    const sortedActive = [...zoneFittingSkus].sort((a, b) => {
      // Keep stacking the zone's preferred SKU vertically for maximum height utilization & SKU grouping
      if (zs.preferredCargoId) {
        const aPref = a.item.id === zs.preferredCargoId ? 1 : 0;
        const bPref = b.item.id === zs.preferredCargoId ? 1 : 0;
        if (aPref !== bPref) return bPref - aPref;
      }
      if (config.prioritizeHeavyBottom) {
        const sturdA = a.item.maxLoad * 1.5 + a.item.weight * 2;
        const sturdB = b.item.maxLoad * 1.5 + b.item.weight * 2;
        if (Math.abs(sturdB - sturdA) > 0.5) return sturdB - sturdA;
      }
      return (
        b.remaining * b.item.length * b.item.width -
        a.remaining * a.item.length * a.item.width
      );
    });

    let builtLayerBoxes: PlacedBox[] = [];
    let builtLayerHeight = 0;
    let builtPatternName = '';

    // Try Single-SKU optimal interlocking layer for this zone
    for (const candidateSku of sortedActive) {
      const item = candidateSku.item;
      const pair = getZoneSingleSkuPair(zone, item);
      if (!pair) continue;

      const chosenPat = parity === 'odd' ? pair.oddPattern : pair.evenPattern;
      const fullCount = chosenPat.boxes.length;
      if (fullCount === 0) continue;

      const isOnlySku = activeSkus.length === 1;
      // Require >= 80% of zone layer when other SKUs exist so we don't starve mixed fill rate
      const fillsMostOfZone = candidateSku.remaining >= Math.ceil(fullCount * 0.8);
      if (!isOnlySku && !fillsMostOfZone) continue;

      const maxByWeight = Math.floor(
        (pallet.maxWeight - currentWeight + EPS) / item.weight
      );
      const targetCount = Math.min(candidateSku.remaining, fullCount, maxByWeight);
      if (targetCount <= 0) continue;

      const chosen2D = selectBalancedSubset(
        chosenPat.boxes,
        targetCount,
        zone.dx,
        zone.dy
      );

      const validBoxesForLayer: PlacedBox[] = [];
      for (const b2d of chosen2D) {
        const cand: PlacedBox = {
          instanceId: nextId(),
          cargoId: item.id,
          name: item.name,
          x: round4(zone.x + b2d.x),
          y: round4(zone.y + b2d.y),
          z: currentZ,
          dx: b2d.dx,
          dy: b2d.dy,
          dz: item.height,
          rotated: b2d.rotated,
          weight: item.weight,
          maxLoad: item.maxLoad,
          color: item.color,
          layerIndex: isFullPallet ? zs.layerIndex : globalLayerCounter,
          layerParity: parity,
          layerPattern: isFullPallet
            ? chosenPat.name
            : `[${zone.label}] ${chosenPat.name}`,
          zoneLabel: zone.label,
          sequence: 0,
          supportRatio: 1,
          supportingBoxIds: [],
          isInterlocked: false,
          loadOnTop: 0,
          loadUtilization: 0,
        };

        if (!isWithinPallet(cand, pallet)) continue;

        // Check 3D collision against existing boxes
        let collides3D = false;
        for (const other of placedBoxes) {
          if (other.z + other.dz <= currentZ + EPS || currentZ + cand.dz <= other.z + EPS) {
            continue;
          }
          if (rectsOverlapWithGap(cand, other, config.gapCm)) {
            collides3D = true;
            break;
          }
        }
        if (collides3D) continue;

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
        builtPatternName = isFullPallet
          ? chosenPat.name
          : `[${zone.label}] ${chosenPat.name}`;
        candidateSku.remaining -= validBoxesForLayer.length;
        break;
      }
    }

    // Fallback to Mixed Zone Layer Packer
    if (builtLayerBoxes.length === 0) {
      const mixed = packMixedZoneLayer(
        zone,
        isFullPallet,
        currentZ,
        isFullPallet ? zs.layerIndex : globalLayerCounter,
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

    zs.triedZ.add(currentZ);
    if (builtLayerBoxes.length === 0) {
      continue;
    }

    placedBoxes.push(...builtLayerBoxes);
    if (!zs.preferredCargoId && builtLayerBoxes.length > 0) {
      zs.preferredCargoId = builtLayerBoxes[0].cargoId;
    }
    const layerWeight = builtLayerBoxes.reduce((s, b) => s + b.weight, 0);
    currentWeight += layerWeight;

    propagateLoadsAndSupport(placedBoxes);

    const interlockedInLayer = builtLayerBoxes.filter((b) => b.isInterlocked).length;
    const assignedLayerIdx = isFullPallet ? zs.layerIndex : globalLayerCounter;
    layers.push({
      layerIndex: assignedLayerIdx,
      parity,
      zStart: round4(currentZ),
      zHeight: round4(builtLayerHeight),
      patternName: builtPatternName,
      boxCount: builtLayerBoxes.length,
      layerWeight: round4(layerWeight),
      interlockedCount: interlockedInLayer,
      interlockRate:
        currentZ <= Z_CONTACT_TOLERANCE
          ? 1
          : builtLayerBoxes.length > 0
            ? interlockedInLayer / builtLayerBoxes.length
            : 0,
    });

    // Register every distinct top elevation created by boxes in this layer
    for (const b of builtLayerBoxes) {
      addZLevel(zs, b.z + b.dz);
    }
    zs.layerIndex++;
    globalLayerCounter++;
  }

  propagateLoadsAndSupport(placedBoxes);
  const sequencedBoxes = assignStackingSequence(placedBoxes);

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
    } else if (it.height > pallet.maxHeight + EPS) {
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
    zoneLayoutName: layout.name,
    zones: layout.zones,
  };
}

/**
 * Main 3D Palletizing Solver with Modular Zone Partitioning (1/1, 1/2, 1/4).
 */
export function solvePalletPacking(
  pallet: PalletSpec,
  items: CargoItem[],
  config: PackingConfig
): PackingResult {
  const layouts = buildZoneLayouts(pallet, config.gapCm);
  const activeCount = items.filter((it) => it.quantity > 0).length;

  const scoreResult = (res: PackingResult, layout: ZoneLayoutSpec): number => {
    const effUtil = Math.max(
      res.metrics.totalVolumeUtilization,
      res.metrics.weightUtilization
    );
    const placedRatio =
      res.metrics.totalBoxesRequested > 0
        ? res.metrics.totalBoxesPlaced / res.metrics.totalBoxesRequested
        : 0;
    const interlockWeight =
      config.optimizationPriority === 'fill-rate'
        ? 4
        : config.optimizationPriority === 'interlock'
          ? 16
          : 9;
    return (
      effUtil * 100 +
      placedRatio * 25 +
      res.metrics.interlockRate * interlockWeight +
      (res.metrics.cogOffset.isBalanced ? 3 : 0) -
      layout.complexityPenalty
    );
  };

  if (config.zoneMode === 'full') {
    return solvePalletWithZoneLayout(pallet, items, config, layouts.full);
  }

  if (config.zoneMode === 'half') {
    const cands = [layouts['half-y'], layouts['half-x']];
    let bestRes = solvePalletWithZoneLayout(pallet, items, config, cands[0]);
    let bestScore = scoreResult(bestRes, cands[0]);
    for (let i = 1; i < cands.length; i++) {
      const r = solvePalletWithZoneLayout(pallet, items, config, cands[i]);
      const sc = scoreResult(r, cands[i]);
      if (sc > bestScore) {
        bestScore = sc;
        bestRes = r;
      }
    }
    return bestRes;
  }

  if (config.zoneMode === 'quarter') {
    const qRes = solvePalletWithZoneLayout(pallet, items, config, layouts.quarter);
    // If pure 4x1/4 couldn't place some oversized boxes, also check hybrid 1/2+2x1/4
    if (qRes.unplacedItems.length > 0) {
      const hybRes = solvePalletWithZoneLayout(
        pallet,
        items,
        config,
        layouts['hybrid-y']
      );
      if (
        scoreResult(hybRes, layouts['hybrid-y']) >
        scoreResult(qRes, layouts.quarter)
      ) {
        return hybRes;
      }
    }
    return qRes;
  }

  // zoneMode === 'auto':
  // 1. Evaluate 1/1 Full Layer first
  const fullRes = solvePalletWithZoneLayout(pallet, items, config, layouts.full);
  const fullEffUtil = Math.max(
    fullRes.metrics.totalVolumeUtilization,
    fullRes.metrics.weightUtilization
  );

  // Fast path: single SKU or already >= 92% full or placed 100% of items cleanly
  if (
    activeCount <= 1 ||
    fullEffUtil >= 0.92 ||
    (fullRes.unplacedItems.length === 0 && fullRes.metrics.compactVolumeUtilization >= 0.85)
  ) {
    return fullRes;
  }

  // Otherwise evaluate modular 1/2, 1/2+1/4, and 4×1/4 layouts and pick best
  const candidates: ZoneLayoutSpec[] = [
    layouts['half-y'],
    layouts['half-x'],
    layouts['hybrid-y'],
    layouts.quarter,
  ];

  let bestRes = fullRes;
  let bestScore = scoreResult(fullRes, layouts.full);

  for (const layout of candidates) {
    const res = solvePalletWithZoneLayout(pallet, items, config, layout);
    const sc = scoreResult(res, layout);
    if (sc > bestScore) {
      bestScore = sc;
      bestRes = res;
    }
  }

  return bestRes;
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
  return `${result.zoneLayoutName ?? 'full'}#${skuPart}#${layerPart}`;
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
 * odd/even interlocking, modular zone partitioning, load-bearing safety, and CoG balance.
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

    const usedBySku = new Map<string, number>();
    for (const b of single.placedBoxes) {
      usedBySku.set(b.cargoId, (usedBySku.get(b.cargoId) ?? 0) + 1);
    }

    let maxRepeats = Infinity;
    for (const [skuId, used] of usedBySku.entries()) {
      const rem = remainingMap.get(skuId) ?? 0;
      maxRepeats = Math.min(maxRepeats, Math.floor(rem / used));
    }
    const repeats = Math.max(
      1,
      Math.min(maxRepeats, maxPallets - pallets.length)
    );

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

    for (const [skuId, used] of usedBySku.entries()) {
      const rem = remainingMap.get(skuId) ?? 0;
      remainingMap.set(skuId, Math.max(0, rem - used * repeats));
    }
  }

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
