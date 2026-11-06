import { getEntranceAnchor } from '../office/anchors';
import type { OfficeLayout, Vec2 } from '../office/layout';
import {
  buildNavGrid,
  cellToWorld,
  findPath,
  isWalkable,
  worldToCell,
  type NavGrid,
} from '../office/navigation';
import type { Pose } from '../state/activity';
import { hash01 } from './random';

/**
 * Simulação de movimento do escritório (independente de renderização).
 *
 * - Caminhos por A* na grade da planta (paredes e móveis) + obstáculos
 *   dinâmicos (pessoas paradas) quando necessário.
 * - Direção suave, aceleração/frenagem, desaceleração em curvas.
 * - Desvio local entre pessoas (passar pela direita, ceder passagem,
 *   seguir quem está à frente) e separação mínima garantida.
 * - Nunca teletransporta: toda mudança de lugar é uma caminhada; quem fica
 *   preso espera e recalcula o caminho.
 */

export type AgentPhase =
  | 'hidden'
  | 'entering'
  | 'standing_up'
  | 'walking'
  | 'arriving'
  | 'sitting_down'
  | 'seated'
  | 'standing';

export interface SimGoal {
  /** Identidade do destino. Mesmo `key` => mesmo destino (não recalcula). */
  key: string;
  kind: 'seat' | 'stand' | 'exit';
  position: Vec2;
  facing: number;
  seatHeight: number;
  label: string;
  pose: Pose;
  /** Quem o personagem está visitando/inspecionando (para reações). */
  interactWith?: string;
  interaction?: 'talk' | 'inspect';
}

export interface HistoryEntry {
  at: number;
  label: string;
}

export interface SimAgent {
  id: string;
  pos: [number, number];
  heading: number;
  /** Velocidade própria de caminhada (m/s). */
  baseSpeed: number;
  speed: number;
  /** Velocidade realmente obtida (após desvios/separação), suavizada. */
  actual: number;
  moveDir: [number, number];
  goal: SimGoal | null;
  path: Vec2[];
  idx: number;
  phase: AgentPhase;
  phaseTime: number;
  /** 0 = em pé, 1 = sentado (interpolado ao sentar/levantar). */
  sit: number;
  /** Altura do assento ocupado (ou sendo deixado), para a animação. */
  seatHeight: number;
  /** Posição do último assento ocupado (ao levantar de um sofá, a saída cruza o móvel). */
  seatPos: [number, number] | null;
  /** Ciclo da passada, proporcional à distância percorrida (sem "patinar"). */
  gait: number;
  waiting: number;
  waitReason: string | null;
  stuckTime: number;
  repathIn: number;
  needsPath: boolean;
  priority: number;
  /** Pose resolvida para o quadro atual. */
  pose: Pose | 'walk';
  /** Com quem está interagindo agora (visitante chegou / visitado). */
  engagedWith: string | null;
  history: HistoryEntry[];
  /** Distância total percorrida (m). */
  distance: number;
}

export interface SimulationOptions {
  /** Raio "físico" de cada pessoa (m). */
  radius?: number;
}

const RADIUS = 0.26;
const MIN_SEP = RADIUS * 2;
const ACCEL = 2.4;
const DECEL = 2.8;
const TURN_RATE = 8;
const SIT_TIME = 0.55;
const MAX_HISTORY = 24;
const PATHS_PER_STEP = 3;
const SUBSTEP = 0.04;

export type SimListener = (agentId: string) => void;

export class OfficeSimulation {
  readonly layout: OfficeLayout;
  readonly grid: NavGrid;
  readonly entrance: { position: Vec2; facing: number };
  readonly agents = new Map<string, SimAgent>();
  private listeners = new Set<SimListener>();
  private pathQueue: string[] = [];
  private nowMs = 0;
  /** Tempo total simulado (s). */
  elapsed = 0;

  constructor(layout: OfficeLayout, grid?: NavGrid) {
    this.layout = layout;
    this.grid = grid ?? buildNavGrid(layout);
    const e = getEntranceAnchor(layout);
    this.entrance = { position: e.position, facing: e.facing + Math.PI };
  }

  subscribe(fn: SimListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(id: string) {
    for (const l of this.listeners) l(id);
  }

  /** Adiciona um personagem já posicionado no destino (carga inicial) ou fora do prédio. */
  addAgent(id: string, goal: SimGoal | null, opts: { baseSpeed?: number } = {}): SimAgent {
    const placed = goal && goal.kind !== 'exit';
    const agent: SimAgent = {
      id,
      pos: placed ? [goal.position[0], goal.position[1]] : [this.entrance.position[0], this.entrance.position[1]],
      heading: placed ? goal.facing : this.entrance.facing,
      baseSpeed: opts.baseSpeed ?? 1.25 + hash01(`speed:${id}`) * 0.45,
      speed: 0,
      actual: 0,
      moveDir: [0, 1],
      goal,
      path: [],
      idx: 0,
      phase: placed ? (goal.seatHeight > 0 ? 'seated' : 'standing') : 'hidden',
      phaseTime: 0,
      sit: placed && goal.seatHeight > 0 ? 1 : 0,
      seatHeight: placed ? goal.seatHeight : 0,
      seatPos: placed && goal.seatHeight > 0 ? [goal.position[0], goal.position[1]] : null,
      gait: 0,
      waiting: 0,
      waitReason: null,
      stuckTime: 0,
      repathIn: 0,
      needsPath: false,
      priority: hash01(`prio:${id}`),
      pose: placed ? goal.pose : 'stand_idle',
      engagedWith: null,
      history: [],
      distance: 0,
    };
    this.agents.set(id, agent);
    if (placed) this.log(agent, `Em ${goal.label}`);
    return agent;
  }

  removeAgent(id: string) {
    this.agents.delete(id);
  }

  /** Define um novo destino. Destinos iguais (mesma `key`) são ignorados. */
  setGoal(id: string, goal: SimGoal) {
    const a = this.agents.get(id);
    if (!a) return;
    if (a.goal?.key === goal.key) {
      // Mesmo destino: só atualiza pose/rótulo (ex.: digitando ↔ ocioso).
      a.goal = { ...goal, position: a.goal.position, facing: a.goal.facing };
      return;
    }
    a.goal = goal;
    this.log(a, goal.kind === 'exit' ? 'Saindo do escritório' : `Indo para ${goal.label}`);
    if (a.phase === 'hidden') {
      if (goal.kind === 'exit') return;
      this.setPhase(a, 'entering');
      return;
    }
    if (a.sit > 0.01) {
      this.setPhase(a, 'standing_up');
      return;
    }
    this.requestPath(a);
  }

  /** Ponto livre para ficar em pé perto de `near`, olhando para `lookAt`. */
  findStandSpot(near: Vec2, lookAt: Vec2, agentId: string, minR = 0.6, maxR = 1.8): { position: Vec2; facing: number } | null {
    const g = this.grid;
    const [c0, r0] = worldToCell(g, near);
    const reach = Math.ceil(maxR / g.cellSize) + 1;
    let best: Vec2 | null = null;
    let bestScore = Infinity;
    for (let dr = -reach; dr <= reach; dr++) {
      for (let dc = -reach; dc <= reach; dc++) {
        const c = c0 + dc;
        const r = r0 + dr;
        if (!isWalkable(g, c, r)) continue;
        const p = cellToWorld(g, c, r);
        const d = Math.hypot(p[0] - near[0], p[1] - near[1]);
        if (d < minR || d > maxR) continue;
        if (this.isReserved(p, agentId)) continue;
        // Prefere ficar à distância de conversa (~1 m) e livre ao redor.
        const score = Math.abs(d - 1.0) + this.crowding(p, agentId) * 0.8;
        if (score < bestScore) {
          bestScore = score;
          best = p;
        }
      }
    }
    if (!best) return null;
    return { position: best, facing: Math.atan2(lookAt[0] - best[0], lookAt[1] - best[1]) };
  }

  private isReserved(p: Vec2, agentId: string): boolean {
    for (const o of this.agents.values()) {
      if (o.id === agentId || o.phase === 'hidden') continue;
      if (o.goal && o.goal.kind !== 'exit' && Math.hypot(o.goal.position[0] - p[0], o.goal.position[1] - p[1]) < 0.7) return true;
      const settled = o.phase === 'seated' || o.phase === 'standing';
      if (settled && Math.hypot(o.pos[0] - p[0], o.pos[1] - p[1]) < 0.7) return true;
    }
    return false;
  }

  private crowding(p: Vec2, agentId: string): number {
    let n = 0;
    for (const o of this.agents.values()) {
      if (o.id === agentId || o.phase === 'hidden') continue;
      if (Math.hypot(o.pos[0] - p[0], o.pos[1] - p[1]) < 1.2) n++;
    }
    return n;
  }

  /** Avança a simulação. `dt` em segundos; `nowMs` = relógio (para o histórico). */
  step(dt: number, nowMs: number) {
    this.nowMs = nowMs;
    let remaining = Math.min(dt, 0.5);
    this.elapsed += remaining;
    this.processPaths();
    while (remaining > 1e-6) {
      const h = Math.min(SUBSTEP, remaining);
      remaining -= h;
      const before = new Map<string, [number, number]>();
      for (const a of this.agents.values()) before.set(a.id, [a.pos[0], a.pos[1]]);
      for (const a of this.agents.values()) this.updateAgent(a, h);
      this.separate();
      for (const a of this.agents.values()) {
        const b = before.get(a.id)!;
        const v = Math.hypot(a.pos[0] - b[0], a.pos[1] - b[1]) / h;
        a.actual += (v - a.actual) * Math.min(1, h * 6);
      }
    }
    this.resolveInteractions();
  }

  // ── Caminhos ───────────────────────────────────────────────────────
  private requestPath(a: SimAgent) {
    a.needsPath = true;
    if (!this.pathQueue.includes(a.id)) this.pathQueue.push(a.id);
    if (a.phase !== 'walking') this.setPhase(a, 'walking');
    a.path = [];
  }

  private processPaths() {
    let budget = PATHS_PER_STEP;
    while (budget > 0 && this.pathQueue.length) {
      const id = this.pathQueue.shift()!;
      const a = this.agents.get(id);
      if (!a || !a.needsPath || !a.goal) continue;
      budget--;
      a.needsPath = false;
      const dynamic = a.stuckTime > 0 ? this.dynamicGrid(a) : null;
      const path = (dynamic && findPath(dynamic, a.pos, a.goal.position)) || findPath(this.grid, a.pos, a.goal.position);
      if (!path || path.length === 0) {
        // Sem caminho agora: espera e tenta de novo (nunca teletransporta).
        a.waitReason = 'sem caminho livre';
        a.repathIn = 1.5;
        continue;
      }
      a.path = path;
      a.idx = Math.hypot(path[0]![0] - a.pos[0], path[0]![1] - a.pos[1]) < 0.3 && path.length > 1 ? 1 : 0;
      a.waitReason = null;
    }
  }

  /** Grade com pessoas paradas marcadas como obstáculo (usada ao desviar). */
  private dynamicGrid(self: SimAgent): NavGrid {
    const walkable = new Uint8Array(this.grid.walkable);
    const g = this.grid;
    const goalCell = self.goal ? worldToCell(g, self.goal.position) : null;
    const startCell = worldToCell(g, self.pos);
    for (const o of this.agents.values()) {
      if (o.id === self.id || o.phase === 'hidden') continue;
      const stationary = o.phase !== 'walking' || o.actual < 0.08;
      if (!stationary) continue;
      const [c, r] = worldToCell(g, o.pos);
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) {
          const cc = c + dc;
          const rr = r + dr;
          if (cc < 0 || rr < 0 || cc >= g.cols || rr >= g.rows) continue;
          const center = cellToWorld(g, cc, rr);
          if (Math.hypot(center[0] - o.pos[0], center[1] - o.pos[1]) > 0.62) continue;
          if (goalCell && cc === goalCell[0] && rr === goalCell[1]) continue;
          if (cc === startCell[0] && rr === startCell[1]) continue;
          walkable[rr * g.cols + cc] = 0;
        }
    }
    return { ...g, walkable };
  }

  // ── Atualização de cada personagem ─────────────────────────────────
  private updateAgent(a: SimAgent, dt: number) {
    a.phaseTime += dt;
    switch (a.phase) {
      case 'hidden':
        return;
      case 'entering': {
        // Entra pela porta só quando a entrada está livre (evita sobreposição).
        if (this.isAreaFree(this.entrance.position, a.id, 0.7)) {
          a.pos = [this.entrance.position[0], this.entrance.position[1]];
          a.heading = this.entrance.facing;
          this.requestPath(a);
        }
        return;
      }
      case 'standing_up': {
        a.sit = Math.max(0, a.sit - dt / SIT_TIME);
        a.pose = 'stand_idle';
        if (a.sit <= 0) this.requestPath(a);
        return;
      }
      case 'sitting_down': {
        a.sit = Math.min(1, a.sit + dt / SIT_TIME);
        if (a.goal) {
          a.pos[0] += (a.goal.position[0] - a.pos[0]) * Math.min(1, dt * 8);
          a.pos[1] += (a.goal.position[1] - a.pos[1]) * Math.min(1, dt * 8);
          a.heading = turn(a.heading, a.goal.facing, TURN_RATE * dt);
        }
        if (a.sit >= 1) {
          this.setPhase(a, 'seated');
          if (a.goal) this.log(a, `Sentou: ${a.goal.label}`);
        }
        return;
      }
      case 'arriving': {
        if (!a.goal) return;
        a.speed = 0;
        a.heading = turn(a.heading, a.goal.facing, TURN_RATE * 0.8 * dt);
        if (Math.abs(angleDiff(a.heading, a.goal.facing)) < 0.06 || a.phaseTime > 0.9) {
          if (a.goal.seatHeight > 0) {
            a.seatHeight = a.goal.seatHeight;
            a.seatPos = [a.goal.position[0], a.goal.position[1]];
            this.setPhase(a, 'sitting_down');
          }
          else {
            this.setPhase(a, 'standing');
            this.log(a, `Chegou: ${a.goal.label}`);
          }
        }
        return;
      }
      case 'seated':
      case 'standing': {
        a.speed = 0;
        if (a.goal) a.heading = turn(a.heading, a.goal.facing, TURN_RATE * 0.5 * dt);
        a.pose = a.goal?.pose ?? 'stand_idle';
        return;
      }
      case 'walking':
        this.walk(a, dt);
    }
  }

  private walk(a: SimAgent, dt: number) {
    if (!a.goal) return;
    if (a.repathIn > 0) {
      a.repathIn -= dt;
      if (a.repathIn <= 0) this.requestPath(a);
    }
    if (a.path.length === 0 || a.idx >= a.path.length) {
      a.speed = Math.max(0, a.speed - DECEL * dt);
      a.pose = a.waitReason ? 'wait' : 'stand_idle';
      if (a.path.length > 0 && a.idx >= a.path.length) this.arrive(a);
      return;
    }

    const wp = a.path[a.idx]!;
    let dx = wp[0] - a.pos[0];
    let dz = wp[1] - a.pos[1];
    const dist = Math.hypot(dx, dz);
    const isLast = a.idx === a.path.length - 1;
    const arriveRadius = isLast ? (a.goal.kind === 'exit' ? 0.35 : 0.04) : 0.18;
    if (dist < arriveRadius) {
      a.idx++;
      if (a.idx >= a.path.length) this.arrive(a);
      return;
    }
    dx /= dist;
    dz /= dist;

    // ── Desvio local entre pessoas ──────────────────────────────────
    let speedCap = a.baseSpeed;
    let side = 0;
    let yieldNow = false;
    let blockedByStatic = false;
    const remainingToGoal = this.remainingDistance(a);
    for (const o of this.agents.values()) {
      if (o === a || o.phase === 'hidden' || o.phase === 'entering') continue;
      const ox = o.pos[0] - a.pos[0];
      const oz = o.pos[1] - a.pos[1];
      const od = Math.hypot(ox, oz);
      if (od > 1.4 || od < 1e-6) continue;
      const ahead = (ox * dx + oz * dz) / od;
      if (ahead < 0.35) continue;
      const proj = ox * dx + oz * dz;
      const lateral = Math.abs(ox * dz - oz * dx);
      const onMyWay = proj > 0 && proj < dist + 0.6 && lateral < MIN_SEP;
      if (o.phase === 'walking') {
        if (o.actual > 0.12) {
          const align = o.moveDir[0] * dx + o.moveDir[1] * dz;
          if (align < -0.3 && od < 1.3) side += 1; // de frente: ambos passam pela direita
          else if (align > 0.5) speedCap = Math.min(speedCap, Math.max(0, (od - MIN_SEP) * 1.6)); // segue
          else if (od < 1.0 && a.priority < o.priority) yieldNow = true; // cruzamento: cede passagem
        } else if (onMyWay && od < 0.9 && a.priority < o.priority) {
          // Outra pessoa parada no caminho também tentando andar: só o de menor
          // prioridade espera (ordem estrita => sem impasse); o outro passa ao lado.
          yieldNow = true;
        }
      } else if (od < 0.9 && od < remainingToGoal + 0.1) {
        // Parado de vez (sentado, conversando…) sobre o trecho que vamos percorrer.
        // Depois de esperar um pouco, aceita passar mais rente (a separação mínima continua valendo).
        const clearance = a.waiting > 3 ? MIN_SEP * 0.6 : MIN_SEP * 0.95;
        if (proj > 0 && proj < dist + 0.3 && lateral < clearance) blockedByStatic = true;
      }
    }

    let mx = dx;
    let mz = dz;
    if (side > 0) {
      // Direita relativa à direção: (dz, -dx). Se não couber, tenta a esquerda.
      for (const s of [1, -1]) {
        const px = mx + dz * 0.75 * s;
        const pz = mz - dx * 0.75 * s;
        const n = Math.hypot(px, pz);
        const probe: Vec2 = [a.pos[0] + (px / n) * 0.45, a.pos[1] + (pz / n) * 0.45];
        if (this.walkableAt(probe)) {
          mx = px / n;
          mz = pz / n;
          break;
        }
      }
    }

    if (blockedByStatic && a.waiting > 4 && remainingToGoal < 1.6 && a.goal.kind === 'stand') {
      // Quase chegando e o espaço está tomado: fica num ponto próximo (sem atravessar ninguém).
      a.goal = { ...a.goal, position: [a.pos[0], a.pos[1]] };
      this.arrive(a);
      return;
    }
    if (blockedByStatic || yieldNow) {
      a.waiting += dt;
      a.waitReason = blockedByStatic ? 'caminho ocupado' : 'cedendo passagem';
      speedCap = 0;
      if (blockedByStatic && a.waiting > 0.35 && a.repathIn <= 0) {
        a.stuckTime = 1;
        a.repathIn = 1.2;
        this.requestPath(a);
      }
      if (yieldNow && a.waiting > 2.5 && a.repathIn <= 0) {
        a.stuckTime = 1;
        a.repathIn = 2;
        this.requestPath(a);
      }
    } else {
      a.waiting = 0;
      a.waitReason = null;
    }

    // ── Velocidade: aceleração, curvas e frenagem ───────────────────
    const turnNeed = Math.abs(angleDiff(a.heading, Math.atan2(mx, mz)));
    const turnFactor = Math.max(0.3, Math.cos(Math.min(turnNeed, Math.PI / 2)));
    const remaining = this.remainingDistance(a);
    const brake = Math.sqrt(2 * DECEL * Math.max(0, remaining - 0.02)) + (a.goal.kind === 'exit' ? 0.4 : 0.05);
    const target = Math.min(speedCap * turnFactor, brake, a.baseSpeed);
    a.speed = target > a.speed ? Math.min(target, a.speed + ACCEL * dt) : Math.max(target, a.speed - DECEL * 1.5 * dt);

    a.heading = turn(a.heading, Math.atan2(mx, mz), TURN_RATE * dt);
    a.moveDir = [mx, mz];
    const stepLen = Math.min(a.speed * dt, dist);
    this.tryMove(a, mx * stepLen, mz * stepLen, isLast);
    a.pose = a.speed < 0.08 && a.waiting > 0.25 ? 'wait' : 'walk';

    // Detecção de "preso": quer andar mas não sai do lugar.
    if (a.actual < 0.06 && speedCap > 0) {
      a.stuckTime += dt;
      // Quase lá e o espaço em pé ficou ocupado: para num ponto próximo.
      if (a.goal.kind === 'stand' && a.stuckTime > 2 && remainingToGoal < 0.9) {
        a.goal = { ...a.goal, position: [a.pos[0], a.pos[1]] };
        this.arrive(a);
        return;
      }
      if (a.stuckTime > 1.5 && a.repathIn <= 0) {
        a.repathIn = 1.5;
        this.requestPath(a);
      }
    } else if (a.actual > 0.2) {
      a.stuckTime = 0;
    }
  }

  private tryMove(a: SimAgent, mx: number, mz: number, finalApproach: boolean) {
    const cur: Vec2 = [a.pos[0], a.pos[1]];
    const escaping = !this.walkableAt(cur); // saindo de um sofá/poltrona
    const ok = (p: Vec2) => escaping || this.walkableAt(p) || (finalApproach && a.goal?.kind === 'seat');
    const candidates: Vec2[] = [
      [cur[0] + mx, cur[1] + mz],
      [cur[0] + mx, cur[1]],
      [cur[0], cur[1] + mz],
    ];
    for (const p of candidates) {
      if (ok(p)) {
        const moved = Math.hypot(p[0] - cur[0], p[1] - cur[1]);
        a.pos = [p[0], p[1]];
        a.gait += moved * 3.4;
        a.distance += moved;
        return;
      }
    }
  }

  private remainingDistance(a: SimAgent): number {
    let d = 0;
    let prev: Vec2 = a.pos;
    for (let i = a.idx; i < a.path.length; i++) {
      const p = a.path[i]!;
      d += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      prev = p;
      if (d > 3) break;
    }
    return d;
  }

  private arrive(a: SimAgent) {
    if (!a.goal) return;
    a.speed = 0;
    a.path = [];
    if (a.goal.kind === 'exit') {
      this.setPhase(a, 'hidden');
      this.log(a, 'Saiu do escritório');
      return;
    }
    this.setPhase(a, 'arriving');
  }

  /** Garante distância mínima entre pessoas (sem atravessar ninguém). */
  private separate() {
    const list = [...this.agents.values()].filter((a) => a.phase !== 'hidden' && a.phase !== 'entering');
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        let dx = b.pos[0] - a.pos[0];
        let dz = b.pos[1] - a.pos[1];
        let d = Math.hypot(dx, dz);
        if (d >= MIN_SEP) continue;
        if (d < 1e-4) {
          dx = Math.cos(a.priority * 6.28);
          dz = Math.sin(a.priority * 6.28);
          d = 1e-4;
        }
        const overlap = MIN_SEP - d;
        const aMov = this.movable(a);
        const bMov = this.movable(b);
        if (!aMov && !bMov) continue;
        const wa = aMov && bMov ? 0.5 : aMov ? 1 : 0;
        const wb = aMov && bMov ? 0.5 : bMov ? 1 : 0;
        this.push(a, (-dx / d) * overlap * wa, (-dz / d) * overlap * wa);
        this.push(b, (dx / d) * overlap * wb, (dz / d) * overlap * wb);
      }
    }
  }

  private movable(a: SimAgent): boolean {
    return a.phase === 'walking' || a.phase === 'standing' || a.phase === 'arriving';
  }

  private push(a: SimAgent, dx: number, dz: number) {
    if (dx === 0 && dz === 0) return;
    const p: Vec2 = [a.pos[0] + dx, a.pos[1] + dz];
    if (this.walkableAt(p) || !this.walkableAt(a.pos)) a.pos = [p[0], p[1]];
    else if (this.walkableAt([p[0], a.pos[1]])) a.pos = [p[0], a.pos[1]];
    else if (this.walkableAt([a.pos[0], p[1]])) a.pos = [a.pos[0], p[1]];
  }

  /** Reações: quem é visitado vira para o visitante; ambos conversam. */
  private resolveInteractions() {
    for (const a of this.agents.values()) a.engagedWith = null;
    for (const a of this.agents.values()) {
      const g = a.goal;
      if (!g?.interactWith || a.phase !== 'standing') continue;
      const other = this.agents.get(g.interactWith);
      if (!other || other.phase === 'hidden') continue;
      const d = Math.hypot(other.pos[0] - a.pos[0], other.pos[1] - a.pos[1]);
      if (d > 2.2) continue;
      a.engagedWith = other.id;
      a.heading = turn(a.heading, Math.atan2(other.pos[0] - a.pos[0], other.pos[1] - a.pos[1]), 0.15);
      if (other.phase === 'seated' || other.phase === 'standing') {
        other.engagedWith = a.id;
        // O visitado conversa (se não estiver digitando uma tarefa real).
        if (g.interaction === 'talk' && other.pose !== 'sit_typing') {
          other.pose = other.phase === 'seated' ? 'sit_talking' : 'stand_talk';
        }
        if (other.phase === 'standing') {
          other.heading = turn(other.heading, Math.atan2(a.pos[0] - other.pos[0], a.pos[1] - other.pos[1]), 0.15);
        }
      }
    }
  }

  // ── Utilidades ─────────────────────────────────────────────────────
  walkableAt(p: Vec2): boolean {
    const [c, r] = worldToCell(this.grid, p);
    return isWalkable(this.grid, c, r);
  }

  private isAreaFree(p: Vec2, selfId: string, radius: number): boolean {
    for (const o of this.agents.values()) {
      if (o.id === selfId || o.phase === 'hidden' || o.phase === 'entering') continue;
      if (Math.hypot(o.pos[0] - p[0], o.pos[1] - p[1]) < radius) return false;
    }
    return true;
  }

  private setPhase(a: SimAgent, phase: AgentPhase) {
    if (a.phase === phase) return;
    a.phase = phase;
    a.phaseTime = 0;
    this.emit(a.id);
  }

  private log(a: SimAgent, label: string) {
    a.history.unshift({ at: this.nowMs, label });
    if (a.history.length > MAX_HISTORY) a.history.length = MAX_HISTORY;
    this.emit(a.id);
  }
}

function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turn(from: number, to: number, maxStep: number): number {
  const d = angleDiff(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}
