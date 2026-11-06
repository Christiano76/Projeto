import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMPLOYEES,
  OfficeSimulation,
  createDefaultLayout,
  getPointsOfInterest,
  getSeatAnchors,
  getStrollPoints,
  isWalkable,
  toSimGoal,
  worldToCell,
  type SimGoal,
  type Vec2,
} from '../src';

const layout = createDefaultLayout();
const seats = new Map(getSeatAnchors(layout).map((s) => [s.key, s]));

function deskGoal(seatKey: string): SimGoal {
  const s = seats.get(seatKey)!;
  return { key: `seat:${s.key}`, kind: 'seat', position: s.position, facing: s.facing, seatHeight: s.seatHeight, label: s.key, pose: 'sit_idle' };
}

/** Executa a simulação verificando invariantes a cada passo. */
function run(sim: OfficeSimulation, seconds: number, onStep?: (t: number) => void) {
  const dt = 1 / 30;
  const stats = { minSep: Infinity, maxStep: 0, illegal: [] as string[] };
  const prev = new Map<string, Vec2>();
  for (let t = 0; t < seconds; t += dt) {
    onStep?.(t);
    sim.step(dt, t * 1000);
    const visible = [...sim.agents.values()].filter((a) => a.phase !== 'hidden' && a.phase !== 'entering');
    for (const a of visible) {
      const p = prev.get(a.id);
      if (p) stats.maxStep = Math.max(stats.maxStep, Math.hypot(a.pos[0] - p[0], a.pos[1] - p[1]));
      prev.set(a.id, [a.pos[0], a.pos[1]]);
      // Fora da grade caminhável só é permitido junto ao próprio assento (sofá/poltrona).
      const [c, r] = worldToCell(sim.grid, a.pos);
      if (!isWalkable(sim.grid, c, r)) {
        const g = a.goal;
        const nearSeat = g && Math.hypot(g.position[0] - a.pos[0], g.position[1] - a.pos[1]) < 0.9;
        const nearChair = [...seats.values()].some((s) => Math.hypot(s.position[0] - a.pos[0], s.position[1] - a.pos[1]) < 0.9);
        if (!nearSeat && !nearChair) stats.illegal.push(`${a.id}@${a.pos.map((v) => v.toFixed(2))}`);
      }
    }
    for (let i = 0; i < visible.length; i++)
      for (let j = i + 1; j < visible.length; j++) {
        const d = Math.hypot(visible[i]!.pos[0] - visible[j]!.pos[0], visible[i]!.pos[1] - visible[j]!.pos[1]);
        stats.minSep = Math.min(stats.minSep, d);
      }
    for (const a of sim.agents.values()) if (a.phase === 'hidden') prev.delete(a.id);
  }
  return stats;
}

describe('simulação de movimento', () => {
  it('todos entram pela recepção e chegam sentados às próprias mesas', () => {
    const sim = new OfficeSimulation(layout);
    DEFAULT_EMPLOYEES.forEach((e) => sim.addAgent(e.key, null));
    DEFAULT_EMPLOYEES.forEach((e) => sim.setGoal(e.key, deskGoal(e.deskSeatKey)));
    const stats = run(sim, 90);
    for (const e of DEFAULT_EMPLOYEES) {
      const a = sim.agents.get(e.key)!;
      expect(a.phase, e.key).toBe('seated');
      const seat = seats.get(e.deskSeatKey)!;
      expect(Math.hypot(a.pos[0] - seat.position[0], a.pos[1] - seat.position[1])).toBeLessThan(0.05);
      expect(a.history.some((h) => h.label.startsWith('Sentou'))).toBe(true);
    }
    expect(stats.illegal).toEqual([]);
    expect(stats.maxStep).toBeLessThan(0.12); // sem teletransporte (≤ ~3,6 m/s)
    expect(stats.minSep).toBeGreaterThan(0.4); // ninguém atravessa ninguém
  });

  it('circulação intensa: destinos trocados repetidamente sem colisões, travamentos ou atravessar móveis', () => {
    const sim = new OfficeSimulation(layout);
    const grid = sim.grid;
    const pois = [...getPointsOfInterest(layout, grid), ...getStrollPoints(layout, grid)];
    const ids = DEFAULT_EMPLOYEES.map((e) => e.key);
    ids.forEach((id, i) => sim.addAgent(id, deskGoal(DEFAULT_EMPLOYEES[i]!.deskSeatKey)));
    let round = 0;
    const lastGoalAt = new Map<string, number>();
    const stats = run(sim, 250, (t) => {
      const r = Math.floor(t / 20);
      if (r === round || r >= 12) return; // últimos 10 s: só concluir os trajetos
      round = r;
      ids.forEach((id, i) => {
        const goToPoi = (i + r) % 2 === 0;
        const goal = goToPoi
          ? toSimGoal(sim, id, {
              kind: 'near',
              key: `t:${id}:${r}`,
              point: pois[(i * 7 + r * 3) % pois.length]!.position,
              lookAt: [0, 0],
              pose: 'stand_idle',
              label: 'poi',
              activity: 'teste',
            })
          : deskGoal(DEFAULT_EMPLOYEES[i]!.deskSeatKey);
        if (goal) {
          sim.setGoal(id, goal);
          lastGoalAt.set(id, t);
        }
      });
    });
    expect(stats.illegal).toEqual([]);
    expect(stats.maxStep).toBeLessThan(0.12);
    expect(stats.minSep).toBeGreaterThan(0.38);
    // Depois de 20 s cada um deve ter chegado (ninguém preso para sempre).
    const settled = [...sim.agents.values()].filter((a) => a.phase === 'seated' || a.phase === 'standing');
    expect(settled.map((a) => a.id).sort()).toEqual([...ids].sort());
  });

  it('saída e retorno: sai pela recepção, some e volta caminhando', () => {
    const sim = new OfficeSimulation(layout);
    const e = DEFAULT_EMPLOYEES[4]!;
    sim.addAgent(e.key, deskGoal(e.deskSeatKey));
    sim.setGoal(e.key, { key: 'exit', kind: 'exit', position: sim.entrance.position, facing: 0, seatHeight: 0, label: 'Saída', pose: 'stand_idle' });
    run(sim, 40);
    expect(sim.agents.get(e.key)!.phase).toBe('hidden');
    sim.setGoal(e.key, deskGoal(e.deskSeatKey));
    run(sim, 40);
    expect(sim.agents.get(e.key)!.phase).toBe('seated');
  });

  it('findStandSpot não reserva o mesmo lugar para duas pessoas', () => {
    const sim = new OfficeSimulation(layout);
    const target = seats.get(DEFAULT_EMPLOYEES[5]!.deskSeatKey)!.position;
    const a = toSimGoal(sim, 'a', { kind: 'near', key: 'a', point: target, lookAt: target, pose: 'stand_talk', label: 'x', activity: 'x', minR: 0.7, maxR: 1.6 })!;
    sim.addAgent('a', a);
    const b = toSimGoal(sim, 'b', { kind: 'near', key: 'b', point: target, lookAt: target, pose: 'stand_talk', label: 'x', activity: 'x', minR: 0.7, maxR: 1.6 })!;
    expect(Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1])).toBeGreaterThanOrEqual(0.7);
  });
});
