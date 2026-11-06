import { describe, expect, it } from 'vitest';
import {
  CELEBRATION_MS,
  DEFAULT_EMPLOYEES,
  allocateAnchors,
  applyEvent,
  createDefaultLayout,
  createInitialRuntimeState,
  deriveActivity,
  getEntranceAnchor,
  nextActivityChangeAt,
  type Employee,
} from '../src';
import { T, ev } from './helpers';

describe('deriveActivity', () => {
  it('só digita quando realmente trabalhando', () => {
    const idle = createInitialRuntimeState(T(0));
    expect(deriveActivity(idle, Date.parse(T(1)))).toMatchObject({ placement: 'desk', pose: 'sit_idle', screenOn: false });
    const working = applyEvent(idle, ev({ employeeId: 'e', type: 'task.started', payload: { taskId: 't', title: 'x' } }, T(1))).state;
    expect(deriveActivity(working, Date.parse(T(2)))).toMatchObject({ pose: 'sit_typing', screenOn: true });
  });

  it('comemora apenas por um período após conclusão real', () => {
    let s = createInitialRuntimeState(T(0));
    s = applyEvent(s, ev({ employeeId: 'e', type: 'task.started', payload: { taskId: 't', title: 'x' } }, T(1))).state;
    s = applyEvent(s, ev({ employeeId: 'e', type: 'task.completed', payload: { taskId: 't' } }, T(2))).state;
    const at = Date.parse(T(2));
    expect(deriveActivity(s, at + 100)).toMatchObject({ pose: 'celebrate', badge: 'task_done' });
    expect(nextActivityChangeAt(s, at + 100)).toBe(at + CELEBRATION_MS);
    expect(deriveActivity(s, at + CELEBRATION_MS + 1)).toMatchObject({ pose: 'sit_idle', badge: null });
    expect(nextActivityChangeAt(s, at + CELEBRATION_MS + 1)).toBeNull();
  });

  it('mapeia todos os status para um posicionamento', () => {
    const base = createInitialRuntimeState(T(0));
    expect(deriveActivity({ ...base, status: 'offline' }, 0).placement).toBe('away');
    expect(deriveActivity({ ...base, status: 'meeting' }, 0).placement).toBe('meeting');
    expect(deriveActivity({ ...base, status: 'resting' }, 0).placement).toBe('lounge');
    expect(deriveActivity({ ...base, status: 'blocked' }, 0).badge).toBe('blocked');
    expect(deriveActivity({ ...base, status: 'error' }, 0).badge).toBe('error');
  });
});

describe('allocateAnchors', () => {
  const layout = createDefaultLayout();
  const make = (status: Employee['runtime']['status'], i: number) => ({
    id: `e${i}`,
    deskSeatKey: DEFAULT_EMPLOYEES[i % DEFAULT_EMPLOYEES.length]!.deskSeatKey,
    runtime: { ...createInitialRuntimeState(T(i)), status },
  });

  it('coloca cada um na própria mesa quando disponível', () => {
    const emps = DEFAULT_EMPLOYEES.map((_, i) => make('idle', i));
    const m = allocateAnchors(layout, emps, 0);
    emps.forEach((e) => expect(m.get(e.id)!.key).toBe(e.deskSeatKey));
  });

  it('distribui assentos distintos na reunião e transborda em pé', () => {
    const emps = Array.from({ length: 10 }, (_, i) => make('meeting', i));
    const m = allocateAnchors(layout, emps, 0);
    const seated = emps.map((e) => m.get(e.id)!).filter((a) => a.kind === 'meeting');
    expect(seated).toHaveLength(8);
    expect(new Set(seated.map((a) => a.key)).size).toBe(8);
    const standing = emps.map((e) => m.get(e.id)!).filter((a) => a.kind === 'stand');
    expect(standing).toHaveLength(2);
    expect(standing.every((a) => a.roomKey === 'reunioes')).toBe(true);
  });

  it('é determinística independentemente da ordem de entrada', () => {
    const emps = Array.from({ length: 5 }, (_, i) => make('resting', i));
    const a = allocateAnchors(layout, emps, 0);
    const b = allocateAnchors(layout, [...emps].reverse(), 0);
    emps.forEach((e) => expect(a.get(e.id)!.key).toBe(b.get(e.id)!.key));
  });

  it('funcionários fora do expediente vão para a entrada', () => {
    const m = allocateAnchors(layout, [make('offline', 0)], 0);
    expect(m.get('e0')!.key).toBe(getEntranceAnchor(layout).key);
  });
});
