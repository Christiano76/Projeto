import {
  applyEvent,
  parseAgentEventInput,
  type AgentEvent,
  type Employee,
  type EventSource,
} from '@agency/core';
import { randomUUID } from 'node:crypto';
import type { Repository } from './repository/types';

export type IngestResult =
  | { status: 'applied'; event: AgentEvent; employee: Pick<Employee, 'id' | 'runtime'> }
  | { status: 'rejected'; reason: string; employee: Pick<Employee, 'id' | 'runtime'> }
  | { status: 'invalid'; error: string }
  | { status: 'not_found' };

const MAX_ATTEMPTS = 3;

/**
 * Serviço único de ingestão de eventos — usado pela API, pelo console manual
 * e (na Fase 3) pelo orquestrador/worker.
 *
 * 1. valida a entrada; 2. carrega o estado atual; 3. aplica a máquina de
 * estados; 4. persiste atomicamente com concorrência otimista (com retentativa).
 * Eventos rejeitados NÃO são persistidos e não alteram o escritório 3D.
 */
export async function ingestEvent(
  repo: Repository,
  args: { companyId: string; raw: unknown; source: EventSource; actorUserId: string | null; now?: () => Date },
): Promise<IngestResult> {
  const parsed = parseAgentEventInput(args.raw);
  if (!parsed.ok) return { status: 'invalid', error: parsed.error };
  const input = parsed.value;
  const now = args.now ?? (() => new Date());

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const employee = await repo.getEmployee(args.companyId, input.employeeId);
    if (!employee) return { status: 'not_found' };

    // Garante ordem monotônica mesmo com relógios iguais.
    let createdAt = now().toISOString();
    if (employee.runtime.lastEventAt && createdAt < employee.runtime.lastEventAt) {
      createdAt = employee.runtime.lastEventAt;
    }
    const event = {
      id: randomUUID(),
      companyId: args.companyId,
      employeeId: employee.id,
      type: input.type,
      payload: input.payload,
      source: args.source,
      createdAt,
    } as AgentEvent;

    const result = applyEvent(employee.runtime, event);
    if (!result.applied) {
      return { status: 'rejected', reason: result.reason, employee: { id: employee.id, runtime: employee.runtime } };
    }

    const commit = await repo.commitEvent({
      companyId: args.companyId,
      employeeId: employee.id,
      expectedVersion: employee.runtime.version,
      nextState: result.state,
      event,
      createdBy: args.actorUserId && args.source === 'manual' ? args.actorUserId : null,
    });
    if (commit === 'ok') return { status: 'applied', event, employee: { id: employee.id, runtime: result.state } };
  }
  throw new Error('conflito de concorrência persistente ao registrar evento');
}
