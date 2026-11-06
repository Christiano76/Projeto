import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  assessEmployee,
  buildInspectionPayload,
  chooseInspectionTarget,
  createInitialRuntimeState,
  deriveActivity,
  lastInspections,
  mainReason,
  shouldInterrupt,
  type EmployeeRuntimeState,
} from '../src';
import { T, ev } from './helpers';

const MIN = 60_000;
const base = Date.parse(T(0));
const rt = (patch: Partial<EmployeeRuntimeState>): EmployeeRuntimeState => ({ ...createInitialRuntimeState(T(0)), ...patch });

describe('avaliação do estado real', () => {
  it('detecta falha, bloqueio, atraso, tarefa longa e ociosidade', () => {
    expect(assessEmployee(rt({ status: 'error' }), base)).toEqual(['error']);
    expect(assessEmployee(rt({ status: 'blocked', currentTask: { id: 't', title: 'x' } }), base)).toEqual(['blocked']);
    const overdue = rt({ status: 'working', currentTask: { id: 't', title: 'x', dueAt: T(10) } });
    expect(assessEmployee(overdue, base + 20_000)).toContain('overdue');
    expect(assessEmployee(rt({ status: 'working', currentTask: { id: 't', title: 'x' } }), base + 31 * MIN)).toContain('long_running');
    expect(assessEmployee(rt({ status: 'idle' }), base + 11 * MIN)).toEqual(['idle_long']);
    expect(assessEmployee(rt({ status: 'idle' }), base + MIN)).toEqual(['ok']);
    expect(mainReason(['long_running', 'overdue'])).toBe('overdue');
  });
});

describe('escolha da próxima inspeção', () => {
  const emps = [
    { id: 'mgr', runtime: rt({}) },
    { id: 'a', runtime: rt({ status: 'working', currentTask: { id: 't', title: 'x' } }) },
    { id: 'b', runtime: rt({ status: 'error' }) },
    { id: 'c', runtime: rt({ status: 'meeting' }) },
    { id: 'd', runtime: rt({ status: 'offline' }) },
  ];

  it('prioriza problemas reais e ignora ausentes/em reunião e o próprio gerente', () => {
    const pick = chooseInspectionTarget('mgr', emps, new Map(), base + MIN);
    expect(pick).toMatchObject({ targetEmployeeId: 'b', reason: 'error' });
  });

  it('não repete inspeção do mesmo problema dentro do intervalo, mas faz rotina com os demais', () => {
    const inspected = new Map([['b', base + MIN]]);
    const pick = chooseInspectionTarget('mgr', emps, inspected, base + 2 * MIN);
    expect(pick).toMatchObject({ targetEmployeeId: 'a', reason: 'routine' });
    const all = new Map([['a', base + 2 * MIN], ['b', base + 2 * MIN]]);
    expect(chooseInspectionTarget('mgr', emps, all, base + 3 * MIN)).toBeNull();
  });

  it('urgência interrompe ronda de rotina, mas não outra urgência', () => {
    const urgent = { targetEmployeeId: 'b', reason: 'error' as const, score: 1 };
    expect(shouldInterrupt('routine', urgent)).toBe(true);
    expect(shouldInterrupt('blocked', urgent)).toBe(false);
    expect(shouldInterrupt('routine', { ...urgent, reason: 'idle_long' })).toBe(false);
  });

  it('registro da inspeção reflete o estado consultado', () => {
    const target = { id: 'a', runtime: rt({ status: 'working', statusSince: T(0), currentTask: { id: 't9', title: 'Home' } }) };
    expect(buildInspectionPayload(target, base + 5 * MIN)).toEqual({
      targetEmployeeId: 'a',
      observedStatus: 'working',
      taskId: 't9',
      taskTitle: 'Home',
      findings: ['ok'],
      statusMinutes: 5,
    });
  });
});

describe('máquina de estados da supervisão', () => {
  it('visita → inspeção; trabalho real cancela a ronda; lastInspections lê o histórico', () => {
    let s = createInitialRuntimeState(T(0));
    const start = applyEvent(s, ev({ employeeId: 'mgr', type: 'supervision.visit_started', payload: { targetEmployeeId: 'a', reason: 'routine' } }, T(1)));
    expect(start.applied).toBe(true);
    s = start.state;
    expect(deriveActivity(s, base).placement).toBe('visit');
    expect(applyEvent(s, ev({ employeeId: 'mgr', type: 'supervision.inspected', payload: { targetEmployeeId: 'x', observedStatus: 'idle', findings: ['ok'], statusMinutes: 0 } }, T(2))).applied).toBe(false);
    const done = ev({ employeeId: 'mgr', type: 'supervision.inspected', payload: { targetEmployeeId: 'a', observedStatus: 'idle', findings: ['ok'], statusMinutes: 0 } }, T(3));
    const ins = applyEvent(s, done);
    expect(ins.state).toMatchObject({ supervision: null, inspectionsDone: 1 });
    expect(lastInspections([done]).get('a')).toBe(Date.parse(T(3)));

    const again = applyEvent(ins.state, ev({ employeeId: 'mgr', type: 'supervision.visit_started', payload: { targetEmployeeId: 'b', reason: 'error' } }, T(4))).state;
    const task = applyEvent(again, ev({ employeeId: 'mgr', type: 'task.started', payload: { taskId: 'p', title: 'Plano semanal' } }, T(5)));
    expect(task.state.supervision).toBeNull();
    expect(applyEvent(task.state, ev({ employeeId: 'mgr', type: 'supervision.visit_started', payload: { targetEmployeeId: 'b', reason: 'error' } }, T(6))).applied).toBe(false);
  });
});
