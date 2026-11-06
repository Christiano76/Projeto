'use client';

import { STATUS_COLORS, type Employee, type OfficeSimulation, type Pose, type SimAgent, type VisualActivity } from '@agency/core';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { prefersReducedMotion } from '@/lib/theme';
import { getMaterial } from './geometry';
import { setLabelTarget } from './labels';

/**
 * Avatar de um funcionário.
 *
 * Posição e orientação vêm da simulação (`OfficeSimulation`), que por sua vez
 * segue o estado real. Aqui só se anima o corpo: as articulações perseguem a
 * pose-alvo com amortecimento, então todas as transições (sentar, levantar,
 * começar a andar, parar, conversar) são suaves — sem saltos.
 */

const HIP = 0.7;

interface Props {
  employee: Employee;
  sim: OfficeSimulation;
  activity: VisualActivity;
  selected: boolean;
  onSelect: (id: string) => void;
}

const sphereGeo = new THREE.IcosahedronGeometry(1, 1);
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const torsoGeo = new THREE.CylinderGeometry(0.17, 0.2, 0.48, 7);
const ringGeo = new THREE.RingGeometry(0.32, 0.42, 24);
const starGeo = new THREE.OctahedronGeometry(0.12, 0);
const frustum = new THREE.Frustum();
const projScreen = new THREE.Matrix4();
const sphere = new THREE.Sphere(new THREE.Vector3(), 1.2);

/** Ângulos das articulações (rad) e deslocamentos do corpo (m). */
interface Joints {
  bodyY: number;
  bodyZ: number;
  torsoX: number;
  torsoZ: number;
  headX: number;
  headY: number;
  headZ: number;
  armLX: number;
  armLZ: number;
  armRX: number;
  armRZ: number;
  elbowL: number;
  elbowR: number;
  thighL: number;
  thighR: number;
  kneeL: number;
  kneeR: number;
}

const ZERO: Joints = {
  bodyY: 0,
  bodyZ: 0,
  torsoX: 0,
  torsoZ: 0,
  headX: 0,
  headY: 0,
  headZ: 0,
  armLX: 0,
  armLZ: -0.06,
  armRX: 0,
  armRZ: 0.06,
  elbowL: 0,
  elbowR: 0,
  thighL: 0,
  thighR: 0,
  kneeL: 0,
  kneeR: 0,
};

function AvatarImpl({ employee, sim, activity, selected, onSelect }: Props) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const foreL = useRef<THREE.Group>(null);
  const foreR = useRef<THREE.Group>(null);
  const thighL = useRef<THREE.Group>(null);
  const thighR = useRef<THREE.Group>(null);
  const kneeL = useRef<THREE.Group>(null);
  const kneeR = useRef<THREE.Group>(null);
  const badge = useRef<THREE.Group>(null);
  const tablet = useRef<THREE.Mesh>(null);
  const pulse = useRef<THREE.Mesh>(null);
  const joints = useRef<Joints>({ ...ZERO });
  const clock = useRef(Math.random() * 10);
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  // Rótulo HTML acompanha o avatar (somente quando visível).
  useEffect(() => {
    setLabelTarget(`emp:${employee.id}`, (out) => {
      const g = root.current;
      if (!g || !g.visible) return false;
      out.set(g.position.x, 2.2 + (body.current?.position.y ?? 0), g.position.z);
      return true;
    });
    return () => setLabelTarget(`emp:${employee.id}`, null);
  }, [employee.id]);

  const mats = useMemo(
    () => ({
      skin: getMaterial(employee.avatar.skin),
      hair: getMaterial(employee.avatar.hair),
      shirt: getMaterial(employee.avatar.shirt),
      pants: getMaterial(employee.avatar.pants),
      shoes: getMaterial('#1f2937'),
      eyes: getMaterial('#0f172a'),
      accessory: getMaterial(employee.avatar.accessory === 'headset' ? '#111827' : '#334155'),
      tablet: getMaterial('#7dd3fc', { emissive: true }),
    }),
    [employee.avatar],
  );
  const statusColor = STATUS_COLORS[employee.runtime.status];
  const ringMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: statusColor, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false }),
    [statusColor],
  );
  const pulseMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: statusColor, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }),
    [statusColor],
  );
  // Libera materiais antigos ao trocar de cor (evita vazamento de memória).
  useEffect(() => () => ringMat.dispose(), [ringMat]);
  useEffect(() => () => pulseMat.dispose(), [pulseMat]);

  /** Indicador de atividade: só pulsa com trabalho/colaboração reais. */
  const pulsing = employee.runtime.status === 'working' || employee.runtime.status === 'meeting';

  useFrame((state, rawDt) => {
    const g = root.current;
    const agent = sim.agents.get(employee.id);
    if (!g || !agent) return;
    const dt = Math.min(rawDt, 0.1);
    clock.current += dt;

    const visible = agent.phase !== 'hidden' && agent.phase !== 'entering';
    g.visible = visible;
    if (!visible) return;
    g.position.set(agent.pos[0], 0, agent.pos[1]);
    g.rotation.y = agent.heading;

    // Animações só para quem está na tela.
    projScreen.multiplyMatrices(state.camera.projectionMatrix, state.camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    sphere.center.set(agent.pos[0], 0.8, agent.pos[1]);
    if (!frustum.intersectsSphere(sphere)) return;

    const target = poseTarget(agent, employee, activity, clock.current);
    const j = joints.current;
    const k = 1 - Math.exp(-dt * 11);
    (Object.keys(j) as (keyof Joints)[]).forEach((key) => {
      j[key] += (target[key] - j[key]) * k;
    });
    // Pernas na caminhada seguem a passada diretamente (sem "patinar").
    if (agent.phase === 'walking' && agent.sit === 0) {
      j.thighL = target.thighL;
      j.thighR = target.thighR;
      j.kneeL = target.kneeL;
      j.kneeR = target.kneeR;
    }
    applyJoints(j, {
      body: body.current!,
      torso: torso.current!,
      head: head.current!,
      armL: armL.current!,
      armR: armR.current!,
      foreL: foreL.current!,
      foreR: foreR.current!,
      thighL: thighL.current!,
      thighR: thighR.current!,
      kneeL: kneeL.current!,
      kneeR: kneeR.current!,
    });

    if (tablet.current) tablet.current.visible = employee.isManager && agent.sit < 0.5 && agent.goal?.interaction === 'inspect';
    if (pulse.current) {
      const on = pulsing && !reducedMotion;
      pulse.current.visible = on;
      if (on) {
        const p = (clock.current * 0.7) % 1;
        pulse.current.scale.setScalar(1 + p * 0.9);
        pulseMat.opacity = 0.55 * (1 - p);
      }
    }
    if (badge.current) {
      badge.current.rotation.y += dt * 2;
      badge.current.position.y = j.bodyY + 1.95 + Math.sin(clock.current * 3) * 0.04;
    }
  });

  const { hairStyle, accessory } = employee.avatar;

  return (
    <group
      ref={root}
      visible={false}
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
      <mesh geometry={ringGeo} material={ringMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} scale={selected ? 1.35 : 1} renderOrder={1} />
      <mesh ref={pulse} geometry={ringGeo} material={pulseMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} visible={false} renderOrder={1} />

      <group ref={body}>
        {/* Pernas: coxa → joelho → canela + sapato (sola exatamente em y=0) */}
        {([
          [thighL, kneeL, -0.1],
          [thighR, kneeR, 0.1],
        ] as const).map(([thigh, knee, x]) => (
          <group key={x} ref={thigh} position={[x, HIP, 0]}>
            <mesh geometry={boxGeo} material={mats.pants} position={[0, -0.16, 0]} scale={[0.13, 0.32, 0.14]} castShadow />
            <group ref={knee} position={[0, -0.32, 0]}>
              <mesh geometry={boxGeo} material={mats.pants} position={[0, -0.16, 0]} scale={[0.12, 0.32, 0.13]} castShadow />
              <mesh geometry={boxGeo} material={mats.shoes} position={[0, -0.35, 0.04]} scale={[0.13, 0.06, 0.22]} castShadow />
            </group>
          </group>
        ))}

        <group ref={torso} position={[0, HIP, 0]}>
          <mesh geometry={boxGeo} material={mats.pants} position={[0, 0.03, 0]} scale={[0.34, 0.1, 0.2]} />
          <mesh geometry={torsoGeo} material={mats.shirt} position={[0, 0.27, 0]} castShadow />
          {/* Braços: ombro → cotovelo */}
          {([
            [armL, foreL, -0.24],
            [armR, foreR, 0.24],
          ] as const).map(([arm, fore, x]) => (
            <group key={x} ref={arm} position={[x, 0.44, 0]}>
              <mesh geometry={boxGeo} material={mats.shirt} position={[0, -0.11, 0]} scale={[0.1, 0.24, 0.1]} castShadow />
              <group ref={fore} position={[0, -0.22, 0]}>
                <mesh geometry={boxGeo} material={mats.shirt} position={[0, -0.1, 0]} scale={[0.09, 0.2, 0.09]} />
                <mesh geometry={sphereGeo} material={mats.skin} position={[0, -0.23, 0]} scale={0.055} />
                {x > 0 && (
                  <mesh
                    ref={tablet}
                    geometry={boxGeo}
                    material={mats.tablet}
                    position={[0, -0.24, 0.06]}
                    rotation={[0.3, 0, 0]}
                    scale={[0.22, 0.015, 0.16]}
                    visible={false}
                  />
                )}
              </group>
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
                material={getMaterial(activity.badge === 'error' ? '#f43f5e' : '#f59e0b', { emissive: true })}
                position={[0, 0.08, 0]}
                scale={[0.06, 0.18, 0.06]}
              />
              <mesh
                geometry={boxGeo}
                material={getMaterial(activity.badge === 'error' ? '#f43f5e' : '#f59e0b', { emissive: true })}
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

/** Pose-alvo do quadro, a partir do estado da simulação. */
function poseTarget(agent: SimAgent, employee: Employee, activity: VisualActivity, t: number): Joints {
  const j: Joints = { ...ZERO };
  const s = agent.sit; // 0..1
  const seatH = agent.seatHeight || 0.48;

  // Base sentada (misturada pelo fator s) — vale para sentar, levantar e sentado.
  j.thighL = j.thighR = (-Math.PI / 2) * s;
  j.kneeL = j.kneeR = (Math.PI / 2) * s;
  j.bodyY = (seatH - HIP) * s;
  j.bodyZ = -0.06 * s;
  // Ao sentar/levantar o tronco inclina para frente (transferência de peso).
  const transition = Math.sin(s * Math.PI);
  if (agent.phase === 'sitting_down' || agent.phase === 'standing_up') {
    j.torsoX = 0.35 * transition;
    j.armLX = j.armRX = -0.5 * transition;
    j.headX = -0.15 * transition;
    return j;
  }

  let pose: Pose | 'walk' = agent.pose;
  if (agent.phase === 'walking') pose = agent.pose === 'wait' ? 'wait' : 'walk';
  if (agent.phase === 'arriving') pose = 'stand_idle';
  // O visitado conversa; se estiver digitando de verdade, só vira a cabeça.
  if (agent.engagedWith && pose === 'sit_typing') j.headY = 0.5;

  switch (pose) {
    case 'walk': {
      const ph = agent.gait;
      const amp = Math.min(1, agent.actual / 1.3);
      const sw = Math.sin(ph);
      j.thighL = sw * 0.55 * amp;
      j.thighR = -sw * 0.55 * amp;
      j.kneeL = Math.max(0, -Math.sin(ph - 0.6)) * 0.85 * amp;
      j.kneeR = Math.max(0, Math.sin(ph - 0.6)) * 0.85 * amp;
      j.armLX = -sw * 0.45 * amp;
      j.armRX = sw * 0.45 * amp;
      j.elbowL = j.elbowR = -0.25 * amp;
      j.bodyY = Math.abs(Math.cos(ph)) * 0.035 * amp;
      j.torsoX = 0.06 * amp;
      j.torsoZ = Math.sin(ph) * 0.03 * amp;
      j.headY = Math.sin(ph * 0.5) * 0.04;
      break;
    }
    case 'sit_typing': {
      j.torsoX = 0.1;
      j.armLX = -0.7 + Math.sin(t * 17) * 0.05;
      j.armRX = -0.7 + Math.sin(t * 17 + 1.7) * 0.05;
      j.elbowL = -0.9 + Math.sin(t * 19) * 0.08;
      j.elbowR = -0.9 + Math.sin(t * 19 + 2.1) * 0.08;
      j.armLZ = -0.12;
      j.armRZ = 0.12;
      j.headX = 0.12 + Math.sin(t * 1.3) * 0.03;
      j.headY += Math.sin(t * 0.4) * 0.05;
      break;
    }
    case 'sit_idle': {
      j.armLX = j.armRX = -0.35;
      j.elbowL = j.elbowR = -0.6;
      j.headY = Math.sin(t * 0.5) * 0.35;
      j.torsoX = -0.04 + Math.sin(t * 1.4) * 0.015;
      break;
    }
    case 'sit_talking': {
      j.armLX = -0.4;
      j.elbowL = -0.7;
      j.armRX = -0.6 + Math.sin(t * 3) * 0.25;
      j.elbowR = -0.9 + Math.sin(t * 2.3) * 0.25;
      j.armRZ = 0.2;
      j.headX = Math.sin(t * 2.2) * 0.12;
      j.headY = (agent.engagedWith ? 0.35 : 0) + Math.sin(t * 0.7) * 0.2;
      break;
    }
    case 'sit_relax': {
      j.torsoX = -0.2;
      j.armLX = -0.25;
      j.armRX = -0.25;
      j.armLZ = -0.4;
      j.armRZ = 0.4;
      j.headX = -0.12;
      j.headY = Math.sin(t * 0.3) * 0.25;
      break;
    }
    case 'stand_talk': {
      j.armLX = -0.25 + Math.sin(t * 2.1) * 0.15;
      j.elbowL = -0.5;
      j.armRX = -0.55 + Math.sin(t * 3.2) * 0.3;
      j.elbowR = -0.8 + Math.sin(t * 2.6) * 0.3;
      j.armRZ = 0.18;
      j.headX = Math.sin(t * 2.4) * 0.1;
      j.torsoZ = Math.sin(t * 0.8) * 0.03;
      break;
    }
    case 'inspect': {
      // Gerente: segura o tablet, observa a estação e anota, acenando com a cabeça.
      j.armRX = -0.85;
      j.elbowR = -0.9;
      j.armRZ = 0.12;
      j.armLX = -0.5 + Math.sin(t * 2.5) * 0.08;
      j.elbowL = -1.2;
      j.armLZ = -0.25;
      j.headX = 0.32 + Math.sin(t * 1.8) * 0.12;
      j.headZ = Math.sin(t * 0.6) * 0.08;
      j.torsoX = 0.12;
      break;
    }
    case 'wait': {
      // Esperando passagem: braços cruzados e troca de apoio.
      j.armLX = j.armRX = -0.55;
      j.elbowL = j.elbowR = -1.5;
      j.armLZ = -0.25;
      j.armRZ = 0.25;
      j.torsoZ = Math.sin(t * 1.2) * 0.04;
      j.headY = Math.sin(t * 0.9) * 0.4;
      break;
    }
    case 'celebrate': {
      j.bodyY += Math.abs(Math.sin(t * 6)) * 0.1;
      j.armLX = -2.9 + Math.sin(t * 12) * 0.15;
      j.armRX = -2.9 - Math.sin(t * 12) * 0.15;
      j.armLZ = -0.3;
      j.armRZ = 0.3;
      j.headX = -0.2;
      break;
    }
    case 'stand_idle':
    default: {
      j.torsoX = Math.sin(t * 1.5) * 0.015;
      j.headY = Math.sin(t * 0.4) * 0.3;
      j.elbowL = j.elbowR = -0.12;
    }
  }

  // Chegada: breve olhar ao redor ao parar em pé.
  if (agent.phase === 'standing' && agent.phaseTime < 1.2 && pose !== 'inspect') {
    j.headY += Math.sin(agent.phaseTime * 5) * 0.35 * (1 - agent.phaseTime / 1.2);
  }
  if (activity.badge === 'blocked' || activity.badge === 'error') {
    j.headX += 0.1;
  }
  return j;
}

interface Rig {
  body: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  foreL: THREE.Group;
  foreR: THREE.Group;
  thighL: THREE.Group;
  thighR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
}

function applyJoints(j: Joints, r: Rig) {
  r.body.position.set(0, j.bodyY, j.bodyZ);
  r.torso.rotation.set(j.torsoX, 0, j.torsoZ);
  r.head.rotation.set(j.headX, j.headY, j.headZ);
  r.armL.rotation.set(j.armLX, 0, j.armLZ);
  r.armR.rotation.set(j.armRX, 0, j.armRZ);
  r.foreL.rotation.set(j.elbowL, 0, 0);
  r.foreR.rotation.set(j.elbowR, 0, 0);
  r.thighL.rotation.set(j.thighL, 0, 0);
  r.thighR.rotation.set(j.thighR, 0, 0);
  r.kneeL.rotation.set(j.kneeL, 0, 0);
  r.kneeR.rotation.set(j.kneeR, 0, 0);
}

export const Avatar = memo(AvatarImpl);
