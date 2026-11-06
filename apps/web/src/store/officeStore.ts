'use client';

import type { AgentEvent, Employee, LiveUpdate, OfficeSnapshot } from '@agency/core';
import { create } from 'zustand';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';
export type WallMode = 'low' | 'high';

interface OfficeState {
  snapshot: OfficeSnapshot | null;
  employees: Record<string, Employee>;
  events: AgentEvent[];
  selectedEmployeeId: string | null;
  focusRoomKey: string | null;
  /** Incrementado para pedir à câmera que reenquadre (mesmo foco repetido). */
  focusNonce: number;
  wallMode: WallMode;
  showLabels: boolean;
  connection: ConnectionState;
  /** Diferença (ms) entre o relógio do servidor e o local. */
  clockSkewMs: number;

  load(snapshot: OfficeSnapshot): void;
  applyUpdate(update: LiveUpdate): void;
  select(employeeId: string | null): void;
  focusRoom(roomKey: string | null): void;
  /** Limpa o foco sem pedir reenquadramento (a câmera já está indo para outro lugar). */
  clearFocus(): void;
  setWallMode(mode: WallMode): void;
  toggleLabels(): void;
  setConnection(state: ConnectionState): void;
}

const MAX_FEED = 100;

export const useOfficeStore = create<OfficeState>((set) => ({
  snapshot: null,
  employees: {},
  events: [],
  selectedEmployeeId: null,
  focusRoomKey: null,
  focusNonce: 0,
  wallMode: 'low',
  showLabels: true,
  connection: 'connecting',
  clockSkewMs: 0,

  load: (snapshot) =>
    set({
      snapshot,
      employees: Object.fromEntries(snapshot.employees.map((e) => [e.id, e])),
      events: snapshot.recentEvents.slice(0, MAX_FEED),
      clockSkewMs: Date.parse(snapshot.serverTime) - Date.now(),
    }),

  applyUpdate: (update) =>
    set((s) => {
      const next: Partial<OfficeState> = {};
      if (update.employee) {
        const current = s.employees[update.employee.id];
        // Ignora atualizações antigas (ex.: chegaram fora de ordem).
        if (current && update.employee.runtime.version >= current.runtime.version) {
          next.employees = { ...s.employees, [current.id]: { ...current, runtime: update.employee.runtime } };
        }
      }
      if (update.event && !s.events.some((e) => e.id === update.event!.id)) {
        next.events = [update.event, ...s.events].slice(0, MAX_FEED);
      }
      return next;
    }),

  select: (employeeId) => set({ selectedEmployeeId: employeeId }),
  focusRoom: (roomKey) => set((s) => ({ focusRoomKey: roomKey, focusNonce: s.focusNonce + 1 })),
  clearFocus: () => set({ focusRoomKey: null }),
  setWallMode: (wallMode) => set({ wallMode }),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  setConnection: (connection) => set({ connection }),
}));

/** Hora "do servidor" estimada no cliente (para derivações temporais consistentes). */
export function serverNow(): number {
  return Date.now() + useOfficeStore.getState().clockSkewMs;
}
