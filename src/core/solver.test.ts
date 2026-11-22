import { describe, expect, it } from 'vitest';
import { EPS, rectsOverlapWithGap } from './physics';
import { DEFAULT_CONFIG, PALLET_PRESETS, SCENARIO_PRESETS } from './presets';
import { solveMultiPalletPacking, solvePalletPacking } from './solver';

describe('3D Palletizing Solver', () => {
  it('achieves strong odd/even layer interlocking for single-SKU scenario with decimal cm & gap', () => {
    const scenario = SCENARIO_PRESETS.find((s) => s.id === 'single-sku-interlock')!;
    const pallet = PALLET_PRESETS.find((p) => p.id === scenario.palletId)!;
    const config = { ...DEFAULT_CONFIG, ...scenario.configOverride };

    const result = solvePalletPacking(pallet, scenario.items, config);

    expect(result.placedBoxes.length).toBeGreaterThan(20);
    expect(result.layers.length).toBeGreaterThanOrEqual(3);
    expect(result.metrics.isOverhangFree).toBe(true);
    expect(result.metrics.isLoadSafe).toBe(true);
    expect(result.metrics.minSupportRatioFound).toBeGreaterThanOrEqual(
      config.minSupportRatio - EPS
    );
    expect(result.metrics.interlockRate).toBeGreaterThan(0.5);
    expect(result.metrics.cogOffset.isBalanced).toBe(true);

    // Verify clearance gap between all boxes on the same layer
    for (const layer of result.layers) {
      const lBoxes = result.placedBoxes.filter(
        (b) => b.layerIndex === layer.layerIndex
      );
      for (let i = 0; i < lBoxes.length; i++) {
        for (let j = i + 1; j < lBoxes.length; j++) {
          expect(rectsOverlapWithGap(lBoxes[i], lBoxes[j], config.gapCm)).toBe(false);
        }
      }
    }
  });

  it('produces column stacking (0% interlock) when interlocking is disabled', () => {
    const scenario = SCENARIO_PRESETS.find((s) => s.id === 'single-sku-interlock')!;
    const pallet = PALLET_PRESETS.find((p) => p.id === scenario.palletId)!;
    const config = { ...DEFAULT_CONFIG, enableInterlocking: false, gapCm: 0.5 };

    const result = solvePalletPacking(pallet, scenario.items, config);
    expect(result.metrics.interlockRate).toBe(0);
    expect(result.metrics.isOverhangFree).toBe(true);
  });

  it('places heavy sturdy boxes below light fragile boxes in multi-SKU mixed scenario', () => {
    const scenario = SCENARIO_PRESETS.find((s) => s.id === 'mixed-heavy-light')!;
    const pallet = PALLET_PRESETS.find((p) => p.id === scenario.palletId)!;
    const config = { ...DEFAULT_CONFIG, ...scenario.configOverride };

    const result = solvePalletPacking(pallet, scenario.items, config);

    expect(result.placedBoxes.length).toBeGreaterThan(25);
    expect(result.metrics.isOverhangFree).toBe(true);
    expect(result.metrics.isLoadSafe).toBe(true);
    expect(result.metrics.minSupportRatioFound).toBeGreaterThanOrEqual(
      config.minSupportRatio - EPS
    );

    const heavyAvgZ =
      result.placedBoxes
        .filter((b) => b.cargoId === 'sku-heavy')
        .reduce((s, b) => s + b.z, 0) /
      Math.max(1, result.placedBoxes.filter((b) => b.cargoId === 'sku-heavy').length);

    const fragileBoxes = result.placedBoxes.filter(
      (b) => b.cargoId === 'sku-fragile'
    );
    if (fragileBoxes.length > 0) {
      const fragileAvgZ =
        fragileBoxes.reduce((s, b) => s + b.z, 0) / fragileBoxes.length;
      expect(heavyAvgZ).toBeLessThan(fragileAvgZ);
    }
  });

  it('strictly enforces individual box maxLoad limit', () => {
    const scenario = SCENARIO_PRESETS.find((s) => s.id === 'load-limit-test')!;
    const pallet = PALLET_PRESETS.find((p) => p.id === scenario.palletId)!;
    const config = { ...DEFAULT_CONFIG, ...scenario.configOverride };

    const result = solvePalletPacking(pallet, scenario.items, config);

    expect(result.metrics.isLoadSafe).toBe(true);
    for (const box of result.placedBoxes) {
      expect(box.loadOnTop).toBeLessThanOrEqual(box.maxLoad + EPS);
    }
    // With 14kg per box and 35kg maxLoad, the solver cannot stack all 50 boxes safely
    expect(result.placedBoxes.length).toBeLessThan(50);
    expect(result.unplacedItems.length).toBeGreaterThan(0);
  });

  it('assigns monotonic collision-free stacking sequence from 1..N', () => {
    const scenario = SCENARIO_PRESETS.find((s) => s.id === 'pinwheel-euro')!;
    const pallet = PALLET_PRESETS.find((p) => p.id === scenario.palletId)!;
    const config = { ...DEFAULT_CONFIG, ...scenario.configOverride };

    const result = solvePalletPacking(pallet, scenario.items, config);

    expect(result.placedBoxes.length).toBeGreaterThan(0);
    result.placedBoxes.forEach((b, idx) => {
      expect(b.sequence).toBe(idx + 1);
      if (idx > 0) {
        expect(b.layerIndex).toBeGreaterThanOrEqual(
          result.placedBoxes[idx - 1].layerIndex
        );
      }
    });
  });

  it('handles user-dataset-1 (18 mixed real-world items) safely and quickly', () => {
    const scenario = SCENARIO_PRESETS.find((s) => s.id === 'user-dataset-1')!;
    const pallet = PALLET_PRESETS.find((p) => p.id === scenario.palletId)!;
    const config = { ...DEFAULT_CONFIG, ...scenario.configOverride };

    const result = solvePalletPacking(pallet, scenario.items, config);
    expect(result.placedBoxes.length).toBeGreaterThan(0);
    expect(result.metrics.isOverhangFree).toBe(true);
    expect(result.metrics.isLoadSafe).toBe(true);
  });

  it('handles user-dataset-2 (1900-box delivery order) safely without hanging', () => {
    const scenario = SCENARIO_PRESETS.find((s) => s.id === 'user-dataset-2')!;
    const pallet = PALLET_PRESETS.find((p) => p.id === scenario.palletId)!;
    const config = { ...DEFAULT_CONFIG, ...scenario.configOverride };

    const result = solvePalletPacking(pallet, scenario.items, config);
    expect(result.placedBoxes.length).toBeGreaterThan(10);
    expect(result.metrics.isOverhangFree).toBe(true);
    expect(result.metrics.isLoadSafe).toBe(true);
  });

  it('auto-splits all 1,920 boxes of user-dataset-2 across multiple pallets safely', () => {
    const scenario = SCENARIO_PRESETS.find((s) => s.id === 'user-dataset-2')!;
    const pallet = PALLET_PRESETS.find((p) => p.id === scenario.palletId)!;
    const config = { ...DEFAULT_CONFIG, ...scenario.configOverride };

    const multi = solveMultiPalletPacking(pallet, scenario.items, config);
    expect(multi.summary.totalBoxesRequested).toBe(1920);
    expect(multi.summary.totalBoxesPlaced).toBe(1920);
    expect(multi.unplacedItems.length).toBe(0);
    expect(multi.summary.totalPallets).toBeGreaterThan(10);
    expect(multi.summary.uniquePatterns).toBeLessThan(multi.summary.totalPallets);
    expect(multi.summary.allPalletsSafe).toBe(true);
  });

  it('skips loading when pallet utilization falls below minUtilizationRatio', () => {
    const pallet = PALLET_PRESETS[0]; // 120 x 100 x 150 cm, 1000 kg
    const tinyOrder = [
      {
        id: 'tiny-1',
        name: '少量小箱',
        length: 30,
        width: 20,
        height: 20,
        weight: 5,
        maxLoad: 50,
        quantity: 3,
        color: '#3b82f6',
      },
    ];
    const config = {
      ...DEFAULT_CONFIG,
      enableMinUtilization: true,
      minUtilizationRatio: 0.5,
    };

    const multi = solveMultiPalletPacking(pallet, tinyOrder, config);
    expect(multi.pallets.length).toBe(0);
    expect(multi.summary.totalBoxesPlaced).toBe(0);
    expect(multi.unplacedItems.length).toBe(1);
    expect(multi.unplacedItems[0].remaining).toBe(3);
    expect(multi.summary.skippedLowUtilization).toBeDefined();
    expect(multi.summary.skippedLowUtilization!.effectiveUtilization).toBeLessThan(0.5);
  });

  it('dispatches a heavy low-volume pallet if weight utilization meets minUtilizationRatio', () => {
    const pallet = PALLET_PRESETS[0]; // 1000 kg maxWeight
    const heavyOrder = [
      {
        id: 'steel-1',
        name: '重型鋼件',
        length: 50,
        width: 40,
        height: 20,
        weight: 200,
        maxLoad: 500,
        quantity: 4, // 800 kg = 80% weight utilization, even though volume is ~9%
        color: '#0ea5e9',
      },
    ];
    const config = {
      ...DEFAULT_CONFIG,
      enableMinUtilization: true,
      minUtilizationRatio: 0.6,
    };

    const multi = solveMultiPalletPacking(pallet, heavyOrder, config);
    expect(multi.pallets.length).toBe(1);
    expect(multi.summary.totalBoxesPlaced).toBe(4);
    expect(multi.summary.skippedLowUtilization).toBeUndefined();
  });
});
