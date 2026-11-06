import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMPLOYEES,
  OBJECT_SPECS,
  buildNavGrid,
  buildWallSegments,
  createDefaultCompanySeed,
  createDefaultLayout,
  findPath,
  getEntranceAnchor,
  getSeatAnchors,
  lineOfSight,
  objectRect,
  pathLength,
  type OfficeLayout,
} from '../src';

const layout = createDefaultLayout();
const grid = buildNavGrid(layout);

describe('layout padrão', () => {
  it('possui as 9 salas exigidas (+ corredor)', () => {
    const names = layout.rooms.filter((r) => r.kind !== 'corridor').map((r) => r.key).sort();
    expect(names).toEqual(
      ['comercial', 'descanso', 'desenvolvimento', 'diretor', 'financeiro', 'gerente', 'prospeccao', 'recepcao', 'reunioes'].sort(),
    );
  });

  it('salas não se sobrepõem e ficam dentro do prédio', () => {
    for (const a of layout.rooms) {
      expect(a.bounds.x + a.bounds.w).toBeLessThanOrEqual(layout.width);
      expect(a.bounds.z + a.bounds.d).toBeLessThanOrEqual(layout.depth);
      for (const b of layout.rooms) {
        if (a === b) continue;
        const overlap =
          a.bounds.x < b.bounds.x + b.bounds.w && b.bounds.x < a.bounds.x + a.bounds.w &&
          a.bounds.z < b.bounds.z + b.bounds.d && b.bounds.z < a.bounds.z + a.bounds.d;
        expect(overlap, `${a.key} x ${b.key}`).toBe(false);
      }
    }
  });

  it('todo objeto fica dentro da sua sala e as chaves são únicas', () => {
    const keys = new Set<string>();
    for (const o of layout.objects) {
      expect(keys.has(o.key), o.key).toBe(false);
      keys.add(o.key);
      const room = layout.rooms.find((r) => r.key === o.roomKey)!;
      const r = objectRect(o);
      expect(r.minX >= room.bounds.x && r.maxX <= room.bounds.x + room.bounds.w, `${o.key} X`).toBe(true);
      expect(r.minZ >= room.bounds.z && r.maxZ <= room.bounds.z + room.bounds.d, `${o.key} Z`).toBe(true);
    }
  });

  it('objetos que bloqueiam passagem não se sobrepõem', () => {
    const blocking = layout.objects.filter((o) => OBJECT_SPECS[o.type].blocksMovement);
    for (let i = 0; i < blocking.length; i++) {
      for (let j = i + 1; j < blocking.length; j++) {
        const a = objectRect(blocking[i]!);
        const b = objectRect(blocking[j]!);
        const overlap = a.minX < b.maxX - 1e-6 && b.minX < a.maxX - 1e-6 && a.minZ < b.maxZ - 1e-6 && b.minZ < a.maxZ - 1e-6;
        expect(overlap, `${blocking[i]!.key} x ${blocking[j]!.key}`).toBe(false);
      }
    }
  });

  it('cada funcionário tem uma mesa própria existente', () => {
    const seats = new Map(getSeatAnchors(layout).map((s) => [s.key, s]));
    const used = new Set<string>();
    for (const e of DEFAULT_EMPLOYEES) {
      const seat = seats.get(e.deskSeatKey);
      expect(seat, e.key).toBeDefined();
      expect(seat!.kind).toBe('desk');
      expect(used.has(e.deskSeatKey)).toBe(false);
      used.add(e.deskSeatKey);
    }
    expect(createDefaultCompanySeed().departments.map((d) => d.key)).toEqual(
      expect.arrayContaining([...new Set(DEFAULT_EMPLOYEES.map((e) => e.departmentKey))]),
    );
  });

  it('há 8 lugares de reunião e pelo menos 4 de descanso', () => {
    const seats = getSeatAnchors(layout);
    expect(seats.filter((s) => s.kind === 'meeting')).toHaveLength(8);
    expect(seats.filter((s) => s.kind === 'lounge').length).toBeGreaterThanOrEqual(4);
  });
});

describe('paredes', () => {
  it('portas abrem passagem nas paredes compartilhadas e não há paredes duplicadas', () => {
    const walls = buildWallSegments(layout);
    const keyOf = (w: { a: readonly number[]; b: readonly number[] }) => `${w.a.join()}-${w.b.join()}`;
    expect(new Set(walls.map(keyOf)).size).toBe(walls.length);
    // Porta do desenvolvimento (lado norte, x 26.5..28, z 9.5) não pode ter parede.
    const blocked = walls.some((w) => w.a[1] === 9.5 && w.b[1] === 9.5 && w.a[0] < 28 && w.b[0] > 26.5);
    expect(blocked).toBe(false);
    expect(walls.some((w) => w.exterior)).toBe(true);
  });
});

describe('navegação', () => {
  const entrance = getEntranceAnchor(layout);

  it('todos os assentos são alcançáveis a partir da entrada', () => {
    for (const seat of getSeatAnchors(layout)) {
      const path = findPath(grid, entrance.position, seat.position);
      expect(path, seat.key).not.toBeNull();
      expect(path!.at(-1)).toEqual(seat.position);
    }
  });

  it('caminhos suavizados mantêm linha de visão e não atravessam paredes', () => {
    const seat = getSeatAnchors(layout).find((s) => s.key.startsWith('descanso.sofa'))!;
    const path = findPath(grid, entrance.position, seat.position)!;
    // Todos os trechos exceto o último (que entra no assento) devem ter linha de visão.
    for (let i = 1; i < path.length - 1; i++) {
      expect(lineOfSight(grid, path[i - 1]!, path[i]!)).toBe(true);
    }
    // Precisa dar a volta pelo corredor: maior que a distância em linha reta.
    const straight = Math.hypot(seat.position[0] - entrance.position[0], seat.position[1] - entrance.position[1]);
    expect(pathLength(path)).toBeGreaterThan(straight);
  });

  it('retorna null quando o destino é inalcançável', () => {
    const closed: OfficeLayout = {
      width: 10,
      depth: 5,
      rooms: [
        { key: 'a', name: 'A', kind: 'department', departmentKey: null, bounds: { x: 0, z: 0, w: 5, d: 5 }, doors: [], floorColor: '#fff', sortOrder: 0 },
        { key: 'b', name: 'B', kind: 'department', departmentKey: null, bounds: { x: 5, z: 0, w: 5, d: 5 }, doors: [], floorColor: '#fff', sortOrder: 1 },
      ],
      objects: [],
    };
    const g = buildNavGrid(closed);
    expect(findPath(g, [2.5, 2.5], [7.5, 2.5])).toBeNull();
    const opened = { ...closed, rooms: [{ ...closed.rooms[0]!, doors: [{ side: 'e' as const, offset: 2, width: 1 }] }, closed.rooms[1]!] };
    expect(findPath(buildNavGrid(opened), [2.5, 2.5], [7.5, 2.5])).not.toBeNull();
  });
});
