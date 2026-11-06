/**
 * Tipos de domínio compartilhados entre backend, worker (Fase 3) e o escritório 3D.
 *
 * Regra de ouro: o estado visual de um funcionário é SEMPRE derivado de
 * `EmployeeRuntimeState`, que por sua vez só muda por meio de eventos
 * (`AgentEvent`) aplicados pela máquina de estados em `state/employeeState.ts`.
 */

export const DEPARTMENT_KEYS = [
  'direcao',
  'gerencia',
  'prospeccao',
  'comercial',
  'desenvolvimento',
  'financeiro',
] as const;
export type DepartmentKey = (typeof DEPARTMENT_KEYS)[number];

export interface Department {
  id: string;
  key: DepartmentKey | string;
  name: string;
  color: string;
}

/**
 * Status operacional real do funcionário.
 * "Comemorando" NÃO é um status: é um efeito visual transitório derivado de
 * uma tarefa realmente concluída (ver `deriveActivity`).
 */
export const EMPLOYEE_STATUSES = [
  'offline', // fora do expediente / agente desligado
  'idle', // disponível, sem tarefa
  'working', // executando uma tarefa
  'meeting', // em reunião/colaboração
  'resting', // pausa configurada
  'blocked', // tarefa bloqueada aguardando algo (ex.: aprovação)
  'error', // última tarefa falhou
] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const STATUS_LABELS: Record<EmployeeStatus, string> = {
  offline: 'Fora do expediente',
  idle: 'Disponível',
  working: 'Trabalhando',
  meeting: 'Em reunião',
  resting: 'Em pausa',
  blocked: 'Bloqueado',
  error: 'Erro na última tarefa',
};

export const STATUS_COLORS: Record<EmployeeStatus, string> = {
  offline: '#94a3b8',
  idle: '#38bdf8',
  working: '#22c55e',
  meeting: '#a855f7',
  resting: '#f59e0b',
  blocked: '#f97316',
  error: '#ef4444',
};

export interface TaskRef {
  id: string;
  title: string;
}

export interface EmployeeRuntimeState {
  status: EmployeeStatus;
  statusSince: string; // ISO-8601
  currentTask: TaskRef | null;
  meeting: { id: string; topic: string } | null;
  lastCompletedTask: (TaskRef & { at: string }) | null;
  blockedReason: string | null;
  lastError: string | null;
  lastEventAt: string | null;
  tasksCompleted: number;
  tasksFailed: number;
  /** Incrementado a cada evento aplicado — usado para concorrência otimista. */
  version: number;
}

export type HairStyle = 'short' | 'long' | 'bun' | 'bald' | 'curly';
export type Accessory = 'glasses' | 'headset' | 'none';

export interface AvatarStyle {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  pants: string;
  accessory: Accessory;
}

export type AiProvider = 'anthropic' | 'openai';

export interface AgentModelConfig {
  provider: AiProvider;
  model: string;
}

export interface EmployeeProfile {
  id: string;
  key: string;
  name: string;
  role: string;
  departmentKey: string;
  personality: string;
  objectives: string[];
  avatar: AvatarStyle;
  /** Chave do assento (cadeira) da mesa de trabalho no layout. */
  deskSeatKey: string;
  model: AgentModelConfig;
  isManager: boolean;
}

export interface Employee extends EmployeeProfile {
  runtime: EmployeeRuntimeState;
}

export function createInitialRuntimeState(
  now: string,
  status: EmployeeStatus = 'idle',
): EmployeeRuntimeState {
  return {
    status,
    statusSince: now,
    currentTask: null,
    meeting: null,
    lastCompletedTask: null,
    blockedReason: null,
    lastError: null,
    lastEventAt: null,
    tasksCompleted: 0,
    tasksFailed: 0,
    version: 0,
  };
}
