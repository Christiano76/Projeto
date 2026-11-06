'use client';

import type { LiveUpdate } from '@agency/core';
import { useEffect } from 'react';
import { useOfficeStore } from '@/store/officeStore';
import { simulationHost } from './simulationHost';

const TICK_MS = 4_000;
const FOLLOWER_TICK_MS = 15_000;
/** Tempo que o gerente observa a estação depois de chegar, antes de registrar. */
export const INSPECTION_OBSERVE_MS = 3_500;

function clientId(): string {
  try {
    let id = sessionStorage.getItem('agency-os:client');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('agency-os:client', id);
    }
    return id;
  } catch {
    return `anon-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/**
 * Mantém a ronda do gerente em andamento enquanto o escritório estiver aberto.
 *
 * - A cada poucos segundos pede ao servidor o próximo passo (o servidor
 *   decide quem visitar com base nos dados reais e concede a liderança a uma
 *   única aba por empresa).
 * - Quando o avatar do gerente CHEGA ao funcionário e observa por alguns
 *   segundos, pede ao servidor o registro da inspeção — o servidor consulta o
 *   estado verdadeiro do funcionário e grava o resultado.
 */
export function useSupervisionLeader(applyUpdate: (u: LiveUpdate) => void) {
  useEffect(() => {
    const id = clientId();
    let stopped = false;
    let leader = false;
    let tickTimer: ReturnType<typeof setTimeout> | null = null;
    const sentFor = new Set<string>();

    const post = async (url: string, body: object) => {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: id, ...body }) });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };

    const absorb = (result: { status?: string; event?: LiveUpdate['event']; employee?: LiveUpdate['employee'] } | undefined) => {
      if (result?.status === 'applied' && result.event && result.employee) applyUpdate({ event: result.event, employee: result.employee });
    };

    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === 'visible') {
        try {
          const r = await post('/api/supervision/tick', {});
          leader = r.body?.leader === true;
          absorb(r.body?.result);
        } catch {
          /* rede instável: tenta no próximo ciclo */
        }
      }
      tickTimer = setTimeout(tick, leader ? TICK_MS : FOLLOWER_TICK_MS);
    };
    tickTimer = setTimeout(tick, 1200);

    // Observa a chegada do gerente ao funcionário visitado.
    const watch = setInterval(async () => {
      if (!leader || stopped) return;
      const { employees } = useOfficeStore.getState();
      const manager = Object.values(employees).find((e) => e.isManager);
      const visit = manager?.runtime.supervision;
      const agent = manager ? simulationHost.current?.agents.get(manager.id) : undefined;
      if (!manager || !visit || !agent) return;
      const visitKey = `${visit.targetEmployeeId}@${visit.startedAt}`;
      if (sentFor.has(visitKey)) return;
      const arrived =
        agent.phase === 'standing' &&
        agent.goal?.interaction === 'inspect' &&
        agent.goal.interactWith === visit.targetEmployeeId &&
        agent.phaseTime * 1000 >= INSPECTION_OBSERVE_MS;
      if (!arrived) return;
      sentFor.add(visitKey);
      try {
        const r = await post('/api/supervision/inspect', { targetEmployeeId: visit.targetEmployeeId });
        if (r.status === 425) sentFor.delete(visitKey); // cedo demais: tenta de novo
        absorb(r.body?.result);
      } catch {
        sentFor.delete(visitKey);
      }
    }, 500);

    return () => {
      stopped = true;
      if (tickTimer) clearTimeout(tickTimer);
      clearInterval(watch);
    };
  }, [applyUpdate]);
}
