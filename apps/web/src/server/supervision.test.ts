import { beforeEach, describe, expect, it } from 'vitest';
import { ingestEvent } from './events';
import { MemoryRepository } from './repository/memory';
import { MIN_VISIT_MS, recordInspection, resetLeases, supervisionTick } from './supervision';

const viewer = { userId: 'u1', email: null, companyId: null, role: 'director' as const };

async function setup() {
  const repo = new MemoryRepository();
  const { companyId } = await repo.bootstrapCompany(viewer, 'Teste');
  const snap = (await repo.getOfficeSnapshot(companyId))!;
  const byKey = Object.fromEntries(snap.employees.map((e) => [e.key, e]));
  return { repo, companyId, byKey, manager: byKey.gerente! };
}

const t0 = Date.parse('2026-01-01T12:00:00Z');

describe('supervisão no servidor', () => {
  beforeEach(() => resetLeases());

  it('só um cliente lidera a ronda por vez', async () => {
    const { repo, companyId } = await setup();
    expect((await supervisionTick(repo, companyId, 'cliente-aaaa', t0)).leader).toBe(true);
    expect((await supervisionTick(repo, companyId, 'cliente-bbbb', t0 + 1000)).leader).toBe(false);
    // Concessão expira se o líder some
    expect((await supervisionTick(repo, companyId, 'cliente-bbbb', t0 + 60_000)).leader).toBe(true);
  });

  it('prioriza funcionário com falha real e registra a inspeção com o estado consultado', async () => {
    const { repo, companyId, byKey, manager } = await setup();
    const qa = byKey.qa!;
    const at = (ms: number) => () => new Date(t0 + ms);
    await ingestEvent(repo, { companyId, raw: { employeeId: qa.id, type: 'task.started', payload: { taskId: 'q1', title: 'Testes de regressão' } }, source: 'system', actorUserId: null, now: at(0) });
    await ingestEvent(repo, { companyId, raw: { employeeId: qa.id, type: 'task.failed', payload: { taskId: 'q1', error: 'navegador indisponível' } }, source: 'system', actorUserId: null, now: at(1000) });

    const tick = await supervisionTick(repo, companyId, 'cliente-aaaa', t0 + 2000);
    expect(tick).toMatchObject({ leader: true, action: 'visit_started' });
    const m1 = (await repo.getEmployee(companyId, manager.id))!;
    expect(m1.runtime.supervision).toMatchObject({ targetEmployeeId: qa.id, reason: 'error' });

    // Cedo demais: precisa caminhar e observar
    expect(await recordInspection(repo, companyId, 'cliente-aaaa', qa.id, t0 + 3000)).toMatchObject({ status: 'too_early' });
    // Outro cliente não registra
    expect(await recordInspection(repo, companyId, 'cliente-bbbb', qa.id, t0 + 9000)).toEqual({ status: 'not_leader' });

    const done = await recordInspection(repo, companyId, 'cliente-aaaa', qa.id, t0 + 2000 + MIN_VISIT_MS + 1000);
    expect(done.status).toBe('done');
    const events = await repo.listEvents(companyId, { employeeId: manager.id });
    const inspected = events.find((e) => e.type === 'supervision.inspected')!;
    expect(inspected.payload).toMatchObject({ targetEmployeeId: qa.id, observedStatus: 'error', findings: ['error'] });
    expect(inspected.source).toBe('system');
    const m2 = (await repo.getEmployee(companyId, manager.id))!;
    expect(m2.runtime).toMatchObject({ supervision: null, inspectionsDone: 1 });
  });

  it('interrompe a ronda de rotina para atender urgência', async () => {
    const { repo, companyId, byKey, manager } = await setup();
    const first = await supervisionTick(repo, companyId, 'cliente-aaaa', t0);
    expect(first).toMatchObject({ action: 'visit_started' });
    const routineTarget = (await repo.getEmployee(companyId, manager.id))!.runtime.supervision!.targetEmployeeId;
    const other = Object.values(byKey).find((e) => !e.isManager && e.id !== routineTarget)!;
    const now = () => new Date(t0 + 1000);
    await ingestEvent(repo, { companyId, raw: { employeeId: other.id, type: 'task.started', payload: { taskId: 'x', title: 'Deploy' } }, source: 'system', actorUserId: null, now });
    await ingestEvent(repo, { companyId, raw: { employeeId: other.id, type: 'task.blocked', payload: { taskId: 'x', reason: 'aguardando aprovação' } }, source: 'system', actorUserId: null, now });
    const tick = await supervisionTick(repo, companyId, 'cliente-aaaa', t0 + 2000);
    expect(tick).toMatchObject({ action: 'visit_switched' });
    expect((await repo.getEmployee(companyId, manager.id))!.runtime.supervision).toMatchObject({ targetEmployeeId: other.id, reason: 'blocked' });
  });

  it('encerra a visita se o funcionário sai e não supervisiona com o gerente ocupado', async () => {
    const { repo, companyId, manager } = await setup();
    await supervisionTick(repo, companyId, 'cliente-aaaa', t0);
    const target = (await repo.getEmployee(companyId, manager.id))!.runtime.supervision!.targetEmployeeId;
    await ingestEvent(repo, { companyId, raw: { employeeId: target, type: 'employee.offline' }, source: 'system', actorUserId: null, now: () => new Date(t0 + 1000) });
    expect(await supervisionTick(repo, companyId, 'cliente-aaaa', t0 + 2000)).toMatchObject({ action: 'visit_ended' });
    await ingestEvent(repo, { companyId, raw: { employeeId: manager.id, type: 'task.started', payload: { taskId: 'p', title: 'Planejamento' } }, source: 'system', actorUserId: null, now: () => new Date(t0 + 3000) });
    expect(await supervisionTick(repo, companyId, 'cliente-aaaa', t0 + 4000)).toMatchObject({ action: 'none' });
  });

  it('após uma ronda completa, o gerente volta à sala (pausa) se não houver urgência', async () => {
    const { repo, companyId, manager } = await setup();
    let t = t0;
    for (let i = 0; i < 3; i++) {
      await supervisionTick(repo, companyId, 'cliente-aaaa', t);
      const target = (await repo.getEmployee(companyId, manager.id))!.runtime.supervision!.targetEmployeeId;
      t += MIN_VISIT_MS + 2000;
      expect((await recordInspection(repo, companyId, 'cliente-aaaa', target, t)).status).toBe('done');
      t += 7000;
    }
    expect(await supervisionTick(repo, companyId, 'cliente-aaaa', t)).toMatchObject({ action: 'none', reason: 'pausa entre rondas' });
  });
});
