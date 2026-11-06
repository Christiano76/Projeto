import { describe, expect, it } from 'vitest';
import { applyEvent, createInitialRuntimeState, replayEvents, type EmployeeRuntimeState } from '../src';
import { T, ev } from './helpers';

const E = 'e1';
const idle = () => createInitialRuntimeState(T(0));
const start = (s: EmployeeRuntimeState, at = 1, taskId = 't1') =>
  applyEvent(s, ev({ employeeId: E, type: 'task.started', payload: { taskId, title: 'Landing page' } }, T(at)));

describe('máquina de estados do funcionário', () => {
  it('idle -> working -> idle ao concluir tarefa, contando produtividade', () => {
    const s1 = start(idle());
    expect(s1.applied).toBe(true);
    expect(s1.state.status).toBe('working');
    expect(s1.state.currentTask).toEqual({ id: 't1', title: 'Landing page', dueAt: null });
    expect(s1.state.statusSince).toBe(T(1));

    const s2 = applyEvent(s1.state, ev({ employeeId: E, type: 'task.completed', payload: { taskId: 't1' } }, T(5)));
    expect(s2.applied).toBe(true);
    expect(s2.state).toMatchObject({ status: 'idle', currentTask: null, tasksCompleted: 1, version: 2 });
    expect(s2.state.lastCompletedTask).toEqual({ id: 't1', title: 'Landing page', dueAt: null, at: T(5) });
  });

  it('não permite iniciar uma segunda tarefa simultânea', () => {
    const s1 = start(idle());
    const s2 = start(s1.state, 2, 't2');
    expect(s2.applied).toBe(false);
    expect(s2.state).toBe(s1.state);
  });

  it('rejeita conclusão de tarefa que não é a atual', () => {
    const s1 = start(idle());
    const r = applyEvent(s1.state, ev({ employeeId: E, type: 'task.completed', payload: { taskId: 'outra' } }, T(2)));
    expect(r.applied).toBe(false);
    if (!r.applied) expect(r.reason).toMatch(/tarefa atual/);
  });

  it('rejeita eventos fora de ordem', () => {
    const s1 = start(idle(), 10);
    const r = applyEvent(s1.state, ev({ employeeId: E, type: 'break.started', payload: {} }, T(5)));
    expect(r.applied).toBe(false);
  });

  it('falha leva a status error e permite nova tarefa', () => {
    const s1 = start(idle());
    const s2 = applyEvent(s1.state, ev({ employeeId: E, type: 'task.failed', payload: { taskId: 't1', error: 'timeout' } }, T(2)));
    expect(s2.state).toMatchObject({ status: 'error', lastError: 'timeout', tasksFailed: 1, currentTask: null });
    const s3 = start(s2.state, 3, 't2');
    expect(s3.applied).toBe(true);
    expect(s3.state.lastError).toBeNull();
  });

  it('bloqueio e desbloqueio preservam a tarefa', () => {
    const s1 = start(idle());
    const b = applyEvent(s1.state, ev({ employeeId: E, type: 'task.blocked', payload: { taskId: 't1', reason: 'aguardando aprovação' } }, T(2)));
    expect(b.state).toMatchObject({ status: 'blocked', blockedReason: 'aguardando aprovação' });
    const u = applyEvent(b.state, ev({ employeeId: E, type: 'task.unblocked', payload: { taskId: 't1' } }, T(3)));
    expect(u.state).toMatchObject({ status: 'working', blockedReason: null, currentTask: { id: 't1' } });
  });

  it('reunião pausa a tarefa e retoma o status anterior ao sair', () => {
    const s1 = start(idle());
    const m = applyEvent(s1.state, ev({ employeeId: E, type: 'meeting.joined', payload: { meetingId: 'm1', topic: 'Planejamento' } }, T(2)));
    expect(m.state.status).toBe('meeting');
    expect(m.state.currentTask?.id).toBe('t1');
    expect(start(m.state, 3, 't2').applied).toBe(false);
    const wrong = applyEvent(m.state, ev({ employeeId: E, type: 'meeting.left', payload: { meetingId: 'm2' } }, T(3)));
    expect(wrong.applied).toBe(false);
    const l = applyEvent(m.state, ev({ employeeId: E, type: 'meeting.left', payload: { meetingId: 'm1' } }, T(4)));
    expect(l.state).toMatchObject({ status: 'working', meeting: null });
  });

  it('pausa só a partir de disponível', () => {
    const r = applyEvent(idle(), ev({ employeeId: E, type: 'break.started', payload: {} }, T(1)));
    expect(r.state.status).toBe('resting');
    expect(start(r.state, 2).applied).toBe(false);
    const e = applyEvent(r.state, ev({ employeeId: E, type: 'break.ended', payload: {} }, T(3)));
    expect(e.state.status).toBe('idle');
    expect(applyEvent(start(idle()).state, ev({ employeeId: E, type: 'break.started', payload: {} }, T(2))).applied).toBe(false);
  });

  it('offline/online e mensagens', () => {
    const off = applyEvent(idle(), ev({ employeeId: E, type: 'employee.offline', payload: {} }, T(1)));
    expect(off.state.status).toBe('offline');
    expect(applyEvent(off.state, ev({ employeeId: E, type: 'message.sent', payload: { toEmployeeId: 'e2', subject: 'oi' } }, T(2))).applied).toBe(false);
    expect(start(off.state, 2).applied).toBe(false);
    const on = applyEvent(off.state, ev({ employeeId: E, type: 'employee.online', payload: {} }, T(3)));
    expect(on.state.status).toBe('idle');
    const msg = applyEvent(on.state, ev({ employeeId: E, type: 'message.sent', payload: { toEmployeeId: 'e2', subject: 'oi' } }, T(4)));
    expect(msg.applied).toBe(true);
    expect(msg.state.status).toBe('idle');
    expect(msg.state.statusSince).toBe(T(3));
  });

  it('replay ignora eventos inválidos e chega ao mesmo estado', () => {
    const events = [
      ev({ employeeId: E, type: 'task.started', payload: { taskId: 't1', title: 'A' } }, T(1)),
      ev({ employeeId: E, type: 'task.started', payload: { taskId: 't2', title: 'B' } }, T(2)), // rejeitado
      ev({ employeeId: E, type: 'task.completed', payload: { taskId: 't1' } }, T(3)),
    ];
    const s = replayEvents(idle(), events);
    expect(s).toMatchObject({ status: 'idle', tasksCompleted: 1, version: 2 });
  });
});
