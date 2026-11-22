import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PackingConfig, PackingResult, PalletSpec, PlacedBox } from '../core/types';

export type ColorMode = 'sku' | 'parity' | 'load';
export type CameraPreset = 'iso' | 'top' | 'front' | 'side';

interface PalletViewer3DProps {
  pallet: PalletSpec;
  config: PackingConfig;
  result: PackingResult;
  colorMode: ColorMode;
  visibleUpToSeq: number;
  selectedLayer: number | null; // null = show all up to seq
  showCoG: boolean;
  showWireframe: boolean;
  cameraPresetTrigger: { preset: CameraPreset; tick: number };
}

function getLoadHeatColor(utilization: number): THREE.Color {
  const clamped = Math.min(1, Math.max(0, utilization));
  if (clamped < 0.5) {
    // Emerald (#10b981) -> Amber (#f59e0b)
    const t = clamped / 0.5;
    return new THREE.Color('#10b981').lerp(new THREE.Color('#f59e0b'), t);
  }
  // Amber (#f59e0b) -> Red (#ef4444)
  const t = (clamped - 0.5) / 0.5;
  return new THREE.Color('#f59e0b').lerp(new THREE.Color('#ef4444'), t);
}

export const PalletViewer3D: React.FC<PalletViewer3DProps> = ({
  pallet,
  config,
  result,
  colorMode,
  visibleUpToSeq,
  selectedLayer,
  showCoG,
  showWireframe,
  cameraPresetTrigger,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredBox, setHoveredBox] = useState<PlacedBox | null>(null);

  // Persistent Three.js references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const dynamicGroupRef = useRef<THREE.Group | null>(null);
  const interactiveMeshesRef = useRef<THREE.Mesh[]>([]);
  const meshToBoxRef = useRef<Map<THREE.Object3D, PlacedBox>>(new Map());

  // Initialize Three.js scene once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0f172a');
    sceneRef.current = scene;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    const camera = new THREE.PerspectiveCamera(42, width / height, 1, 2500);
    camera.position.set(175, 165, 195);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.minDistance = 60;
    controls.maxDistance = 650;
    controls.target.set(0, 55, 0);
    controls.update();
    controlsRef.current = controls;

    // Studio Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.72);
    scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xe2e8f0, 0x1e293b, 0.45);
    scene.add(hemi);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.95);
    dirLight.position.set(180, 280, 160);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 20;
    dirLight.shadow.camera.far = 700;
    const d = 180;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.bias = -0.0005;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.35);
    fillLight.position.set(-160, 120, -140);
    scene.add(fillLight);

    // Floor & subtle grid
    const floorGeo = new THREE.PlaneGeometry(900, 900);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.92,
      metalness: 0.05,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(600, 30, 0x334155, 0x1e293b);
    grid.position.y = 0.05;
    scene.add(grid);

    const dynamicGroup = new THREE.Group();
    scene.add(dynamicGroup);
    dynamicGroupRef.current = dynamicGroup;

    // Raycaster for hover inspection
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let lastHighlighted: THREE.Mesh | null = null;

    const handlePointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(interactiveMeshesRef.current, false);

      if (lastHighlighted) {
        const mat = lastHighlighted.material as THREE.MeshStandardMaterial;
        mat.emissive.setHex(0x000000);
        lastHighlighted = null;
      }

      if (hits.length > 0) {
        const mesh = hits[0].object as THREE.Mesh;
        const box = meshToBoxRef.current.get(mesh) ?? null;
        if (box) {
          const mat = mesh.material as THREE.MeshStandardMaterial;
          mat.emissive.setHex(0x2563eb);
          mat.emissiveIntensity = 0.35;
          lastHighlighted = mesh;
          renderer.domElement.style.cursor = 'pointer';
          setHoveredBox(box);
          return;
        }
      }

      renderer.domElement.style.cursor = 'grab';
      setHoveredBox(null);
    };

    renderer.domElement.addEventListener('pointermove', handlePointerMove);

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    // Animation loop
    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Handle camera preset changes
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const maxDim = Math.max(pallet.length, pallet.width, pallet.maxHeight);
    const dist = maxDim * 1.65;
    const targetY = pallet.deckHeight + Math.max(30, result.metrics.usedHeight / 2);

    controls.target.set(0, targetY, 0);
    if (cameraPresetTrigger.preset === 'iso') {
      camera.position.set(dist * 0.72, targetY + dist * 0.58, dist * 0.78);
    } else if (cameraPresetTrigger.preset === 'top') {
      camera.position.set(0, targetY + dist * 1.15, 0.1);
    } else if (cameraPresetTrigger.preset === 'front') {
      camera.position.set(0, targetY + 12, dist * 1.05);
    } else if (cameraPresetTrigger.preset === 'side') {
      camera.position.set(dist * 1.05, targetY + 12, 0);
    }
    controls.update();
  }, [cameraPresetTrigger, pallet.length, pallet.width, pallet.maxHeight, pallet.deckHeight, result.metrics.usedHeight]);

  // Rebuild pallet + boxes whenever data or filters change
  useEffect(() => {
    const group = dynamicGroupRef.current;
    if (!group) return;

    // Dispose old objects
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      child.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) {
          (obj as THREE.Mesh).geometry.dispose();
        }
        const mat = (obj as THREE.Mesh).material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
    }

    interactiveMeshesRef.current = [];
    meshToBoxRef.current.clear();

    const L = pallet.length;
    const W = pallet.width;
    const H = pallet.deckHeight;

    // 1. Build realistic wooden pallet base
    const woodTopMat = new THREE.MeshStandardMaterial({
      color: 0xb08453,
      roughness: 0.82,
      metalness: 0.04,
    });
    const woodDarkMat = new THREE.MeshStandardMaterial({
      color: 0x8a633b,
      roughness: 0.88,
      metalness: 0.04,
    });

    const plankThick = Math.min(2.5, H * 0.22);
    const runnerH = H - plankThick * 2;

    // Top deck slats
    const numSlats = 7;
    const slatW = (W / numSlats) * 0.82;
    for (let i = 0; i < numSlats; i++) {
      const zPos = -W / 2 + (W / numSlats) * (i + 0.5);
      const slat = new THREE.Mesh(new THREE.BoxGeometry(L, plankThick, slatW), woodTopMat);
      slat.position.set(0, H - plankThick / 2, zPos);
      slat.castShadow = true;
      slat.receiveShadow = true;
      group.add(slat);
    }

    // 3 Stringer blocks / runners
    const stringerW = Math.min(9, W * 0.1);
    [-W / 2 + stringerW / 2, 0, W / 2 - stringerW / 2].forEach((zPos) => {
      const runner = new THREE.Mesh(
        new THREE.BoxGeometry(L - 4, runnerH, stringerW),
        woodDarkMat
      );
      runner.position.set(0, plankThick + runnerH / 2, zPos);
      runner.castShadow = true;
      runner.receiveShadow = true;
      group.add(runner);
    });

    // Bottom deck boards
    [-W / 2 + stringerW / 2, 0, W / 2 - stringerW / 2].forEach((zPos) => {
      const bot = new THREE.Mesh(
        new THREE.BoxGeometry(L, plankThick, stringerW + 2),
        woodTopMat
      );
      bot.position.set(0, plankThick / 2, zPos);
      bot.receiveShadow = true;
      group.add(bot);
    });

    // 2. Max height & zero-overhang wireframe envelope
    if (showWireframe) {
      const envGeo = new THREE.BoxGeometry(L, pallet.maxHeight, W);
      const edges = new THREE.EdgesGeometry(envGeo);
      envGeo.dispose();
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.25,
      });
      const envWire = new THREE.LineSegments(edges, lineMat);
      envWire.position.set(0, H + pallet.maxHeight / 2, 0);
      group.add(envWire);
    }

    // 3. Render cargo boxes
    const visibleBoxes = result.placedBoxes.filter((b) => {
      if (b.sequence > visibleUpToSeq) return false;
      if (selectedLayer !== null && b.layerIndex > selectedLayer) return false;
      return true;
    });

    const latestSeq = visibleBoxes.length > 0 ? visibleBoxes[visibleBoxes.length - 1].sequence : -1;

    for (const box of visibleBoxes) {
      const isFocusedLayer = selectedLayer === null || box.layerIndex === selectedLayer;
      const isLatest = box.sequence === latestSeq && visibleUpToSeq < result.placedBoxes.length;

      let baseColor: THREE.Color;
      if (colorMode === 'sku') {
        baseColor = new THREE.Color(box.color);
      } else if (colorMode === 'parity') {
        baseColor = new THREE.Color(box.layerParity === 'odd' ? '#3b82f6' : '#f59e0b');
      } else {
        baseColor = getLoadHeatColor(box.loadUtilization);
      }

      const geo = new THREE.BoxGeometry(box.dx, box.dz, box.dy);
      const mat = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.52,
        metalness: 0.08,
        transparent: !isFocusedLayer,
        opacity: isFocusedLayer ? 0.96 : 0.28,
        emissive: isLatest ? new THREE.Color('#22d3ee') : new THREE.Color('#000000'),
        emissiveIntensity: isLatest ? 0.35 : 0,
      });

      const mesh = new THREE.Mesh(geo, mat);
      const px = box.x + box.dx / 2 - L / 2;
      const py = H + box.z + box.dz / 2;
      const pz = box.y + box.dy / 2 - W / 2;

      mesh.position.set(px, py, pz);
      mesh.castShadow = isFocusedLayer;
      mesh.receiveShadow = true;
      group.add(mesh);

      // Crisp dark edges so individual boxes & gaps are clearly distinguishable
      const edgeGeo = new THREE.EdgesGeometry(geo);
      const edgeMat = new THREE.LineBasicMaterial({
        color: isLatest ? 0x67e8f9 : 0x0f172a,
        transparent: true,
        opacity: isFocusedLayer ? 0.65 : 0.18,
      });
      const wireframe = new THREE.LineSegments(edgeGeo, edgeMat);
      mesh.add(wireframe);

      interactiveMeshesRef.current.push(mesh);
      meshToBoxRef.current.set(mesh, box);
    }

    // 4. Center of Gravity (CoG) 3D indicator & allowed offset boundary on pallet deck
    if (showCoG && result.placedBoxes.length > 0) {
      const { cog, cogOffset } = result.metrics;
      const cogX = cog.x - L / 2;
      const cogY = H + cog.z;
      const cogZ = cog.y - W / 2;
      const cogColor = cogOffset.isBalanced ? 0x22c55e : 0xef4444;

      // Allowed balance zone rectangle on top of pallet deck
      const allowW = L * config.maxCogOffsetRatio;
      const allowD = W * config.maxCogOffsetRatio;
      const zoneGeo = new THREE.PlaneGeometry(allowW, allowD);
      const zoneEdges = new THREE.EdgesGeometry(zoneGeo);
      zoneGeo.dispose();
      const zoneLine = new THREE.LineSegments(
        zoneEdges,
        new THREE.LineBasicMaterial({ color: cogColor, transparent: true, opacity: 0.9 })
      );
      zoneLine.rotation.x = -Math.PI / 2;
      zoneLine.position.set(0, H + 0.35, 0);
      group.add(zoneLine);

      // Vertical plumb line from CoG down to deck
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(cogX, H + 0.4, cogZ),
        new THREE.Vector3(cogX, Math.max(cogY, H + result.metrics.usedHeight + 12), cogZ),
      ]);
      const plumb = new THREE.Line(
        lineGeo,
        new THREE.LineBasicMaterial({ color: cogColor, transparent: true, opacity: 0.95 })
      );
      group.add(plumb);

      // CoG marker sphere at top of plumb line + actual 3D CoG
      const sphereMat = new THREE.MeshBasicMaterial({ color: cogColor });
      const topBeacon = new THREE.Mesh(new THREE.SphereGeometry(2.8, 16, 16), sphereMat);
      topBeacon.position.set(cogX, H + result.metrics.usedHeight + 12, cogZ);
      group.add(topBeacon);

      const deckDot = new THREE.Mesh(
        new THREE.CylinderGeometry(2.2, 2.2, 0.6, 20),
        sphereMat
      );
      deckDot.position.set(cogX, H + 0.5, cogZ);
      group.add(deckDot);
    }
  }, [pallet, config, result, colorMode, visibleUpToSeq, selectedLayer, showCoG, showWireframe]);

  return (
    <div className="viewer-wrapper">
      <div ref={containerRef} className="viewer-canvas" />

      {/* Color legend overlay */}
      <div className="viewer-legend">
        {colorMode === 'parity' && (
          <>
            <span className="legend-item">
              <i className="dot" style={{ background: '#3b82f6' }} /> 奇數層 (Odd)
            </span>
            <span className="legend-item">
              <i className="dot" style={{ background: '#f59e0b' }} /> 偶數層 (Even)
            </span>
          </>
        )}
        {colorMode === 'load' && (
          <>
            <span className="legend-item">
              <i className="dot" style={{ background: '#10b981' }} /> 輕負重 (&lt;50%)
            </span>
            <span className="legend-item">
              <i className="dot" style={{ background: '#f59e0b' }} /> 中負重 (50~80%)
            </span>
            <span className="legend-item">
              <i className="dot" style={{ background: '#ef4444' }} /> 接近上限 (&gt;80%)
            </span>
          </>
        )}
        {colorMode === 'sku' && (
          <span className="legend-item">左鍵旋轉 · 右鍵平移 · 滾輪縮放 · 移至貨箱檢視詳情</span>
        )}
      </div>

      {/* Hover Inspector HUD */}
      {hoveredBox && (
        <div className="box-tooltip">
          <div className="tooltip-header">
            <span className="tooltip-swatch" style={{ background: hoveredBox.color }} />
            <strong>
              #{hoveredBox.sequence} {hoveredBox.name}
            </strong>
            <span className={`pill ${hoveredBox.layerParity}`}>
              第 {hoveredBox.layerIndex} 層 ({hoveredBox.layerParity === 'odd' ? '奇' : '偶'})
            </span>
          </div>
          <div className="tooltip-grid">
            <span>座標 (cm)</span>
            <span>
              X:{hoveredBox.x.toFixed(1)} · Y:{hoveredBox.y.toFixed(1)} · Z:{hoveredBox.z.toFixed(1)}
            </span>
            <span>實放尺寸</span>
            <span>
              {hoveredBox.dx.toFixed(1)} × {hoveredBox.dy.toFixed(1)} × {hoveredBox.dz.toFixed(1)} cm
              {hoveredBox.rotated ? ' (旋90°)' : ''}
            </span>
            <span>單箱重量</span>
            <span>{hoveredBox.weight.toFixed(2)} kg</span>
            <span>頂部負重</span>
            <span>
              {hoveredBox.loadOnTop.toFixed(1)} / {hoveredBox.maxLoad.toFixed(1)} kg (
              {(hoveredBox.loadUtilization * 100).toFixed(0)}%)
            </span>
            <span>底面支撐</span>
            <span>
              {(hoveredBox.supportRatio * 100).toFixed(1)}%{' '}
              {hoveredBox.layerIndex > 1
                ? hoveredBox.isInterlocked
                  ? `· 互鎖 (${hoveredBox.supportingBoxIds.length} 箱支撐)`
                  : '· 單箱柱撐'
                : '· 棧板底面'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
