'use client';

import { agentActivity, type OfficeSimulation, type SimAgent } from '@agency/core';
import { useEffect, useState } from 'react';

/**
 * Ponte entre a simulação (atualizada a cada quadro, fora do React) e a
 * interface. Os painéis só re-renderizam quando algo relevante muda
 * (destino, fase, histórico), no máximo algumas vezes por segundo.
 */
export const simulationHost: { current: OfficeSimulation | null } = { current: null };
const hostListeners = new Set<() => void>();

export function setSimulation(sim: OfficeSimulation | null) {
  simulationHost.current = sim;
  hostListeners.forEach((l) => l());
}

export interface AgentInfo {
  phase: SimAgent['phase'];
  destination: string | null;
  activity: string | null;
  history: SimAgent['history'];
  distance: number;
  waitReason: string | null;
  engagedWith: string | null;
}

function snapshot(id: string): AgentInfo | null {
  const a = simulationHost.current?.agents.get(id);
  if (!a) return null;
  return {
    phase: a.phase,
    destination: a.goal?.label ?? null,
    activity: agentActivity.get(id) ?? null,
    history: a.history.slice(0, 12),
    distance: a.distance,
    waitReason: a.waitReason,
    engagedWith: a.engagedWith,
  };
}

/** Informações de movimento de um funcionário (atualizadas com moderação). */
export function useAgentInfo(id: string | null): AgentInfo | null {
  const [info, setInfo] = useState<AgentInfo | null>(() => (id ? snapshot(id) : null));
  useEffect(() => {
    if (!id) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setInfo(snapshot(id));
      }, 250);
    };
    let unsubSim: (() => void) | null = null;
    const attach = () => {
      unsubSim?.();
      unsubSim = simulationHost.current?.subscribe((agentId) => agentId === id && refresh()) ?? null;
      refresh();
    };
    attach();
    hostListeners.add(attach);
    // Atividade/espera mudam sem eventos estruturais: atualização leve periódica.
    const interval = setInterval(refresh, 1500);
    return () => {
      hostListeners.delete(attach);
      unsubSim?.();
      clearInterval(interval);
      if (timer) clearTimeout(timer);
    };
  }, [id]);
  return id ? info : null;
}
