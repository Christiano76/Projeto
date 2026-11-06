import {
  createDefaultCompanySeed,
  createInitialRuntimeState,
  type AgentEvent,
  type Department,
  type Employee,
  type LiveUpdate,
  type OfficeLayout,
  type OfficeSnapshot,
} from '@agency/core';
import { randomUUID } from 'node:crypto';
import type { CommitInput, Repository, Viewer } from './types';

interface CompanyData {
  id: string;
  name: string;
  layout: OfficeLayout;
  departments: Department[];
  employees: Map<string, Employee>;
  events: AgentEvent[];
  listeners: Set<(u: LiveUpdate) => void>;
}

const MAX_EVENTS = 2000;

/**
 * Repositório em memória para desenvolvimento sem credenciais.
 * Mesma semântica do Supabase (concorrência otimista, ordem dos eventos).
 */
export class MemoryRepository implements Repository {
  readonly mode = 'memory' as const;
  private companies = new Map<string, CompanyData>();
  private userCompany = new Map<string, string>();

  async getOfficeSnapshot(companyId: string): Promise<OfficeSnapshot | null> {
    const c = this.companies.get(companyId);
    if (!c) return null;
    return structuredClone({
      mode: this.mode,
      company: { id: c.id, name: c.name },
      layout: c.layout,
      departments: c.departments,
      employees: [...c.employees.values()],
      recentEvents: c.events.slice(-50).reverse(),
      serverTime: new Date().toISOString(),
    });
  }

  async getEmployee(companyId: string, employeeId: string): Promise<Employee | null> {
    const e = this.companies.get(companyId)?.employees.get(employeeId);
    return e ? structuredClone(e) : null;
  }

  async listEvents(companyId: string, opts: { limit?: number; employeeId?: string } = {}): Promise<AgentEvent[]> {
    const c = this.companies.get(companyId);
    if (!c) return [];
    const limit = Math.min(opts.limit ?? 50, 500);
    const filtered = opts.employeeId ? c.events.filter((e) => e.employeeId === opts.employeeId) : c.events;
    return structuredClone(filtered.slice(-limit).reverse());
  }

  async commitEvent(input: CommitInput): Promise<'ok' | 'conflict'> {
    const c = this.companies.get(input.companyId);
    const e = c?.employees.get(input.employeeId);
    if (!c || !e) throw new Error('funcionário não encontrado');
    if (e.runtime.version !== input.expectedVersion) return 'conflict';
    e.runtime = structuredClone(input.nextState);
    c.events.push(structuredClone(input.event));
    if (c.events.length > MAX_EVENTS) c.events.splice(0, c.events.length - MAX_EVENTS);
    const update: LiveUpdate = { event: input.event, employee: { id: e.id, runtime: e.runtime } };
    for (const l of c.listeners) {
      try {
        l(structuredClone(update));
      } catch {
        // Um ouvinte com problema não pode derrubar os demais.
      }
    }
    return 'ok';
  }

  async bootstrapCompany(viewer: Viewer, name: string): Promise<{ companyId: string }> {
    const existing = this.userCompany.get(viewer.userId);
    if (existing) return { companyId: existing };

    const seed = createDefaultCompanySeed();
    const now = new Date().toISOString();
    const companyId = randomUUID();
    const departments: Department[] = seed.departments.map((d) => ({ ...d, id: randomUUID() }));
    const employees = new Map<string, Employee>();
    for (const s of seed.employees) {
      const id = randomUUID();
      employees.set(id, { ...s, id, runtime: createInitialRuntimeState(now) });
    }
    this.companies.set(companyId, {
      id: companyId,
      name,
      layout: seed.layout,
      departments,
      employees,
      events: [],
      listeners: new Set(),
    });
    this.userCompany.set(viewer.userId, companyId);
    return { companyId };
  }

  companyIdForUser(userId: string): string | null {
    return this.userCompany.get(userId) ?? null;
  }

  subscribe(companyId: string, listener: (u: LiveUpdate) => void): () => void {
    const c = this.companies.get(companyId);
    if (!c) return () => {};
    c.listeners.add(listener);
    return () => c.listeners.delete(listener);
  }
}
