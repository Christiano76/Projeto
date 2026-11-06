import { describe, expect, it } from 'vitest';
import { AGENT_EVENT_TYPES, describeEvent, parseAgentEventInput } from '../src';

describe('parseAgentEventInput', () => {
  it('aceita evento válido e normaliza payload', () => {
    const r = parseAgentEventInput({ employeeId: 'e1', type: 'task.started', payload: { taskId: ' t1 ', title: 'Criar landing page' } });
    expect(r).toEqual({ ok: true, value: { employeeId: 'e1', type: 'task.started', payload: { taskId: 't1', title: 'Criar landing page' } } });
  });

  it('usa payload vazio para eventos sem dados', () => {
    const r = parseAgentEventInput({ employeeId: 'e1', type: 'break.started' });
    expect(r.ok).toBe(true);
  });

  it('rejeita tipo desconhecido', () => {
    const r = parseAgentEventInput({ employeeId: 'e1', type: 'task.hacked', payload: {} });
    expect(r.ok).toBe(false);
  });

  it('rejeita payload incompleto ou com campos extras', () => {
    expect(parseAgentEventInput({ employeeId: 'e1', type: 'task.started', payload: { taskId: 't1' } }).ok).toBe(false);
    expect(parseAgentEventInput({ employeeId: 'e1', type: 'break.started', payload: { x: 1 } }).ok).toBe(false);
  });

  it('rejeita textos acima do limite', () => {
    const r = parseAgentEventInput({ employeeId: 'e1', type: 'task.started', payload: { taskId: 't', title: 'x'.repeat(201) } });
    expect(r.ok).toBe(false);
  });

  it('descreve todos os tipos de evento', () => {
    for (const type of AGENT_EVENT_TYPES) {
      expect(describeEvent({ type, payload: { title: 'a', note: 'b', error: 'c', reason: 'd', topic: 'e', subject: 'f' } } as never)).toBeTruthy();
    }
  });
});
