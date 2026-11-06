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
} from '../src';

/**
 * Estresse: 8 pessoas trocando de destino (mesas, reuniões, descanso, pontos
 * de interesse) a cada 25 s por 5 min, em vários cenários. Verifica que
 * ninguém fica preso, atravessa móveis/paredes ou se sobrepõe a outra pessoa.
 */
describe('simulação — estresse de circulação', () => {
  const layout = createDefaultLayout();
  const seats = getSeatAnchors(layout);
  const byKey = new Map(seats.map((s) => [s.key, s]));
  const shared = seats.filter((s) => s.kind === 'meeting' || s.kind === 'lounge');
  const seatGoal = (key: string, label: string, s = byKey.get(key)!): SimGoal => ({
    key,
    kind: 'seat',
    position: s.position,
    facing: s.facing,
    seatHeight: s.seatHeight,
    label,
    pose: 'sit_idle',
  });

  for (const seed of [0, 3, 7, 10]) {
    it(`cenário ${seed}`, () => {
      const sim = new OfficeSimulation(layout);
      const pois = [...getPointsOfInterest(layout, sim.grid), ...getStrollPoints(layout, sim.grid)];
      const ids = DEFAULT_EMPLOYEES.map((e) => e.key);
      ids.forEach((id, i) => sim.addAgent(id, seatGoal(DEFAULT_EMPLOYEES[i]!.deskSeatKey, 'mesa')));
      let worstSep = Infinity;
      let illegal = 0;
      const still = new Map<string, { p: [number, number]; n: number }>();
      let stuck = 0;
      for (let t = 0, round = -1; t < 300; t += 1 / 30) {
        const r = Math.floor(t / 25);
        if (r !== round) {
          round = r;
          ids.forEach((id, i) => {
            const mode = (i * 13 + r * 7 + seed * 5) % 4;
            let g: SimGoal | null = null;
            if (mode === 0) g = { ...seatGoal(DEFAULT_EMPLOYEES[i]!.deskSeatKey, 'mesa'), key: `d${id}${r}` };
            else if (mode === 1) {
              const s = shared[(i + r + seed) % shared.length]!;
              const taken = [...sim.agents.values()].some((a) => a.id !== id && a.goal?.position === s.position);
              if (!taken) g = { ...seatGoal(s.key, 'compartilhado', s), key: `m${id}${r}` };
            } else {
              const p = pois[(i * 7 + r * 3 + seed * 11) % pois.length]!;
              g = toSimGoal(sim, id, { kind: 'near', key: `p${id}${r}`, point: p.position, lookAt: [0, 0], pose: 'stand_idle', label: p.label, activity: '' });
            }
            if (g) sim.setGoal(id, g);
          });
        }
        sim.step(1 / 30, t * 1000);
        const l = [...sim.agents.values()];
        for (let a = 0; a < l.length; a++)
          for (let b = a + 1; b < l.length; b++)
            worstSep = Math.min(worstSep, Math.hypot(l[a]!.pos[0] - l[b]!.pos[0], l[a]!.pos[1] - l[b]!.pos[1]));
        for (const a of l) {
          const [c, rr] = worldToCell(sim.grid, a.pos);
          const nearSeat = seats.some((s) => Math.hypot(s.position[0] - a.pos[0], s.position[1] - a.pos[1]) < 0.9);
          if (!isWalkable(sim.grid, c, rr) && !nearSeat) illegal++;
          const prev = still.get(a.id);
          if (a.phase === 'walking' && prev && Math.hypot(prev.p[0] - a.pos[0], prev.p[1] - a.pos[1]) < 0.02) prev.n++;
          else still.set(a.id, { p: [a.pos[0], a.pos[1]], n: 0 });
          if ((still.get(a.id)?.n ?? 0) === 30 * 6) stuck++; // 6 s parado querendo andar
        }
      }
      expect(illegal).toBe(0);
      expect(stuck).toBe(0);
      expect(worstSep).toBeGreaterThan(0.45);
    });
  }
});
