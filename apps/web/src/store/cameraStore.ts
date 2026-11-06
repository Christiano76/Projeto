'use client';

import { create } from 'zustand';

/** Comandos discretos de câmera (botões do painel e atalhos). */
export type CameraCommand =
  | { type: 'rotate'; amount: number }
  | { type: 'tilt'; amount: number }
  | { type: 'zoom'; amount: number }
  | { type: 'pan'; x: number; z: number }
  | { type: 'reset' }
  | { type: 'iso' };

export type HeldAxis = 'rotate' | 'tilt' | 'zoom' | 'panX' | 'panZ';
export type Quality = 'auto' | 'high' | 'medium' | 'low';

const QUALITY_KEY = 'agency-os:quality';
const SPEED_KEY = 'agency-os:camera-speed';

function readStored<T>(key: string, ok: (v: string) => boolean, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = localStorage.getItem(key);
    return v !== null && ok(v) ? (v as unknown as T) : fallback;
  } catch {
    return fallback;
  }
}

interface CameraState {
  /** Multiplicador de velocidade (0,5–2). */
  speed: number;
  follow: boolean;
  held: Record<HeldAxis, number>;
  pending: CameraCommand[];
  quality: Quality;
  /** Qualidade efetiva após detecção automática. */
  effectiveQuality: Exclude<Quality, 'auto'>;
  push(cmd: CameraCommand): void;
  drain(): CameraCommand[];
  setHeld(axis: HeldAxis, value: number): void;
  setSpeed(v: number): void;
  setFollow(v: boolean): void;
  setQuality(q: Quality): void;
  setEffectiveQuality(q: Exclude<Quality, 'auto'>): void;
}

export const useCameraStore = create<CameraState>((set, get) => ({
  speed: Number(readStored(SPEED_KEY, (v) => Number(v) >= 0.5 && Number(v) <= 2, '1')),
  follow: false,
  held: { rotate: 0, tilt: 0, zoom: 0, panX: 0, panZ: 0 },
  pending: [],
  quality: readStored<Quality>(QUALITY_KEY, (v) => ['auto', 'high', 'medium', 'low'].includes(v), 'auto'),
  effectiveQuality: 'high',
  push: (cmd) => set((s) => ({ pending: [...s.pending, cmd] })),
  drain: () => {
    const p = get().pending;
    if (p.length) set({ pending: [] });
    return p;
  },
  setHeld: (axis, value) => set((s) => ({ held: { ...s.held, [axis]: value } })),
  setSpeed: (speed) => {
    try {
      localStorage.setItem(SPEED_KEY, String(speed));
    } catch {
      /* opcional */
    }
    set({ speed });
  },
  setFollow: (follow) => set({ follow }),
  setQuality: (quality) => {
    try {
      localStorage.setItem(QUALITY_KEY, quality);
    } catch {
      /* opcional */
    }
    set({ quality });
  },
  setEffectiveQuality: (effectiveQuality) => set({ effectiveQuality }),
}));
