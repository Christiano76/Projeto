import type { ObjectType } from '@agency/core';

/**
 * Modelos low-poly procedurais dos móveis, descritos como listas de peças.
 * Cada (tipo, peça) vira UM InstancedMesh, então 30 mesas custam o mesmo
 * número de draw calls que uma. Para trocar por modelos do Blender, basta
 * carregar um .glb por tipo (ver docs/ARCHITECTURE.md › Assets 3D).
 *
 * Coordenadas locais: origem no centro da pegada, Y para cima, frente = +Z.
 */

export type PartGeometry =
  | { kind: 'box'; size: [number, number, number] }
  | { kind: 'cyl'; rTop: number; rBottom: number; height: number; segments?: number }
  | { kind: 'ico'; radius: number; detail?: number };

export interface Part {
  geometry: PartGeometry;
  position: [number, number, number];
  rotation?: [number, number, number];
  /** Cor fixa ou `prop:<nome>` para ler de `props` do objeto (com fallback). */
  color: string;
  fallbackColor?: string;
  emissive?: boolean;
  castShadow?: boolean;
}

const box = (size: [number, number, number]): PartGeometry => ({ kind: 'box', size });
const cyl = (rTop: number, rBottom: number, height: number, segments = 8): PartGeometry => ({
  kind: 'cyl',
  rTop,
  rBottom,
  height,
  segments,
});

const WOOD = '#b08968';
const WOOD_DARK = '#7f5539';
const METAL = '#94a3b8';
const DARK = '#334155';
const WHITE = '#f8fafc';

function legs4(w: number, d: number, h: number, color: string, inset = 0.05, t = 0.05): Part[] {
  const x = w / 2 - inset;
  const z = d / 2 - inset;
  return [
    [x, z],
    [-x, z],
    [x, -z],
    [-x, -z],
  ].map(([px, pz]) => ({ geometry: box([t, h, t]), position: [px!, h / 2, pz!], color }));
}

export const MODELS: Record<ObjectType, Part[]> = {
  desk: [
    { geometry: box([1.4, 0.05, 0.7]), position: [0, 0.73, 0], color: WOOD, castShadow: true },
    ...legs4(1.4, 0.7, 0.71, METAL),
    { geometry: box([1.3, 0.35, 0.03]), position: [0, 0.5, -0.32], color: WOOD_DARK },
  ],
  exec_desk: [
    { geometry: box([1.8, 0.06, 0.85]), position: [0, 0.74, 0], color: WOOD_DARK, castShadow: true },
    { geometry: box([0.08, 0.71, 0.8]), position: [0.84, 0.355, 0], color: WOOD_DARK, castShadow: true },
    { geometry: box([0.08, 0.71, 0.8]), position: [-0.84, 0.355, 0], color: WOOD_DARK, castShadow: true },
    { geometry: box([1.6, 0.45, 0.04]), position: [0, 0.45, -0.38], color: WOOD_DARK },
  ],
  monitor: [
    { geometry: box([0.22, 0.02, 0.14]), position: [0, 0.765, 0], color: DARK },
    { geometry: box([0.05, 0.22, 0.04]), position: [0, 0.87, -0.02], color: DARK },
    { geometry: box([0.58, 0.36, 0.03]), position: [0, 1.1, 0], color: '#1e293b', castShadow: true },
    { geometry: box([0.42, 0.02, 0.14]), position: [0, 0.765, 0.3], color: '#475569' },
  ],
  office_chair: [
    { geometry: cyl(0.26, 0.26, 0.04, 5), position: [0, 0.04, 0], color: DARK },
    { geometry: cyl(0.03, 0.03, 0.36, 6), position: [0, 0.24, 0], color: METAL },
    { geometry: box([0.48, 0.08, 0.46]), position: [0, 0.44, 0], color: '#1f2937', castShadow: true },
    { geometry: box([0.46, 0.5, 0.06]), position: [0, 0.74, -0.22], color: '#1f2937', castShadow: true },
  ],
  meeting_table: [
    { geometry: box([3.2, 0.06, 1.3]), position: [0, 0.74, 0], color: WHITE, castShadow: true },
    { geometry: box([0.3, 0.71, 0.7]), position: [1.1, 0.355, 0], color: METAL, castShadow: true },
    { geometry: box([0.3, 0.71, 0.7]), position: [-1.1, 0.355, 0], color: METAL, castShadow: true },
  ],
  meeting_chair: [
    { geometry: box([0.46, 0.06, 0.44]), position: [0, 0.45, 0], color: '#475569', castShadow: true },
    { geometry: box([0.44, 0.42, 0.05]), position: [0, 0.7, -0.2], color: '#475569', castShadow: true },
    ...legs4(0.44, 0.42, 0.43, METAL, 0.04, 0.035),
  ],
  sofa: [
    { geometry: box([2.2, 0.38, 0.9]), position: [0, 0.19, 0], color: 'prop:color', fallbackColor: '#5b7f95', castShadow: true },
    { geometry: box([2.2, 0.5, 0.22]), position: [0, 0.6, -0.34], color: 'prop:color', fallbackColor: '#5b7f95', castShadow: true },
    { geometry: box([0.2, 0.58, 0.9]), position: [1.0, 0.29, 0], color: 'prop:color', fallbackColor: '#4f6d80' },
    { geometry: box([0.2, 0.58, 0.9]), position: [-1.0, 0.29, 0], color: 'prop:color', fallbackColor: '#4f6d80' },
    { geometry: box([0.58, 0.1, 0.6]), position: [-0.6, 0.43, 0.08], color: '#7aa0b8' },
    { geometry: box([0.58, 0.1, 0.6]), position: [0, 0.43, 0.08], color: '#7aa0b8' },
    { geometry: box([0.58, 0.1, 0.6]), position: [0.6, 0.43, 0.08], color: '#7aa0b8' },
  ],
  armchair: [
    { geometry: box([0.85, 0.38, 0.85]), position: [0, 0.19, 0], color: '#a26769', castShadow: true },
    { geometry: box([0.85, 0.48, 0.18]), position: [0, 0.6, -0.33], color: '#8e5557', castShadow: true },
    { geometry: box([0.14, 0.56, 0.85]), position: [0.355, 0.28, 0], color: '#8e5557' },
    { geometry: box([0.14, 0.56, 0.85]), position: [-0.355, 0.28, 0], color: '#8e5557' },
  ],
  coffee_table: [
    { geometry: box([1.1, 0.05, 0.6]), position: [0, 0.4, 0], color: WOOD, castShadow: true },
    ...legs4(1.1, 0.6, 0.38, WOOD_DARK),
  ],
  coffee_machine: [
    { geometry: box([0.9, 0.9, 0.55]), position: [0, 0.45, 0], color: WHITE, castShadow: true },
    { geometry: box([0.9, 0.04, 0.57]), position: [0, 0.92, 0], color: WOOD_DARK },
    { geometry: box([0.32, 0.42, 0.3]), position: [-0.15, 1.15, 0], color: '#1f2937', castShadow: true },
    { geometry: cyl(0.04, 0.035, 0.09, 6), position: [0.2, 0.985, 0.05], color: '#e11d48' },
  ],
  water_cooler: [
    { geometry: box([0.34, 0.95, 0.34]), position: [0, 0.475, 0], color: WHITE, castShadow: true },
    { geometry: cyl(0.14, 0.14, 0.42, 8), position: [0, 1.16, 0], color: '#7dd3fc' },
  ],
  plant: [
    { geometry: cyl(0.2, 0.15, 0.4, 7), position: [0, 0.2, 0], color: '#c2410c', castShadow: true },
    { geometry: { kind: 'ico', radius: 0.34, detail: 0 }, position: [0, 0.74, 0], color: '#4d7c0f', castShadow: true },
    { geometry: { kind: 'ico', radius: 0.24, detail: 0 }, position: [0.06, 1.04, -0.04], color: '#65a30d', castShadow: true },
  ],
  bookshelf: [
    { geometry: box([1.6, 1.9, 0.4]), position: [0, 0.95, 0], color: WOOD_DARK, castShadow: true },
    { geometry: box([1.4, 0.3, 0.3]), position: [0, 1.5, 0.06], color: '#1d4ed8' },
    { geometry: box([1.4, 0.3, 0.3]), position: [0, 1.0, 0.06], color: '#b91c1c' },
    { geometry: box([1.4, 0.3, 0.3]), position: [0, 0.5, 0.06], color: '#047857' },
  ],
  filing_cabinet: [
    { geometry: box([0.5, 1.1, 0.6]), position: [0, 0.55, 0], color: '#9ca3af', castShadow: true },
    { geometry: box([0.2, 0.03, 0.03]), position: [0, 0.85, 0.31], color: DARK },
    { geometry: box([0.2, 0.03, 0.03]), position: [0, 0.5, 0.31], color: DARK },
  ],
  whiteboard: [
    { geometry: box([1.8, 1.0, 0.04]), position: [0, 1.45, 0], color: WHITE },
    { geometry: box([1.86, 0.05, 0.08]), position: [0, 0.93, 0.02], color: METAL },
    { geometry: box([0.5, 0.02, 0.01]), position: [-0.4, 1.7, 0.025], color: '#2563eb' },
    { geometry: box([0.8, 0.02, 0.01]), position: [0.2, 1.55, 0.025], color: '#dc2626' },
  ],
  tv_screen: [
    { geometry: box([1.8, 1.02, 0.06]), position: [0, 1.5, 0], color: '#0f172a' },
    { geometry: box([1.7, 0.92, 0.01]), position: [0, 1.5, 0.035], color: '#1e3a8a' },
  ],
  reception_counter: [
    { geometry: box([2.6, 1.05, 0.8]), position: [0, 0.525, 0], color: WHITE, castShadow: true },
    { geometry: box([2.7, 0.05, 0.9]), position: [0, 1.075, 0], color: WOOD },
    { geometry: box([2.62, 0.12, 0.02]), position: [0, 0.75, 0.41], color: '#7c3aed' },
  ],
  waiting_bench: [
    { geometry: box([1.6, 0.08, 0.5]), position: [0, 0.44, 0], color: WOOD, castShadow: true },
    { geometry: box([1.6, 0.4, 0.06]), position: [0, 0.7, -0.22], color: WOOD },
    ...legs4(1.6, 0.5, 0.4, METAL),
  ],
  rug: [
    { geometry: box([2.4, 0.012, 1.6]), position: [0, 0.006, 0], color: 'prop:color', fallbackColor: '#9d8189' },
  ],
  server_rack: [
    { geometry: box([0.7, 2.0, 0.8]), position: [0, 1.0, 0], color: '#111827', castShadow: true },
    { geometry: box([0.5, 0.04, 0.01]), position: [0, 1.6, 0.405], color: '#22c55e', emissive: true },
    { geometry: box([0.5, 0.04, 0.01]), position: [0, 1.3, 0.405], color: '#22c55e', emissive: true },
    { geometry: box([0.5, 0.04, 0.01]), position: [0, 1.0, 0.405], color: '#38bdf8', emissive: true },
  ],
  floor_lamp: [
    { geometry: cyl(0.15, 0.17, 0.04, 8), position: [0, 0.02, 0], color: DARK },
    { geometry: cyl(0.02, 0.02, 1.5, 5), position: [0, 0.79, 0], color: DARK },
    { geometry: cyl(0.12, 0.2, 0.28, 8), position: [0, 1.6, 0], color: '#fde68a', emissive: true },
  ],
  wall_sign: [
    { geometry: box([2.0, 0.6, 0.05]), position: [0, 1.7, 0], color: '#7c3aed' },
    { geometry: box([1.5, 0.1, 0.02]), position: [0, 1.75, 0.035], color: WHITE, emissive: true },
    { geometry: box([1.0, 0.06, 0.02]), position: [0, 1.6, 0.035], color: '#c4b5fd', emissive: true },
  ],
};

/** Peça "tela" do monitor, renderizada à parte para refletir o estado real do funcionário. */
export const MONITOR_SCREEN: Part = {
  geometry: box([0.52, 0.3, 0.005]),
  position: [0, 1.1, 0.017],
  color: '#0b1220',
};

/** Faixa luminosa na traseira do monitor (visível quando a tela está de costas para a câmera). */
export const MONITOR_BACK_LIGHT: Part = {
  geometry: box([0.5, 0.035, 0.005]),
  position: [0, 1.255, -0.017],
  color: '#0b1220',
};

export const SCREEN_OFF = '#1e293b';
export const SCREEN_ON = '#7dd3fc';
export const SCREEN_BLOCKED = '#fdba74';

