import { z } from 'zod';
import { INSPECTION_FINDINGS, SUPERVISION_REASONS } from '../domain/types';

/**
 * Catálogo de eventos de agentes.
 *
 * Todo evento é registrado em `agent_events` (append-only) e é a ÚNICA forma de
 * alterar o estado operacional de um funcionário. O escritório 3D apenas
 * reproduz visualmente o resultado desses eventos.
 */

const id = z.string().trim().min(1).max(120);
const shortText = z.string().trim().min(1).max(200);

export const EVENT_PAYLOAD_SCHEMAS = {
  'employee.online': z.object({}).strict(),
  'employee.offline': z.object({}).strict(),
  'task.started': z
    .object({ taskId: id, title: shortText, dueAt: z.iso.datetime({ offset: true }).optional() })
    .strict(),
  'task.progress': z.object({ taskId: id, note: z.string().trim().min(1).max(500) }).strict(),
  'task.completed': z
    .object({ taskId: id, summary: z.string().trim().max(1000).optional() })
    .strict(),
  'task.failed': z.object({ taskId: id, error: z.string().trim().min(1).max(1000) }).strict(),
  'task.blocked': z.object({ taskId: id, reason: shortText }).strict(),
  'task.unblocked': z.object({ taskId: id }).strict(),
  'meeting.joined': z
    .object({
      meetingId: id,
      topic: shortText,
      participantIds: z.array(id).max(20).optional(),
    })
    .strict(),
  'meeting.left': z.object({ meetingId: id }).strict(),
  'break.started': z.object({}).strict(),
  'break.ended': z.object({}).strict(),
  'message.sent': z.object({ toEmployeeId: id, subject: shortText }).strict(),
  /** Gerente inicia visita de supervisão a um funcionário (decidido no servidor). */
  'supervision.visit_started': z
    .object({ targetEmployeeId: id, reason: z.enum(SUPERVISION_REASONS) })
    .strict(),
  /** Visita encerrada sem inspeção (funcionário saiu, entrou em reunião etc.). */
  'supervision.visit_ended': z
    .object({ targetEmployeeId: id, reason: z.enum(['target_unavailable', 'timeout']) })
    .strict(),
  /** Inspeção concluída: o servidor consultou o estado real do funcionário. */
  'supervision.inspected': z
    .object({
      targetEmployeeId: id,
      observedStatus: z.string().min(1).max(20),
      taskId: id.optional(),
      taskTitle: shortText.optional(),
      findings: z.array(z.enum(INSPECTION_FINDINGS)).min(1).max(6),
      statusMinutes: z.number().int().min(0).max(100000),
    })
    .strict(),
} as const;

/** Eventos que só o servidor pode gerar (nunca aceitos do console manual). */
export const SYSTEM_ONLY_EVENT_TYPES: readonly AgentEventType[] = [
  'supervision.visit_started',
  'supervision.visit_ended',
  'supervision.inspected',
];

export type AgentEventType = keyof typeof EVENT_PAYLOAD_SCHEMAS;
export const AGENT_EVENT_TYPES = Object.keys(EVENT_PAYLOAD_SCHEMAS) as AgentEventType[];

export type AgentEventPayload<T extends AgentEventType> = z.infer<
  (typeof EVENT_PAYLOAD_SCHEMAS)[T]
>;

/** Quem originou o evento. `manual` = disparado pelo diretor no console de testes. */
export const EVENT_SOURCES = ['system', 'orchestrator', 'agent', 'manual'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export type AgentEvent = {
  [T in AgentEventType]: {
    id: string;
    companyId: string;
    employeeId: string;
    type: T;
    payload: AgentEventPayload<T>;
    source: EventSource;
    createdAt: string;
  };
}[AgentEventType];

export type AgentEventInput = {
  [T in AgentEventType]: { employeeId: string; type: T; payload: AgentEventPayload<T> };
}[AgentEventType];

export const EVENT_LABELS: Record<AgentEventType, string> = {
  'employee.online': 'Entrou no expediente',
  'employee.offline': 'Saiu do expediente',
  'task.started': 'Iniciou tarefa',
  'task.progress': 'Progresso na tarefa',
  'task.completed': 'Concluiu tarefa',
  'task.failed': 'Tarefa falhou',
  'task.blocked': 'Tarefa bloqueada',
  'task.unblocked': 'Tarefa desbloqueada',
  'meeting.joined': 'Entrou em reunião',
  'meeting.left': 'Saiu da reunião',
  'break.started': 'Iniciou pausa',
  'break.ended': 'Encerrou pausa',
  'message.sent': 'Enviou mensagem interna',
  'supervision.visit_started': 'Iniciou visita de supervisão',
  'supervision.visit_ended': 'Encerrou visita sem inspeção',
  'supervision.inspected': 'Concluiu inspeção',
};

const envelopeSchema = z.object({
  employeeId: id,
  type: z.enum(AGENT_EVENT_TYPES as [AgentEventType, ...AgentEventType[]]),
  payload: z.unknown().optional(),
});

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Valida a entrada de um evento (vinda de API, worker ou console manual). */
export function parseAgentEventInput(raw: unknown): ParseResult<AgentEventInput> {
  const env = envelopeSchema.safeParse(raw);
  if (!env.success) {
    return { ok: false, error: formatZodError(env.error) };
  }
  const schema = EVENT_PAYLOAD_SCHEMAS[env.data.type];
  const payload = schema.safeParse(env.data.payload ?? {});
  if (!payload.success) {
    return { ok: false, error: `payload inválido: ${formatZodError(payload.error)}` };
  }
  return {
    ok: true,
    value: {
      employeeId: env.data.employeeId,
      type: env.data.type,
      payload: payload.data,
    } as AgentEventInput,
  };
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.length ? i.path.join('.') : '(raiz)'}: ${i.message}`)
    .join('; ');
}

/** Resumo legível de um evento para o feed e o histórico. */
export function describeEvent(event: Pick<AgentEvent, 'type' | 'payload'>): string {
  const label = EVENT_LABELS[event.type];
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case 'task.started':
      return `${label}: ${String(p.title)}`;
    case 'task.progress':
      return `${label}: ${String(p.note)}`;
    case 'task.failed':
      return `${label}: ${String(p.error)}`;
    case 'task.blocked':
      return `${label}: ${String(p.reason)}`;
    case 'meeting.joined':
      return `${label}: ${String(p.topic)}`;
    case 'message.sent':
      return `${label}: ${String(p.subject)}`;
    case 'supervision.inspected': {
      const f = (p.findings as string[] | undefined) ?? [];
      return `${label} (${f.includes('ok') ? 'sem problemas' : `${f.length} achado(s)`})`;
    }
    default:
      return label;
  }
}
