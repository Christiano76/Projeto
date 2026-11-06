'use client';

import {
  STATUS_COLORS,
  findPath,
  type Anchor,
  type Employee,
  type NavGrid,
  type Pose,
  type Vec2,
  type VisualActivity,
} from '@agency/core';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { prefersReducedMotion } from '@/lib/theme';
import { getMaterial } from './geometry';
import { setLabelTarget } from './labels';

/**
 * Avatar de um funcionário. Movimento e pose são DERIVADOS do estado real
 * (`activity` + `anchor`, calculados a partir dos eventos do backend).
 * Toda animação acontece em refs, sem re-render do React por quadro.
 */

const WALK_SPEED = 1.6; // m/s
const HIP = 0.7;
const TURN_RATE = 10;

type Phase = 'walking' | 'settled' | 'hidden';

interface Motion {
  pos: [number, number];
  heading: number;
  path: Vec2[];
  idx: number;
  phase: Phase;
  anchorKey: string;
  t: number;
}

interface Props {
  employee: Employee;
  anchor: Anchor;
  entrance: Anchor;
  activity: VisualActivity;
  grid: NavGrid;
  selected: boolean;
  onSelect: (id: string) => void;
}

const sphereGeo = new THREE.IcosahedronGeometry(1, 1);
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const torsoGeo = new THREE.CylinderGeometry(0.17, 0.2, 0.48, 7);
const ringGeo = new THREE.RingGeometry(0.32, 0.42, 20);
const starGeo = new THREE.OctahedronGeometry(0.12, 0);
const frustum = new THREE.Frustum();
const projScreen = new THREE.Matrix4();
const sphere = new THREE.Sphere(new THREE.Vector3(), 1.2);

function angleLerp(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}

function AvatarImpl({ employee, anchor, entrance, activity, grid, selected, onSelect }: Props) {
  const away = activity.placement === 'away';
  const motion = useRef<Motion>({
    pos: away ? [entrance.position[0], entrance.position[1]] : [anchor.position[0], anchor.position[1]],
    heading: away ? entrance.facing : anchor.facing,
    path: [],
    idx: 0,
    phase: away ? 'hidden' : 'settled',
    anchorKey: anchor.key,
    t: Math.random() * 10,
  });

  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const thighL = useRef<THREE.Group>(null);
  const thighR = useRef<THREE.Group>(null);
  const kneeL = useRef<THREE.Group>(null);
  const kneeR = useRef<THREE.Group>(null);
  const badge = useRef<THREE.Group>(null);

  // Posição do rótulo HTML acompanha o avatar (somente quando visível).
  useEffect(() => {
    setLabelTarget(`emp:${employee.id}`, (out) => {
      const g = root.current;
      if (!g || !g.visible) return false;
      out.set(g.position.x, 2.2, g.position.z);
      return true;
    });
    return () => setLabelTarget(`emp:${employee.id}`, null);
  }, [employee.id]);

  // Novo destino => calcula caminho real pela planta (A*).
  useEffect(() => {
    const m = motion.current;
    const destination = away ? entrance : anchor;
    if (m.anchorKey === destination.key && m.phase !== 'hidden') return;
    if (m.phase === 'hidden') {
      if (away) return;
      m.pos = [entrance.position[0], entrance.position[1]];
    }
    const path = findPath(grid, m.pos, destination.position);
    m.anchorKey = destination.key;
    if (!path || path.length < 2) {
      m.pos = [destination.position[0], destination.position[1]];
      m.phase = away ? 'hidden' : 'settled';
      return;
    }
    m.path = path;
    m.idx = 1;
    m.phase = 'walking';
  }, [anchor, entrance, away, grid]);

  const mats = useMemo(
    () => ({
      skin: getMaterial(employee.avatar.skin),
      hair: getMaterial(employee.avatar.hair),
      shirt: getMaterial(employee.avatar.shirt),
      pants: getMaterial(employee.avatar.pants),
      shoes: getMaterial('#1f2937'),
      eyes: getMaterial('#0f172a'),
      accessory: getMaterial(employee.avatar.accessory === 'headset' ? '#111827' : '#334155'),
    }),
    [employee.avatar],
  );
  const statusColor = STATUS_COLORS[employee.runtime.status];
  const ringMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: statusColor, transparent: true, opacity: 0.85, toneMapped: false }),
    [statusColor],
  );
  const pulseMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: statusColor, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }),
    [statusColor],
  );
  const pulse = useRef<THREE.Mesh>(null);
  /** Indicador animado de atividade: só pulsa quando há trabalho/colaboração real. */
  const pulsing = employee.runtime.status === 'working' || employee.runtime.status === 'meeting';
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  useFrame((state, rawDt) => {
    const m = motion.current;
    const g = root.current;
    if (!g) return;
    // Limite generoso: em FPS baixo o avatar ainda chega no tempo certo.
    const dt = Math.min(rawDt, 0.25);
    m.t += dt;

    // ── Deslocamento ────────────────────────────────────────────────
    if (m.phase === 'walking') {
      let remaining = WALK_SPEED * dt;
      while (remaining > 0 && m.idx < m.path.length) {
        const target = m.path[m.idx]!;
        const dx = target[0] - m.pos[0];
        const dz = target[1] - m.pos[1];
        const dist = Math.hypot(dx, dz);
        if (dist > 1e-4) m.heading = angleLerp(m.heading, Math.atan2(dx, dz), TURN_RATE * dt);
        if (dist <= remaining) {
          m.pos = [target[0], target[1]];
          m.idx++;
          remaining -= dist;
        } else {
          m.pos = [m.pos[0] + (dx / dist) * remaining, m.pos[1] + (dz / dist) * remaining];
          remaining = 0;
        }
      }
      if (m.idx >= m.path.length) m.phase = away ? 'hidden' : 'settled';
    } else if (m.phase === 'settled') {
      m.heading = angleLerp(m.heading, anchor.facing, TURN_RATE * 0.6 * dt);
    }

    g.visible = m.phase !== 'hidden';
    g.position.set(m.pos[0], 0, m.pos[1]);
    g.rotation.y = m.heading;
    if (!g.visible) return;

    // ── Animação (pulada fora da tela) ──────────────────────────────
    projScreen.multiplyMatrices(state.camera.projectionMatrix, state.camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    sphere.center.set(m.pos[0], 0.8, m.pos[1]);
    if (!frustum.intersectsSphere(sphere)) return;

    const seated = m.phase === 'settled' && anchor.seatHeight > 0;
    let pose: Pose | 'walk' = m.phase === 'walking' ? 'walk' : activity.pose;
    if (!seated && pose.startsWith('sit_')) pose = 'stand_idle';
    animatePose(pose, m.t, seated ? anchor.seatHeight : 0, {
      body: body.current!,
      torso: torso.current!,
      head: head.current!,
      armL: armL.current!,
      armR: armR.current!,
      thighL: thighL.current!,
      thighR: thighR.current!,
      kneeL: kneeL.current!,
      kneeR: kneeR.current!,
    });
    if (pulse.current) {
      const on = pulsing && !reducedMotion;
      pulse.current.visible = on;
      if (on) {
        const p = (m.t * 0.7) % 1;
        pulse.current.scale.setScalar(1 + p * 0.9);
        pulseMat.opacity = 0.55 * (1 - p);
      }
    }
    if (badge.current) {
      badge.current.rotation.y += dt * 2;
      badge.current.position.y = (seated ? anchor.seatHeight - HIP : 0) + 1.95 + Math.sin(m.t * 3) * 0.04;
    }
  });

  const { hairStyle, accessory } = employee.avatar;

  return (
    <group
      ref={root}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onSelect(employee.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = '';
      }}
    >
      {/* Anel de status no chão: cor = status operacional real */}
      <mesh geometry={ringGeo} material={ringMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} scale={selected ? 1.35 : 1} />
      <mesh ref={pulse} geometry={ringGeo} material={pulseMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} visible={false} />

      <group ref={body}>
        {/* Pernas */}
        {([
          [thighL, kneeL, -0.1],
          [thighR, kneeR, 0.1],
        ] as const).map(([thigh, knee, x]) => (
          <group key={x} ref={thigh} position={[x, HIP, 0]}>
            <mesh geometry={boxGeo} material={mats.pants} position={[0, -0.16, 0]} scale={[0.13, 0.32, 0.14]} castShadow />
            <group ref={knee} position={[0, -0.32, 0]}>
              <mesh geometry={boxGeo} material={mats.pants} position={[0, -0.17, 0]} scale={[0.12, 0.34, 0.13]} castShadow />
              <mesh geometry={boxGeo} material={mats.shoes} position={[0, -0.355, 0.04]} scale={[0.13, 0.06, 0.22]} />
            </group>
          </group>
        ))}

        <group ref={torso} position={[0, HIP, 0]}>
          <mesh geometry={boxGeo} material={mats.pants} position={[0, 0.03, 0]} scale={[0.34, 0.1, 0.2]} />
          <mesh geometry={torsoGeo} material={mats.shirt} position={[0, 0.27, 0]} castShadow />
          {/* Braços */}
          {([
            [armL, -0.24],
            [armR, 0.24],
          ] as const).map(([arm, x]) => (
            <group key={x} ref={arm} position={[x, 0.44, 0]}>
              <mesh geometry={boxGeo} material={mats.shirt} position={[0, -0.2, 0]} scale={[0.1, 0.42, 0.1]} castShadow />
              <mesh geometry={sphereGeo} material={mats.skin} position={[0, -0.44, 0]} scale={0.055} />
            </group>
          ))}
          {/* Cabeça */}
          <group ref={head} position={[0, 0.52, 0]}>
            <mesh geometry={sphereGeo} material={mats.skin} position={[0, 0.17, 0]} scale={0.19} castShadow />
            <mesh geometry={boxGeo} material={mats.eyes} position={[-0.065, 0.19, 0.17]} scale={[0.035, 0.045, 0.02]} />
            <mesh geometry={boxGeo} material={mats.eyes} position={[0.065, 0.19, 0.17]} scale={[0.035, 0.045, 0.02]} />
            <Hair style={hairStyle} material={mats.hair} />
            {accessory === 'glasses' && (
              <mesh geometry={boxGeo} material={mats.accessory} position={[0, 0.19, 0.185]} scale={[0.24, 0.05, 0.015]} />
            )}
            {accessory === 'headset' && (
              <>
                <mesh geometry={boxGeo} material={mats.accessory} position={[0, 0.37, 0]} scale={[0.4, 0.03, 0.05]} />
                <mesh geometry={boxGeo} material={mats.accessory} position={[-0.2, 0.17, 0]} scale={[0.04, 0.12, 0.1]} />
                <mesh geometry={boxGeo} material={mats.accessory} position={[0.2, 0.17, 0]} scale={[0.04, 0.12, 0.1]} />
              </>
            )}
          </group>
        </group>
      </group>

      {activity.badge && (
        <group ref={badge}>
          {activity.badge === 'task_done' ? (
            <mesh geometry={starGeo} material={getMaterial('#facc15', { emissive: true })} />
          ) : (
            <>
              <mesh
                geometry={boxGeo}
                material={getMaterial(activity.badge === 'error' ? '#ef4444' : '#f97316', { emissive: true })}
                position={[0, 0.08, 0]}
                scale={[0.06, 0.18, 0.06]}
              />
              <mesh
                geometry={boxGeo}
                material={getMaterial(activity.badge === 'error' ? '#ef4444' : '#f97316', { emissive: true })}
                position={[0, -0.08, 0]}
                scale={0.06}
              />
            </>
          )}
        </group>
      )}

    </group>
  );
}

function Hair({ style, material }: { style: Employee['avatar']['hairStyle']; material: THREE.Material }) {
  switch (style) {
    case 'bald':
      return null;
    case 'short':
      return <mesh geometry={sphereGeo} material={material} position={[0, 0.24, -0.02]} scale={[0.2, 0.14, 0.2]} />;
    case 'curly':
      return <mesh geometry={sphereGeo} material={material} position={[0, 0.26, -0.01]} scale={[0.23, 0.17, 0.23]} />;
    case 'long':
      return (
        <>
          <mesh geometry={sphereGeo} material={material} position={[0, 0.24, -0.02]} scale={[0.205, 0.15, 0.205]} />
          <mesh geometry={boxGeo} material={material} position={[0, 0.06, -0.11]} scale={[0.36, 0.36, 0.14]} />
        </>
      );
    case 'bun':
      return (
        <>
          <mesh geometry={sphereGeo} material={material} position={[0, 0.24, -0.02]} scale={[0.2, 0.14, 0.2]} />
          <mesh geometry={sphereGeo} material={material} position={[0, 0.36, -0.12]} scale={0.09} />
        </>
      );
  }
}

interface Rig {
  body: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  thighL: THREE.Group;
  thighR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
}

/** Animação procedural de cada pose (sem esqueleto/arquivos de animação). */
function animatePose(pose: Pose | 'walk', t: number, seatHeight: number, r: Rig) {
  const seated = seatHeight > 0;
  r.body.position.set(0, seated ? seatHeight - HIP : 0, seated ? -0.06 : 0);
  r.torso.rotation.set(0, 0, 0);
  r.head.rotation.set(0, 0, 0);
  r.armL.rotation.set(0, 0, 0);
  r.armR.rotation.set(0, 0, 0);

  if (seated) {
    r.thighL.rotation.set(-Math.PI / 2, 0, 0);
    r.thighR.rotation.set(-Math.PI / 2, 0, 0);
    r.kneeL.rotation.set(Math.PI / 2, 0, 0);
    r.kneeR.rotation.set(Math.PI / 2, 0, 0);
  } else {
    r.thighL.rotation.set(0, 0, 0);
    r.thighR.rotation.set(0, 0, 0);
    r.kneeL.rotation.set(0, 0, 0);
    r.kneeR.rotation.set(0, 0, 0);
  }

  switch (pose) {
    case 'walk': {
      const s = Math.sin(t * 9);
      r.thighL.rotation.x = s * 0.5;
      r.thighR.rotation.x = -s * 0.5;
      r.kneeL.rotation.x = Math.max(0, -s) * 0.7;
      r.kneeR.rotation.x = Math.max(0, s) * 0.7;
      r.armL.rotation.x = -s * 0.45;
      r.armR.rotation.x = s * 0.45;
      r.body.position.y = Math.abs(Math.cos(t * 9)) * 0.04;
      break;
    }
    case 'sit_typing': {
      r.torso.rotation.x = 0.08;
      r.armL.rotation.x = -1.25 + Math.sin(t * 17) * 0.06;
      r.armR.rotation.x = -1.25 + Math.sin(t * 17 + 1.7) * 0.06;
      r.armL.rotation.z = -0.15;
      r.armR.rotation.z = 0.15;
      r.head.rotation.x = 0.1 + Math.sin(t * 1.3) * 0.03;
      break;
    }
    case 'sit_idle': {
      r.armL.rotation.x = -0.45;
      r.armR.rotation.x = -0.45;
      r.head.rotation.y = Math.sin(t * 0.5) * 0.35;
      break;
    }
    case 'sit_talking': {
      r.armL.rotation.x = -0.6;
      r.armR.rotation.x = -0.8 + Math.sin(t * 3) * 0.3;
      r.armR.rotation.z = 0.2;
      r.head.rotation.x = Math.sin(t * 2.2) * 0.12;
      r.head.rotation.y = Math.sin(t * 0.7) * 0.25;
      break;
    }
    case 'sit_relax': {
      r.torso.rotation.x = -0.18;
      r.armL.rotation.set(-0.3, 0, -0.35);
      r.armR.rotation.set(-0.3, 0, 0.35);
      r.head.rotation.x = -0.1;
      break;
    }
    case 'stand_idle': {
      r.torso.rotation.x = Math.sin(t * 1.5) * 0.015;
      r.armL.rotation.z = -0.06;
      r.armR.rotation.z = 0.06;
      r.head.rotation.y = Math.sin(t * 0.4) * 0.3;
      break;
    }
    case 'celebrate': {
      r.body.position.y += Math.abs(Math.sin(t * 6)) * 0.12;
      r.armL.rotation.set(-2.9 + Math.sin(t * 12) * 0.15, 0, -0.3);
      r.armR.rotation.set(-2.9 - Math.sin(t * 12) * 0.15, 0, 0.3);
      r.head.rotation.x = -0.2;
      break;
    }
  }
}

export const Avatar = memo(AvatarImpl);
