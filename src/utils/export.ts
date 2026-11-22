import type { PackingConfig, PackingResult, PalletSpec } from '../core/types';

export function exportResultToJSON(
  pallet: PalletSpec,
  config: PackingConfig,
  result: PackingResult
): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    units: { length: 'cm', weight: 'kg' },
    pallet,
    config,
    metrics: result.metrics,
    layers: result.layers,
    unplacedItems: result.unplacedItems,
    placements: result.placedBoxes,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  triggerDownload(blob, `pallet-plan-${pallet.length}x${pallet.width}cm.json`);
}

export function exportResultToCSV(
  pallet: PalletSpec,
  result: PackingResult
): void {
  const headers = [
    '放置順序',
    '層數',
    '奇偶層',
    '層排法',
    '貨物名稱',
    'X_cm',
    'Y_cm',
    'Z_cm',
    '長_dx_cm',
    '寬_dy_cm',
    '高_dz_cm',
    '水平旋轉90度',
    '重量_kg',
    '耐壓上限_kg',
    '上方負重_kg',
    '底面支撐率_%',
    '是否互鎖',
  ];

  const rows = result.placedBoxes.map((b) => [
    b.sequence,
    b.layerIndex,
    b.layerParity === 'odd' ? '奇數層' : '偶數層',
    `"${b.layerPattern}"`,
    `"${b.name}"`,
    b.x.toFixed(2),
    b.y.toFixed(2),
    b.z.toFixed(2),
    b.dx.toFixed(2),
    b.dy.toFixed(2),
    b.dz.toFixed(2),
    b.rotated ? '是' : '否',
    b.weight.toFixed(2),
    b.maxLoad.toFixed(2),
    b.loadOnTop.toFixed(2),
    (b.supportRatio * 100).toFixed(1),
    b.isInterlocked ? '是' : '否',
  ]);

  // UTF-8 BOM for proper Chinese rendering in Excel
  const csv = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, `pallet-sequence-${pallet.length}x${pallet.width}cm.csv`);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
