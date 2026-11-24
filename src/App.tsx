import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Layers,
  PackageCheck,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Trash2,
} from 'lucide-react';
import {
  PalletViewer3D,
  type CameraPreset,
  type ColorMode,
} from './components/PalletViewer3D';
import {
  COLOR_PALETTE,
  DEFAULT_CONFIG,
  PALLET_PRESETS,
  SCENARIO_PRESETS,
} from './core/presets';
import { generateBenchmarkSuite } from './core/benchmarks';
import { solveMultiPalletPacking } from './core/solver';
import type {
  CargoItem,
  InterlockStrategy,
  OptimizationPriority,
  PackingConfig,
  PackingResult,
  PalletSpec,
  ZoneMode,
} from './core/types';
import {
  exportMultiPalletToCSV,
  exportMultiPalletToJSON,
} from './utils/export';

const EMPTY_RESULT: PackingResult = {
  placedBoxes: [],
  unplacedItems: [],
  layers: [],
  metrics: {
    totalBoxesPlaced: 0,
    totalBoxesRequested: 0,
    totalWeight: 0,
    weightUtilization: 0,
    compactVolumeUtilization: 0,
    totalVolumeUtilization: 0,
    usedHeight: 0,
    cog: { x: 0, y: 0, z: 0 },
    cogOffset: { dx: 0, dy: 0, normX: 0, normY: 0, isBalanced: true },
    interlockRate: 1,
    avgSupportRatio: 1,
    minSupportRatioFound: 1,
    maxLoadUtilization: 0,
    isLoadSafe: true,
    isOverhangFree: true,
    easeOfStackingScore: 100,
  },
};

function formatPalletRange(nums: number[]): string {
  if (nums.length === 0) return '';
  if (nums.length === 1) return `#${nums[0]}`;
  const isContiguous = nums[nums.length - 1] - nums[0] === nums.length - 1;
  if (isContiguous) return `#${nums[0]}~#${nums[nums.length - 1]}`;
  if (nums.length <= 3) return nums.map((n) => `#${n}`).join(', ');
  return `#${nums[0]}..#${nums[nums.length - 1]}`;
}

export function App() {
  const initialScenario = SCENARIO_PRESETS[0];
  const initialPallet =
    PALLET_PRESETS.find((p) => p.id === initialScenario.palletId) ?? PALLET_PRESETS[0];

  const benchmarkSuite = useMemo(() => generateBenchmarkSuite(), []);
  const [activeScenarioId, setActiveScenarioId] = useState<string>(initialScenario.id);
  const [activeBenchmarkRefPallets, setActiveBenchmarkRefPallets] = useState<number | null>(null);
  const [pallet, setPallet] = useState<PalletSpec>({ ...initialPallet });
  const [items, setItems] = useState<CargoItem[]>(
    initialScenario.items.map((it) => ({ ...it }))
  );
  const [config, setConfig] = useState<PackingConfig>({
    ...DEFAULT_CONFIG,
    ...initialScenario.configOverride,
  });
  const [enableGap, setEnableGap] = useState<boolean>(
    (initialScenario.configOverride?.gapCm ?? DEFAULT_CONFIG.gapCm) > 0
  );
  const [savedGapCm, setSavedGapCm] = useState<number>(
    initialScenario.configOverride?.gapCm ?? DEFAULT_CONFIG.gapCm
  );

  // Active pallet index in multi-pallet mode (0-based)
  const [activePalletIdx, setActivePalletIdx] = useState<number>(0);

  // Viewport controls
  const [colorMode, setColorMode] = useState<ColorMode>('sku');
  const [showCoG, setShowCoG] = useState<boolean>(true);
  const [showWireframe, setShowWireframe] = useState<boolean>(true);
  const [selectedLayer, setSelectedLayer] = useState<number | null>(null);
  const [cameraPresetTrigger, setCameraPresetTrigger] = useState<{
    preset: CameraPreset;
    tick: number;
  }>({ preset: 'iso', tick: 0 });

  // Run multi-pallet solver synchronously via useMemo (fast: < 60ms even for 1,900 boxes)
  const effectiveConfig = useMemo<PackingConfig>(
    () => ({ ...config, gapCm: enableGap ? Math.max(0, savedGapCm) : 0 }),
    [config, enableGap, savedGapCm]
  );

  const multiResult = useMemo(
    () => solveMultiPalletPacking(pallet, items, effectiveConfig),
    [pallet, items, effectiveConfig]
  );

  // Clamp activePalletIdx whenever pallet count changes
  const safePalletIdx = Math.min(
    activePalletIdx,
    Math.max(0, multiResult.pallets.length - 1)
  );
  const result = multiResult.pallets[safePalletIdx] ?? EMPTY_RESULT;

  useEffect(() => {
    setActivePalletIdx(0);
  }, [multiResult]);

  // Sequence playback state for currently selected pallet
  const totalPlaced = result.placedBoxes.length;
  const [visibleUpToSeq, setVisibleUpToSeq] = useState<number>(totalPlaced);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Reset playback when switching pallets or recalculating
  useEffect(() => {
    setVisibleUpToSeq(result.placedBoxes.length);
    setSelectedLayer(null);
    setIsPlaying(false);
  }, [result, safePalletIdx]);

  // Playback timer
  useEffect(() => {
    if (!isPlaying) return;
    if (visibleUpToSeq >= totalPlaced) {
      setIsPlaying(false);
      return;
    }
    const timer = window.setInterval(() => {
      setVisibleUpToSeq((prev) => {
        if (prev + 1 >= totalPlaced) {
          setIsPlaying(false);
          return totalPlaced;
        }
        return prev + 1;
      });
    }, 180);
    return () => window.clearInterval(timer);
  }, [isPlaying, visibleUpToSeq, totalPlaced]);

  const applyScenario = (scenarioId: string) => {
    const sc = SCENARIO_PRESETS.find((s) => s.id === scenarioId);
    if (!sc) return;
    const p = PALLET_PRESETS.find((pp) => pp.id === sc.palletId) ?? PALLET_PRESETS[0];
    setActiveScenarioId(sc.id);
    setActiveBenchmarkRefPallets(null);
    setPallet({ ...p });
    setItems(sc.items.map((it) => ({ ...it })));
    const nextCfg = { ...DEFAULT_CONFIG, ...sc.configOverride };
    setConfig(nextCfg);
    setEnableGap(nextCfg.gapCm > 0);
    setSavedGapCm(nextCfg.gapCm > 0 ? nextCfg.gapCm : 0.5);
  };

  const applyBenchmark = (benchId: string) => {
    const b = benchmarkSuite.find((x) => x.id === benchId);
    if (!b) return;
    setActiveScenarioId(`bench:${b.id}`);
    setActiveBenchmarkRefPallets(b.referencePallets);
    setPallet({ ...b.pallet });
    setItems(b.items.map((it) => ({ ...it })));
    setConfig({ ...b.config });
    setEnableGap(b.config.gapCm > 0);
    setSavedGapCm(b.config.gapCm > 0 ? b.config.gapCm : 0.5);
  };

  const handlePalletPresetChange = (id: string) => {
    const p = PALLET_PRESETS.find((pp) => pp.id === id);
    if (p) setPallet({ ...p });
  };

  const updateItem = (id: string, patch: Partial<CargoItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    setActiveScenarioId('custom');
  };

  const addItem = () => {
    const idx = items.length;
    const newItem: CargoItem = {
      id: `sku-${Date.now()}`,
      name: `貨物 ${String.fromCharCode(65 + (idx % 26))}`,
      length: 35.0,
      width: 25.0,
      height: 22.0,
      weight: 10.0,
      maxLoad: 60.0,
      quantity: 12,
      color: COLOR_PALETTE[idx % COLOR_PALETTE.length],
    };
    setItems((prev) => [...prev, newItem]);
    setActiveScenarioId('custom');
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setActiveScenarioId('custom');
  };

  const triggerCamera = (preset: CameraPreset) => {
    setCameraPresetTrigger((prev) => ({ preset, tick: prev.tick + 1 }));
  };

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      if (visibleUpToSeq >= totalPlaced) {
        setVisibleUpToSeq(1);
      }
      setSelectedLayer(null);
      setIsPlaying(true);
    }
  };

  const { metrics } = result;
  const { summary } = multiResult;
  const isMultiPallet = summary.totalPallets > 1;

  return (
    <div className="app-shell">
      {/* Top Header */}
      <header className="top-bar">
        <div className="brand">
          <div className="brand-icon">
            <Box size={20} />
          </div>
          <div>
            <h1>3D 棧板智慧裝箱系統</h1>
            <span className="subtitle">
              多棧板自動拆板 · 奇偶層互鎖 · 重心平衡 · 獨立耐壓 · cm / kg
            </span>
          </div>
        </div>

        <div className="scenario-tabs">
          {SCENARIO_PRESETS.map((sc) => (
            <button
              key={sc.id}
              className={`scenario-btn ${activeScenarioId === sc.id ? 'active' : ''}`}
              onClick={() => applyScenario(sc.id)}
              title={sc.description}
            >
              {sc.name}
            </button>
          ))}
          <select
            className="pallet-select"
            value={activeScenarioId.startsWith('bench:') ? activeScenarioId.slice(6) : ''}
            onChange={(e) => {
              if (e.target.value) applyBenchmark(e.target.value);
            }}
            title="載入依據 3D-BPP 文獻生成之大訂單基準測資"
          >
            <option value="">文獻大訂單測資 (10組)...</option>
            {benchmarkSuite.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} (參考 {b.referencePallets}板)
              </option>
            ))}
          </select>
        </div>

        <div className="export-actions">
          <button
            className="btn-secondary"
            onClick={() => exportMultiPalletToCSV(pallet, multiResult)}
            disabled={summary.totalBoxesPlaced === 0}
          >
            <Download size={14} />{' '}
            {isMultiPallet ? `全部 CSV (${summary.totalPallets}板)` : 'CSV 順序表'}
          </button>
          <button
            className="btn-secondary"
            onClick={() => exportMultiPalletToJSON(pallet, effectiveConfig, multiResult)}
            disabled={summary.totalBoxesPlaced === 0}
          >
            <Download size={14} /> JSON
          </button>
        </div>
      </header>

      {/* Main 3-Column Workspace */}
      <main className="workspace">
        {/* LEFT PANEL: Configuration & Cargo */}
        <aside className="panel panel-left">
          {/* Pallet Specification */}
          <section className="card">
            <div className="card-title">
              <Layers size={15} /> 棧板規格 (cm / kg)
            </div>
            <select
              className="select-input"
              value={pallet.id}
              onChange={(e) => handlePalletPresetChange(e.target.value)}
            >
              {PALLET_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <div className="field-grid-2">
              <label className="field">
                <span>長度 X (cm)</span>
                <input
                  type="number"
                  step="0.5"
                  min="20"
                  value={pallet.length}
                  onChange={(e) =>
                    setPallet({ ...pallet, length: Math.max(10, parseFloat(e.target.value) || 0) })
                  }
                />
              </label>
              <label className="field">
                <span>寬度 Y (cm)</span>
                <input
                  type="number"
                  step="0.5"
                  min="20"
                  value={pallet.width}
                  onChange={(e) =>
                    setPallet({ ...pallet, width: Math.max(10, parseFloat(e.target.value) || 0) })
                  }
                />
              </label>
              <label className="field">
                <span>最大堆高 (cm)</span>
                <input
                  type="number"
                  step="1"
                  min="20"
                  value={pallet.maxHeight}
                  onChange={(e) =>
                    setPallet({
                      ...pallet,
                      maxHeight: Math.max(10, parseFloat(e.target.value) || 0),
                    })
                  }
                />
              </label>
              <label className="field">
                <span>最大承重 (kg)</span>
                <input
                  type="number"
                  step="10"
                  min="10"
                  value={pallet.maxWeight}
                  onChange={(e) =>
                    setPallet({
                      ...pallet,
                      maxWeight: Math.max(1, parseFloat(e.target.value) || 0),
                    })
                  }
                />
              </label>
            </div>
          </section>

          {/* Stability & Interlocking Constraints */}
          <section className="card">
            <div className="card-title">
              <Sliders size={15} /> 堆疊與穩定性參數
            </div>

            <label className="field" style={{ marginBottom: 8 }}>
              <span>層空間分區模式 (1/1 · 1/2 · 1/4)</span>
              <select
                className="select-input"
                style={{ marginBottom: 0 }}
                value={config.zoneMode}
                onChange={(e) =>
                  setConfig({ ...config, zoneMode: e.target.value as ZoneMode })
                }
              >
                <option value="auto">自動最佳分區（1/1 · 1/2 · 1/4 動態擇優）</option>
                <option value="full">1/1 整層模式（全板統一）</option>
                <option value="half">1/2 半層雙區（左右／前後獨立堆高）</option>
                <option value="quarter">1/4 四分區（2×2 獨立堆高）</option>
              </select>
            </label>

            <label className="field" style={{ marginBottom: 10 }}>
              <span>填充率 vs 策略權衡偏好</span>
              <select
                className="select-input"
                style={{ marginBottom: 0 }}
                value={config.optimizationPriority}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    optimizationPriority: e.target.value as OptimizationPriority,
                  })
                }
              >
                <option value="balanced">均衡模式（預設，互鎖最多折讓 2% 箱數）</option>
                <option value="fill-rate">填充率優先（絕不犧牲單層箱數）</option>
                <option value="interlock">互鎖穩定優先（最高容許折讓 15%）</option>
              </select>
            </label>

            <div className="toggle-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.enableInterlocking}
                  onChange={(e) =>
                    setConfig({ ...config, enableInterlocking: e.target.checked })
                  }
                />
                <span>啟用奇偶層互鎖 (Interlocking)</span>
              </label>
            </div>

            {config.enableInterlocking && (
              <label className="field" style={{ marginBottom: 10 }}>
                <span>偶數層互鎖策略</span>
                <select
                  className="select-input"
                  value={config.interlockStrategy}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      interlockStrategy: e.target.value as InterlockStrategy,
                    })
                  }
                >
                  <option value="auto">自動最佳化（自動挑選最高互鎖率）</option>
                  <option value="rotate-180">偶數層旋轉 180°</option>
                  <option value="mirror-x">偶數層 X 軸鏡像翻轉</option>
                  <option value="mirror-y">偶數層 Y 軸鏡像翻轉</option>
                </select>
              </label>
            )}

            {/* Tolerance Gap Option */}
            <div className="gap-box">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={enableGap}
                  onChange={(e) => setEnableGap(e.target.checked)}
                />
                <span>考量貨物公差保留空隙</span>
              </label>
              {enableGap && (
                <div className="inline-input">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="5"
                    value={savedGapCm}
                    onChange={(e) =>
                      setSavedGapCm(Math.max(0, parseFloat(e.target.value) || 0))
                    }
                  />
                  <span>cm</span>
                </div>
              )}
            </div>

            {/* Minimum Utilization Gate (Skip Low-Utilization Pallet) */}
            <div className="util-gate-box">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.enableMinUtilization}
                  onChange={(e) =>
                    setConfig({ ...config, enableMinUtilization: e.target.checked })
                  }
                />
                <span>未達利用率門檻則不裝貨</span>
              </label>
              {config.enableMinUtilization && (
                <label className="slider-field" style={{ marginTop: 8, marginBottom: 0 }}>
                  <div className="slider-header">
                    <span>最低綜合利用率（體積/承重取高）</span>
                    <strong>{Math.round(config.minUtilizationRatio * 100)}%</strong>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="0.95"
                    step="0.05"
                    value={config.minUtilizationRatio}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        minUtilizationRatio: parseFloat(e.target.value),
                      })
                    }
                  />
                </label>
              )}
            </div>

            <label className="slider-field">
              <div className="slider-header">
                <span>最小底面支撐率</span>
                <strong>{Math.round(config.minSupportRatio * 100)}%</strong>
              </div>
              <input
                type="range"
                min="0.5"
                max="1.0"
                step="0.02"
                value={config.minSupportRatio}
                onChange={(e) =>
                  setConfig({ ...config, minSupportRatio: parseFloat(e.target.value) })
                }
              />
            </label>

            <label className="slider-field">
              <div className="slider-header">
                <span>重心容許偏移上限</span>
                <strong>±{Math.round(config.maxCogOffsetRatio * 100)}%</strong>
              </div>
              <input
                type="range"
                min="0.05"
                max="0.35"
                step="0.01"
                value={config.maxCogOffsetRatio}
                onChange={(e) =>
                  setConfig({ ...config, maxCogOffsetRatio: parseFloat(e.target.value) })
                }
              />
            </label>

            <div className="toggle-stack">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.prioritizeHeavyBottom}
                  onChange={(e) =>
                    setConfig({ ...config, prioritizeHeavyBottom: e.target.checked })
                  }
                />
                <span>重物與高耐壓優先置底</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.groupSameSku}
                  onChange={(e) =>
                    setConfig({ ...config, groupSameSku: e.target.checked })
                  }
                />
                <span>同品項集中（提升揀貨與堆疊效率）</span>
              </label>
            </div>
          </section>

          {/* Cargo List */}
          <section className="card cargo-card">
            <div className="card-title-row">
              <div className="card-title" style={{ marginBottom: 0 }}>
                <Box size={15} /> 貨物清單 ({items.length} 品項 · {summary.totalBoxesRequested} 箱)
              </div>
              <button className="btn-primary-sm" onClick={addItem}>
                <Plus size={13} /> 新增品項
              </button>
            </div>

            <div className="cargo-list">
              {items.map((item) => (
                <div key={item.id} className="cargo-item">
                  <div className="cargo-item-header">
                    <input
                      type="color"
                      className="color-picker"
                      value={item.color}
                      onChange={(e) => updateItem(item.id, { color: e.target.value })}
                    />
                    <input
                      type="text"
                      className="cargo-name-input"
                      value={item.name}
                      onChange={(e) => updateItem(item.id, { name: e.target.value })}
                    />
                    <button
                      className="icon-btn danger"
                      onClick={() => removeItem(item.id)}
                      title="刪除此品項"
                      disabled={items.length <= 1}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="cargo-grid-3">
                    <label className="mini-field">
                      <span>長 (cm)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="1"
                        value={item.length}
                        onChange={(e) =>
                          updateItem(item.id, {
                            length: Math.max(0.5, parseFloat(e.target.value) || 0),
                          })
                        }
                      />
                    </label>
                    <label className="mini-field">
                      <span>寬 (cm)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="1"
                        value={item.width}
                        onChange={(e) =>
                          updateItem(item.id, {
                            width: Math.max(0.5, parseFloat(e.target.value) || 0),
                          })
                        }
                      />
                    </label>
                    <label className="mini-field">
                      <span>高 (cm)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="1"
                        value={item.height}
                        onChange={(e) =>
                          updateItem(item.id, {
                            height: Math.max(0.5, parseFloat(e.target.value) || 0),
                          })
                        }
                      />
                    </label>
                    <label className="mini-field">
                      <span>重量 (kg)</span>
                      <input
                        type="number"
                        step="any"
                        min="0.001"
                        value={item.weight}
                        onChange={(e) =>
                          updateItem(item.id, {
                            weight: Math.max(0.001, parseFloat(e.target.value) || 0),
                          })
                        }
                      />
                    </label>
                    <label className="mini-field">
                      <span>耐壓 (kg)</span>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={item.maxLoad}
                        onChange={(e) =>
                          updateItem(item.id, {
                            maxLoad: Math.max(0, parseFloat(e.target.value) || 0),
                          })
                        }
                      />
                    </label>
                    <label className="mini-field">
                      <span>數量</span>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={item.quantity}
                        onChange={(e) =>
                          updateItem(item.id, {
                            quantity: Math.max(0, parseInt(e.target.value, 10) || 0),
                          })
                        }
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>

        {/* CENTER VIEWPORT: 3D Interactive Scene + Multi-Pallet Bar + Playback */}
        <section className="viewport-area">
          <div className="viewport-toolbar">
            <div className="btn-group">
              <button onClick={() => triggerCamera('iso')}>等角 3D</button>
              <button onClick={() => triggerCamera('top')}>俯視圖</button>
              <button onClick={() => triggerCamera('front')}>正視圖</button>
              <button onClick={() => triggerCamera('side')}>側視圖</button>
            </div>

            <div className="btn-group">
              <button
                className={colorMode === 'sku' ? 'active' : ''}
                onClick={() => setColorMode('sku')}
              >
                品項色
              </button>
              <button
                className={colorMode === 'parity' ? 'active' : ''}
                onClick={() => setColorMode('parity')}
              >
                奇偶層色
              </button>
              <button
                className={colorMode === 'load' ? 'active' : ''}
                onClick={() => setColorMode('load')}
              >
                承重熱力
              </button>
            </div>

            <div className="btn-group">
              <button
                className={showCoG ? 'active' : ''}
                onClick={() => setShowCoG(!showCoG)}
              >
                <Eye size={13} /> 重心線
              </button>
              <button
                className={showWireframe ? 'active' : ''}
                onClick={() => setShowWireframe(!showWireframe)}
              >
                邊界框
              </button>
            </div>
          </div>

          {/* Multi-Pallet Fleet Switcher Bar (auto-shown when > 1 pallet) */}
          {isMultiPallet && (
            <div className="fleet-bar">
              <div className="fleet-summary-pill">
                <PackageCheck size={14} />
                <span>
                  自動拆板：共 <strong>{summary.totalPallets}</strong> 板（
                  {summary.uniquePatterns} 種板型）
                  {activeBenchmarkRefPallets !== null && (
                    <>
                      {' '}· 參考答案 <strong>{activeBenchmarkRefPallets}</strong> 板（達成率{' '}
                      <strong>
                        {Math.min(
                          100,
                          (activeBenchmarkRefPallets / Math.max(1, summary.totalPallets)) * 100
                        ).toFixed(1)}
                        %
                      </strong>
                      ）
                    </>
                  )}
                  · 已排 <strong>{summary.totalBoxesPlaced}</strong> /{' '}
                  {summary.totalBoxesRequested} 箱 · 總重{' '}
                  <strong>{summary.totalWeight.toFixed(1)}</strong> kg
                </span>
              </div>

              <div className="fleet-nav">
                <button
                  className="icon-btn"
                  disabled={safePalletIdx <= 0}
                  onClick={() => setActivePalletIdx((i) => Math.max(0, i - 1))}
                  title="上一板"
                >
                  <ChevronLeft size={15} />
                </button>
                <select
                  className="pallet-select"
                  value={safePalletIdx}
                  onChange={(e) => setActivePalletIdx(parseInt(e.target.value, 10))}
                >
                  {multiResult.pallets.map((p, idx) => (
                    <option key={idx} value={idx}>
                      棧板 #{idx + 1} / {summary.totalPallets}（{p.placedBoxes.length}箱 ·{' '}
                      {p.metrics.totalWeight.toFixed(1)}kg）
                    </option>
                  ))}
                </select>
                <button
                  className="icon-btn"
                  disabled={safePalletIdx >= summary.totalPallets - 1}
                  onClick={() =>
                    setActivePalletIdx((i) => Math.min(summary.totalPallets - 1, i + 1))
                  }
                  title="下一板"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}

          <div className="viewport-canvas-host">
            <PalletViewer3D
              pallet={pallet}
              config={effectiveConfig}
              result={result}
              colorMode={colorMode}
              visibleUpToSeq={visibleUpToSeq}
              selectedLayer={selectedLayer}
              showCoG={showCoG}
              showWireframe={showWireframe}
              cameraPresetTrigger={cameraPresetTrigger}
            />
          </div>

          {/* Bottom Playback & Layer Scrubber */}
          <div className="playback-bar">
            <div className="playback-controls">
              <button
                className="play-btn"
                onClick={togglePlay}
                disabled={totalPlaced === 0}
                title={isPlaying ? '暫停堆疊動畫' : '播放逐箱堆疊順序'}
              >
                {isPlaying ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <button
                className="icon-btn"
                onClick={() => {
                  setIsPlaying(false);
                  setVisibleUpToSeq(totalPlaced);
                  setSelectedLayer(null);
                }}
                title="顯示全部"
              >
                <RotateCcw size={14} />
              </button>
              <span className="seq-label">
                {isMultiPallet ? `板#${safePalletIdx + 1} ` : ''}順序{' '}
                <strong>{visibleUpToSeq}</strong> / {totalPlaced}
              </span>
              <input
                type="range"
                className="seq-slider"
                min={0}
                max={totalPlaced}
                value={visibleUpToSeq}
                onChange={(e) => {
                  setIsPlaying(false);
                  setSelectedLayer(null);
                  setVisibleUpToSeq(parseInt(e.target.value, 10));
                }}
              />
            </div>

            <div className="layer-pills">
              <button
                className={`layer-pill ${selectedLayer === null ? 'active' : ''}`}
                onClick={() => {
                  setSelectedLayer(null);
                  setVisibleUpToSeq(totalPlaced);
                }}
              >
                全部 ({result.layers.length}層)
              </button>
              {result.layers.map((l) => (
                <button
                  key={l.layerIndex}
                  className={`layer-pill ${l.parity} ${
                    selectedLayer === l.layerIndex ? 'active' : ''
                  }`}
                  onClick={() => {
                    setIsPlaying(false);
                    setSelectedLayer(l.layerIndex);
                    setVisibleUpToSeq(totalPlaced);
                  }}
                >
                  L{l.layerIndex} ({l.parity === 'odd' ? '奇' : '偶'})
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* RIGHT PANEL: Fleet Groups, Analytics, CoG Radar & Layer Details */}
        <aside className="panel panel-right">
          {/* Multi-Pallet Template Groups (when > 1 pallet) */}
          {isMultiPallet && (
            <section className="card fleet-card">
              <div className="card-title">
                <PackageCheck size={15} className="accent-blue" />
                拆板板型總覽 ({summary.totalPallets} 板 / {summary.uniquePatterns} 種)
              </div>
              <div className="template-list">
                {multiResult.groups.map((grp) => {
                  const isActiveGroup = grp.palletNumbers.includes(safePalletIdx + 1);
                  return (
                    <div
                      key={grp.groupIndex}
                      className={`template-row ${isActiveGroup ? 'selected' : ''}`}
                      onClick={() => setActivePalletIdx(grp.representativePalletIndex)}
                    >
                      <div className="template-row-top">
                        <span className="pill odd">板型 {grp.groupIndex}</span>
                        <span className="template-range">
                          {formatPalletRange(grp.palletNumbers)}
                        </span>
                        <strong>×{grp.count} 板</strong>
                      </div>
                      <div className="template-sku">{grp.skuSummary}</div>
                      <div className="layer-row-sub">
                        <span>{grp.boxesPerPallet} 箱/板</span>
                        <span>{grp.weightPerPallet.toFixed(1)} kg</span>
                        <span>互鎖 {(grp.interlockRate * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Current Pallet KPI Grid */}
          <section className="kpi-grid">
            <div className="kpi-card">
              <span className="kpi-label">
                {isMultiPallet ? `棧板 #${safePalletIdx + 1} 箱數` : '裝載箱數'}
              </span>
              <div className="kpi-value">
                {metrics.totalBoxesPlaced}
                <small>
                  {' '}
                  / {isMultiPallet ? summary.totalBoxesRequested : metrics.totalBoxesRequested}
                </small>
              </div>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">層間互鎖率</span>
              <div className="kpi-value accent-blue">
                {(metrics.interlockRate * 100).toFixed(0)}%
              </div>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">有效體積率</span>
              <div className="kpi-value accent-emerald">
                {(metrics.compactVolumeUtilization * 100).toFixed(1)}%
              </div>
              <span className="kpi-sub">
                堆高 {metrics.usedHeight.toFixed(1)} / {pallet.maxHeight} cm
              </span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">本板重量</span>
              <div className="kpi-value">
                {metrics.totalWeight.toFixed(1)}
                <small> kg</small>
              </div>
              <span className="kpi-sub">
                佔上限 {(metrics.weightUtilization * 100).toFixed(1)}%
              </span>
            </div>
          </section>

          {/* Safety Checklist */}
          <section className="card">
            <div className="card-title">
              {metrics.isOverhangFree && metrics.isLoadSafe && metrics.cogOffset.isBalanced ? (
                <ShieldCheck size={15} className="text-ok" />
              ) : (
                <ShieldAlert size={15} className="text-warn" />
              )}
              {isMultiPallet ? `棧板 #${safePalletIdx + 1} 物理約束評估` : '物理約束與堆疊評估'}
            </div>

            <div className="status-list">
              <div className="status-row">
                <span>採用空間分區</span>
                <span className="badge info">{result.zoneLayoutName ?? '1/1 整層'}</span>
              </div>
              <div className="status-row">
                <span>零超邊界 (Zero Overhang)</span>
                <span className={`badge ${metrics.isOverhangFree ? 'ok' : 'err'}`}>
                  {metrics.isOverhangFree ? '通過' : '超邊'}
                </span>
              </div>
              <div className="status-row">
                <span>單箱耐壓安全 (最高負荷)</span>
                <span className={`badge ${metrics.isLoadSafe ? 'ok' : 'err'}`}>
                  {(metrics.maxLoadUtilization * 100).toFixed(0)}% ·{' '}
                  {metrics.isLoadSafe ? '安全' : '超載'}
                </span>
              </div>
              <div className="status-row">
                <span>最低底面支撐率</span>
                <span
                  className={`badge ${
                    metrics.minSupportRatioFound >= effectiveConfig.minSupportRatio - 1e-3
                      ? 'ok'
                      : 'err'
                  }`}
                >
                  {(metrics.minSupportRatioFound * 100).toFixed(1)}%
                </span>
              </div>
              <div className="status-row">
                <span>重心平衡狀態</span>
                <span className={`badge ${metrics.cogOffset.isBalanced ? 'ok' : 'warn'}`}>
                  {metrics.cogOffset.isBalanced ? '平衡' : '偏移偏大'}
                </span>
              </div>
              <div className="status-row">
                <span>堆疊容易度評分</span>
                <span className="badge info">{metrics.easeOfStackingScore} / 100</span>
              </div>
              <div className="status-row">
                <span>整板綜合利用率 (體積/承重)</span>
                <span
                  className={`badge ${
                    !effectiveConfig.enableMinUtilization ||
                    Math.max(metrics.totalVolumeUtilization, metrics.weightUtilization) >=
                      effectiveConfig.minUtilizationRatio - 1e-3
                      ? 'ok'
                      : 'warn'
                  }`}
                >
                  {(
                    Math.max(metrics.totalVolumeUtilization, metrics.weightUtilization) *
                    100
                  ).toFixed(1)}
                  %
                </span>
              </div>
            </div>
          </section>

          {/* 2D Top-Down CoG Radar */}
          <section className="card">
            <div className="card-title">重心投影與平衡圖 (俯視)</div>
            <div className="cog-diagram-wrap">
              <svg viewBox="0 0 200 160" className="cog-svg">
                <rect
                  x="20"
                  y="15"
                  width="160"
                  height="130"
                  rx="4"
                  fill="#0f172a"
                  stroke="#475569"
                  strokeWidth="1.5"
                />
                <line x1="100" y1="15" x2="100" y2="145" stroke="#334155" strokeDasharray="3 3" />
                <line x1="20" y1="80" x2="180" y2="80" stroke="#334155" strokeDasharray="3 3" />
                <rect
                  x={100 - 80 * effectiveConfig.maxCogOffsetRatio}
                  y={80 - 65 * effectiveConfig.maxCogOffsetRatio}
                  width={160 * effectiveConfig.maxCogOffsetRatio}
                  height={130 * effectiveConfig.maxCogOffsetRatio}
                  fill="rgba(34, 197, 94, 0.14)"
                  stroke="#22c55e"
                  strokeWidth="1.2"
                  strokeDasharray="3 2"
                />
                {totalPlaced > 0 && (
                  <circle
                    cx={100 + (metrics.cogOffset.dx / (pallet.length / 2)) * 80}
                    cy={80 + (metrics.cogOffset.dy / (pallet.width / 2)) * 65}
                    r="5.5"
                    fill={metrics.cogOffset.isBalanced ? '#22c55e' : '#ef4444'}
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                )}
              </svg>
              <div className="cog-stats">
                <span>
                  偏移 ΔX:{' '}
                  <strong>
                    {metrics.cogOffset.dx >= 0 ? '+' : ''}
                    {metrics.cogOffset.dx.toFixed(1)} cm
                  </strong>
                </span>
                <span>
                  偏移 ΔY:{' '}
                  <strong>
                    {metrics.cogOffset.dy >= 0 ? '+' : ''}
                    {metrics.cogOffset.dy.toFixed(1)} cm
                  </strong>
                </span>
                <span>
                  重心高 Z: <strong>{metrics.cog.z.toFixed(1)} cm</strong>
                </span>
              </div>
            </div>
          </section>

          {/* Layer Breakdown */}
          <section className="card">
            <div className="card-title">分層排法與互鎖明細</div>
            <div className="layer-list">
              {result.layers.map((l) => (
                <div
                  key={l.layerIndex}
                  className={`layer-row ${selectedLayer === l.layerIndex ? 'selected' : ''}`}
                  onClick={() =>
                    setSelectedLayer(selectedLayer === l.layerIndex ? null : l.layerIndex)
                  }
                >
                  <div className="layer-row-top">
                    <span className={`pill ${l.parity}`}>
                      L{l.layerIndex} {l.parity === 'odd' ? '奇' : '偶'}
                    </span>
                    <span className="layer-pattern">{l.patternName}</span>
                    <strong>{l.boxCount} 箱</strong>
                  </div>
                  <div className="layer-row-sub">
                    <span>
                      Z: {l.zStart.toFixed(1)}~{(l.zStart + l.zHeight).toFixed(1)} cm
                    </span>
                    <span>{l.layerWeight.toFixed(1)} kg</span>
                    <span>
                      {l.layerIndex === 1
                        ? '底層基準'
                        : `互鎖 ${(l.interlockRate * 100).toFixed(0)}%`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Low-Utilization Skipped Pallet Notice */}
          {summary.skippedLowUtilization && (
            <section className="card warn-card">
              <div className="card-title text-warn">
                <ShieldAlert size={15} /> 未達利用率門檻 · 已選擇不裝貨
              </div>
              <div className="unplaced-row" style={{ marginBottom: 6 }}>
                <span>
                  尾板預估綜合利用率僅{' '}
                  <strong>
                    {(summary.skippedLowUtilization.effectiveUtilization * 100).toFixed(1)}%
                  </strong>
                  （總體積 {(summary.skippedLowUtilization.volumeUtilization * 100).toFixed(1)}% /
                  承重 {(summary.skippedLowUtilization.weightUtilization * 100).toFixed(1)}%），低於門檻{' '}
                  <strong>{(summary.skippedLowUtilization.threshold * 100).toFixed(0)}%</strong>。
                </span>
                <small>
                  已自動保留剩餘貨物不派板，避免浪費低利用率棧板空間。
                </small>
              </div>
            </section>
          )}

          {/* Global Unplaced Items Notice */}
          {multiResult.unplacedItems.length > 0 && (
            <section className="card warn-card">
              <div className="card-title text-warn">
                <ShieldAlert size={15} />{' '}
                {summary.skippedLowUtilization ? '保留未裝貨清單' : '無法裝載貨物'} (
                {multiResult.unplacedItems.reduce((s, u) => s + u.remaining, 0)} 箱)
              </div>
              <div className="unplaced-list">
                {multiResult.unplacedItems.map((u) => (
                  <div key={u.cargoId} className="unplaced-row">
                    <div>
                      <strong>{u.name}</strong> · 剩餘 {u.remaining} 箱
                    </div>
                    <small>{u.reason}</small>
                  </div>
                ))}
              </div>
            </section>
          )}

          {multiResult.unplacedItems.length === 0 && summary.totalBoxesPlaced > 0 && (
            <div className="all-placed-banner">
              <CheckCircle2 size={16} />
              {isMultiPallet
                ? `全部 ${summary.totalBoxesPlaced} 箱已拆分為 ${summary.totalPallets} 板安全裝載完成！`
                : '所有指定貨物皆已安全裝載完成！'}
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

export default App;
