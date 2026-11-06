import type { AgentEvent, AgentEventInput } from '../src';

let counter = 0;
export function ev(input: AgentEventInput, createdAt: string): AgentEvent {
  counter += 1;
  return { id: `ev-${counter}`, companyId: 'c1', source: 'manual', createdAt, ...input } as AgentEvent;
}
export const T = (s: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, s)).toISOString();
