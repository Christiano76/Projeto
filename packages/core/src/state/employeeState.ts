import type { EmployeeRuntimeState, EmployeeStatus } from '../domain/types';
import type { AgentEvent } from '../events/schema';

/**
 * Máquina de estados do funcionário.
 *
 * Função pura: (estado, evento) -> novo estado. É executada no servidor antes
 * de persistir o evento (fonte da verdade) e pode ser reutilizada pelo worker.
 * Transições inválidas são REJEITADAS (não persistidas), garantindo que o
 * escritório 3D nunca mostre uma atividade que não esteja acontecendo.
 */

export type ApplyResult =
  | { applied: true; state: EmployeeRuntimeState }
  | { applied: false; state: EmployeeRuntimeState; reason: string };

/** Status a partir dos quais o funcionário pode assumir uma nova tarefa. */
const AVAILABLE: ReadonlySet<EmployeeStatus> = new Set(['idle', 'error']);

export function applyEvent(state: EmployeeRuntimeState, event: AgentEvent): ApplyResult {
  if (state.lastEventAt && event.createdAt < state.lastEventAt) {
    return reject(state, 'evento fora de ordem (anterior ao último evento aplicado)');
  }

  const at = event.createdAt;

  switch (event.type) {
    case 'employee.online': {
      if (state.status !== 'offline') return reject(state, 'funcionário já está no expediente');
      return accept(state, at, { status: state.currentTask ? 'working' : 'idle' });
    }

    case 'employee.offline': {
      if (state.status === 'offline') return reject(state, 'funcionário já está fora do expediente');
      return accept(state, at, { status: 'offline', meeting: null });
    }

    case 'task.started': {
      if (!AVAILABLE.has(state.status)) {
        return reject(state, `não pode iniciar tarefa com status "${state.status}"`);
      }
      return accept(state, at, {
        status: 'working',
        currentTask: { id: event.payload.taskId, title: event.payload.title },
        blockedReason: null,
        lastError: null,
      });
    }

    case 'task.progress': {
      if (state.currentTask?.id !== event.payload.taskId) {
        return reject(state, 'tarefa informada não é a tarefa atual');
      }
      return accept(state, at, {});
    }

    case 'task.completed': {
      if (state.currentTask?.id !== event.payload.taskId) {
        return reject(state, 'tarefa informada não é a tarefa atual');
      }
      if (state.status !== 'working' && state.status !== 'blocked') {
        return reject(state, `não pode concluir tarefa com status "${state.status}"`);
      }
      return accept(state, at, {
        status: 'idle',
        lastCompletedTask: { ...state.currentTask, at },
        currentTask: null,
        blockedReason: null,
        tasksCompleted: state.tasksCompleted + 1,
      });
    }

    case 'task.failed': {
      if (state.currentTask?.id !== event.payload.taskId) {
        return reject(state, 'tarefa informada não é a tarefa atual');
      }
      if (state.status !== 'working' && state.status !== 'blocked') {
        return reject(state, `não pode falhar tarefa com status "${state.status}"`);
      }
      return accept(state, at, {
        status: 'error',
        currentTask: null,
        blockedReason: null,
        lastError: event.payload.error,
        tasksFailed: state.tasksFailed + 1,
      });
    }

    case 'task.blocked': {
      if (state.status !== 'working' || state.currentTask?.id !== event.payload.taskId) {
        return reject(state, 'só é possível bloquear a tarefa em execução');
      }
      return accept(state, at, { status: 'blocked', blockedReason: event.payload.reason });
    }

    case 'task.unblocked': {
      if (state.status !== 'blocked' || state.currentTask?.id !== event.payload.taskId) {
        return reject(state, 'tarefa não está bloqueada');
      }
      return accept(state, at, { status: 'working', blockedReason: null });
    }

    case 'meeting.joined': {
      if (state.status === 'offline') return reject(state, 'funcionário fora do expediente');
      if (state.status === 'meeting') return reject(state, 'funcionário já está em reunião');
      if (state.status === 'resting') return reject(state, 'funcionário está em pausa');
      return accept(state, at, {
        status: 'meeting',
        meeting: { id: event.payload.meetingId, topic: event.payload.topic },
      });
    }

    case 'meeting.left': {
      if (state.status !== 'meeting' || state.meeting?.id !== event.payload.meetingId) {
        return reject(state, 'funcionário não está nesta reunião');
      }
      const resume: EmployeeStatus = state.currentTask
        ? state.blockedReason
          ? 'blocked'
          : 'working'
        : 'idle';
      return accept(state, at, { status: resume, meeting: null });
    }

    case 'break.started': {
      if (!AVAILABLE.has(state.status)) {
        return reject(state, `não pode iniciar pausa com status "${state.status}"`);
      }
      return accept(state, at, { status: 'resting' });
    }

    case 'break.ended': {
      if (state.status !== 'resting') return reject(state, 'funcionário não está em pausa');
      return accept(state, at, { status: 'idle' });
    }

    case 'message.sent': {
      if (state.status === 'offline') return reject(state, 'funcionário fora do expediente');
      return accept(state, at, {});
    }
  }
}

/** Aplica uma sequência de eventos ignorando os rejeitados (útil para reconstrução/replay). */
export function replayEvents(
  initial: EmployeeRuntimeState,
  events: readonly AgentEvent[],
): EmployeeRuntimeState {
  return events.reduce((s, e) => applyEvent(s, e).state, initial);
}

function accept(
  state: EmployeeRuntimeState,
  at: string,
  patch: Partial<EmployeeRuntimeState>,
): ApplyResult {
  const statusChanged = patch.status !== undefined && patch.status !== state.status;
  return {
    applied: true,
    state: {
      ...state,
      ...patch,
      statusSince: statusChanged ? at : state.statusSince,
      lastEventAt: at,
      version: state.version + 1,
    },
  };
}

function reject(state: EmployeeRuntimeState, reason: string): ApplyResult {
  return { applied: false, state, reason };
}
