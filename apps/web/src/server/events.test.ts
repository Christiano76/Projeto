import { DEFAULT_EMPLOYEES, getSeatAnchors } from '@agency/core';
import { describe, expect, it, vi } from 'vitest';
import { ingestEvent } from './events';
import { MemoryRepository } from './repository/memory';
import type { Viewer } from './repository/types';

const viewer: Viewer = { userId: 'u1', email: null, companyId: null, role: 'director' };

async function setup() {
  const repo = new MemoryRepository();
  const { companyId } = await repo.bootstrapCompany(viewer, 'Teste');
  const snap = (await repo.getOfficeSnapshot(companyId))!;
  return { repo, companyId, snap, dev: snap.employees.find((e) => e.key === 'dev_frontend')! };
}

describe('bootstrap da empresa (modo local)', () => {
  it('cria funcionários, departamentos e escritório coerentes', async () => {
    const { snap } = await setup();
    expect(snap.employees).toHaveLength(DEFAULT_EMPLOYEES.length);
    expect(snap.employees.every((e) => e.runtime.status === 'idle')).toBe(true);
    const seats = new Set(getSeatAnchors(snap.layout).map((s) => s.key));
    expect(snap.employees.every((e) => seats.has(e.deskSeatKey))).toBe(true);
    expect(snap.employees.filter((e) => e.isManager)).toHaveLength(1);
  });

  it('é idempotente por usuário', async () => {
    const repo = new MemoryRepository();
    const a = await repo.bootstrapCompany(viewer, 'A');
    const b = await repo.bootstrapCompany(viewer, 'B');
    expect(a.companyId).toBe(b.companyId);
  });
});

describe('ingestEvent', () => {
  it('aplica evento válido, persiste e notifica assinantes', async () => {
    const { repo, companyId, dev } = await setup();
    const listener = vi.fn();
    repo.subscribe(companyId, listener);
    const r = await ingestEvent(repo, {
      companyId,
      raw: { employeeId: dev.id, type: 'task.started', payload: { taskId: 't1', title: 'Home page' } },
      source: 'manual',
      actorUserId: 'u1',
    });
    expect(r.status).toBe('applied');
    const after = await repo.getEmployee(companyId, dev.id);
    expect(after!.runtime).toMatchObject({ status: 'working', version: 1, currentTask: { id: 't1' } });
    expect(await repo.listEvents(companyId)).toHaveLength(1);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]![0].employee.runtime.status).toBe('working');
  });

  it('rejeita transições inválidas sem persistir', async () => {
    const { repo, companyId, dev } = await setup();
    const r = await ingestEvent(repo, {
      companyId,
      raw: { employeeId: dev.id, type: 'task.completed', payload: { taskId: 'nada' } },
      source: 'manual',
      actorUserId: 'u1',
    });
    expect(r.status).toBe('rejected');
    expect(await repo.listEvents(companyId)).toHaveLength(0);
    expect((await repo.getEmployee(companyId, dev.id))!.runtime.version).toBe(0);
  });

  it('valida entrada e funcionário', async () => {
    const { repo, companyId } = await setup();
    expect((await ingestEvent(repo, { companyId, raw: { type: 'x' }, source: 'manual', actorUserId: null })).status).toBe('invalid');
    expect(
      (await ingestEvent(repo, { companyId, raw: { employeeId: 'nao-existe', type: 'break.started' }, source: 'manual', actorUserId: null })).status,
    ).toBe('not_found');
  });

  it('não permite acessar funcionário de outra empresa', async () => {
    const { repo, dev } = await setup();
    const other = await repo.bootstrapCompany({ ...viewer, userId: 'u2' }, 'Outra');
    const r = await ingestEvent(repo, { companyId: other.companyId, raw: { employeeId: dev.id, type: 'break.started' }, source: 'manual', actorUserId: null });
    expect(r.status).toBe('not_found');
  });

  it('refaz a operação em caso de conflito de versão', async () => {
    const { repo, companyId, dev } = await setup();
    const original = repo.commitEvent.bind(repo);
    let calls = 0;
    vi.spyOn(repo, 'commitEvent').mockImplementation(async (input) => {
      calls++;
      if (calls === 1) return 'conflict';
      return original(input);
    });
    const r = await ingestEvent(repo, { companyId, raw: { employeeId: dev.id, type: 'break.started' }, source: 'system', actorUserId: null });
    expect(r.status).toBe('applied');
    expect(calls).toBe(2);
  });

  it('mantém ordem monotônica dos eventos mesmo com relógio atrasado', async () => {
    const { repo, companyId, dev } = await setup();
    const t = new Date('2026-01-01T12:00:10Z');
    await ingestEvent(repo, { companyId, raw: { employeeId: dev.id, type: 'break.started' }, source: 'system', actorUserId: null, now: () => t });
    const r = await ingestEvent(repo, {
      companyId,
      raw: { employeeId: dev.id, type: 'break.ended' },
      source: 'system',
      actorUserId: null,
      now: () => new Date('2026-01-01T12:00:05Z'),
    });
    expect(r.status).toBe('applied');
  });

  it('simula um ciclo completo: tarefa, reunião, conclusão', async () => {
    const { repo, companyId, dev } = await setup();
    const send = (type: string, payload: object = {}) =>
      ingestEvent(repo, { companyId, raw: { employeeId: dev.id, type, payload }, source: 'system', actorUserId: null });
    await send('task.started', { taskId: 't1', title: 'Header responsivo' });
    await send('meeting.joined', { meetingId: 'm1', topic: 'Revisão com QA' });
    await send('meeting.left', { meetingId: 'm1' });
    const done = await send('task.completed', { taskId: 't1' });
    expect(done.status).toBe('applied');
    const emp = (await repo.getEmployee(companyId, dev.id))!;
    expect(emp.runtime).toMatchObject({ status: 'idle', tasksCompleted: 1, version: 4 });
    const events = await repo.listEvents(companyId, { employeeId: dev.id });
    expect(events.map((e) => e.type)).toEqual(['task.completed', 'meeting.left', 'meeting.joined', 'task.started']);
  });
});
