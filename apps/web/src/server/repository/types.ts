import type { AgentEvent, DataMode, Employee, EmployeeRuntimeState, LiveUpdate, OfficeSnapshot } from '@agency/core';

export interface Viewer {
  userId: string;
  email: string | null;
  companyId: string | null;
  role: 'director' | 'member';
}

export interface CommitInput {
  companyId: string;
  employeeId: string;
  expectedVersion: number;
  nextState: EmployeeRuntimeState;
  event: AgentEvent;
  createdBy: string | null;
}

/**
 * Porta de persistência. Duas implementações:
 *  - `MemoryRepository`: modo local sem credenciais (dados em memória).
 *  - `SupabaseRepository`: PostgreSQL/Supabase (produção).
 * Toda a lógica de negócio (validação, máquina de estados) fica fora daqui.
 */
export interface Repository {
  readonly mode: DataMode;
  getOfficeSnapshot(companyId: string): Promise<OfficeSnapshot | null>;
  getEmployee(companyId: string, employeeId: string): Promise<Employee | null>;
  listEvents(companyId: string, opts?: { limit?: number; employeeId?: string }): Promise<AgentEvent[]>;
  /** Persiste evento + novo estado atomicamente. Retorna 'conflict' se a versão mudou. */
  commitEvent(input: CommitInput): Promise<'ok' | 'conflict'>;
  /** Cria a empresa com departamentos, escritório e funcionários padrão. */
  bootstrapCompany(viewer: Viewer, name: string): Promise<{ companyId: string }>;
  /** Assinatura de atualizações em tempo real (apenas no modo local; no Supabase usa-se Realtime). */
  subscribe?(companyId: string, listener: (u: LiveUpdate) => void): () => void;
}
