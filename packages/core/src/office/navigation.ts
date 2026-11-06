import { OBJECT_SPECS, objectRect, type OfficeLayout, type Vec2 } from './layout';
import { buildWallSegments, distanceToSegment } from './walls';

/**
 * Grade de navegação + A* (8 direções, sem cortar quinas) com suavização por
 * linha de visão. Calculada uma vez por layout no cliente.
 */

export interface NavGrid {
  cellSize: number;
  cols: number;
  rows: number;
  /** 1 = caminhável. Índice = row * cols + col. */
  walkable: Uint8Array;
}

const WALL_CLEARANCE = 0.3;

export function buildNavGrid(layout: OfficeLayout, cellSize = 0.5): NavGrid {
  const cols = Math.ceil(layout.width / cellSize);
  const rows = Math.ceil(layout.depth / cellSize);
  const walkable = new Uint8Array(cols * rows);
  const walls = buildWallSegments(layout);
  const blockers = layout.objects
    .filter((o) => OBJECT_SPECS[o.type].blocksMovement)
    .map(objectRect);
  const eps = 0.02;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * cellSize;
      const z = (r + 0.5) * cellSize;
      const p: Vec2 = [x, z];
      const inside = layout.rooms.some(
        (room) =>
          x > room.bounds.x && x < room.bounds.x + room.bounds.w && z > room.bounds.z && z < room.bounds.z + room.bounds.d,
      );
      if (!inside) continue;
      if (walls.some((w) => distanceToSegment(p, w) < WALL_CLEARANCE)) continue;
      const h = cellSize / 2 - eps;
      const hit = blockers.some((b) => x + h > b.minX && x - h < b.maxX && z + h > b.minZ && z - h < b.maxZ);
      if (hit) continue;
      walkable[r * cols + c] = 1;
    }
  }
  return { cellSize, cols, rows, walkable };
}

export function isWalkable(grid: NavGrid, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < grid.cols && row < grid.rows && grid.walkable[row * grid.cols + col] === 1;
}

export function worldToCell(grid: NavGrid, p: Vec2): [number, number] {
  return [Math.floor(p[0] / grid.cellSize), Math.floor(p[1] / grid.cellSize)];
}

export function cellToWorld(grid: NavGrid, col: number, row: number): Vec2 {
  return [(col + 0.5) * grid.cellSize, (row + 0.5) * grid.cellSize];
}

/** Célula caminhável mais próxima (busca em anéis). */
export function nearestWalkableCell(grid: NavGrid, p: Vec2, maxRadius = 8): [number, number] | null {
  const [c0, r0] = worldToCell(grid, p);
  if (isWalkable(grid, c0, r0)) return [c0, r0];
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let rad = 1; rad <= maxRadius; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const c = c0 + dc;
        const r = r0 + dr;
        if (!isWalkable(grid, c, r)) continue;
        const [wx, wz] = cellToWorld(grid, c, r);
        const d = Math.hypot(wx - p[0], wz - p[1]);
        if (d < bestD) {
          bestD = d;
          best = [c, r];
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Caminho de `from` até `to` em coordenadas de mundo. O primeiro ponto é a
 * célula de partida e o último é o próprio `to` (ex.: o assento, que pode
 * estar dentro de um móvel como um sofá). Retorna null se inalcançável.
 */
export function findPath(grid: NavGrid, from: Vec2, to: Vec2): Vec2[] | null {
  const start = nearestWalkableCell(grid, from);
  const goal = nearestWalkableCell(grid, to);
  if (!start || !goal) return null;

  const idx = (c: number, r: number) => r * grid.cols + c;
  const startI = idx(start[0], start[1]);
  const goalI = idx(goal[0], goal[1]);
  const n = grid.cols * grid.rows;
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  const h = (i: number) => {
    const dc = Math.abs((i % grid.cols) - goal[0]);
    const dr = Math.abs(Math.floor(i / grid.cols) - goal[1]);
    return dc + dr + (Math.SQRT2 - 2) * Math.min(dc, dr); // octile
  };

  g[startI] = 0;
  heap.push(startI, h(startI));
  const dirs = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ] as const;

  while (heap.size > 0) {
    const cur = heap.pop()!;
    if (cur === goalI) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cc = cur % grid.cols;
    const cr = Math.floor(cur / grid.cols);
    for (const [dc, dr, cost] of dirs) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (!isWalkable(grid, nc, nr)) continue;
      // Diagonal só se as duas ortogonais forem livres (não corta quinas).
      if (dc !== 0 && dr !== 0 && (!isWalkable(grid, cc + dc, cr) || !isWalkable(grid, cc, cr + dr))) continue;
      const ni = idx(nc, nr);
      const ng = g[cur]! + cost;
      if (ng < g[ni]!) {
        g[ni] = ng;
        came[ni] = cur;
        heap.push(ni, ng + h(ni));
      }
    }
  }

  if (startI !== goalI && came[goalI] === -1) return null;

  const cells: number[] = [];
  for (let i = goalI; i !== -1; i = came[i]!) {
    cells.push(i);
    if (i === startI) break;
  }
  cells.reverse();
  const points = cells.map((i) => cellToWorld(grid, i % grid.cols, Math.floor(i / grid.cols)));
  const smoothed = smoothPath(grid, points);
  const last = smoothed[smoothed.length - 1]!;
  if (Math.hypot(last[0] - to[0], last[1] - to[1]) > 1e-6) smoothed.push(to);
  return smoothed;
}

/** Remove pontos intermediários quando há linha de visão livre (string pulling). */
export function smoothPath(grid: NavGrid, points: Vec2[]): Vec2[] {
  if (points.length <= 2) return points.slice();
  const out: Vec2[] = [points[0]!];
  let anchor = 0;
  for (let i = 2; i < points.length; i++) {
    if (!lineOfSight(grid, points[anchor]!, points[i]!)) {
      out.push(points[i - 1]!);
      anchor = i - 1;
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** Verifica se o segmento a→b passa somente por células caminháveis (amostragem fina, com folga lateral). */
export function lineOfSight(grid: NavGrid, a: Vec2, b: Vec2): boolean {
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(1, Math.ceil(dist / (grid.cellSize / 4)));
  const nx = dist === 0 ? 0 : -(b[1] - a[1]) / dist;
  const nz = dist === 0 ? 0 : (b[0] - a[0]) / dist;
  const r = grid.cellSize * 0.3;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[1] + (b[1] - a[1]) * t;
    for (const o of [0, r, -r]) {
      const [c, rr] = worldToCell(grid, [x + nx * o, z + nz * o]);
      if (!isWalkable(grid, c, rr)) return false;
    }
  }
  return true;
}

export function pathLength(path: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]);
  }
  return total;
}

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, p: number) {
    this.items.push(item);
    this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent]! <= this.prio[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastPrio = this.prio.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l]! < this.prio[m]!) m = l;
        if (r < this.items.length && this.prio[r]! < this.prio[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.prio[a], this.prio[b]] = [this.prio[b]!, this.prio[a]!];
  }
}
