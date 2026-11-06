import {
  DEFAULT_SUPERVISION_CONFIG,
  URGENT_REASONS,
  buildInspectionPayload,
  chooseInspectionTarget,
  lastInspections,
  shouldInterrupt,
  type Employee,
} from '@agency/core';
import { ingestEvent, type IngestResult } from './events';
import type { Repository } from './repository/types';

/**
 * Supervisão do gerente — decidida e registrada NO SERVIDOR com dados reais.
 *
 * O escritório 3D executa a caminhada. Um único navegador por empresa
 * ("líder", com concessão renovável) avisa o servidor do ritmo da ronda; o
 * servidor escolhe quem visitar e, na chegada, consulta o estado verdadeiro do
 * funcionário para montar o registro. Nada é afirmado pelo cliente.
 */

export const LEASE_MS = 20_000;
/** Tempo mínimo entre início da visita e registro (caminhada + observação). */
export const MIN_VISIT_MS = 4_000;
/** Visita sem conclusão por mais que isso é encerrada (líder sumiu, por ex.). */
export const VISIT_TIMEOUT_MS = 3 * 60_000;
/** Pausa entre uma inspeção e a próxima visita (o gerente "anota" e segue). */
export const BETWEEN_VISITS_MS = 6_000;
/** Após N inspeções em sequência, o gerente volta à sala por este tempo (salvo urgência). */
export const ROUND_SIZE = 3;
export const ROUND_REST_MS = 75_000;

interface Lease {
  clientId: string;
  until: number;
}
const globalRef = globalThis as unknown as { __agencyLeases?: Map<string, Lease> };
const leases = (globalRef.__agencyLeases ??= new Map());

export function acquireLease(companyId: string, clientId: string, nowMs: number): boolean {
  const cur = leases.get(companyId);
  if (!cur || cur.until < nowMs || cur.clientId === clientId) {
    leases.set(companyId, { clientId, until: nowMs + LEASE_MS });
    return true;
  }
  return false;
}

export function resetLeases() {
  leases.clear();
}

export type TickResult =
  | { leader: false }
  | { leader: true; action: 'none'; reason: string }
  | { leader: true; action: 'visit_started' | 'visit_switched' | 'visit_ended'; result: IngestResult };

async function loadContext(repo: Repository, companyId: string) {
  const snap = await repo.getOfficeSnapshot(companyId);
  if (!snap) return null;
  const manager = snap.employees.find((e) => e.isManager);
  if (!manager) return null;
  const managerEvents = await repo.listEvents(companyId, { employeeId: manager.id, limit: 200 });
  return { employees: snap.employees, manager, managerEvents };
}

/** Avança a lógica de supervisão (chamado periodicamente pelo cliente líder). */
export async function supervisionTick(
  repo: Repository,
  companyId: string,
  clientId: string,
  nowMs = Date.now(),
): Promise<TickResult> {
  if (!acquireLease(companyId, clientId, nowMs)) return { leader: false };
  const ctx = await loadContext(repo, companyId);
  if (!ctx) return { leader: true, action: 'none', reason: 'sem gerente' };
  const { employees, manager, managerEvents } = ctx;
  if (manager.runtime.status !== 'idle') {
    return { leader: true, action: 'none', reason: `gerente ${manager.runtime.status}` };
  }

  const inspectedAt = lastInspections(managerEvents);
  const candidate = chooseInspectionTarget(manager.id, employees, inspectedAt, nowMs);
  const send = (type: string, payload: object) =>
    ingestEvent(repo, { companyId, raw: { employeeId: manager.id, type, payload }, source: 'system', actorUserId: null, now: () => new Date(nowMs) });

  const current = manager.runtime.supervision;
  if (current) {
    const target = employees.find((e) => e.id === current.targetEmployeeId);
    const unavailable = !target || ['offline', 'meeting', 'resting'].includes(target.runtime.status);
    if (unavailable) {
      return { leader: true, action: 'visit_ended', result: await send('supervision.visit_ended', { targetEmployeeId: current.targetEmployeeId, reason: 'target_unavailable' }) };
    }
    if (nowMs - Date.parse(current.startedAt) > VISIT_TIMEOUT_MS) {
      return { leader: true, action: 'visit_ended', result: await send('supervision.visit_ended', { targetEmployeeId: current.targetEmployeeId, reason: 'timeout' }) };
    }
    if (candidate && candidate.targetEmployeeId !== current.targetEmployeeId && shouldInterrupt(current.reason, candidate)) {
      // Situação urgente: interrompe a ronda e vai direto ao problema.
      return {
        leader: true,
        action: 'visit_switched',
        result: await send('supervision.visit_started', { targetEmployeeId: candidate.targetEmployeeId, reason: candidate.reason }),
      };
    }
    return { leader: true, action: 'none', reason: 'visita em andamento' };
  }

  if (!candidate) return { leader: true, action: 'none', reason: 'ninguém a inspecionar agora' };

  const inspections = managerEvents
    .filter((e) => e.type === 'supervision.inspected')
    .map((e) => Date.parse(e.createdAt))
    .sort((a, b) => b - a);
  const last = inspections[0] ?? -Infinity;
  const urgent = URGENT_REASONS.has(candidate.reason);
  if (!urgent && nowMs - last < BETWEEN_VISITS_MS) return { leader: true, action: 'none', reason: 'anotando inspeção' };
  const recentRound = inspections.filter((t) => nowMs - t < ROUND_REST_MS + ROUND_SIZE * 40_000).length;
  if (!urgent && recentRound >= ROUND_SIZE && nowMs - last < ROUND_REST_MS) {
    return { leader: true, action: 'none', reason: 'pausa entre rondas' };
  }
  return {
    leader: true,
    action: 'visit_started',
    result: await send('supervision.visit_started', { targetEmployeeId: candidate.targetEmployeeId, reason: candidate.reason }),
  };
}

export type InspectResult =
  | { status: 'not_leader' }
  | { status: 'no_visit' }
  | { status: 'too_early'; waitMs: number }
  | { status: 'done'; result: IngestResult };

/** Registra a inspeção consultando o estado REAL do funcionário visitado. */
export async function recordInspection(
  repo: Repository,
  companyId: string,
  clientId: string,
  targetEmployeeId: string,
  nowMs = Date.now(),
): Promise<InspectResult> {
  if (!acquireLease(companyId, clientId, nowMs)) return { status: 'not_leader' };
  const snap = await repo.getOfficeSnapshot(companyId);
  const manager = snap?.employees.find((e) => e.isManager);
  const visit = manager?.runtime.supervision;
  if (!manager || !visit || visit.targetEmployeeId !== targetEmployeeId) return { status: 'no_visit' };
  const elapsed = nowMs - Date.parse(visit.startedAt);
  if (elapsed < MIN_VISIT_MS) return { status: 'too_early', waitMs: MIN_VISIT_MS - elapsed };
  // Consulta direta do estado atual (fonte da verdade), não do que o cliente viu.
  const target: Employee | null = await repo.getEmployee(companyId, targetEmployeeId);
  if (!target) return { status: 'no_visit' };
  const payload = buildInspectionPayload(target, nowMs, DEFAULT_SUPERVISION_CONFIG);
  const result = await ingestEvent(repo, {
    companyId,
    raw: { employeeId: manager.id, type: 'supervision.inspected', payload },
    source: 'system',
    actorUserId: null,
    now: () => new Date(nowMs),
  });
  return { status: 'done', result };
}
