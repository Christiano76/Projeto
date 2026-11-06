/**
 * Modelo de dados do escritório (planta). Persistido em `office_rooms` e
 * `office_objects`, o que torna o escritório expansível sem alterar código.
 *
 * Convenções:
 *  - Plano XZ, em metros. X cresce para a "direita", Z para "baixo" na planta.
 *  - Rotação em radianos no eixo Y. Rotação 0 => a frente do objeto aponta para +Z.
 *    Direção de uma rotação θ: (sin θ, cos θ).
 *  - Todas as coordenadas de paredes/portas são múltiplas de 0,5 m.
 */

export type Vec2 = readonly [number, number];
export type Side = 'n' | 's' | 'e' | 'w';

export type RoomKind =
  | 'reception'
  | 'director'
  | 'manager'
  | 'department'
  | 'meeting'
  | 'lounge'
  | 'corridor';

export interface DoorDef {
  side: Side;
  /** Distância (m) a partir do canto oeste (lados n/s) ou norte (lados e/w). */
  offset: number;
  width: number;
  /** Porta externa (entrada do prédio). */
  exterior?: boolean;
}

export interface RoomDef {
  key: string;
  name: string;
  kind: RoomKind;
  departmentKey: string | null;
  bounds: { x: number; z: number; w: number; d: number };
  doors: DoorDef[];
  floorColor: string;
  sortOrder: number;
}

export const OBJECT_TYPES = [
  'desk',
  'exec_desk',
  'office_chair',
  'monitor',
  'meeting_table',
  'meeting_chair',
  'sofa',
  'armchair',
  'coffee_table',
  'coffee_machine',
  'water_cooler',
  'plant',
  'bookshelf',
  'filing_cabinet',
  'whiteboard',
  'tv_screen',
  'reception_counter',
  'waiting_bench',
  'rug',
  'server_rack',
  'floor_lamp',
  'wall_sign',
] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

export interface ObjectDef {
  key: string;
  roomKey: string;
  type: ObjectType;
  position: Vec2;
  rotation: number;
  props?: Record<string, string | number | boolean>;
}

export interface OfficeLayout {
  width: number;
  depth: number;
  rooms: RoomDef[];
  objects: ObjectDef[];
}

export type SeatKind = 'desk' | 'meeting' | 'lounge' | 'guest';

export interface ObjectSpec {
  /** Pegada no chão (largura no eixo X local, profundidade no Z local). */
  footprint: { w: number; d: number };
  blocksMovement: boolean;
  /** Assentos oferecidos pelo objeto, em coordenadas locais. */
  seats?: { offset: Vec2; height: number }[];
}

export const OBJECT_SPECS: Record<ObjectType, ObjectSpec> = {
  desk: { footprint: { w: 1.4, d: 0.7 }, blocksMovement: true },
  exec_desk: { footprint: { w: 1.8, d: 0.85 }, blocksMovement: true },
  office_chair: {
    footprint: { w: 0.55, d: 0.55 },
    blocksMovement: false,
    seats: [{ offset: [0, 0], height: 0.45 }],
  },
  monitor: { footprint: { w: 0.6, d: 0.2 }, blocksMovement: false },
  meeting_table: { footprint: { w: 3.2, d: 1.3 }, blocksMovement: true },
  meeting_chair: {
    footprint: { w: 0.5, d: 0.5 },
    blocksMovement: false,
    seats: [{ offset: [0, 0], height: 0.45 }],
  },
  sofa: {
    footprint: { w: 2.2, d: 0.9 },
    blocksMovement: true,
    seats: [
      { offset: [-0.65, 0.1], height: 0.42 },
      { offset: [0, 0.1], height: 0.42 },
      { offset: [0.65, 0.1], height: 0.42 },
    ],
  },
  armchair: {
    footprint: { w: 0.85, d: 0.85 },
    blocksMovement: true,
    seats: [{ offset: [0, 0.08], height: 0.42 }],
  },
  coffee_table: { footprint: { w: 1.1, d: 0.6 }, blocksMovement: true },
  coffee_machine: { footprint: { w: 0.9, d: 0.55 }, blocksMovement: true },
  water_cooler: { footprint: { w: 0.4, d: 0.4 }, blocksMovement: true },
  plant: { footprint: { w: 0.5, d: 0.5 }, blocksMovement: true },
  bookshelf: { footprint: { w: 1.6, d: 0.4 }, blocksMovement: true },
  filing_cabinet: { footprint: { w: 0.5, d: 0.6 }, blocksMovement: true },
  whiteboard: { footprint: { w: 1.8, d: 0.15 }, blocksMovement: true },
  tv_screen: { footprint: { w: 1.8, d: 0.15 }, blocksMovement: true },
  reception_counter: { footprint: { w: 2.6, d: 0.8 }, blocksMovement: true },
  waiting_bench: { footprint: { w: 1.6, d: 0.55 }, blocksMovement: true },
  rug: { footprint: { w: 2.4, d: 1.6 }, blocksMovement: false },
  server_rack: { footprint: { w: 0.7, d: 0.8 }, blocksMovement: true },
  floor_lamp: { footprint: { w: 0.35, d: 0.35 }, blocksMovement: true },
  wall_sign: { footprint: { w: 2.0, d: 0.1 }, blocksMovement: false },
};

/** Direção (unitária) para onde aponta a frente de algo com rotação θ. */
export function directionOf(rotation: number): Vec2 {
  return [round(Math.sin(rotation)), round(Math.cos(rotation))];
}

/** Rotação que faz algo olhar na direção (dx, dz). */
export function rotationToward(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** Converte coordenada local de um objeto para o mundo. */
export function localToWorld(obj: Pick<ObjectDef, 'position' | 'rotation'>, local: Vec2): Vec2 {
  const c = Math.cos(obj.rotation);
  const s = Math.sin(obj.rotation);
  const [lx, lz] = local;
  // Rotação no eixo Y (three.js): x' = x cos + z sin ; z' = -x sin + z cos
  return [round(obj.position[0] + lx * c + lz * s), round(obj.position[1] - lx * s + lz * c)];
}

/** Retângulo (alinhado aos eixos) ocupado por um objeto, considerando rotação em múltiplos de 90°. */
export function objectRect(obj: ObjectDef): { minX: number; minZ: number; maxX: number; maxZ: number } {
  const { w, d } = OBJECT_SPECS[obj.type].footprint;
  const quarter = Math.round(obj.rotation / (Math.PI / 2));
  const swapped = Math.abs(quarter) % 2 === 1;
  const hw = (swapped ? d : w) / 2;
  const hd = (swapped ? w : d) / 2;
  return {
    minX: obj.position[0] - hw,
    maxX: obj.position[0] + hw,
    minZ: obj.position[1] - hd,
    maxZ: obj.position[1] + hd,
  };
}

export function roomContains(room: RoomDef, p: Vec2, margin = 0): boolean {
  const { x, z, w, d } = room.bounds;
  return p[0] >= x + margin && p[0] <= x + w - margin && p[1] >= z + margin && p[1] <= z + d - margin;
}

export function roomCenter(room: RoomDef): Vec2 {
  return [room.bounds.x + room.bounds.w / 2, room.bounds.z + room.bounds.d / 2];
}

export function findRoomAt(layout: OfficeLayout, p: Vec2): RoomDef | undefined {
  return layout.rooms.find((r) => roomContains(r, p));
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
