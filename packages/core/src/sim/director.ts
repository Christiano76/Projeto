import type { GoalSpec } from './behavior';
import type { OfficeSimulation, SimGoal } from './simulation';

/** Rótulo de atividade atual de cada agente (para a ficha do funcionário). */
export const agentActivity = new Map<string, string>();

/**
 * Converte as intenções (GoalSpec) em destinos concretos da simulação.
 * Só procura um novo ponto livre quando a intenção muda (mesma `key` = mesmo destino).
 */
export function applyGoalSpecs(sim: OfficeSimulation, specs: ReadonlyMap<string, GoalSpec>) {
  for (const [id, spec] of specs) {
    const agent = sim.agents.get(id);
    agentActivity.set(id, spec.activity);
    if (agent?.goal?.key === spec.key) {
      if (agent.goal.pose !== poseOf(spec) || agent.goal.label !== spec.label) {
        sim.setGoal(id, { ...agent.goal, pose: poseOf(spec), label: spec.label });
      }
      continue;
    }
    const goal = toSimGoal(sim, id, spec);
    if (!goal) continue; // sem ponto livre agora: tenta no próximo ciclo
    if (!agent) sim.addAgent(id, goal);
    else sim.setGoal(id, goal);
  }
}

function poseOf(spec: GoalSpec) {
  return spec.kind === 'exit' ? 'stand_idle' : spec.pose;
}

export function toSimGoal(sim: OfficeSimulation, agentId: string, spec: GoalSpec): SimGoal | null {
  switch (spec.kind) {
    case 'exit':
      return {
        key: spec.key,
        kind: 'exit',
        position: sim.entrance.position,
        facing: sim.entrance.facing + Math.PI,
        seatHeight: 0,
        label: spec.label,
        pose: 'stand_idle',
      };
    case 'seat':
      return {
        key: spec.key,
        kind: 'seat',
        position: spec.anchor.position,
        facing: spec.anchor.facing,
        seatHeight: spec.anchor.seatHeight,
        label: spec.label,
        pose: spec.pose,
      };
    case 'near': {
      const spot = sim.findStandSpot(spec.point, spec.lookAt, agentId, spec.minR ?? 0.6, spec.maxR ?? 1.8);
      if (!spot) return null;
      return {
        key: spec.key,
        kind: 'stand',
        position: spot.position,
        facing: spot.facing,
        seatHeight: 0,
        label: spec.label,
        pose: spec.pose,
        ...(spec.interactWith ? { interactWith: spec.interactWith } : {}),
        ...(spec.interaction ? { interaction: spec.interaction } : {}),
      };
    }
  }
}
