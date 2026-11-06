'use client';

import { OBJECT_TYPES, type ObjectDef, type ObjectType } from '@agency/core';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { getGeometry, getMaterial } from './geometry';
import { MODELS, MONITOR_BACK_LIGHT, MONITOR_SCREEN, SCREEN_BLOCKED, SCREEN_OFF, SCREEN_ON, type Part } from './models';

const tmpObj = new THREE.Object3D();
const tmpPart = new THREE.Matrix4();
const tmpColor = new THREE.Color();

function objectMatrix(o: ObjectDef): THREE.Matrix4 {
  tmpObj.position.set(o.position[0], 0, o.position[1]);
  tmpObj.rotation.set(0, o.rotation, 0);
  tmpObj.scale.set(1, 1, 1);
  tmpObj.updateMatrix();
  return tmpObj.matrix.clone();
}

function partMatrix(p: Part): THREE.Matrix4 {
  tmpObj.position.set(...p.position);
  tmpObj.rotation.set(...(p.rotation ?? [0, 0, 0]));
  tmpObj.scale.set(1, 1, 1);
  tmpObj.updateMatrix();
  return tmpPart.copy(tmpObj.matrix);
}

/** Uma peça de um tipo de móvel, instanciada para todos os objetos daquele tipo. */
function InstancedPart({ part, objects, shadows }: { part: Part; objects: ObjectDef[]; shadows: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const usesProp = part.color.startsWith('prop:');
  const geometry = getGeometry(part.geometry);
  const material = usesProp ? getMaterial('#ffffff') : getMaterial(part.color, { emissive: !!part.emissive });

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const local = partMatrix(part).clone();
    objects.forEach((o, i) => {
      mesh.setMatrixAt(i, objectMatrix(o).multiply(local));
      if (usesProp) {
        const prop = part.color.slice(5);
        const value = o.props?.[prop];
        mesh.setColorAt(i, tmpColor.set(typeof value === 'string' ? value : (part.fallbackColor ?? '#cccccc')));
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [objects, part, usesProp]);

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, objects.length]}
      castShadow={shadows && !!part.castShadow}
      receiveShadow={!part.emissive}
    />
  );
}

/**
 * Renderiza todos os móveis do layout agrupados por tipo
 * (draw calls ≈ nº de peças distintas, independente da quantidade de móveis).
 */
export function Furniture({ objects, shadows }: { objects: ObjectDef[]; shadows: boolean }) {
  const byType = useMemo(() => {
    const map = new Map<ObjectType, ObjectDef[]>();
    for (const t of OBJECT_TYPES) map.set(t, []);
    for (const o of objects) map.get(o.type)?.push(o);
    return map;
  }, [objects]);

  return (
    <group>
      {[...byType.entries()]
        .filter(([, list]) => list.length > 0)
        .map(([type, list]) =>
          MODELS[type].map((part, i) => <InstancedPart key={`${type}-${i}-${list.length}`} part={part} objects={list} shadows={shadows} />),
        )}
    </group>
  );
}

export type ScreenState = 'off' | 'on' | 'blocked';

/**
 * Telas dos monitores: ligadas SOMENTE quando o dono da mesa está de fato
 * trabalhando (estado vindo do backend).
 */
export function MonitorScreens({ monitors, states }: { monitors: ObjectDef[]; states: Record<string, ScreenState> }) {
  if (monitors.length === 0) return null;
  return (
    <group>
      <ScreenLayer key={`s${monitors.length}`} part={MONITOR_SCREEN} monitors={monitors} states={states} />
      <ScreenLayer key={`b${monitors.length}`} part={MONITOR_BACK_LIGHT} monitors={monitors} states={states} />
    </group>
  );
}

function ScreenLayer({ part, monitors, states }: { part: Part; monitors: ObjectDef[]; states: Record<string, ScreenState> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = getGeometry(part.geometry);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const local = partMatrix(part).clone();
    monitors.forEach((o, i) => mesh.setMatrixAt(i, objectMatrix(o).multiply(local)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [monitors, part]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    monitors.forEach((o, i) => {
      const s = states[o.key] ?? 'off';
      mesh.setColorAt(i, tmpColor.set(s === 'on' ? SCREEN_ON : s === 'blocked' ? SCREEN_BLOCKED : SCREEN_OFF));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [monitors, states]);

  return <instancedMesh ref={ref} args={[geometry, material, monitors.length]} />;
}
