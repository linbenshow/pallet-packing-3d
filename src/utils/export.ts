import type {
  MultiPalletResult,
  PackingConfig,
  PalletSpec,
} from '../core/types';

export function exportMultiPalletToJSON(
  pallet: PalletSpec,
  config: PackingConfig,
  multiResult: MultiPalletResult
): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    units: { length: 'cm', weight: 'kg' },
    pallet,
    config,
    summary: multiResult.summary,
    templateGroups: multiResult.groups,
    unplacedItems: multiResult.unplacedItems,
    pallets: multiResult.pallets.map((p, idx) => ({
      palletNumber: idx + 1,
      metrics: p.metrics,
      layers: p.layers,
      placements: p.placedBoxes,
    })),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  triggerDownload(
    blob,
    `pallet-plan-${multiResult.summary.totalPallets}pallets-${pallet.length}x${pallet.width}cm.json`
  );
}

export function exportMultiPalletToCSV(
  pallet: PalletSpec,
  multiResult: MultiPalletResult
): void {
  const headers = [
    '棧板編號',
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

  const rows: (string | number)[][] = [];
  multiResult.pallets.forEach((p, idx) => {
    const palletNo = idx + 1;
    for (const b of p.placedBoxes) {
      rows.push([
        palletNo,
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
        b.weight.toFixed(3),
        b.maxLoad.toFixed(2),
        b.loadOnTop.toFixed(2),
        (b.supportRatio * 100).toFixed(1),
        b.isInterlocked ? '是' : '否',
      ]);
    }
  });

  // UTF-8 BOM for proper Chinese rendering in Excel
  const csv =
    '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  triggerDownload(
    blob,
    `pallet-manifest-${multiResult.summary.totalPallets}pallets-${pallet.length}x${pallet.width}cm.csv`
  );
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
