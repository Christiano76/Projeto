import { OBJECT_SPECS, localToWorld, roomCenter, type ObjectType, type OfficeLayout, type Vec2 } from '../office/layout';
import { cellToWorld, nearestWalkableCell, type NavGrid } from '../office/navigation';

/** Ponto de interesse onde um personagem pode ir e ficar em pé. */
export interface Poi {
  key: string;
  roomKey: string;
  kind: 'coffee' | 'water' | 'board' | 'books' | 'reception' | 'servers' | 'stroll';
  label: string;
  position: Vec2;
  /** Para onde o personagem olha ao chegar. */
  lookAt: Vec2;
}

const POI_TYPES: Partial<Record<ObjectType, { kind: Poi['kind']; label: string }>> = {
  coffee_machine: { kind: 'coffee', label: 'Máquina de café' },
  water_cooler: { kind: 'water', label: 'Bebedouro' },
  whiteboard: { kind: 'board', label: 'Quadro branco' },
  bookshelf: { kind: 'books', label: 'Estante' },
  reception_counter: { kind: 'reception', label: 'Balcão da recepção' },
  server_rack: { kind: 'servers', label: 'Servidores' },
};

function snap(grid: NavGrid, p: Vec2, maxDist: number): Vec2 | null {
  const cell = nearestWalkableCell(grid, p, 4);
  if (!cell) return null;
  const w = cellToWorld(grid, cell[0], cell[1]);
  return Math.hypot(w[0] - p[0], w[1] - p[1]) <= maxDist ? w : null;
}

/** Objetos interessantes (café, quadros, estantes…) com um ponto alcançável à frente. */
export function getPointsOfInterest(layout: OfficeLayout, grid: NavGrid): Poi[] {
  const out: Poi[] = [];
  for (const o of layout.objects) {
    const meta = POI_TYPES[o.type];
    if (!meta) continue;
    const front = localToWorld(o, [0, OBJECT_SPECS[o.type].footprint.d / 2 + 0.55]);
    const p = snap(grid, front, 1.2);
    if (!p) continue;
    out.push({ key: `poi:${o.key}`, roomKey: o.roomKey, kind: meta.kind, label: meta.label, position: p, lookAt: o.position });
  }
  return out;
}

/** Pontos de passeio: centro de cada sala (exceto corredor). */
export function getStrollPoints(layout: OfficeLayout, grid: NavGrid): Poi[] {
  const out: Poi[] = [];
  for (const room of layout.rooms) {
    // Corredor é passagem: ninguém fica parado nele.
    if (room.kind === 'corridor') continue;
    const points: Vec2[] = [roomCenter(room)];
    points.forEach((pt, i) => {
      const p = snap(grid, pt, 2.5);
      if (!p) return;
      out.push({
        key: `stroll:${room.key}:${i}`,
        roomKey: room.key,
        kind: 'stroll',
        label: room.name,
        position: p,
        lookAt: [p[0] + 1, p[1] + 1],
      });
    });
  }
  return out;
}
