'use client';

import {
  OfficeSimulation,
  allocateAnchors,
  applyGoalSpecs,
  deriveActivity,
  getPointsOfInterest,
  getStrollPoints,
  nextActivityChangeAt,
  resolveGoals,
  type ObjectDef,
  type OfficeLayout,
  type RoomDef,
  type VisualActivity,
} from '@agency/core';
import { PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as THREE from 'three';
import { setSimulation } from '@/lib/simulationHost';
import { useCameraStore, type Quality } from '@/store/cameraStore';
import { serverNow, useOfficeStore } from '@/store/officeStore';
import { Avatar } from './Avatar';
import { CAMERA_FOV, CameraRig, type Bounds } from './CameraRig';
import { Furniture, MonitorScreens, type ScreenState } from './Furniture';
import { LabelProjector } from './labels';
import { SCENE_PALETTES } from './sceneTheme';
import { Floors, WALL_HEIGHTS, Walls } from './Structure';
import { ThemeAnimator } from './ThemeAnimator';

/** Configuração gráfica por nível de qualidade. */
const QUALITY = {
  high: { dpr: [1, 2] as [number, number], shadows: true, shadowMap: 2048, antialias: true },
  medium: { dpr: [1, 1.5] as [number, number], shadows: true, shadowMap: 1024, antialias: true },
  low: { dpr: [1, 1] as [number, number], shadows: false, shadowMap: 512, antialias: false },
} as const;

/** Qualidade inicial no modo automático: celulares/telas de toque começam em "média". */
function autoQuality(): Exclude<Quality, 'auto'> {
  if (typeof window === 'undefined') return 'high';
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  return coarse || small ? 'medium' : 'high';
}

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

const PLAN_INTERVAL_MS = 500;

/**
 * Executa a simulação: a cada ~0,5 s (ou imediatamente após um evento real)
 * recalcula as intenções a partir do estado real e avança o movimento a cada quadro.
 */
function SimulationDriver({
  sim,
  layout,
  onScreens,
}: {
  sim: OfficeSimulation;
  layout: OfficeLayout;
  onScreens: (s: Record<string, ScreenState>) => void;
}) {
  const pois = useMemo(() => getPointsOfInterest(layout, sim.grid), [layout, sim]);
  const strolls = useMemo(() => getStrollPoints(layout, sim.grid), [layout, sim]);
  const lastPlan = useRef(-Infinity);
  const lastScreens = useRef('');
  const monitors = useMemo(() => layout.objects.filter((o) => o.type === 'monitor') as ObjectDef[], [layout]);

  // Evento real chegou => replaneja já no próximo quadro.
  useEffect(
    () =>
      useOfficeStore.subscribe((s, prev) => {
        if (s.employees !== prev.employees || s.events !== prev.events) lastPlan.current = -Infinity;
      }),
    [],
  );

  useFrame((_, dt) => {
    const now = serverNow();
    if (now - lastPlan.current >= PLAN_INTERVAL_MS) {
      lastPlan.current = now;
      const { employees: map, events } = useOfficeStore.getState();
      const employees = Object.values(map);
      const anchors = allocateAnchors(layout, employees, now);
      const specs = resolveGoals({ layout, employees, anchors, pois, strolls, recentEvents: events, nowMs: now });
      applyGoalSpecs(sim, specs);

      // Monitor aceso somente com o dono SENTADO à própria mesa e trabalhando de verdade.
      const bySeat = new Map(employees.map((e) => [e.deskSeatKey, e]));
      const screens: Record<string, ScreenState> = {};
      for (const m of monitors) {
        const owner = bySeat.get(String(m.props?.seatKey ?? ''));
        const agent = owner ? sim.agents.get(owner.id) : undefined;
        const act = owner ? deriveActivity(owner.runtime, now) : undefined;
        const seatedAtDesk = agent?.phase === 'seated' && agent.goal?.key === `seat:${owner?.deskSeatKey}`;
        screens[m.key] = act?.screenOn && seatedAtDesk ? (act.badge === 'blocked' ? 'blocked' : 'on') : 'off';
      }
      const key = JSON.stringify(screens);
      if (key !== lastScreens.current) {
        lastScreens.current = key;
        onScreens(screens);
      }
    }
    sim.step(dt, now);
  });
  return null;
}

export function OfficeScene() {
  const snapshot = useOfficeStore((s) => s.snapshot)!;
  const employees = useOfficeStore((s) => s.employees);
  const selectedId = useOfficeStore((s) => s.selectedEmployeeId);
  const focusRoomKey = useOfficeStore((s) => s.focusRoomKey);
  const focusNonce = useOfficeStore((s) => s.focusNonce);
  const wallMode = useOfficeStore((s) => s.wallMode);
  const select = useOfficeStore((s) => s.select);
  const focusRoom = useOfficeStore((s) => s.focusRoom);
  const qualitySetting = useCameraStore((s) => s.quality);
  const setEffectiveQuality = useCameraStore((s) => s.setEffectiveQuality);

  const [autoLevel, setAutoLevel] = useState<Exclude<Quality, 'auto'>>(() => autoQuality());
  const level = qualitySetting === 'auto' ? autoLevel : qualitySetting;
  const q = QUALITY[level];
  useEffect(() => setEffectiveQuality(level), [level, setEffectiveQuality]);

  const layout = snapshot.layout;
  const now = useActivityClock();
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const [screenStates, setScreenStates] = useState<Record<string, ScreenState>>({});

  // Uma simulação por layout; registrada para a interface (painéis, testes).
  const sim = useMemo(() => new OfficeSimulation(layout), [layout]);
  useEffect(() => {
    setSimulation(sim);
    const w = window as unknown as { __agencyOS?: Record<string, unknown> };
    w.__agencyOS = {
      ...(w.__agencyOS ?? {}),
      agents: () =>
        [...sim.agents.values()].map((a) => ({
          id: a.id,
          phase: a.phase,
          pos: [a.pos[0], a.pos[1]],
          goal: a.goal?.label ?? null,
          goalKey: a.goal?.key ?? null,
          goalPos: a.goal ? [a.goal.position[0], a.goal.position[1]] : null,
          sit: a.sit,
          seatPos: a.seatPos,
          simTime: sim.elapsed,
          distance: a.distance,
          pose: a.pose,
          walkable: sim.walkableAt(a.pos),
        })),
    };
    return () => setSimulation(null);
  }, [sim]);

  const list = useMemo(() => Object.values(employees), [employees]);
  const activities = useMemo(() => {
    const map = new Map<string, VisualActivity>();
    for (const e of list) map.set(e.id, deriveActivity(e.runtime, now));
    return map;
  }, [list, now]);

  const monitors = useMemo(() => layout.objects.filter((o) => o.type === 'monitor'), [layout]);

  const focus: Bounds = useMemo(() => {
    const room = layout.rooms.find((r) => r.key === focusRoomKey);
    return room
      ? { minX: room.bounds.x, maxX: room.bounds.x + room.bounds.w, minZ: room.bounds.z, maxZ: room.bounds.z + room.bounds.d }
      : { minX: 0, maxX: layout.width, minZ: 0, maxZ: layout.depth };
  }, [layout, focusRoomKey]);

  const center: [number, number, number] = [layout.width / 2, 0, layout.depth / 2];
  const span = Math.max(layout.width, layout.depth);

  return (
    <Canvas
      shadows={q.shadows ? 'soft' : false}
      dpr={q.dpr}
      camera={{ fov: CAMERA_FOV, position: [60, 60, 60], near: 0.5, far: 400 }}
      gl={{ antialias: q.antialias, powerPreference: 'high-performance' }}
      onPointerMissed={() => select(null)}
      aria-label="Escritório 3D da agência"
      data-quality={level}
    >
      <ThemeAnimator hemi={hemiRef} sun={sunRef} ambient={ambientRef} />
      {qualitySetting === 'auto' && (
        <PerformanceMonitor
          flipflops={3}
          onDecline={() => setAutoLevel((l) => (l === 'high' ? 'medium' : 'low'))}
          onFallback={() => setAutoLevel('low')}
        />
      )}

      {/* Cores/intensidades iniciais do tema claro; o ThemeAnimator interpola conforme o tema */}
      <hemisphereLight ref={hemiRef} args={[SCENE_PALETTES.light.sky, SCENE_PALETTES.light.groundLight, SCENE_PALETTES.light.hemiIntensity]} />
      <ambientLight ref={ambientRef} color={SCENE_PALETTES.light.ambient} intensity={SCENE_PALETTES.light.ambientIntensity} />
      <directionalLight
        key={`sun-${q.shadowMap}`}
        ref={sunRef}
        position={[center[0] + 18, 30, center[2] + 12]}
        intensity={SCENE_PALETTES.light.sunIntensity}
        castShadow={q.shadows}
        shadow-mapSize={[q.shadowMap, q.shadowMap]}
        shadow-camera-left={-span * 0.7}
        shadow-camera-right={span * 0.7}
        shadow-camera-top={span * 0.7}
        shadow-camera-bottom={-span * 0.7}
        shadow-camera-near={1}
        shadow-camera-far={90}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      >
        <object3D attach="target" position={center} />
      </directionalLight>

      <CameraRig layout={layout} focus={focus} focusNonce={focusNonce} />
      <SimulationDriver sim={sim} layout={layout} onScreens={setScreenStates} />

      <Floors layout={layout} onFloorClick={() => select(null)} onRoomDoubleClick={(room: RoomDef) => focusRoom(room.key)} />
      <Walls layout={layout} height={WALL_HEIGHTS[wallMode]} shadows={q.shadows} />
      <Furniture objects={layout.objects} shadows={q.shadows} />
      <MonitorScreens monitors={monitors} states={screenStates} />
      <LabelProjector />

      {list.map((e) => (
        <Avatar
          key={e.id}
          employee={e}
          sim={sim}
          activity={activities.get(e.id)!}
          selected={selectedId === e.id}
          onSelect={select}
        />
      ))}
    </Canvas>
  );
}
