'use client';

import type { AgentEvent, DataMode, EmployeeRuntimeState, LiveUpdate } from '@agency/core';
import { getBrowserSupabase } from './supabase/browser';

type Status = 'live' | 'reconnecting' | 'offline';

/**
 * Assina as atualizações em tempo real da empresa.
 *  - Modo local: Server-Sent Events (`/api/events/stream`).
 *  - Supabase: Realtime (postgres_changes em agent_events e employees, sob RLS).
 * Em ambos os casos o escritório reage a EVENTOS — sem polling.
 */
export function subscribeLiveUpdates(
  mode: DataMode,
  companyId: string,
  onUpdate: (u: LiveUpdate) => void,
  onStatus: (s: Status) => void,
): () => void {
  if (mode === 'memory') {
    const source = new EventSource('/api/events/stream');
    source.onopen = () => onStatus('live');
    source.onerror = () => onStatus(source.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting');
    source.onmessage = (msg) => {
      try {
        onUpdate(JSON.parse(msg.data) as LiveUpdate);
      } catch {
        /* mensagem malformada: ignora */
      }
    };
    return () => source.close();
  }

  const supabase = getBrowserSupabase();
  const channel = supabase
    .channel(`company:${companyId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'agent_events', filter: `company_id=eq.${companyId}` },
      (payload) => {
        const r = payload.new as Record<string, unknown>;
        const event = {
          id: String(r.id),
          companyId: String(r.company_id),
          employeeId: String(r.employee_id),
          type: r.type,
          payload: r.payload ?? {},
          source: r.source,
          createdAt: new Date(String(r.created_at)).toISOString(),
        } as AgentEvent;
        onUpdate({ event });
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'employees', filter: `company_id=eq.${companyId}` },
      (payload) => {
        const r = payload.new as Record<string, unknown>;
        const raw = r.runtime_state as EmployeeRuntimeState;
        const runtime: EmployeeRuntimeState = {
          ...raw,
          statusSince: new Date(raw.statusSince).toISOString(),
          lastEventAt: raw.lastEventAt ? new Date(raw.lastEventAt).toISOString() : null,
          version: Number(r.state_version),
        };
        onUpdate({ employee: { id: String(r.id), runtime } });
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onStatus('live');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onStatus('reconnecting');
      else if (status === 'CLOSED') onStatus('offline');
    });
  return () => {
    void supabase.removeChannel(channel);
  };
}
