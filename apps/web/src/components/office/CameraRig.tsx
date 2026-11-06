'use client';

import type { OfficeLayout } from '@agency/core';
import { CameraControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import CameraControlsImpl from 'camera-controls';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { prefersReducedMotion } from '@/lib/theme';
import { simulationHost } from '@/lib/simulationHost';
import { useCameraStore } from '@/store/cameraStore';
import { useOfficeStore } from '@/store/officeStore';

/** Ângulo polar da vista isométrica clássica (≈ 54,7° a partir da vertical). */
export const ISO_POLAR = Math.atan(Math.SQRT2);
export const ISO_AZIMUTH = Math.PI / 4;
export const CAMERA_FOV = 30;
const MIN_POLAR = 0.12; // quase vista de cima
const MAX_POLAR = 1.36; // ~78°: nunca abaixo do chão
const MIN_DISTANCE = 3.5;
const MAX_DISTANCE = 95;

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Área da tela ocupada pelo HUD (px), para enquadrar o escritório no espaço livre. */
function hudInsets(width: number) {
  return width >= 640 ? { left: 270, right: 0, top: 70, bottom: 0 } : { left: 0, right: 0, top: 70, bottom: 70 };
}

/** Calcula posição/alvo que enquadram `b` na área livre da tela, para os ângulos dados. */
export function frameBounds(
  b: Bounds,
  azimuth: number,
  polar: number,
  size: { width: number; height: number },
  fovDeg = CAMERA_FOV,
): { position: THREE.Vector3; target: THREE.Vector3 } {
  const offsetDir = new THREE.Vector3().setFromSphericalCoords(1, polar, azimuth);
  const viewDir = offsetDir.clone().negate();
  const right = new THREE.Vector3().crossVectors(viewDir, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, viewDir).normalize();
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  let w = 0;
  let h = 0;
  let depth = 0;
  for (const x of [b.minX, b.maxX])
    for (const z of [b.minZ, b.maxZ])
      for (const y of [0, 2]) {
        const p = new THREE.Vector3(x - cx, y, z - cz);
        w = Math.max(w, Math.abs(p.dot(right)) * 2);
        h = Math.max(h, Math.abs(p.dot(up)) * 2);
        depth = Math.max(depth, Math.abs(p.dot(viewDir)));
      }
  const inset = hudInsets(size.width);
  const freeW = Math.max(200, size.width - inset.left - inset.right);
  const freeH = Math.max(200, size.height - inset.top - inset.bottom);
  const tanH = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
  const aspect = size.width / size.height;
  const dH = (h / 2 / tanH) * (size.height / freeH);
  const dW = (w / 2 / (tanH * aspect)) * (size.width / freeW);
  const d = THREE.MathUtils.clamp(Math.max(dH, dW) * 1.04 + depth * 0.6, MIN_DISTANCE, MAX_DISTANCE);
  // Desloca o alvo no chão para centralizar na área livre (descontando o HUD).
  const worldPerPx = (2 * d * tanH) / size.height;
  const dx = ((inset.left - inset.right) / 2) * worldPerPx;
  const dy = ((inset.top - inset.bottom) / 2) * worldPerPx;
  const forward = new THREE.Vector3(up.x, 0, up.z);
  const fl = forward.length();
  const target = new THREE.Vector3(cx, 0, cz).addScaledVector(right, -dx);
  if (fl > 0.05) target.addScaledVector(forward.normalize(), dy / Math.max(0.2, fl));
  return { position: target.clone().addScaledVector(offsetDir, d), target };
}

interface Props {
  layout: OfficeLayout;
  focus: Bounds;
  focusNonce: number;
}

/**
 * Câmera livre: órbita 360°, inclinação limitada (nunca atravessa o chão),
 * zoom suave em direção ao cursor, deslocamento lateral/vertical, teclado
 * (WASD/QE/RF/+−), gestos de toque e acompanhamento de personagem.
 */
export function CameraRig({ layout, focus, focusNonce }: Props) {
  const controls = useRef<CameraControlsImpl>(null);
  const { size, camera } = useThree();
  const initialized = useRef(false);
  const speed = useCameraStore((s) => s.speed);
  const tmp = useMemo(() => ({ target: new THREE.Vector3(), pos: new THREE.Vector3() }), []);

  const wholeOffice: Bounds = useMemo(
    () => ({ minX: 0, maxX: layout.width, minZ: 0, maxZ: layout.depth }),
    [layout.width, layout.depth],
  );

  // Configuração dos controles (mouse, toque, limites)
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const A = CameraControlsImpl.ACTION;
    c.mouseButtons.left = A.ROTATE;
    c.mouseButtons.right = A.TRUCK;
    c.mouseButtons.middle = A.DOLLY;
    c.mouseButtons.wheel = A.DOLLY;
    c.touches.one = A.TOUCH_ROTATE;
    c.touches.two = A.TOUCH_DOLLY_TRUCK;
    c.touches.three = A.TOUCH_TRUCK;
    c.minPolarAngle = MIN_POLAR;
    c.maxPolarAngle = MAX_POLAR;
    c.minDistance = MIN_DISTANCE;
    c.maxDistance = MAX_DISTANCE;
    c.dollyToCursor = true;
    c.boundaryFriction = 0.1;
    c.setBoundary(new THREE.Box3(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(layout.width + 4, 3.5, layout.depth + 4)));
  }, [layout.width, layout.depth]);

  // Velocidade configurável
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.azimuthRotateSpeed = 0.9 * speed;
    c.polarRotateSpeed = 0.7 * speed;
    c.dollySpeed = 0.8 * speed;
    c.truckSpeed = 1.6 * speed;
    const reduced = prefersReducedMotion();
    c.smoothTime = reduced ? 0.01 : 0.28;
    c.draggingSmoothTime = reduced ? 0.01 : 0.1;
  }, [speed]);

  const lookAt = (pos: THREE.Vector3, target: THREE.Vector3, smooth: boolean) => {
    void controls.current?.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, smooth && !prefersReducedMotion());
  };

  // Enquadramento inicial e ao focar uma sala (mantém os ângulos atuais do usuário)
  useEffect(() => {
    const c = controls.current;
    if (!c || size.width === 0) return;
    if (!initialized.current) {
      initialized.current = true;
      const f = frameBounds(wholeOffice, ISO_AZIMUTH, ISO_POLAR, size);
      lookAt(f.position, f.target, false);
      return;
    }
    const f = frameBounds(focus, c.azimuthAngle, Math.min(c.polarAngle, 1.1), size);
    lookAt(f.position, f.target, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  // Teclado: WASD/setas movem, Q/E giram, R/F inclinam, +/- aproximam.
  useEffect(() => {
    const keys: Record<string, [Parameters<ReturnType<typeof useCameraStore.getState>['setHeld']>[0], number]> = {
      KeyW: ['panZ', 1],
      ArrowUp: ['panZ', 1],
      KeyS: ['panZ', -1],
      ArrowDown: ['panZ', -1],
      KeyA: ['panX', -1],
      ArrowLeft: ['panX', -1],
      KeyD: ['panX', 1],
      ArrowRight: ['panX', 1],
      KeyQ: ['rotate', 1],
      KeyE: ['rotate', -1],
      KeyR: ['tilt', -1],
      KeyF: ['tilt', 1],
      Equal: ['zoom', 1],
      NumpadAdd: ['zoom', 1],
      Minus: ['zoom', -1],
      NumpadSubtract: ['zoom', -1],
    };
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
    };
    const down = (e: KeyboardEvent) => {
      const k = keys[e.code];
      if (!k || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      useCameraStore.getState().setHeld(k[0], k[1]);
      if (k[0] === 'panX' || k[0] === 'panZ') useCameraStore.getState().setFollow(false);
    };
    const up = (e: KeyboardEvent) => {
      const k = keys[e.code];
      if (!k) return;
      const held = useCameraStore.getState().held[k[0]];
      if (held === k[1]) useCameraStore.getState().setHeld(k[0], 0);
    };
    const blur = () => (['rotate', 'tilt', 'zoom', 'panX', 'panZ'] as const).forEach((a) => useCameraStore.getState().setHeld(a, 0));
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Expõe leitura da câmera para diagnóstico e testes automatizados.
  useEffect(() => {
    const w = window as unknown as { __agencyOS?: Record<string, unknown> };
    w.__agencyOS = {
      ...(w.__agencyOS ?? {}),
      camera: () => {
        const c = controls.current;
        if (!c) return null;
        c.getTarget(tmp.target);
        return {
          azimuth: c.azimuthAngle,
          polar: c.polarAngle,
          distance: c.distance,
          target: tmp.target.toArray(),
          position: camera.position.toArray(),
        };
      },
    };
  }, [camera, tmp]);

  const pan = (c: CameraControlsImpl, x: number, z: number, smooth: boolean) => {
    // Desloca no plano do chão, relativo à direção da câmera.
    const az = c.azimuthAngle;
    const fwd = new THREE.Vector3(-Math.sin(az), 0, -Math.cos(az));
    const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    c.getTarget(tmp.target, true);
    tmp.target.addScaledVector(fwd, z).addScaledVector(right, x);
    void c.moveTo(tmp.target.x, tmp.target.y, tmp.target.z, smooth);
  };

  useFrame((_, rawDt) => {
    const c = controls.current;
    if (!c) return;
    // Limite generoso: mesmo com poucos quadros por segundo a velocidade percebida se mantém.
    const dt = Math.min(rawDt, 0.25);
    const store = useCameraStore.getState();
    const sp = store.speed;
    const smooth = !prefersReducedMotion();

    // Comandos discretos (botões)
    for (const cmd of store.drain()) {
      switch (cmd.type) {
        case 'rotate':
          void c.rotate(cmd.amount, 0, smooth);
          break;
        case 'tilt':
          void c.rotate(0, cmd.amount, smooth);
          break;
        case 'zoom':
          void c.dolly(c.distance * cmd.amount, smooth);
          break;
        case 'pan':
          store.setFollow(false);
          pan(c, cmd.x * Math.max(2, c.distance * 0.15), cmd.z * Math.max(2, c.distance * 0.15), smooth);
          break;
        case 'reset': {
          store.setFollow(false);
          useOfficeStore.getState().clearFocus();
          const f = frameBounds(wholeOffice, ISO_AZIMUTH, ISO_POLAR, size);
          lookAt(f.position, f.target, true);
          break;
        }
        case 'iso': {
          // Volta à vista isométrica original (ângulo diagonal mais próximo), mantendo o enquadramento.
          const q = Math.PI / 2;
          const az = Math.round((c.azimuthAngle - ISO_AZIMUTH) / q) * q + ISO_AZIMUTH;
          void c.rotateTo(az, ISO_POLAR, smooth);
          break;
        }
      }
    }

    // Botões/teclas mantidos pressionados: movimento contínuo
    const h = store.held;
    if (h.rotate) void c.rotate(h.rotate * 1.4 * sp * dt, 0, false);
    if (h.tilt) void c.rotate(0, h.tilt * 0.9 * sp * dt, false);
    if (h.zoom) void c.dolly(h.zoom * c.distance * 1.1 * sp * dt, false);
    if (h.panX || h.panZ) {
      const v = Math.max(4, c.distance * 0.45) * sp * dt;
      pan(c, h.panX * v, h.panZ * v, false);
    }

    // Acompanhar o funcionário selecionado
    if (store.follow) {
      const id = useOfficeStore.getState().selectedEmployeeId;
      const a = id ? simulationHost.current?.agents.get(id) : undefined;
      if (a && a.phase !== 'hidden') void c.moveTo(a.pos[0], 0.6, a.pos[1], true);
    }
  });

  return <CameraControls ref={controls} makeDefault />;
}
