'use client';

import type { OfficeLayout } from '@agency/core';
import { MapControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { prefersReducedMotion } from '@/lib/theme';

/** Subconjunto da API do MapControls (three-stdlib) usado aqui. */
interface MapControlsImpl extends THREE.EventDispatcher<{ start: object; change: object; end: object }> {
  target: THREE.Vector3;
  update(): void;
}

/** Ângulo polar da vista isométrica (≈ 54,7° a partir da vertical). */
export const ISO_POLAR = Math.atan(Math.SQRT2);
const DISTANCE = 60;
const MIN_ZOOM = 5;
const MAX_ZOOM = 160;

/** Área da tela ocupada pelo HUD (px), para enquadrar o escritório no espaço livre. */
function hudInsets(width: number) {
  return width >= 640 ? { left: 270, right: 0, top: 70, bottom: 0 } : { left: 0, right: 0, top: 130, bottom: 60 };
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface Props {
  layout: OfficeLayout;
  /** Área a enquadrar (sala ou escritório inteiro). Muda => anima a câmera. */
  focus: Bounds;
  focusNonce: number;
  /** Incrementado para girar 90° (sinal = sentido). */
  rotateRequest: { nonce: number; dir: 1 | -1 };
  /** Ponto a seguir (funcionário selecionado), opcional. */
  follow?: () => [number, number] | null;
}

/**
 * Câmera ortográfica isométrica com zoom, pan, rotação controlada (somente
 * azimute) e transições suaves para enquadrar salas.
 */
export function CameraRig({ layout, focus, focusNonce, rotateRequest, follow }: Props) {
  const controls = useRef<MapControlsImpl>(null);
  const { camera, size } = useThree();
  const anim = useRef<{ target: THREE.Vector3; zoom: number; azimuth: number; active: boolean }>({
    target: new THREE.Vector3(),
    zoom: 40,
    azimuth: Math.PI / 4,
    active: false,
  });
  const initialized = useRef(false);

  const axes = (azimuth: number) => {
    const dir = new THREE.Vector3().setFromSphericalCoords(1, ISO_POLAR, azimuth).negate();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    return { right, up };
  };

  /** Zoom e alvo que enquadram `b` na área livre da tela (descontando o HUD). */
  const frame = (b: Bounds, azimuth: number) => {
    const { right, up } = axes(azimuth);
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    let w = 0;
    let h = 0;
    for (const x of [b.minX, b.maxX])
      for (const z of [b.minZ, b.maxZ])
        for (const y of [0, 2]) {
          const p = new THREE.Vector3(x - cx, y, z - cz);
          w = Math.max(w, Math.abs(p.dot(right)) * 2);
          h = Math.max(h, Math.abs(p.dot(up)) * 2);
        }
    const inset = hudInsets(size.width);
    const freeW = Math.max(200, size.width - inset.left - inset.right);
    const freeH = Math.max(200, size.height - inset.top - inset.bottom);
    const zoom = THREE.MathUtils.clamp(Math.min(freeW / (w * 1.08), freeH / (h * 1.12)), MIN_ZOOM, MAX_ZOOM);
    // Desloca o alvo no plano do chão para centralizar na área livre.
    const dx = (inset.left - inset.right) / 2 / zoom;
    const dy = (inset.top - inset.bottom) / 2 / zoom;
    const forward = new THREE.Vector3(up.x, 0, up.z).normalize();
    const target = new THREE.Vector3(cx, 0, cz)
      .addScaledVector(right, -dx)
      .addScaledVector(forward, dy / Math.max(0.2, forward.dot(up)));
    return { zoom, target };
  };

  const currentAzimuth = () => {
    const c = controls.current;
    if (!c) return anim.current.azimuth;
    const off = camera.position.clone().sub(c.target);
    return Math.atan2(off.x, off.z);
  };

  // Enquadramento (inicial e ao mudar o foco)
  useEffect(() => {
    const az = initialized.current ? currentAzimuth() : Math.PI / 4;
    const { target, zoom } = frame(focus, az);
    if (!initialized.current && controls.current) {
      initialized.current = true;
      controls.current.target.copy(target);
      camera.position.copy(target).add(new THREE.Vector3().setFromSphericalCoords(DISTANCE, ISO_POLAR, az));
      (camera as THREE.OrthographicCamera).zoom = zoom;
      camera.updateProjectionMatrix();
      controls.current.update();
      anim.current = { target, zoom, azimuth: az, active: false };
      return;
    }
    anim.current = { target, zoom, azimuth: az, active: true };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce, focus.minX, focus.maxX, focus.minZ, focus.maxZ, size.width, size.height]);

  // Rotação em passos de 90°
  useEffect(() => {
    if (rotateRequest.nonce === 0) return;
    const c = controls.current;
    anim.current = {
      target: c ? c.target.clone() : anim.current.target,
      zoom: (camera as THREE.OrthographicCamera).zoom,
      azimuth: currentAzimuth() + (rotateRequest.dir * Math.PI) / 2,
      active: true,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotateRequest.nonce]);

  // Interação do usuário cancela animações.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const stop = () => {
      anim.current.active = false;
    };
    c.addEventListener('start', stop);
    return () => c.removeEventListener('start', stop);
  }, []);

  useFrame((_, rawDt) => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(rawDt, 0.1);
    const ortho = camera as THREE.OrthographicCamera;

    const followed = follow?.();
    if (followed && !anim.current.active) {
      const desired = new THREE.Vector3(followed[0], 0, followed[1]);
      const delta = desired.sub(c.target).multiplyScalar(Math.min(1, dt * 3));
      c.target.add(delta);
      camera.position.add(delta);
    }

    if (anim.current.active) {
      // Com movimento reduzido, a câmera salta direto ao destino.
      const k = prefersReducedMotion() ? 1 : 1 - Math.exp(-dt * 6);
      const a = anim.current;
      c.target.lerp(a.target, k);
      ortho.zoom += (a.zoom - ortho.zoom) * k;
      let az = currentAzimuth();
      let d = a.azimuth - az;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      az += d * k;
      camera.position.copy(c.target).add(new THREE.Vector3().setFromSphericalCoords(DISTANCE, ISO_POLAR, az));
      ortho.updateProjectionMatrix();
      if (c.target.distanceTo(a.target) < 0.01 && Math.abs(a.zoom - ortho.zoom) < 0.05 && Math.abs(d) < 0.002) {
        a.active = false;
      }
    }

    // Mantém o alvo dentro do prédio (com folga).
    const clamped = c.target.clone();
    clamped.x = THREE.MathUtils.clamp(clamped.x, -2, layout.width + 2);
    clamped.z = THREE.MathUtils.clamp(clamped.z, -2, layout.depth + 2);
    clamped.y = 0;
    if (!clamped.equals(c.target)) {
      camera.position.add(clamped.clone().sub(c.target));
      c.target.copy(clamped);
    }
    c.update();
  });

  return (
    <MapControls
      ref={controls as never}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      screenSpacePanning={false}
      minPolarAngle={ISO_POLAR}
      maxPolarAngle={ISO_POLAR}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      zoomToCursor
    />
  );
}
