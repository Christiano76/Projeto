import 'server-only';

import {
  createDefaultCompanySeed,
  createInitialRuntimeState,
  type AgentEvent,
  type Department,
  type Employee,
  type EmployeeRuntimeState,
  type ObjectDef,
  type OfficeSnapshot,
  type RoomDef,
} from '@agency/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommitInput, Repository, Viewer } from './types';

type Row = Record<string, unknown>;

const iso = (v: unknown) => new Date(String(v)).toISOString();
const num = (v: unknown) => Number(v);

export function rowToEvent(r: Row): AgentEvent {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    employeeId: String(r.employee_id),
    type: r.type as AgentEvent['type'],
    payload: (r.payload ?? {}) as AgentEvent['payload'],
    source: r.source as AgentEvent['source'],
    createdAt: iso(r.created_at),
  } as AgentEvent;
}

/** Normaliza o estado vindo do banco (datas em ISO-UTC). */
export function normalizeRuntime(raw: unknown, version: number): EmployeeRuntimeState {
  const r = raw as EmployeeRuntimeState;
  return {
    ...r,
    statusSince: iso(r.statusSince),
    lastEventAt: r.lastEventAt ? iso(r.lastEventAt) : null,
    version,
  };
}

/**
 * Persistência no Supabase. Usa o cliente administrativo (service role):
 * a autorização do usuário é verificada antes, em `server/auth.ts`, e todas as
 * consultas são filtradas explicitamente por `company_id`.
 */
export class SupabaseRepository implements Repository {
  readonly mode = 'supabase' as const;

  constructor(private readonly db: SupabaseClient) {}

  async getOfficeSnapshot(companyId: string): Promise<OfficeSnapshot | null> {
    const [company, departments, rooms, objects, employees, events] = await Promise.all([
      this.db.from('companies').select('id, name').eq('id', companyId).maybeSingle(),
      this.db.from('departments').select('id, key, name, color').eq('company_id', companyId),
      this.db.from('office_rooms').select('*').eq('company_id', companyId).order('sort_order'),
      this.db.from('office_objects').select('id, key, room_id, type, x, z, rotation, props').eq('company_id', companyId),
      this.selectEmployees(companyId),
      this.listEvents(companyId, { limit: 50 }),
    ]);
    for (const r of [company, departments, rooms, objects]) if (r.error) throw r.error;
    if (!company.data) return null;

    const deptById = new Map((departments.data ?? []).map((d: Row) => [String(d.id), d]));
    const roomById = new Map((rooms.data ?? []).map((r: Row) => [String(r.id), r]));

    const roomDefs: RoomDef[] = (rooms.data ?? []).map((r: Row) => ({
      key: String(r.key),
      name: String(r.name),
      kind: r.kind as RoomDef['kind'],
      departmentKey: r.department_id ? String(deptById.get(String(r.department_id))?.key ?? '') || null : null,
      bounds: { x: num(r.x), z: num(r.z), w: num(r.width), d: num(r.depth) },
      doors: (r.doors as RoomDef['doors']) ?? [],
      floorColor: String(r.floor_color),
      sortOrder: num(r.sort_order),
    }));
    const objectDefs: ObjectDef[] = (objects.data ?? []).map((o: Row) => ({
      key: String(o.key),
      roomKey: String(roomById.get(String(o.room_id))?.key ?? ''),
      type: o.type as ObjectDef['type'],
      position: [num(o.x), num(o.z)] as const,
      rotation: num(o.rotation),
      props: (o.props as ObjectDef['props']) ?? {},
    }));
    const width = Math.max(0, ...roomDefs.map((r) => r.bounds.x + r.bounds.w));
    const depth = Math.max(0, ...roomDefs.map((r) => r.bounds.z + r.bounds.d));

    return {
      mode: this.mode,
      company: { id: String(company.data.id), name: String(company.data.name) },
      layout: { width, depth, rooms: roomDefs, objects: objectDefs },
      departments: (departments.data ?? []).map((d: Row) => ({
        id: String(d.id),
        key: String(d.key),
        name: String(d.name),
        color: String(d.color),
      })) as Department[],
      employees,
      recentEvents: events,
      serverTime: new Date().toISOString(),
    };
  }

  private async selectEmployees(companyId: string, employeeId?: string): Promise<Employee[]> {
    let q = this.db
      .from('employees')
      .select(
        'id, key, name, role_title, personality, objectives, avatar, is_manager, runtime_state, state_version, departments(key), employee_positions(office_objects(key)), agents(provider, model)',
      )
      .eq('company_id', companyId)
      .order('name');
    if (employeeId) q = q.eq('id', employeeId);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r: Row) => {
      const one = <T,>(v: unknown): T | undefined => (Array.isArray(v) ? (v[0] as T) : (v as T));
      const dept = one<Row>(r.departments);
      const pos = one<Row>(r.employee_positions);
      const desk = one<Row>(pos?.office_objects);
      const agent = one<Row>(r.agents);
      return {
        id: String(r.id),
        key: String(r.key),
        name: String(r.name),
        role: String(r.role_title),
        departmentKey: String(dept?.key ?? ''),
        personality: String(r.personality ?? ''),
        objectives: (r.objectives as string[]) ?? [],
        avatar: r.avatar as Employee['avatar'],
        deskSeatKey: String(desk?.key ?? ''),
        model: {
          provider: (agent?.provider as Employee['model']['provider']) ?? 'anthropic',
          model: String(agent?.model ?? ''),
        },
        isManager: Boolean(r.is_manager),
        runtime: normalizeRuntime(r.runtime_state, num(r.state_version)),
      };
    });
  }

  async getEmployee(companyId: string, employeeId: string): Promise<Employee | null> {
    if (!isUuid(employeeId)) return null;
    const list = await this.selectEmployees(companyId, employeeId);
    return list[0] ?? null;
  }

  async listEvents(companyId: string, opts: { limit?: number; employeeId?: string } = {}): Promise<AgentEvent[]> {
    let q = this.db
      .from('agent_events')
      .select('id, company_id, employee_id, type, payload, source, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(Math.min(opts.limit ?? 50, 500));
    if (opts.employeeId) {
      if (!isUuid(opts.employeeId)) return [];
      q = q.eq('employee_id', opts.employeeId);
    }
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(rowToEvent);
  }

  async commitEvent(input: CommitInput): Promise<'ok' | 'conflict'> {
    const { data, error } = await this.db.rpc('commit_agent_event', {
      p_company_id: input.companyId,
      p_employee_id: input.employeeId,
      p_expected_version: input.expectedVersion,
      p_runtime_state: input.nextState,
      p_event_id: input.event.id,
      p_event_type: input.event.type,
      p_payload: input.event.payload,
      p_source: input.event.source,
      p_created_by: input.createdBy,
      p_created_at: input.event.createdAt,
    });
    if (error) throw error;
    return data === true ? 'ok' : 'conflict';
  }

  async bootstrapCompany(viewer: Viewer, name: string): Promise<{ companyId: string }> {
    if (viewer.companyId) return { companyId: viewer.companyId };
    const seed = createDefaultCompanySeed();
    const now = new Date().toISOString();

    const { data: company, error: ce } = await this.db.from('companies').insert({ name }).select('id').single();
    if (ce) throw ce;
    const companyId = String(company.id);

    try {
      const must = <T,>(r: { data: T | null; error: unknown }): T => {
        if (r.error) throw r.error;
        return r.data as T;
      };
      must(await this.db.from('company_settings').insert({ company_id: companyId }));

      const deps = must(
        await this.db
          .from('departments')
          .insert(seed.departments.map((d) => ({ company_id: companyId, key: d.key, name: d.name, color: d.color })))
          .select('id, key'),
      ) as Row[];
      const depId = new Map(deps.map((d) => [String(d.key), String(d.id)]));

      const rooms = must(
        await this.db
          .from('office_rooms')
          .insert(
            seed.layout.rooms.map((r) => ({
              company_id: companyId,
              department_id: r.departmentKey ? (depId.get(r.departmentKey) ?? null) : null,
              key: r.key,
              name: r.name,
              kind: r.kind,
              x: r.bounds.x,
              z: r.bounds.z,
              width: r.bounds.w,
              depth: r.bounds.d,
              doors: r.doors,
              floor_color: r.floorColor,
              sort_order: r.sortOrder,
            })),
          )
          .select('id, key'),
      ) as Row[];
      const roomId = new Map(rooms.map((r) => [String(r.key), String(r.id)]));

      const objects = must(
        await this.db
          .from('office_objects')
          .insert(
            seed.layout.objects.map((o) => ({
              company_id: companyId,
              room_id: roomId.get(o.roomKey),
              key: o.key,
              type: o.type,
              x: o.position[0],
              z: o.position[1],
              rotation: o.rotation,
              props: o.props ?? {},
            })),
          )
          .select('id, key'),
      ) as Row[];
      const objectId = new Map(objects.map((o) => [String(o.key), String(o.id)]));

      const emps = must(
        await this.db
          .from('employees')
          .insert(
            seed.employees.map((e) => ({
              company_id: companyId,
              department_id: depId.get(e.departmentKey),
              key: e.key,
              name: e.name,
              role_title: e.role,
              personality: e.personality,
              objectives: e.objectives,
              avatar: e.avatar,
              is_manager: e.isManager,
              status: 'idle',
              runtime_state: createInitialRuntimeState(now),
            })),
          )
          .select('id, key'),
      ) as Row[];
      const empId = new Map(emps.map((e) => [String(e.key), String(e.id)]));

      must(
        await this.db.from('employee_positions').insert(
          seed.employees.map((e) => ({
            employee_id: empId.get(e.key),
            company_id: companyId,
            desk_object_id: objectId.get(e.deskSeatKey) ?? null,
            current_room_id: roomId.get(seed.layout.objects.find((o) => o.key === e.deskSeatKey)?.roomKey ?? '') ?? null,
          })),
        ),
      );
      // Agentes ficam DESLIGADOS até a Fase 2 e a configuração das chaves de IA.
      must(
        await this.db.from('agents').insert(
          seed.employees.map((e) => ({
            company_id: companyId,
            employee_id: empId.get(e.key),
            provider: e.model.provider,
            model: e.model.model,
            enabled: false,
          })),
        ),
      );

      const { data: linked, error: le } = await this.db
        .from('users')
        .update({ company_id: companyId, role: 'director' })
        .eq('id', viewer.userId)
        .is('company_id', null)
        .select('id');
      if (le) throw le;
      if (!linked?.length) throw new Error('usuário já vinculado a outra empresa');
      return { companyId };
    } catch (err) {
      // Compensação: remove a empresa parcialmente criada (cascade).
      await this.db.from('companies').delete().eq('id', companyId);
      throw err;
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}
