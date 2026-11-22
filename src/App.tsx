import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  CheckCircle2,
  Download,
  Eye,
  Layers,
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
import { solvePalletPacking } from './core/solver';
import type { CargoItem, InterlockStrategy, PackingConfig, PalletSpec } from './core/types';
import { exportResultToCSV, exportResultToJSON } from './utils/export';

export function App() {
  const initialScenario = SCENARIO_PRESETS[0];
  const initialPallet =
    PALLET_PRESETS.find((p) => p.id === initialScenario.palletId) ?? PALLET_PRESETS[0];

  const [activeScenarioId, setActiveScenarioId] = useState<string>(initialScenario.id);
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

  // Viewport controls
  const [colorMode, setColorMode] = useState<ColorMode>('sku');
  const [showCoG, setShowCoG] = useState<boolean>(true);
  const [showWireframe, setShowWireframe] = useState<boolean>(true);
  const [selectedLayer, setSelectedLayer] = useState<number | null>(null);
  const [cameraPresetTrigger, setCameraPresetTrigger] = useState<{
    preset: CameraPreset;
    tick: number;
  }>({ preset: 'iso', tick: 0 });

  // Run solver synchronously via useMemo (fast: < 30ms)
  const effectiveConfig = useMemo<PackingConfig>(
    () => ({ ...config, gapCm: enableGap ? Math.max(0, savedGapCm) : 0 }),
    [config, enableGap, savedGapCm]
  );

  const result = useMemo(
    () => solvePalletPacking(pallet, items, effectiveConfig),
    [pallet, items, effectiveConfig]
  );

  // Sequence playback state
  const totalPlaced = result.placedBoxes.length;
  const [visibleUpToSeq, setVisibleUpToSeq] = useState<number>(totalPlaced);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Reset playback when solution changes
  useEffect(() => {
    setVisibleUpToSeq(result.placedBoxes.length);
    setSelectedLayer(null);
    setIsPlaying(false);
  }, [result]);

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
    setPallet({ ...p });
    setItems(sc.items.map((it) => ({ ...it })));
    const nextCfg = { ...DEFAULT_CONFIG, ...sc.configOverride };
    setConfig(nextCfg);
    setEnableGap(nextCfg.gapCm > 0);
    setSavedGapCm(nextCfg.gapCm > 0 ? nextCfg.gapCm : 0.5);
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
              奇偶層互鎖 · 重心平衡 · 獨立耐壓保護 · 單位 cm / kg
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
        </div>

        <div className="export-actions">
          <button
            className="btn-secondary"
            onClick={() => exportResultToCSV(pallet, result)}
            disabled={totalPlaced === 0}
          >
            <Download size={14} /> CSV 順序表
          </button>
          <button
            className="btn-secondary"
            onClick={() => exportResultToJSON(pallet, effectiveConfig, result)}
            disabled={totalPlaced === 0}
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
                <Box size={15} /> 貨物清單 ({items.length} 品項)
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

        {/* CENTER VIEWPORT: 3D Interactive Scene + Playback */}
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
                順序 <strong>{visibleUpToSeq}</strong> / {totalPlaced}
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

        {/* RIGHT PANEL: Analytics, CoG Radar & Layer Details */}
        <aside className="panel panel-right">
          {/* KPI Grid */}
          <section className="kpi-grid">
            <div className="kpi-card">
              <span className="kpi-label">裝載箱數</span>
              <div className="kpi-value">
                {metrics.totalBoxesPlaced}
                <small> / {metrics.totalBoxesRequested}</small>
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
              <span className="kpi-label">總重 / 承重</span>
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
              物理約束與堆疊評估
            </div>

            <div className="status-list">
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
            </div>
          </section>

          {/* 2D Top-Down CoG Radar */}
          <section className="card">
            <div className="card-title">重心投影與平衡圖 (俯視)</div>
            <div className="cog-diagram-wrap">
              <svg viewBox="0 0 200 160" className="cog-svg">
                {/* Pallet outline */}
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
                {/* Crosshairs */}
                <line x1="100" y1="15" x2="100" y2="145" stroke="#334155" strokeDasharray="3 3" />
                <line x1="20" y1="80" x2="180" y2="80" stroke="#334155" strokeDasharray="3 3" />
                {/* Allowed CoG zone */}
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
                {/* Actual CoG point */}
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
                  偏移 ΔX: <strong>{metrics.cogOffset.dx >= 0 ? '+' : ''}{metrics.cogOffset.dx.toFixed(1)} cm</strong>
                </span>
                <span>
                  偏移 ΔY: <strong>{metrics.cogOffset.dy >= 0 ? '+' : ''}{metrics.cogOffset.dy.toFixed(1)} cm</strong>
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

          {/* Unplaced Items Notice */}
          {result.unplacedItems.length > 0 && (
            <section className="card warn-card">
              <div className="card-title text-warn">
                <ShieldAlert size={15} /> 未裝載貨物 ({result.unplacedItems.reduce((s, u) => s + u.remaining, 0)} 箱)
              </div>
              <div className="unplaced-list">
                {result.unplacedItems.map((u) => (
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

          {result.unplacedItems.length === 0 && totalPlaced > 0 && (
            <div className="all-placed-banner">
              <CheckCircle2 size={16} /> 所有指定貨物皆已安全裝載完成！
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

export default App;
