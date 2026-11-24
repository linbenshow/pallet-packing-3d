import { describe, expect, it } from 'vitest';
import { generateBenchmarkSuite } from './benchmarks';
import { solveMultiPalletPacking } from './solver';

describe('Literature-Grounded Large-Order 3D-BPP Benchmark Suite (95%+ Target)', () => {
  const suite = generateBenchmarkSuite();

  it('achieves >= 95% reference attainment on EVERY single large-order benchmark and >= 97.5% average', () => {
    expect(suite.length).toBe(10);

    let totalAttainment = 0;

    for (const bench of suite) {
      const res = solveMultiPalletPacking(
        bench.pallet,
        bench.items,
        bench.config,
        300
      );

      // 100% of requested boxes must be placed with full physical safety
      expect(res.summary.totalBoxesPlaced, `${bench.id} placed count`).toBe(
        bench.totalBoxes
      );
      expect(res.unplacedItems.length, `${bench.id} unplaced`).toBe(0);
      expect(res.summary.allPalletsSafe, `${bench.id} physical safety`).toBe(true);

      // Reference attainment ratio: P_ref / P_solver >= 95%
      const attainment = Math.min(
        1,
        bench.referencePallets / Math.max(1, res.summary.totalPallets)
      );
      expect(
        attainment,
        `${bench.id}: P_ref=${bench.referencePallets}, P_sol=${res.summary.totalPallets}`
      ).toBeGreaterThanOrEqual(0.95);

      totalAttainment += attainment;
    }

    const avgAttainment = totalAttainment / suite.length;
    expect(avgAttainment).toBeGreaterThanOrEqual(0.975);
  });
});
