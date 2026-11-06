'use client';

import { buildWallSegments, type OfficeLayout, type RoomDef } from '@agency/core';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { SCENE_PALETTES, createThemedMaterial, darkFloorColor, getThemedMaterial } from './sceneTheme';

const L = SCENE_PALETTES.light;
const D = SCENE_PALETTES.dark;

/**
 * Alturas (m). Cada superfície tem sua própria faixa — nenhuma face
 * horizontal visível é coplanar com outra (sem z-fighting):
 *   chão externo  … topo em  -0.05
 *   laje do prédio … -0.14 → -0.02
 *   piso das salas … -0.02 →  0.00  (personagens e móveis apoiam em y = 0)
 *   soleiras       …  0.00 →  0.004
 */
export const FLOOR_TOP = 0;
const FLOOR_BOTTOM = -0.02;
const SLAB_BOTTOM = -0.14;
const GROUND_TOP = -0.05;
const WALL_THICKNESS = 0.15;
export const WALL_HEIGHTS = { low: 0.9, high: 2.6 } as const;

/** Textura de piso procedural (placas com rejunte sutil), compartilhada. */
let tileImage: HTMLCanvasElement | null = null;
function tileCanvas(): HTMLCanvasElement {
  if (tileImage) return tileImage;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  g.fillStyle = 'rgba(0,0,0,0.025)';
  g.fillRect(0, 0, size / 2, size / 2);
  g.fillRect(size / 2, size / 2, size / 2, size / 2);
  g.strokeStyle = 'rgba(40,60,90,0.16)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, size - 2, size - 2);
  g.beginPath();
  g.moveTo(size / 2, 0);
  g.lineTo(size / 2, size);
  g.moveTo(0, size / 2);
  g.lineTo(size, size / 2);
  g.strokeStyle = 'rgba(40,60,90,0.08)';
  g.lineWidth = 1;
  g.stroke();
  tileImage = c;
  return c;
}

/** Piso de uma sala: caixa fina exatamente nos limites da sala, textura alinhada ao mundo. */
function RoomFloor({
  room,
  geometry,
  onRoomDoubleClick,
  onFloorClick,
}: {
  room: RoomDef;
  geometry: THREE.BufferGeometry;
  onRoomDoubleClick: (room: RoomDef) => void;
  onFloorClick: () => void;
}) {
  const { x, z, w, d } = room.bounds;
  const material = useMemo(() => {
    const tex = new THREE.CanvasTexture(tileCanvas());
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    // Placas de 2 m alinhadas à grade global: continuidade visual entre salas.
    tex.repeat.set(w / 2, d / 2);
    tex.offset.set(((x / 2) % 1 + 1) % 1, ((z / 2) % 1 + 1) % 1);
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    const tint = room.kind === 'corridor' ? '#e8edf3' : room.floorColor;
    return createThemedMaterial(tint, darkFloorColor(tint), { map: tex });
  }, [room.kind, room.floorColor, x, z, w, d]);
  useEffect(
    () => () => {
      (material as THREE.MeshStandardMaterial).map?.dispose();
      material.dispose();
    },
    [material],
  );

  return (
    <mesh
      geometry={geometry}
      position={[x + w / 2, (FLOOR_TOP + FLOOR_BOTTOM) / 2, z + d / 2]}
      scale={[w, FLOOR_TOP - FLOOR_BOTTOM, d]}
      receiveShadow
      material={material}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (e.delta > 4) return; // foi um arrasto da câmera
        e.stopPropagation();
        onFloorClick();
      }}
      onDoubleClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onRoomDoubleClick(room);
      }}
    />
  );
}

/** Piso de cada sala + laje + chão externo. Duplo clique numa sala enquadra a câmera nela. */
export function Floors({
  layout,
  onRoomDoubleClick,
  onFloorClick,
}: {
  layout: OfficeLayout;
  onRoomDoubleClick: (room: RoomDef) => void;
  onFloorClick: () => void;
}) {
  const unitBox = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  useEffect(() => () => unitBox.dispose(), [unitBox]);
  const slabPad = WALL_THICKNESS;
  return (
    <group>
      <mesh
        position={[layout.width / 2, GROUND_TOP - 0.1, layout.depth / 2]}
        receiveShadow
        geometry={unitBox}
        scale={[layout.width + 10, 0.2, layout.depth + 10]}
        material={getThemedMaterial(L.ground, D.ground)}
      />
      <mesh
        position={[layout.width / 2, (SLAB_BOTTOM + FLOOR_BOTTOM) / 2, layout.depth / 2]}
        geometry={unitBox}
        scale={[layout.width + slabPad * 2, FLOOR_BOTTOM - SLAB_BOTTOM, layout.depth + slabPad * 2]}
        material={getThemedMaterial(L.slab, D.slab)}
        receiveShadow
      />
      <BuildingOutline width={layout.width} depth={layout.depth} pad={slabPad} />
      {layout.rooms.map((room) => (
        <RoomFloor key={room.key} room={room} geometry={unitBox} onRoomDoubleClick={onRoomDoubleClick} onFloorClick={onFloorClick} />
      ))}
      <DoorThresholds layout={layout} />
    </group>
  );
}

/** Soleiras nas passagens: marcam a separação entre salas e corredor. */
function DoorThresholds({ layout }: { layout: OfficeLayout }) {
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = getThemedMaterial('#b6c4d4', '#1d6bf3');
  const plates = useMemo(() => {
    const out: { x: number; z: number; w: number; d: number }[] = [];
    const seen = new Set<string>();
    for (const room of layout.rooms) {
      const { x, z, w, d } = room.bounds;
      for (const door of room.doors) {
        const horizontal = door.side === 'n' || door.side === 's';
        const cx = horizontal ? x + door.offset + door.width / 2 : door.side === 'w' ? x : x + w;
        const cz = horizontal ? (door.side === 'n' ? z : z + d) : z + door.offset + door.width / 2;
        const key = `${cx}:${cz}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ x: cx, z: cz, w: horizontal ? door.width : WALL_THICKNESS + 0.1, d: horizontal ? WALL_THICKNESS + 0.1 : door.width });
      }
    }
    return out;
  }, [layout]);
  return (
    <group>
      {plates.map((p, i) => (
        <mesh key={i} geometry={geometry} material={material} position={[p.x, 0.002, p.z]} scale={[p.w, 0.004, p.d]} receiveShadow />
      ))}
    </group>
  );
}

/** Paredes (instanciadas). Altura baixa = "corte" estilo simulador; alta = paredes inteiras. */
export function Walls({ layout, height, shadows }: { layout: OfficeLayout; height: number; shadows: boolean }) {
  const segments = useMemo(() => buildWallSegments(layout), [layout]);
  const interior = useMemo(() => segments.filter((s) => !s.exterior), [segments]);
  const exterior = useMemo(() => segments.filter((s) => s.exterior), [segments]);
  return (
    <group>
      <WallSet segments={interior} height={height} material={getThemedMaterial(L.wallInterior, D.wallInterior)} shadows={shadows} />
      <WallSet segments={exterior} height={height} material={getThemedMaterial(L.wallExterior, D.wallExterior)} shadows={shadows} />
    </group>
  );
}

function WallSet({
  segments,
  height,
  material,
  shadows,
}: {
  segments: ReturnType<typeof buildWallSegments>;
  height: number;
  material: THREE.Material;
  shadows: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const capRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    segments.forEach((s, i) => {
      const horizontal = s.a[1] === s.b[1];
      // Estende meia espessura nas pontas: cantos fechados, sem frestas.
      const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) + WALL_THICKNESS;
      // A parede nasce na base do piso: sem fresta entre parede e chão.
      o.position.set((s.a[0] + s.b[0]) / 2, (FLOOR_BOTTOM + height) / 2, (s.a[1] + s.b[1]) / 2);
      o.scale.set(horizontal ? len : WALL_THICKNESS, height - FLOOR_BOTTOM, horizontal ? WALL_THICKNESS : len);
      o.updateMatrix();
      ref.current?.setMatrixAt(i, o.matrix);
      o.position.y = height + 0.01;
      o.scale.set(horizontal ? len + 0.002 : WALL_THICKNESS + 0.002, 0.02, horizontal ? WALL_THICKNESS + 0.002 : len + 0.002);
      o.updateMatrix();
      capRef.current?.setMatrixAt(i, o.matrix);
    });
    for (const m of [ref.current, capRef.current]) {
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, [segments, height]);

  if (segments.length === 0) return null;
  return (
    <group>
      <instancedMesh ref={ref} args={[geometry, material, segments.length]} castShadow={shadows} receiveShadow />
      <instancedMesh ref={capRef} args={[geometry, getThemedMaterial(L.wallCap, D.wallCap, { unlit: true }), segments.length]} />
    </group>
  );
}

function BuildingOutline({ width, depth, pad }: { width: number; depth: number; pad: number }) {
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = getThemedMaterial('#b4c3d4', '#1d6bf3', { unlit: true });
  const t = 0.06;
  const off = pad + 0.12;
  const strips: [number, number, number, number][] = [
    [width / 2, -off, width + 2 * off + t, t],
    [width / 2, depth + off, width + 2 * off + t, t],
    [-off, depth / 2, t, depth + 2 * off],
    [width + off, depth / 2, t, depth + 2 * off],
  ];
  return (
    <group>
      {strips.map(([x, z, w, d], i) => (
        <mesh key={i} geometry={geometry} material={material} position={[x, GROUND_TOP + 0.004, z]} scale={[w, 0.008, d]} />
      ))}
    </group>
  );
}
