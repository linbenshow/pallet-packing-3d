import type { CargoItem, PackingConfig, PalletSpec } from './types';

export const PALLET_PRESETS: PalletSpec[] = [
  {
    id: 'asia-120x100',
    name: '亞洲標準棧板 (120 × 100 cm)',
    length: 120,
    width: 100,
    maxHeight: 150,
    deckHeight: 15,
    maxWeight: 1000,
  },
  {
    id: 'euro-120x80',
    name: '歐規棧板 EUR (120 × 80 cm)',
    length: 120,
    width: 80,
    maxHeight: 145,
    deckHeight: 14.4,
    maxWeight: 1000,
  },
  {
    id: 'jp-110x110',
    name: '日規標準棧板 (110 × 110 cm)',
    length: 110,
    width: 110,
    maxHeight: 150,
    deckHeight: 15,
    maxWeight: 1000,
  },
  {
    id: 'us-121.9x101.6',
    name: '美規 GMA (121.9 × 101.6 cm)',
    length: 121.9,
    width: 101.6,
    maxHeight: 152.4,
    deckHeight: 14,
    maxWeight: 1134,
  },
];

export const DEFAULT_CONFIG: PackingConfig = {
  minSupportRatio: 0.78,
  maxCogOffsetRatio: 0.15,
  enableInterlocking: true,
  interlockStrategy: 'auto',
  gapCm: 0.5,
  prioritizeHeavyBottom: true,
  groupSameSku: true,
};

export interface ScenarioPreset {
  id: string;
  name: string;
  description: string;
  palletId: string;
  items: CargoItem[];
  configOverride?: Partial<PackingConfig>;
}

function estimateMaxLoad(weight: number): number {
  if (weight >= 100) return 400;
  if (weight >= 20) return Math.round(weight * 5);
  if (weight >= 5) return Math.round(weight * 6);
  return 20;
}

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: 'user-dataset-1',
    name: '實測組 1 (18品項混裝)',
    description: '使用者提供的 18 筆實測貨物資料（含 0.005 kg 極輕件至 176 kg 重件與多組小數尺寸）。',
    palletId: 'asia-120x100',
    items: [
      { id: 'u1-01', name: '貨件 #01', length: 50, width: 34, height: 34, weight: 16.8, maxLoad: estimateMaxLoad(16.8), quantity: 1, color: '#3b82f6' },
      { id: 'u1-02', name: '貨件 #02', length: 42, width: 30, height: 8, weight: 6, maxLoad: estimateMaxLoad(6), quantity: 1, color: '#10b981' },
      { id: 'u1-03', name: '貨件 #03', length: 94, width: 25, height: 72, weight: 0.88, maxLoad: estimateMaxLoad(0.88), quantity: 1, color: '#f59e0b' },
      { id: 'u1-04', name: '貨件 #04', length: 31, width: 26, height: 14, weight: 29.8, maxLoad: estimateMaxLoad(29.8), quantity: 1, color: '#ef4444' },
      { id: 'u1-05', name: '貨件 #05', length: 42, width: 30, height: 46, weight: 0.3, maxLoad: estimateMaxLoad(0.3), quantity: 1, color: '#8b5cf6' },
      { id: 'u1-06', name: '貨件 #06', length: 25, width: 10, height: 10, weight: 0.24, maxLoad: estimateMaxLoad(0.24), quantity: 1, color: '#06b6d4' },
      { id: 'u1-07', name: '貨件 #07', length: 25, width: 10, height: 10, weight: 0.24, maxLoad: estimateMaxLoad(0.24), quantity: 1, color: '#ec4899' },
      { id: 'u1-08', name: '貨件 #08', length: 50, width: 8, height: 10, weight: 35.25, maxLoad: estimateMaxLoad(35.25), quantity: 1, color: '#84cc16' },
      { id: 'u1-09', name: '貨件 #09', length: 34, width: 16, height: 23, weight: 0.005, maxLoad: estimateMaxLoad(0.005), quantity: 1, color: '#f97316' },
      { id: 'u1-10', name: '貨件 #10', length: 26.5, width: 26, height: 16.5, weight: 6.538, maxLoad: estimateMaxLoad(6.538), quantity: 1, color: '#6366f1' },
      { id: 'u1-11', name: '貨件 #11', length: 44, width: 31, height: 26, weight: 5.6, maxLoad: estimateMaxLoad(5.6), quantity: 1, color: '#14b8a6' },
      { id: 'u1-12', name: '貨件 #12', length: 18.5, width: 13.5, height: 8.5, weight: 0.271, maxLoad: estimateMaxLoad(0.271), quantity: 1, color: '#eab308' },
      { id: 'u1-13', name: '貨件 #13', length: 25, width: 21, height: 15.5, weight: 5.6, maxLoad: estimateMaxLoad(5.6), quantity: 1, color: '#0ea5e9' },
      { id: 'u1-14', name: '貨件 #14', length: 34.5, width: 21.5, height: 16, weight: 0.611, maxLoad: estimateMaxLoad(0.611), quantity: 1, color: '#a855f7' },
      { id: 'u1-15', name: '貨件 #15', length: 19.5, width: 19.5, height: 18, weight: 0.68, maxLoad: estimateMaxLoad(0.68), quantity: 1, color: '#22c55e' },
      { id: 'u1-16', name: '貨件 #16', length: 25, width: 25, height: 25, weight: 8.5, maxLoad: estimateMaxLoad(8.5), quantity: 1, color: '#f43f5e' },
      { id: 'u1-17', name: '貨件 #17 (超重件)', length: 94, width: 25, height: 72, weight: 176, maxLoad: estimateMaxLoad(176), quantity: 1, color: '#0284c7' },
      { id: 'u1-18', name: '貨件 #18', length: 64, width: 27, height: 37, weight: 12, maxLoad: estimateMaxLoad(12), quantity: 1, color: '#d946ef' },
    ],
    configOverride: {
      enableInterlocking: true,
      prioritizeHeavyBottom: true,
      gapCm: 0.5,
    },
  },
  {
    id: 'user-dataset-2',
    name: '實測組 2 (交貨清單 1920箱)',
    description: '使用者提供的 14 筆大量交貨訂單（總計 1,920 箱），自動拆板規劃並依板型分組檢視。',
    palletId: 'asia-120x100',
    items: [
      { id: 'u2-01', name: '訂單 #01 (50×34×34)', length: 50, width: 34, height: 34, weight: 16.8, maxLoad: estimateMaxLoad(16.8), quantity: 120, color: '#3b82f6' },
      { id: 'u2-02', name: '訂單 #02 (94×25×72)', length: 94, width: 25, height: 72, weight: 0.88, maxLoad: estimateMaxLoad(0.88), quantity: 200, color: '#f59e0b' },
      { id: 'u2-03', name: '訂單 #03 (42×30×46)', length: 42, width: 30, height: 46, weight: 0.3, maxLoad: estimateMaxLoad(0.3), quantity: 50, color: '#8b5cf6' },
      { id: 'u2-04', name: '訂單 #04 (25×10×10)', length: 25, width: 10, height: 10, weight: 0.24, maxLoad: estimateMaxLoad(0.24), quantity: 60, color: '#06b6d4' },
      { id: 'u2-05', name: '訂單 #05 (25×10×10)', length: 25, width: 10, height: 10, weight: 0.24, maxLoad: estimateMaxLoad(0.24), quantity: 60, color: '#ec4899' },
      { id: 'u2-06', name: '訂單 #06 (34×16×23)', length: 34, width: 16, height: 23, weight: 0.005, maxLoad: estimateMaxLoad(0.005), quantity: 720, color: '#f97316' },
      { id: 'u2-07', name: '訂單 #07 (26.5×26×16.5)', length: 26.5, width: 26, height: 16.5, weight: 6.538, maxLoad: estimateMaxLoad(6.538), quantity: 10, color: '#6366f1' },
      { id: 'u2-08', name: '訂單 #08 (44×31×26)', length: 44, width: 31, height: 26, weight: 5.6, maxLoad: estimateMaxLoad(5.6), quantity: 150, color: '#14b8a6' },
      { id: 'u2-09', name: '訂單 #09 (18.5×13.5×8.5)', length: 18.5, width: 13.5, height: 8.5, weight: 0.271, maxLoad: estimateMaxLoad(0.271), quantity: 50, color: '#eab308' },
      { id: 'u2-10', name: '訂單 #10 (25×21×15.5)', length: 25, width: 21, height: 15.5, weight: 5.6, maxLoad: estimateMaxLoad(5.6), quantity: 25, color: '#0ea5e9' },
      { id: 'u2-11', name: '訂單 #11 (34.5×21.5×16)', length: 34.5, width: 21.5, height: 16, weight: 0.611, maxLoad: estimateMaxLoad(0.611), quantity: 25, color: '#a855f7' },
      { id: 'u2-12', name: '訂單 #12 (19.5×19.5×18)', length: 19.5, width: 19.5, height: 18, weight: 0.68, maxLoad: estimateMaxLoad(0.68), quantity: 300, color: '#22c55e' },
      { id: 'u2-13', name: '訂單 #13 (25×25×25)', length: 25, width: 25, height: 25, weight: 8.5, maxLoad: estimateMaxLoad(8.5), quantity: 30, color: '#f43f5e' },
      { id: 'u2-14', name: '訂單 #14 (64×27×37)', length: 64, width: 27, height: 37, weight: 12, maxLoad: estimateMaxLoad(12), quantity: 120, color: '#d946ef' },
    ],
    configOverride: {
      enableInterlocking: true,
      prioritizeHeavyBottom: true,
      gapCm: 0.5,
    },
  },
  {
    id: 'single-sku-interlock',
    name: '單品項奇偶層互鎖',
    description: '同尺寸紙箱（含小數尺寸與 0.5 cm 公差空隙），自動產生奇偶層交錯互鎖排法。',
    palletId: 'asia-120x100',
    items: [
      {
        id: 'sku-a',
        name: '標準物流箱 A',
        length: 38.5,
        width: 28.5,
        height: 24.0,
        weight: 12.5,
        maxLoad: 95,
        quantity: 45,
        color: '#3b82f6',
      },
    ],
    configOverride: {
      enableInterlocking: true,
      gapCm: 0.5,
    },
  },
  {
    id: 'mixed-heavy-light',
    name: '多品項重輕混裝',
    description: '重型五金箱置底、中型紙箱居中互鎖、輕量易碎品置頂，兼顧重心與承重安全。',
    palletId: 'asia-120x100',
    items: [
      {
        id: 'sku-heavy',
        name: '重型零件箱 (高耐壓)',
        length: 48.0,
        width: 38.0,
        height: 26.0,
        weight: 26.5,
        maxLoad: 140,
        quantity: 12,
        color: '#0ea5e9',
      },
      {
        id: 'sku-mid',
        name: '中型標準箱',
        length: 38.0,
        width: 28.0,
        height: 24.0,
        weight: 11.2,
        maxLoad: 65,
        quantity: 18,
        color: '#10b981',
      },
      {
        id: 'sku-light',
        name: '輕量小箱 (中低耐壓)',
        length: 28.0,
        width: 24.0,
        height: 20.0,
        weight: 4.8,
        maxLoad: 25,
        quantity: 16,
        color: '#f59e0b',
      },
      {
        id: 'sku-fragile',
        name: '易碎品箱 (不可重壓)',
        length: 36.0,
        width: 26.0,
        height: 18.5,
        weight: 3.2,
        maxLoad: 8,
        quantity: 8,
        color: '#ef4444',
      },
    ],
    configOverride: {
      enableInterlocking: true,
      prioritizeHeavyBottom: true,
      gapCm: 0.5,
    },
  },
  {
    id: 'pinwheel-euro',
    name: '歐規風車/交錯互鎖',
    description: '在歐規 120×80 cm 棧板上展示高互鎖率交錯堆疊與小數公差控制。',
    palletId: 'euro-120x80',
    items: [
      {
        id: 'sku-eur',
        name: '歐規飲料箱',
        length: 39.0,
        width: 25.5,
        height: 22.5,
        weight: 14.4,
        maxLoad: 110,
        quantity: 44,
        color: '#8b5cf6',
      },
    ],
    configOverride: {
      enableInterlocking: true,
      gapCm: 0.4,
    },
  },
  {
    id: 'load-limit-test',
    name: '單箱耐壓極限測試',
    description: '驗證單箱最大耐壓上限保護機制：當底層箱耐壓達標時自動停止向上疊加。',
    palletId: 'jp-110x110',
    items: [
      {
        id: 'sku-soft',
        name: '薄瓦楞紙箱 (耐壓 35 kg)',
        length: 35.0,
        width: 26.0,
        height: 25.0,
        weight: 14.0,
        maxLoad: 35,
        quantity: 50,
        color: '#ec4899',
      },
    ],
    configOverride: {
      enableInterlocking: true,
      gapCm: 0.5,
    },
  },
];

export const COLOR_PALETTE = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#6366f1',
];
