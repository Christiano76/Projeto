'use client';

import { buildWallSegments, type OfficeLayout, type RoomDef } from '@agency/core';
import type { ThreeEvent } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { getMaterial } from './geometry';

const WALL_THICKNESS = 0.15;
export const WALL_HEIGHTS = { low: 0.9, high: 2.6 } as const;

/** Piso de cada sala + base externa. Duplo clique numa sala enquadra a câmera nela. */
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
  return (
    <group>
      {/* Base externa (calçada) */}
      <mesh position={[layout.width / 2, -0.12, layout.depth / 2]} receiveShadow geometry={unitBox} scale={[layout.width + 6, 0.2, layout.depth + 6]}>
        <meshStandardMaterial color="#cbd5c0" flatShading />
      </mesh>
      {/* Laje do prédio */}
      <mesh position={[layout.width / 2, -0.06, layout.depth / 2]} geometry={unitBox} scale={[layout.width + 0.3, 0.12, layout.depth + 0.3]}>
        <meshStandardMaterial color="#94a3b8" flatShading />
      </mesh>
      {layout.rooms.map((room) => (
        <mesh
          key={room.key}
          geometry={unitBox}
          position={[room.bounds.x + room.bounds.w / 2, -0.005, room.bounds.z + room.bounds.d / 2]}
          scale={[room.bounds.w, 0.01, room.bounds.d]}
          receiveShadow
          material={getMaterial(room.floorColor)}
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
      ))}
    </group>
  );
}

/** Paredes (instanciadas). Altura baixa = "corte" estilo simulador; alta = paredes inteiras. */
export function Walls({ layout, height, shadows }: { layout: OfficeLayout; height: number; shadows: boolean }) {
  const segments = useMemo(() => buildWallSegments(layout), [layout]);
  const interior = segments.filter((s) => !s.exterior);
  const exterior = segments.filter((s) => s.exterior);
  return (
    <group>
      <WallSet segments={interior} height={height} color="#f1ede4" shadows={shadows} />
      <WallSet segments={exterior} height={height} color="#d6cfc2" shadows={shadows} />
    </group>
  );
}

function WallSet({
  segments,
  height,
  color,
  shadows,
}: {
  segments: ReturnType<typeof buildWallSegments>;
  height: number;
  color: string;
  shadows: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const capRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    segments.forEach((s, i) => {
      const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) + WALL_THICKNESS;
      const horizontal = s.a[1] === s.b[1];
      o.position.set((s.a[0] + s.b[0]) / 2, height / 2, (s.a[1] + s.b[1]) / 2);
      o.scale.set(horizontal ? len : WALL_THICKNESS, height, horizontal ? WALL_THICKNESS : len);
      o.updateMatrix();
      ref.current?.setMatrixAt(i, o.matrix);
      o.position.y = height + 0.01;
      o.scale.y = 0.02;
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
      <instancedMesh ref={ref} args={[geometry, getMaterial(color), segments.length]} castShadow={shadows} receiveShadow />
      <instancedMesh ref={capRef} args={[geometry, getMaterial('#475569'), segments.length]} />
    </group>
  );
}
