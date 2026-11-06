'use client';

import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Camada de rótulos HTML projetados sobre a cena 3D.
 * Um único overlay DOM (fora do Canvas) cujos elementos são posicionados a
 * cada quadro via `transform`, sem re-render do React.
 */

type Target = (out: THREE.Vector3) => boolean;

const targets = new Map<string, Target>();
const elements = new Map<string, HTMLElement>();

export function setLabelTarget(id: string, target: Target | null) {
  if (target) targets.set(id, target);
  else targets.delete(id);
}

export function labelRef(id: string) {
  return (el: HTMLElement | null) => {
    if (el) elements.set(id, el);
    else elements.delete(id);
  };
}

export function fixedTarget(x: number, y: number, z: number): Target {
  return (out) => {
    out.set(x, y, z);
    return true;
  };
}

const v = new THREE.Vector3();

/** Deve ser montado dentro do <Canvas>. */
export function LabelProjector() {
  const { camera, size } = useThree();
  useFrame(() => {
    for (const [id, el] of elements) {
      const target = targets.get(id);
      if (!target || !target(v)) {
        el.style.visibility = 'hidden';
        continue;
      }
      v.project(camera);
      // Atrás da câmera (perspectiva) ou fora da tela => oculto.
      const offscreen = v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2;
      el.style.visibility = offscreen ? 'hidden' : 'visible';
      if (offscreen) continue;
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  });
  return null;
}
