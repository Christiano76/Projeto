import type { OfficeLayout, Vec2 } from './layout';

/**
 * Gera os segmentos de parede a partir das salas.
 *
 * Paredes compartilhadas entre salas vizinhas são deduplicadas e uma porta
 * declarada por QUALQUER sala abre a passagem para os dois lados.
 * Para isso o contorno é discretizado em arestas de 0,5 m.
 */

export interface WallSegment {
  a: Vec2;
  b: Vec2;
  /** Parede no limite externo do prédio. */
  exterior: boolean;
}

const UNIT = 0.5;
const key = (x: number, z: number, horizontal: boolean) =>
  `${horizontal ? 'h' : 'v'}:${Math.round(x / UNIT)}:${Math.round(z / UNIT)}`;

export function buildWallSegments(layout: OfficeLayout): WallSegment[] {
  const edges = new Map<string, { x: number; z: number; horizontal: boolean }>();
  const openings = new Set<string>();

  const forEachEdge = (
    x0: number,
    z0: number,
    length: number,
    horizontal: boolean,
    fn: (x: number, z: number) => void,
  ) => {
    const n = Math.round(length / UNIT);
    for (let i = 0; i < n; i++) {
      const x = horizontal ? x0 + i * UNIT : x0;
      const z = horizontal ? z0 : z0 + i * UNIT;
      fn(x, z);
    }
  };

  for (const room of layout.rooms) {
    const { x, z, w, d } = room.bounds;
    const sides = [
      { side: 'n', x0: x, z0: z, len: w, h: true },
      { side: 's', x0: x, z0: z + d, len: w, h: true },
      { side: 'w', x0: x, z0: z, len: d, h: false },
      { side: 'e', x0: x + w, z0: z, len: d, h: false },
    ] as const;
    for (const s of sides) {
      forEachEdge(s.x0, s.z0, s.len, s.h, (ex, ez) => edges.set(key(ex, ez, s.h), { x: ex, z: ez, horizontal: s.h }));
    }
    for (const door of room.doors) {
      const s = sides.find((v) => v.side === door.side)!;
      const start = s.h ? s.x0 + door.offset : s.z0 + door.offset;
      forEachEdge(s.h ? start : s.x0, s.h ? s.z0 : start, door.width, s.h, (ex, ez) =>
        openings.add(key(ex, ez, s.h)),
      );
    }
  }

  for (const k of openings) edges.delete(k);

  // Mescla arestas contíguas em segmentos.
  const segments: WallSegment[] = [];
  const isExterior = (x: number, z: number, horizontal: boolean) =>
    horizontal ? z === 0 || z === layout.depth : x === 0 || x === layout.width;

  const sorted = [...edges.values()].sort((p, q) =>
    p.horizontal !== q.horizontal
      ? p.horizontal
        ? -1
        : 1
      : p.horizontal
        ? p.z - q.z || p.x - q.x
        : p.x - q.x || p.z - q.z,
  );

  let current: { a: [number, number]; b: [number, number]; horizontal: boolean } | null = null;
  const flush = () => {
    if (!current) return;
    segments.push({
      a: current.a,
      b: current.b,
      exterior: isExterior(current.a[0], current.a[1], current.horizontal),
    });
    current = null;
  };
  for (const e of sorted) {
    const a: [number, number] = [e.x, e.z];
    const b: [number, number] = e.horizontal ? [e.x + UNIT, e.z] : [e.x, e.z + UNIT];
    if (
      current &&
      current.horizontal === e.horizontal &&
      current.b[0] === a[0] &&
      current.b[1] === a[1]
    ) {
      current.b = b;
    } else {
      flush();
      current = { a, b, horizontal: e.horizontal };
    }
  }
  flush();
  return segments;
}

export function distanceToSegment(p: Vec2, s: WallSegment): number {
  const [px, pz] = p;
  const [ax, az] = s.a;
  const [bx, bz] = s.b;
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  const cx = ax + t * dx;
  const cz = az + t * dz;
  return Math.hypot(px - cx, pz - cz);
}
