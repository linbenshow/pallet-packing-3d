import { selectBestSingleSkuPair } from './patterns';
import { COLOR_PALETTE, DEFAULT_CONFIG, PALLET_PRESETS } from './presets';
import type { CargoItem, PackingConfig, PalletSpec } from './types';

export interface BenchmarkInstance {
  id: string;
  name: string;
  category: 'Ground-Truth Exact-Fit' | 'Bischoff-Ratcliff (1995)' | 'Martello-Pisinger-Vigo (2000)' | 'Gzara-Elhedhli MCP (2020)';
  literatureRef: string;
  description: string;
  pallet: PalletSpec;
  config: PackingConfig;
  items: CargoItem[];
  /** Exact known optimal pallet count (for Exact-Fit) or tight discrete capacity lower bound */
  referencePallets: number;
  /** Continuous volume/weight theoretical lower bound */
  theoreticalLB: number;
  totalBoxes: number;
}

/** Deterministic PRNG (Mulberry32) so every benchmark is 100% reproducible */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rng: () => number, min: number, max: number, step = 0.5): number {
  const steps = Math.max(1, Math.floor((max - min) / step));
  return Math.round((min + Math.floor(rng() * (steps + 1)) * step) * 10) / 10;
}

/**
 * Computes the continuous volume/weight lower bound and the tight discrete
 * single-SKU pallet capacity lower bound: sum_i (qty_i / maxBoxesPerPallet_i).
 */
export function computeReferenceBounds(
  pallet: PalletSpec,
  items: CargoItem[],
  config: PackingConfig
): { theoreticalLB: number; discreteCapLB: number } {
  const palletVol = pallet.length * pallet.width * pallet.maxHeight;
  let totalVol = 0;
  let totalWeight = 0;
  let discreteFrac = 0;

  for (const it of items) {
    if (it.quantity <= 0) continue;
    totalVol += it.length * it.width * it.height * it.quantity;
    totalWeight += it.weight * it.quantity;

    // Max boxes of this SKU on 1 pallet under gapCm, maxHeight, maxWeight, and maxLoad
    const pair = selectBestSingleSkuPair(
      pallet.length,
      pallet.width,
      it.length,
      it.width,
      config.gapCm,
      config.minSupportRatio,
      false,
      'auto',
      'fill-rate'
    );
    const perLayer = pair ? pair.oddPattern.boxes.length : 1;
    const maxLayersByHeight = Math.max(1, Math.floor((pallet.maxHeight + 1e-4) / it.height));
    const maxLayersByLoad =
      it.weight > 0 ? Math.max(1, Math.floor(it.maxLoad / it.weight) + 1) : maxLayersByHeight;
    const maxLayers = Math.min(maxLayersByHeight, maxLayersByLoad);
    const maxByGeo = Math.max(1, perLayer * maxLayers);
    const maxByWeight = Math.max(1, Math.floor((pallet.maxWeight + 1e-4) / it.weight));
    const cap = Math.min(maxByGeo, maxByWeight);
    discreteFrac += it.quantity / cap;
  }

  const volLB = Math.ceil(totalVol / palletVol);
  const wtLB = Math.ceil(totalWeight / pallet.maxWeight);
  const theoreticalLB = Math.max(1, volLB, wtLB);
  const discreteCapLB = Math.max(theoreticalLB, Math.ceil(discreteFrac - 1e-6));

  return { theoreticalLB, discreteCapLB };
}

/**
 * Helper to compute exact box dimension so `n` boxes fit with `gap` in span `S`.
 */
function exactDim(span: number, count: number, gap: number): number {
  return Math.floor(((span - (count - 1) * gap) / count) * 10) / 10;
}

/**
 * Builds an Exact-Fit Ground-Truth benchmark where `refPallets` full pallets are
 * constructed from modular 1/1, 1/2, or 1/4 layers with known exact optimal pallet count.
 */
function buildGroundTruthExactFit(params: {
  id: string;
  name: string;
  description: string;
  pallet: PalletSpec;
  gapCm: number;
  refPallets: number;
  skuSpecs: {
    name: string;
    nx: number;
    ny: number;
    nz: number;
    weight: number;
    maxLoad: number;
    palletsCount: number;
    zoneFraction?: 'full' | 'half-x' | 'half-y' | 'quarter';
  }[];
}): BenchmarkInstance {
  const { id, name, description, pallet, gapCm, refPallets, skuSpecs } = params;
  const config: PackingConfig = {
    ...DEFAULT_CONFIG,
    gapCm,
    enableInterlocking: true,
    zoneMode: 'auto',
    optimizationPriority: 'balanced',
  };

  const items: CargoItem[] = skuSpecs.map((spec, idx) => {
    const zf = spec.zoneFraction ?? 'full';
    const spanX =
      zf === 'half-x' || zf === 'quarter' ? (pallet.length - gapCm) / 2 : pallet.length;
    const spanY =
      zf === 'half-y' || zf === 'quarter' ? (pallet.width - gapCm) / 2 : pallet.width;
    const length = exactDim(spanX, spec.nx, gapCm);
    const width = exactDim(spanY, spec.ny, gapCm);
    const height = Math.floor((pallet.maxHeight / spec.nz) * 10) / 10;
    const boxesPerZonePallet = spec.nx * spec.ny * spec.nz;
    const quantity = Math.round(boxesPerZonePallet * spec.palletsCount);

    return {
      id: `${id}-sku-${idx + 1}`,
      name: spec.name,
      length,
      width,
      height,
      weight: spec.weight,
      maxLoad: spec.maxLoad,
      quantity,
      color: COLOR_PALETTE[idx % COLOR_PALETTE.length],
    };
  });

  const bounds = computeReferenceBounds(pallet, items, config);
  const totalBoxes = items.reduce((s, it) => s + it.quantity, 0);

  return {
    id,
    name,
    category: 'Ground-Truth Exact-Fit',
    literatureRef: 'Zero-Waste Guillotine / Modular Pallet Ground-Truth (Gzara & Elhedhli, 2020)',
    description,
    pallet,
    config,
    items,
    referencePallets: refPallets,
    theoreticalLB: bounds.theoreticalLB,
    totalBoxes,
  };
}

/**
 * Generates a Bischoff-Ratcliff (1995) style multi-pallet order with configurable SKU heterogeneity.
 */
function buildBischoffRatcliffOrder(params: {
  id: string;
  name: string;
  description: string;
  seed: number;
  pallet: PalletSpec;
  skuCount: number;
  targetBoxes: number;
  gapCm: number;
}): BenchmarkInstance {
  const { id, name, description, seed, pallet, skuCount, targetBoxes, gapCm } = params;
  const rng = createRng(seed);
  const config: PackingConfig = {
    ...DEFAULT_CONFIG,
    gapCm,
    enableInterlocking: true,
    zoneMode: 'auto',
    optimizationPriority: 'balanced',
  };

  // Standard industrial height tiers (common in palletized supply chains)
  const heightTiers = [15, 20, 25, 30, 37.5, 50];
  const rawWeights: number[] = [];
  let sumWeight = 0;
  for (let i = 0; i < skuCount; i++) {
    const w = 0.4 + rng() * 1.6;
    rawWeights.push(w);
    sumWeight += w;
  }

  const items: CargoItem[] = [];
  let assignedBoxes = 0;

  for (let i = 0; i < skuCount; i++) {
    const nx = 2 + Math.floor(rng() * 4); // 2..5 along X
    const ny = 2 + Math.floor(rng() * 4); // 2..5 along Y
    // Slight perturbation from exact grid divisors to simulate real-world cartons
    const baseL = exactDim(pallet.length, nx, gapCm);
    const baseW = exactDim(pallet.width, ny, gapCm);
    const length = Math.max(15, Math.round((baseL - rng() * 1.5) * 10) / 10);
    const width = Math.max(15, Math.round((baseW - rng() * 1.5) * 10) / 10);
    const height = heightTiers[Math.floor(rng() * heightTiers.length)];

    const volLiters = (length * width * height) / 1000;
    const density = 0.12 + rng() * 0.25; // kg per liter (realistic corrugated cartons)
    const weight = Math.round(Math.max(1.5, Math.min(28, volLiters * density)) * 10) / 10;
    const maxLoad = Math.round(weight * (6 + rng() * 4));

    const qty =
      i === skuCount - 1
        ? Math.max(10, targetBoxes - assignedBoxes)
        : Math.max(10, Math.round((rawWeights[i] / sumWeight) * targetBoxes));
    assignedBoxes += qty;

    items.push({
      id: `${id}-sku-${i + 1}`,
      name: `BR-${String(i + 1).padStart(2, '0')} (${length}×${width}×${height})`,
      length,
      width,
      height,
      weight,
      maxLoad,
      quantity: qty,
      color: COLOR_PALETTE[i % COLOR_PALETTE.length],
    });
  }

  const bounds = computeReferenceBounds(pallet, items, config);
  const totalBoxes = items.reduce((s, it) => s + it.quantity, 0);

  return {
    id,
    name,
    category: 'Bischoff-Ratcliff (1995)',
    literatureRef: 'Bischoff & Ratcliff (1995) / Davies & Bischoff (1999) OR-Library BR1–BR15',
    description,
    pallet,
    config,
    items,
    referencePallets: bounds.discreteCapLB,
    theoreticalLB: bounds.theoreticalLB,
    totalBoxes,
  };
}

/**
 * Generates a Martello-Pisinger-Vigo (2000) style multi-pallet order for Classes II & III.
 */
function buildMPVOrder(params: {
  id: string;
  name: string;
  description: string;
  seed: number;
  pallet: PalletSpec;
  dimMin: number;
  dimMax: number;
  skuCount: number;
  targetBoxes: number;
  gapCm: number;
}): BenchmarkInstance {
  const { id, name, description, seed, pallet, dimMin, dimMax, skuCount, targetBoxes, gapCm } =
    params;
  const rng = createRng(seed);
  const config: PackingConfig = {
    ...DEFAULT_CONFIG,
    gapCm,
    enableInterlocking: true,
    zoneMode: 'auto',
    optimizationPriority: 'balanced',
  };

  const items: CargoItem[] = [];
  const baseQty = Math.floor(targetBoxes / skuCount);

  for (let i = 0; i < skuCount; i++) {
    const length = randRange(rng, dimMin, dimMax, 1);
    const width = randRange(rng, dimMin, Math.min(length, dimMax), 1);
    const height = randRange(rng, Math.max(15, dimMin), Math.min(38, dimMax), 2.5);
    const volLiters = (length * width * height) / 1000;
    const weight = Math.round(Math.max(1.2, Math.min(22, volLiters * (0.15 + rng() * 0.2))) * 10) / 10;
    const maxLoad = Math.round(weight * 8);
    const qty = i === skuCount - 1 ? targetBoxes - baseQty * (skuCount - 1) : baseQty;

    items.push({
      id: `${id}-sku-${i + 1}`,
      name: `MPV-${String(i + 1).padStart(2, '0')} (${length}×${width}×${height})`,
      length,
      width,
      height,
      weight,
      maxLoad,
      quantity: qty,
      color: COLOR_PALETTE[i % COLOR_PALETTE.length],
    });
  }

  const bounds = computeReferenceBounds(pallet, items, config);
  const totalBoxes = items.reduce((s, it) => s + it.quantity, 0);

  return {
    id,
    name,
    category: 'Martello-Pisinger-Vigo (2000)',
    literatureRef: 'Martello, Pisinger & Vigo (2000) Operations Research 48(2):256-267',
    description,
    pallet,
    config,
    items,
    referencePallets: bounds.discreteCapLB,
    theoreticalLB: bounds.theoreticalLB,
    totalBoxes,
  };
}

/**
 * Generates the complete 10-instance Literature-Grounded Large-Order Benchmark Suite.
 */
export function generateBenchmarkSuite(): BenchmarkInstance[] {
  const asiaPallet = PALLET_PRESETS[0]; // 120 x 100 x 150 cm, 1000 kg
  const euroPallet = PALLET_PRESETS[1]; // 120 x 80 x 145 cm, 1000 kg
  const gap = 0.5;

  return [
    // 1. GT-1: Weakly Heterogeneous Exact-Fit (10 reference pallets)
    buildGroundTruthExactFit({
      id: 'gt-1-full-layer',
      name: 'GT-1 整層精確基準 (10板)',
      description: '4 種標準物流箱，精確滿載 10 塊亞洲標準棧板（已知最佳解 P*=10）。',
      pallet: asiaPallet,
      gapCm: gap,
      refPallets: 10,
      skuSpecs: [
        { name: '重型飲料箱 A', nx: 3, ny: 3, nz: 5, weight: 16.0, maxLoad: 120, palletsCount: 3 },
        { name: '標準紙箱 B', nx: 4, ny: 3, nz: 6, weight: 10.5, maxLoad: 90, palletsCount: 3 },
        { name: '中型物流箱 C', nx: 3, ny: 4, nz: 5, weight: 12.0, maxLoad: 95, palletsCount: 2 },
        { name: '輕量日用品 D', nx: 4, ny: 4, nz: 6, weight: 6.5, maxLoad: 65, palletsCount: 2 },
      ],
    }),

    // 2. GT-2: 1/2 Half-Layer Modular Exact-Fit (12 reference pallets)
    buildGroundTruthExactFit({
      id: 'gt-2-half-zone',
      name: 'GT-2 1/2半層模組基準 (12板)',
      description: '6 種品項由 1/1 整層與 1/2 半層組合而成，精確滿載 12 板（已知最佳解 P*=12）。',
      pallet: asiaPallet,
      gapCm: gap,
      refPallets: 12,
      skuSpecs: [
        { name: '大宗整層箱 A', nx: 3, ny: 3, nz: 5, weight: 15.0, maxLoad: 110, palletsCount: 4, zoneFraction: 'full' },
        { name: '半板高箱 B1', nx: 2, ny: 3, nz: 3, weight: 18.0, maxLoad: 100, palletsCount: 4, zoneFraction: 'half-x' },
        { name: '半板中箱 B2', nx: 2, ny: 4, nz: 5, weight: 8.5, maxLoad: 70, palletsCount: 4, zoneFraction: 'half-x' },
        { name: '半板前區 C1', nx: 3, ny: 2, nz: 5, weight: 11.0, maxLoad: 85, palletsCount: 4, zoneFraction: 'half-y' },
        { name: '半板後區 C2', nx: 4, ny: 2, nz: 6, weight: 7.2, maxLoad: 65, palletsCount: 4, zoneFraction: 'half-y' },
      ],
    }),

    // 3. GT-3: 1/4 Quarter-Zone Modular Exact-Fit (15 reference pallets)
    buildGroundTruthExactFit({
      id: 'gt-3-quarter-zone',
      name: 'GT-3 1/4四分區模組基準 (15板)',
      description: '含 1/1、1/2 與 1/4 四分區組合之 15 板大訂單（已知最佳解 P*=15）。',
      pallet: asiaPallet,
      gapCm: gap,
      refPallets: 15,
      skuSpecs: [
        { name: '整層重箱 A', nx: 3, ny: 3, nz: 5, weight: 16.5, maxLoad: 120, palletsCount: 5, zoneFraction: 'full' },
        { name: '整層中箱 B', nx: 4, ny: 3, nz: 5, weight: 11.0, maxLoad: 95, palletsCount: 4, zoneFraction: 'full' },
        { name: '四分區箱 Q1', nx: 2, ny: 2, nz: 5, weight: 10.0, maxLoad: 80, palletsCount: 6, zoneFraction: 'quarter' },
        { name: '四分區箱 Q2', nx: 2, ny: 2, nz: 6, weight: 8.0, maxLoad: 75, palletsCount: 6, zoneFraction: 'quarter' },
        { name: '四分區箱 Q3', nx: 3, ny: 2, nz: 5, weight: 6.5, maxLoad: 60, palletsCount: 6, zoneFraction: 'quarter' },
        { name: '四分區箱 Q4', nx: 2, ny: 3, nz: 6, weight: 5.5, maxLoad: 55, palletsCount: 6, zoneFraction: 'quarter' },
      ],
    }),

    // 4. GT-4: Euro Pallet 120x80 Large Order Exact-Fit (20 reference pallets)
    buildGroundTruthExactFit({
      id: 'gt-4-euro-large',
      name: 'GT-4 歐規大型訂單基準 (20板)',
      description: '歐規 120×80 cm 棧板 20 板大型出貨單，超過 1,200 箱（已知最佳解 P*=20）。',
      pallet: euroPallet,
      gapCm: gap,
      refPallets: 20,
      skuSpecs: [
        { name: '歐規重箱 E1', nx: 3, ny: 2, nz: 5, weight: 22.0, maxLoad: 150, palletsCount: 6, zoneFraction: 'full' },
        { name: '歐規標準 E2', nx: 3, ny: 3, nz: 5, weight: 14.0, maxLoad: 110, palletsCount: 5, zoneFraction: 'full' },
        { name: '歐規中箱 E3', nx: 4, ny: 3, nz: 5, weight: 10.0, maxLoad: 85, palletsCount: 5, zoneFraction: 'full' },
        { name: '歐規輕箱 E4', nx: 4, ny: 4, nz: 6, weight: 6.0, maxLoad: 60, palletsCount: 4, zoneFraction: 'full' },
      ],
    }),

    // 5. BR-Low: Bischoff & Ratcliff Weakly Heterogeneous (5 SKUs, 1,200 boxes)
    buildBischoffRatcliffOrder({
      id: 'br-low-hetero',
      name: 'BR-Low 弱異質大訂單 (5品項/1200箱)',
      description: '依據 Bischoff & Ratcliff (1995) BR1–BR3 弱異質分佈生成 1,200 箱大訂單。',
      seed: 199501,
      pallet: asiaPallet,
      skuCount: 5,
      targetBoxes: 1200,
      gapCm: gap,
    }),

    // 6. BR-Mid: Bischoff & Ratcliff Moderately Heterogeneous (12 SKUs, 1,500 boxes)
    buildBischoffRatcliffOrder({
      id: 'br-mid-hetero',
      name: 'BR-Mid 中異質大訂單 (12品項/1500箱)',
      description: '依據 Bischoff & Ratcliff (1995) BR4–BR7 中度異質分佈生成 1,500 箱大訂單。',
      seed: 199505,
      pallet: asiaPallet,
      skuCount: 12,
      targetBoxes: 1500,
      gapCm: gap,
    }),

    // 7. BR-High: Bischoff & Ratcliff Strongly Heterogeneous (25 SKUs, 1,000 boxes)
    buildBischoffRatcliffOrder({
      id: 'br-high-hetero',
      name: 'BR-High 強異質大訂單 (25品項/1000箱)',
      description: '依據 Davies & Bischoff (1999) BR8–BR12 強異質分佈生成 25 品項 1,000 箱大訂單。',
      seed: 199912,
      pallet: asiaPallet,
      skuCount: 25,
      targetBoxes: 1000,
      gapCm: gap,
    }),

    // 8. MPV-Class2: Martello-Pisinger-Vigo Class II (10 SKUs, 1,400 boxes)
    buildMPVOrder({
      id: 'mpv-class2',
      name: 'MPV-C2 中型隨機尺寸 (10品項/1400箱)',
      description: '依據 Martello, Pisinger & Vigo (2000) Class II 比例生成 1,400 箱訂單。',
      seed: 200002,
      pallet: asiaPallet,
      dimMin: 22,
      dimMax: 48,
      skuCount: 10,
      targetBoxes: 1400,
      gapCm: gap,
    }),

    // 9. MPV-Class3: Martello-Pisinger-Vigo Class III (8 SKUs, 2,000 boxes)
    buildMPVOrder({
      id: 'mpv-class3',
      name: 'MPV-C3 高密度小箱 (8品項/2000箱)',
      description: '依據 Martello, Pisinger & Vigo (2000) Class III 比例生成 2,000 箱大訂單。',
      seed: 200003,
      pallet: asiaPallet,
      dimMin: 18,
      dimMax: 34,
      skuCount: 8,
      targetBoxes: 2000,
      gapCm: gap,
    }),

    // 10. MCP-Retail: Gzara & Elhedhli (2020) Mixed-Case Grocery/Retail Order (12 SKUs, 1,600 boxes)
    buildBischoffRatcliffOrder({
      id: 'mcp-retail-large',
      name: 'MCP-Retail 零售混裝大單 (15品項/1600箱)',
      description: '參考 Gzara & Elhedhli (2020) 零售業 Mixed-Case Palletization 大型混裝出貨單。',
      seed: 202015,
      pallet: asiaPallet,
      skuCount: 15,
      targetBoxes: 1600,
      gapCm: gap,
    }),
  ];
}
