export interface PalletSpec {
  id: string;
  name: string;
  /** Length along X axis (cm) */
  length: number;
  /** Width along Y axis (cm) */
  width: number;
  /** Maximum cargo stack height above pallet deck (cm) */
  maxHeight: number;
  /** Visual height of the pallet base itself (cm) */
  deckHeight: number;
  /** Maximum total cargo weight allowed on the pallet (kg) */
  maxWeight: number;
}

export interface CargoItem {
  id: string;
  name: string;
  /** Length (cm) */
  length: number;
  /** Width (cm) */
  width: number;
  /** Height (cm) - kept upright (only 90° horizontal rotation allowed) */
  height: number;
  /** Weight per box (kg) */
  weight: number;
  /** Maximum top load this box can safely support (kg) */
  maxLoad: number;
  /** Requested quantity */
  quantity: number;
  /** Display color hex */
  color: string;
}

export type InterlockStrategy = 'auto' | 'mirror-x' | 'mirror-y' | 'rotate-180';

export type ZoneMode = 'auto' | 'full' | 'half' | 'quarter';

export type OptimizationPriority = 'balanced' | 'fill-rate' | 'interlock';

export interface PackingConfig {
  /** Minimum bottom surface area ratio that must be supported (0.5 - 1.0) */
  minSupportRatio: number;
  /** Max allowed horizontal CoG offset relative to half pallet dimension (0.05 - 0.5) */
  maxCogOffsetRatio: number;
  /** Enable odd/even layer interlocking */
  enableInterlocking: boolean;
  /** Strategy for even-layer transformation */
  interlockStrategy: InterlockStrategy;
  /** Clearance gap between adjacent boxes to account for real-world tolerances (cm) */
  gapCm: number;
  /** Prioritize heavier & stronger boxes in lower layers */
  prioritizeHeavyBottom: boolean;
  /** Keep identical SKUs grouped together for easier picking & stacking */
  groupSameSku: boolean;
  /** Skip/reject pallets that fail to meet minUtilizationRatio (choose not to load) */
  enableMinUtilization: boolean;
  /** Minimum effective utilization (max of totalVolumeUtilization, weightUtilization) required to dispatch a pallet (0.1 - 0.95) */
  minUtilizationRatio: number;
  /** Modular layer zone partitioning mode: auto, 1/1 full, 1/2 half, or 1/4 quarter */
  zoneMode: ZoneMode;
  /** Balance between maximizing fill rate vs prioritizing interlocking patterns */
  optimizationPriority: OptimizationPriority;
}

export interface Box2D {
  x: number;
  y: number;
  dx: number;
  dy: number;
  rotated: boolean;
}

export interface PlacedBox {
  instanceId: string;
  cargoId: string;
  name: string;
  /** Bottom-back-left corner X on pallet (cm) */
  x: number;
  /** Bottom-back-left corner Y on pallet (cm) */
  y: number;
  /** Elevation Z above pallet deck (cm) */
  z: number;
  /** Placed dimension along X (cm) */
  dx: number;
  /** Placed dimension along Y (cm) */
  dy: number;
  /** Placed dimension along Z (cm) */
  dz: number;
  rotated: boolean;
  weight: number;
  maxLoad: number;
  color: string;
  /** 1-based layer index */
  layerIndex: number;
  layerParity: 'odd' | 'even';
  layerPattern: string;
  /** Modular zone label (e.g. '1/1 整層', '1/2-A', '1/4-Q1') */
  zoneLabel?: string;
  /** 1-based collision-free stacking order */
  sequence: number;
  /** Fraction of bottom face supported by lower boxes or pallet deck (0..1) */
  supportRatio: number;
  /** Instance IDs of boxes directly supporting this box */
  supportingBoxIds: string[];
  /** True if non-bottom box is supported by >= 2 lower boxes (cross-tied) */
  isInterlocked: boolean;
  /** Computed cumulative weight resting on top of this box (kg) */
  loadOnTop: number;
  /** loadOnTop / maxLoad (0..Infinity) */
  loadUtilization: number;
}

export interface LayerSummary {
  layerIndex: number;
  parity: 'odd' | 'even';
  zStart: number;
  zHeight: number;
  patternName: string;
  boxCount: number;
  layerWeight: number;
  interlockedCount: number;
  interlockRate: number;
}

export interface UnplacedItem {
  cargoId: string;
  name: string;
  remaining: number;
  reason: string;
}

export interface PackingMetrics {
  totalBoxesPlaced: number;
  totalBoxesRequested: number;
  totalWeight: number;
  weightUtilization: number;
  /** Placed cargo volume / (pallet.length * pallet.width * usedHeight) */
  compactVolumeUtilization: number;
  /** Placed cargo volume / (pallet.length * pallet.width * pallet.maxHeight) */
  totalVolumeUtilization: number;
  usedHeight: number;
  cog: { x: number; y: number; z: number };
  cogOffset: {
    /** Signed offset from pallet center X (cm) */
    dx: number;
    /** Signed offset from pallet center Y (cm) */
    dy: number;
    /** Normalized offset |dx| / (pallet.length / 2) */
    normX: number;
    /** Normalized offset |dy| / (pallet.width / 2) */
    normY: number;
    isBalanced: boolean;
  };
  /** Percentage of non-bottom boxes supported by >= 2 lower boxes (0..1) */
  interlockRate: number;
  avgSupportRatio: number;
  minSupportRatioFound: number;
  maxLoadUtilization: number;
  isLoadSafe: boolean;
  isOverhangFree: boolean;
  /** 0..100 composite score for human & robotic stacking operability */
  easeOfStackingScore: number;
}

export interface ZoneRect {
  id: string;
  label: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export interface PackingResult {
  placedBoxes: PlacedBox[];
  unplacedItems: UnplacedItem[];
  layers: LayerSummary[];
  metrics: PackingMetrics;
  /** Modular zone layout used for this pallet (1/1, 1/2, 1/2+1/4, or 1/4) */
  zoneLayoutName?: string;
  zones?: ZoneRect[];
}

export interface PalletTemplateGroup {
  groupIndex: number;
  signature: string;
  palletNumbers: number[]; // 1-based pallet indices sharing this exact layout
  count: number;
  representativePalletIndex: number; // 0-based index into MultiPalletResult.pallets
  skuSummary: string;
  boxesPerPallet: number;
  weightPerPallet: number;
  volumeUtilization: number;
  interlockRate: number;
}

export interface MultiPalletSummary {
  totalPallets: number;
  uniquePatterns: number;
  totalBoxesPlaced: number;
  totalBoxesRequested: number;
  totalWeight: number;
  avgCompactVolumeUtilization: number;
  avgInterlockRate: number;
  avgEaseOfStackingScore: number;
  allPalletsSafe: boolean;
  /** Set when remaining cargo was intentionally not loaded due to falling below minUtilizationRatio */
  skippedLowUtilization?: {
    candidateBoxes: number;
    effectiveUtilization: number;
    volumeUtilization: number;
    weightUtilization: number;
    threshold: number;
  };
}

export interface MultiPalletResult {
  pallets: PackingResult[];
  groups: PalletTemplateGroup[];
  unplacedItems: UnplacedItem[];
  summary: MultiPalletSummary;
}

