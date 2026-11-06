import type { AgentEvent } from '../events/schema';
import type { OfficeLayout } from '../office/layout';
import type { Department, Employee } from './types';

export type DataMode = 'memory' | 'supabase';

/** Tudo que o escritório 3D precisa para renderizar o estado atual da empresa. */
export interface OfficeSnapshot {
  mode: DataMode;
  company: { id: string; name: string };
  layout: OfficeLayout;
  departments: Department[];
  employees: Employee[];
  recentEvents: AgentEvent[];
  serverTime: string;
}

/** Mensagem de atualização em tempo real (SSE no modo local; Realtime no Supabase). */
export interface LiveUpdate {
  event?: AgentEvent;
  employee?: Pick<Employee, 'id' | 'runtime'>;
}
