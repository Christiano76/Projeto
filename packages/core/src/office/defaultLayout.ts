import { directionOf, type ObjectDef, type ObjectType, type OfficeLayout, type RoomDef } from './layout';

/**
 * Planta inicial da agência (33 m x 18 m).
 *
 *  z=0  ┌────────┬───────┬──────────┬──────────┬─────────┐
 *       │Diretor │Gerente│Financeiro│ Reuniões │ Descanso│
 *  z=7  ├──▒─────┴──▒────┴────▒─────┴─────▒────┴────▒────┤
 *       │                 Corredor                        │
 *  z=9.5├──▒──────┬──▒────┬───▒───────┬───────▒──────────┤
 *       │Recepção │Prospec│ Comercial │  Desenvolvimento  │
 *  z=18 └──▒──────┴───────┴───────────┴───────────────────┘
 *        (entrada)
 */

const PI = Math.PI;
const SOUTH = 0; // olhando para +z
const NORTH = PI; // olhando para -z
const EAST = PI / 2; // olhando para +x
const WEST = -PI / 2; // olhando para -x

const rooms: RoomDef[] = [
  room('diretor', 'Sala do Diretor', 'director', 'direcao', [0, 0, 7, 7], [{ side: 's', offset: 2.5, width: 1.5 }], '#d5dde7', 1),
  room('gerente', 'Sala do Gerente', 'manager', 'gerencia', [7, 0, 6, 7], [{ side: 's', offset: 2, width: 1.5 }], '#dde3ea', 2),
  room('financeiro', 'Financeiro', 'department', 'financeiro', [13, 0, 6, 7], [{ side: 's', offset: 2.5, width: 1.5 }], '#d3e2e6', 3),
  room('reunioes', 'Sala de Reuniões', 'meeting', null, [19, 0, 7, 7], [{ side: 's', offset: 1, width: 1.5 }], '#cdd9e8', 4),
  room('descanso', 'Área de Descanso', 'lounge', null, [26, 0, 7, 7], [{ side: 's', offset: 1, width: 1.5 }], '#d8e4ee', 5),
  room('corredor', 'Corredor', 'corridor', null, [0, 7, 33, 2.5], [], '#e6ebf1', 0),
  room(
    'recepcao',
    'Recepção',
    'reception',
    null,
    [0, 9.5, 8, 8.5],
    [
      { side: 'n', offset: 5, width: 1.5 },
      { side: 's', offset: 3, width: 2, exterior: true },
    ],
    '#e3e9f0',
    6,
  ),
  room('prospeccao', 'Prospecção', 'department', 'prospeccao', [8, 9.5, 6, 8.5], [{ side: 'n', offset: 2, width: 1.5 }], '#d2dfeb', 7),
  room('comercial', 'Comercial', 'department', 'comercial', [14, 9.5, 8, 8.5], [{ side: 'n', offset: 3, width: 1.5 }], '#d9dfea', 8),
  room('desenvolvimento', 'Desenvolvimento', 'department', 'desenvolvimento', [22, 9.5, 11, 8.5], [{ side: 'n', offset: 4.5, width: 1.5 }], '#cfe0e6', 9),
];

const objects: ObjectDef[] = [];

function room(
  key: string,
  name: string,
  kind: RoomDef['kind'],
  departmentKey: string | null,
  [x, z, w, d]: [number, number, number, number],
  doors: RoomDef['doors'],
  floorColor: string,
  sortOrder: number,
): RoomDef {
  return { key, name, kind, departmentKey, bounds: { x, z, w, d }, doors, floorColor, sortOrder };
}

function add(
  roomKey: string,
  key: string,
  type: ObjectType,
  x: number,
  z: number,
  rotation = 0,
  props?: ObjectDef['props'],
): void {
  objects.push({ key: `${roomKey}.${key}`, roomKey, type, position: [x, z], rotation, ...(props ? { props } : {}) });
}

/**
 * Estação de trabalho: mesa + monitor + cadeira. `facing` é a direção para onde
 * o funcionário sentado olha (em direção ao monitor). Retorna a chave do assento.
 */
function workstation(roomKey: string, key: string, x: number, z: number, facing: number, exec = false): string {
  const [dx, dz] = directionOf(facing);
  const deskType: ObjectType = exec ? 'exec_desk' : 'desk';
  const chairDist = exec ? 0.95 : 0.85;
  const seatKey = `${roomKey}.${key}.chair`;
  add(roomKey, `${key}.desk`, deskType, x, z, facing + PI);
  add(roomKey, `${key}.monitor`, 'monitor', x + dx * 0.15, z + dz * 0.15, facing + PI, { seatKey });
  add(roomKey, `${key}.chair`, 'office_chair', x - dx * chairDist, z - dz * chairDist, facing, { seatKind: 'desk' });
  return seatKey;
}

// ── Sala do Diretor ───────────────────────────────────────────────
export const DIRECTOR_SEAT = workstation('diretor', 'ws', 3.5, 2.8, SOUTH, true);
add('diretor', 'shelf', 'bookshelf', 3.5, 0.6, SOUTH);
add('diretor', 'rug', 'rug', 3.5, 4.9, 0, { color: '#2f4560' });
add('diretor', 'guest1', 'armchair', 2.4, 5.4, NORTH, { seatKind: 'guest' });
add('diretor', 'guest2', 'armchair', 4.6, 5.4, NORTH, { seatKind: 'guest' });
add('diretor', 'plant1', 'plant', 0.7, 0.7);
add('diretor', 'plant2', 'plant', 6.3, 0.7);
add('diretor', 'lamp', 'floor_lamp', 6.3, 6.2);

// ── Sala do Gerente ───────────────────────────────────────────────
export const MANAGER_SEAT = workstation('gerente', 'ws', 10, 2.6, SOUTH);
add('gerente', 'board', 'whiteboard', 7.55, 3.5, EAST);
add('gerente', 'cabinet', 'filing_cabinet', 12.3, 0.7, SOUTH);
add('gerente', 'guest', 'armchair', 10, 4.9, NORTH, { seatKind: 'guest' });
add('gerente', 'plant', 'plant', 12.3, 6.2);

// ── Financeiro ────────────────────────────────────────────────────
export const FINANCE_SEAT = workstation('financeiro', 'ws1', 16, 2.6, SOUTH);
add('financeiro', 'cab1', 'filing_cabinet', 13.7, 0.7, SOUTH);
add('financeiro', 'cab2', 'filing_cabinet', 14.3, 0.7, SOUTH);
add('financeiro', 'shelf', 'bookshelf', 18.55, 4, WEST);
add('financeiro', 'plant', 'plant', 13.7, 6.2);

// ── Sala de Reuniões ──────────────────────────────────────────────
add('reunioes', 'table', 'meeting_table', 22.5, 3.8, 0);
add('reunioes', 'tv', 'tv_screen', 22.5, 0.35, SOUTH);
[-1, 0, 1].forEach((i) => {
  add('reunioes', `chairN${i + 1}`, 'meeting_chair', 22.5 + i * 1.0, 2.75, SOUTH, { seatKind: 'meeting' });
  add('reunioes', `chairS${i + 1}`, 'meeting_chair', 22.5 + i * 1.0, 4.85, NORTH, { seatKind: 'meeting' });
});
add('reunioes', 'chairW', 'meeting_chair', 20.4, 3.8, EAST, { seatKind: 'meeting' });
add('reunioes', 'chairE', 'meeting_chair', 24.6, 3.8, WEST, { seatKind: 'meeting' });
add('reunioes', 'plant1', 'plant', 19.7, 0.7);
add('reunioes', 'plant2', 'plant', 25.3, 6.3);

// ── Área de Descanso ──────────────────────────────────────────────
add('descanso', 'rug', 'rug', 29.5, 2.9, 0, { color: '#3d5a7a' });
add('descanso', 'sofa', 'sofa', 29.5, 1.0, SOUTH);
add('descanso', 'table', 'coffee_table', 29.5, 2.6, 0);
add('descanso', 'arm1', 'armchair', 27.4, 3.0, EAST);
add('descanso', 'arm2', 'armchair', 31.6, 3.0, WEST);
add('descanso', 'coffee', 'coffee_machine', 32.2, 5.6, WEST);
add('descanso', 'water', 'water_cooler', 32.4, 6.4, WEST);
add('descanso', 'plant', 'plant', 26.7, 0.7);
add('descanso', 'lamp', 'floor_lamp', 32.3, 0.7);

// ── Corredor ──────────────────────────────────────────────────────
add('corredor', 'plant1', 'plant', 0.6, 8.25);
add('corredor', 'plant2', 'plant', 32.4, 8.25);

// ── Recepção ──────────────────────────────────────────────────────
add('recepcao', 'sign', 'wall_sign', 4, 9.65, SOUTH);
add('recepcao', 'counter', 'reception_counter', 3.0, 12.2, SOUTH);
add('recepcao', 'bench1', 'waiting_bench', 0.6, 14.8, EAST);
add('recepcao', 'plant1', 'plant', 0.7, 17.3);
add('recepcao', 'plant2', 'plant', 7.3, 17.3);
add('recepcao', 'plant3', 'plant', 7.3, 10.2);
add('recepcao', 'rug', 'rug', 4, 16.3, 0, { color: '#33475f' });

// ── Prospecção ────────────────────────────────────────────────────
export const PROSPECTOR_SEAT = workstation('prospeccao', 'ws1', 11, 13.6, SOUTH);
add('prospeccao', 'shelf', 'bookshelf', 13.55, 14, WEST);
add('prospeccao', 'board', 'whiteboard', 8.15, 14, EAST);
add('prospeccao', 'plant', 'plant', 8.7, 17.3);
add('prospeccao', 'spare', 'desk', 11, 16.6, 0, { note: 'mesa livre para expansão' });

// ── Comercial ─────────────────────────────────────────────────────
export const ANALYST_SEAT = workstation('comercial', 'ws1', 16.5, 13.6, SOUTH);
export const SALES_SEAT = workstation('comercial', 'ws2', 19.5, 13.6, SOUTH);
add('comercial', 'cabinet', 'filing_cabinet', 21.3, 10.2, SOUTH);
add('comercial', 'board', 'whiteboard', 14.15, 14, EAST);
add('comercial', 'plant1', 'plant', 14.7, 17.3);
add('comercial', 'plant2', 'plant', 21.3, 17.3);

// ── Desenvolvimento ───────────────────────────────────────────────
export const FRONTEND_SEAT = workstation('desenvolvimento', 'ws1', 24.5, 13.6, SOUTH);
export const BACKEND_SEAT = workstation('desenvolvimento', 'ws2', 27.5, 13.6, SOUTH);
export const QA_SEAT = workstation('desenvolvimento', 'ws3', 30.5, 13.6, SOUTH);
add('desenvolvimento', 'rack1', 'server_rack', 32.4, 16.9, WEST);
add('desenvolvimento', 'board', 'whiteboard', 22.15, 14, EAST);
add('desenvolvimento', 'plant1', 'plant', 22.7, 17.3);
add('desenvolvimento', 'plant2', 'plant', 32.3, 10.2);
add('desenvolvimento', 'lamp', 'floor_lamp', 29, 17.3);

export const DEFAULT_LAYOUT: OfficeLayout = { width: 33, depth: 18, rooms, objects };

/** Cópia profunda do layout padrão (evita mutação acidental do módulo). */
export function createDefaultLayout(): OfficeLayout {
  return structuredClone(DEFAULT_LAYOUT);
}
