import type {
  Employee,
  EmployeeRuntimeState,
  InspectionFinding,
  SupervisionReason,
} from '../domain/types';
import type { AgentEvent } from '../events/schema';

/**
 * Supervisão do gerente.
 *
 * Funções puras que avaliam o ESTADO REAL dos funcionários. O servidor as usa
 * para escolher a próxima visita e para montar o registro da inspeção — o
 * cliente nunca afirma ter inspecionado algo por conta própria.
 */

export interface SupervisionConfig {
  /** Ocioso por mais que isso => achado "idle_long". */
  idleLongMs: number;
  /** Mesma tarefa por mais que isso => "long_running". */
  longRunningMs: number;
  /** Intervalo mínimo entre inspeções de rotina do mesmo funcionário. */
  routineCooldownMs: number;
  /** Intervalo mínimo entre inspeções do mesmo problema. */
  problemCooldownMs: number;
}

export const DEFAULT_SUPERVISION_CONFIG: SupervisionConfig = {
  idleLongMs: 10 * 60_000,
  longRunningMs: 30 * 60_000,
  routineCooldownMs: 3 * 60_000,
  problemCooldownMs: 5 * 60_000,
};

const SEVERITY: Record<SupervisionReason, number> = {
  error: 100,
  blocked: 90,
  overdue: 70,
  long_running: 40,
  idle_long: 30,
  routine: 0,
};

/** Achados que exigem atenção imediata (interrompem a ronda). */
export const URGENT_REASONS: ReadonlySet<SupervisionReason> = new Set(['error', 'blocked']);

/** Avalia o estado real de um funcionário. Retorna `['ok']` se nada chamar atenção. */
export function assessEmployee(
  runtime: EmployeeRuntimeState,
  nowMs: number,
  cfg: SupervisionConfig = DEFAULT_SUPERVISION_CONFIG,
): InspectionFinding[] {
  const findings: InspectionFinding[] = [];
  const inStatus = nowMs - Date.parse(runtime.statusSince);
  if (runtime.status === 'error') findings.push('error');
  if (runtime.status === 'blocked') findings.push('blocked');
  const due = runtime.currentTask?.dueAt ? Date.parse(runtime.currentTask.dueAt) : NaN;
  if (runtime.currentTask && Number.isFinite(due) && nowMs > due) findings.push('overdue');
  if (runtime.status === 'working' && inStatus > cfg.longRunningMs) findings.push('long_running');
  if (runtime.status === 'idle' && inStatus > cfg.idleLongMs) findings.push('idle_long');
  return findings.length ? findings : ['ok'];
}

export function mainReason(findings: readonly InspectionFinding[]): SupervisionReason {
  let best: SupervisionReason = 'routine';
  for (const f of findings) {
    if (f !== 'ok' && SEVERITY[f] > SEVERITY[best]) best = f;
  }
  return best;
}

/** Último horário (ms) em que cada funcionário foi inspecionado, a partir dos eventos. */
export function lastInspections(events: readonly AgentEvent[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'supervision.inspected') continue;
    const t = Date.parse(e.createdAt);
    const id = e.payload.targetEmployeeId;
    if ((map.get(id) ?? -Infinity) < t) map.set(id, t);
  }
  return map;
}

export interface InspectionChoice {
  targetEmployeeId: string;
  reason: SupervisionReason;
  score: number;
}

/**
 * Escolhe quem o gerente deve visitar agora. Prioriza problemas reais
 * (falha, bloqueio, atraso…); sem problemas, faz rondas de rotina pelos
 * funcionários há mais tempo sem visita. Retorna null se não houver ninguém
 * a visitar (todos inspecionados recentemente, ausentes ou em reunião/pausa).
 */
export function chooseInspectionTarget(
  managerId: string,
  employees: readonly Pick<Employee, 'id' | 'runtime'>[],
  inspectedAt: ReadonlyMap<string, number>,
  nowMs: number,
  cfg: SupervisionConfig = DEFAULT_SUPERVISION_CONFIG,
): InspectionChoice | null {
  let best: InspectionChoice | null = null;
  for (const e of employees) {
    if (e.id === managerId) continue;
    const st = e.runtime.status;
    if (st === 'offline' || st === 'meeting' || st === 'resting') continue;
    const reason = mainReason(assessEmployee(e.runtime, nowMs, cfg));
    const last = inspectedAt.get(e.id) ?? -Infinity;
    const since = nowMs - last;
    if (reason === 'routine') {
      if (since < cfg.routineCooldownMs) continue;
    } else {
      // Problema já inspecionado depois de surgir => respeita o intervalo.
      const problemSince = Date.parse(e.runtime.statusSince);
      if (last >= problemSince && since < cfg.problemCooldownMs) continue;
    }
    const staleness = Math.min(since, 60 * 60_000) / 60_000; // minutos (até 60)
    const score = SEVERITY[reason] * 10 + staleness;
    if (!best || score > best.score || (score === best.score && e.id < best.targetEmployeeId)) {
      best = { targetEmployeeId: e.id, reason, score };
    }
  }
  return best;
}

/** A ronda atual deve ser interrompida por esta nova escolha? */
export function shouldInterrupt(current: SupervisionReason, candidate: InspectionChoice | null): boolean {
  return !!candidate && URGENT_REASONS.has(candidate.reason) && !URGENT_REASONS.has(current);
}

/** Monta o registro de inspeção a partir do estado real consultado. */
export function buildInspectionPayload(target: Pick<Employee, 'id' | 'runtime'>, nowMs: number, cfg = DEFAULT_SUPERVISION_CONFIG) {
  const rt = target.runtime;
  return {
    targetEmployeeId: target.id,
    observedStatus: rt.status,
    ...(rt.currentTask ? { taskId: rt.currentTask.id, taskTitle: rt.currentTask.title } : {}),
    findings: assessEmployee(rt, nowMs, cfg),
    statusMinutes: Math.max(0, Math.floor((nowMs - Date.parse(rt.statusSince)) / 60_000)),
  };
}
