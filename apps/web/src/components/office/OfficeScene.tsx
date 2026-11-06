'use client';

import {
  allocateAnchors,
  buildNavGrid,
  deriveActivity,
  getEntranceAnchor,
  nextActivityChangeAt,
  type Anchor,
  type ObjectDef,
  type RoomDef,
  type VisualActivity,
} from '@agency/core';
import { PerformanceMonitor } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as THREE from 'three';
import { serverNow, useOfficeStore } from '@/store/officeStore';
import { Avatar } from './Avatar';
import { CameraRig, type Bounds } from './CameraRig';
import { Furniture, MonitorScreens, type ScreenState } from './Furniture';
import { LabelProjector } from './labels';
import { SCENE_PALETTES } from './sceneTheme';
import { ThemeAnimator } from './ThemeAnimator';
import { Floors, WALL_HEIGHTS, Walls } from './Structure';

/** Re-render apenas quando uma atividade derivada expira (ex.: fim da comemoração). */
function useActivityClock(): number {
  const employees = useOfficeStore((s) => s.employees);
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => serverNow(), [employees, tick]);
  useEffect(() => {
    const next = Object.values(employees)
      .map((e) => nextActivityChangeAt(e.runtime, now))
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const id = setTimeout(() => setTick((t) => t + 1), next - now + 20);
    return () => clearTimeout(id);
  }, [employees, now]);
  return now;
}

export function OfficeScene({ rotateRequest }: { rotateRequest: { nonce: number; dir: 1 | -1 } }) {
  const snapshot = useOfficeStore((s) => s.snapshot)!;
  const employees = useOfficeStore((s) => s.employees);
  const selectedId = useOfficeStore((s) => s.selectedEmployeeId);
  const focusRoomKey = useOfficeStore((s) => s.focusRoomKey);
  const focusNonce = useOfficeStore((s) => s.focusNonce);
  const wallMode = useOfficeStore((s) => s.wallMode);
  const select = useOfficeStore((s) => s.select);
  const focusRoom = useOfficeStore((s) => s.focusRoom);

  const [quality, setQuality] = useState<'high' | 'low'>('high');
  const shadows = quality === 'high';
  const layout = snapshot.layout;
  const now = useActivityClock();
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);

  const grid = useMemo(() => buildNavGrid(layout), [layout]);
  const entrance = useMemo(() => getEntranceAnchor(layout), [layout]);
  const list = useMemo(() => Object.values(employees), [employees]);

  const activities = useMemo(() => {
    const map = new Map<string, VisualActivity>();
    for (const e of list) map.set(e.id, deriveActivity(e.runtime, now));
    return map;
  }, [list, now]);
  const anchors = useMemo(() => allocateAnchors(layout, list, now), [layout, list, now]);

  // Mantém a identidade dos anchors estável entre renders (evita recalcular caminhos).
  const stableAnchors = useRef(new Map<string, Anchor>());
  for (const [id, a] of anchors) {
    const prev = stableAnchors.current.get(id);
    if (!prev || prev.key !== a.key) stableAnchors.current.set(id, a);
  }

  const monitors = useMemo(() => layout.objects.filter((o) => o.type === 'monitor'), [layout]);
  const screenStates = useMemo(() => {
    const bySeat = new Map(list.map((e) => [e.deskSeatKey, e.id]));
    const states: Record<string, ScreenState> = {};
    for (const m of monitors as ObjectDef[]) {
      const owner = bySeat.get(String(m.props?.seatKey ?? ''));
      const act = owner ? activities.get(owner) : undefined;
      // A tela só "trabalha" se o dono está sentado na própria mesa.
      const atDesk = act?.placement === 'desk';
      states[m.key] = act?.screenOn && atDesk ? (act.badge === 'blocked' ? 'blocked' : 'on') : 'off';
    }
    return states;
  }, [monitors, list, activities]);

  const focus: Bounds = useMemo(() => {
    const room = layout.rooms.find((r) => r.key === focusRoomKey);
    const b = room
      ? { minX: room.bounds.x, maxX: room.bounds.x + room.bounds.w, minZ: room.bounds.z, maxZ: room.bounds.z + room.bounds.d }
      : { minX: 0, maxX: layout.width, minZ: 0, maxZ: layout.depth };
    return b;
  }, [layout, focusRoomKey]);

  const center: [number, number, number] = [layout.width / 2, 0, layout.depth / 2];
  const span = Math.max(layout.width, layout.depth);

  return (
    <Canvas
      orthographic
      shadows={shadows ? 'soft' : false}
      dpr={quality === 'high' ? [1, 2] : 1}
      camera={{ position: [60, 60, 60], zoom: 30, near: 0.1, far: 400 }}
      gl={{ antialias: quality === 'high', powerPreference: 'high-performance' }}
      onPointerMissed={() => select(null)}
      aria-label="Escritório 3D da agência"
    >
      <ThemeAnimator hemi={hemiRef} sun={sunRef} ambient={ambientRef} />
      <PerformanceMonitor onDecline={() => setQuality('low')} flipflops={2} onFallback={() => setQuality('low')} />

      {/* Cores/intensidades iniciais do tema claro; o ThemeAnimator interpola conforme o tema */}
      <hemisphereLight ref={hemiRef} args={[SCENE_PALETTES.light.sky, SCENE_PALETTES.light.groundLight, SCENE_PALETTES.light.hemiIntensity]} />
      <ambientLight ref={ambientRef} color={SCENE_PALETTES.light.ambient} intensity={SCENE_PALETTES.light.ambientIntensity} />
      <directionalLight
        ref={sunRef}
        position={[center[0] + 18, 30, center[2] + 12]}
        intensity={SCENE_PALETTES.light.sunIntensity}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-span * 0.7}
        shadow-camera-right={span * 0.7}
        shadow-camera-top={span * 0.7}
        shadow-camera-bottom={-span * 0.7}
        shadow-camera-near={1}
        shadow-camera-far={90}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
      >
        <object3D attach="target" position={center} />
      </directionalLight>

      <CameraRig
        layout={layout}
        focus={focus}
        focusNonce={focusNonce}
        rotateRequest={rotateRequest}
      />

      <Floors
        layout={layout}
        onFloorClick={() => select(null)}
        onRoomDoubleClick={(room: RoomDef) => focusRoom(room.key)}
      />
      <Walls layout={layout} height={WALL_HEIGHTS[wallMode]} shadows={shadows} />
      <Furniture objects={layout.objects} shadows={shadows} />
      <MonitorScreens monitors={monitors} states={screenStates} />
      <LabelProjector />

      {list.map((e) => (
        <Avatar
          key={e.id}
          employee={e}
          anchor={stableAnchors.current.get(e.id) ?? entrance}
          entrance={entrance}
          activity={activities.get(e.id)!}
          grid={grid}
          selected={selectedId === e.id}
          onSelect={select}
        />
      ))}
    </Canvas>
  );
}
