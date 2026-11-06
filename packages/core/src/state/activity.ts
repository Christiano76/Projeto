import type { Employee, EmployeeRuntimeState } from '../domain/types';
import { getEntranceAnchor, getSeatAnchors, standingAnchor, type Anchor } from '../office/anchors';
import type { OfficeLayout } from '../office/layout';

/**
 * Traduz o estado operacional REAL em atividade visual. Nada aqui inventa
 * trabalho: "digitando" só ocorre com status `working` e uma tarefa atual.
 */

export type Placement = 'desk' | 'meeting' | 'lounge' | 'away' | 'visit';
export type Pose =
  | 'sit_idle'
  | 'sit_typing'
  | 'sit_talking'
  | 'sit_relax'
  | 'stand_idle'
  | 'stand_talk'
  | 'inspect'
  | 'wait'
  | 'celebrate';
export type Badge = 'blocked' | 'error' | 'task_done' | null;

export interface VisualActivity {
  placement: Placement;
  pose: Pose;
  /** Monitor ligado com conteúdo de trabalho. */
  screenOn: boolean;
  badge: Badge;
}

/** Janela (ms) em que o avatar comemora após concluir uma tarefa de verdade. */
export const CELEBRATION_MS = 4000;

export function deriveActivity(state: EmployeeRuntimeState, nowMs: number): VisualActivity {
  switch (state.status) {
    case 'offline':
      return { placement: 'away', pose: 'stand_idle', screenOn: false, badge: null };
    case 'working':
      return { placement: 'desk', pose: 'sit_typing', screenOn: true, badge: null };
    case 'blocked':
      return { placement: 'desk', pose: 'sit_idle', screenOn: true, badge: 'blocked' };
    case 'error':
      return { placement: 'desk', pose: 'sit_idle', screenOn: false, badge: 'error' };
    case 'meeting':
      return { placement: 'meeting', pose: 'sit_talking', screenOn: false, badge: null };
    case 'resting':
      return { placement: 'lounge', pose: 'sit_relax', screenOn: false, badge: null };
    case 'idle': {
      // Gerente em visita de supervisão (decidida e registrada pelo servidor).
      if (state.supervision) return { placement: 'visit', pose: 'inspect', screenOn: false, badge: null };
      const done = state.lastCompletedTask;
      if (done && nowMs - Date.parse(done.at) < CELEBRATION_MS && nowMs >= Date.parse(done.at)) {
        return { placement: 'desk', pose: 'celebrate', screenOn: false, badge: 'task_done' };
      }
      return { placement: 'desk', pose: 'sit_idle', screenOn: false, badge: null };
    }
  }
}

/** Momento (ms) em que a atividade derivada muda sozinha (fim da comemoração), ou null. */
export function nextActivityChangeAt(state: EmployeeRuntimeState, nowMs: number): number | null {
  if (state.status !== 'idle' || !state.lastCompletedTask) return null;
  const end = Date.parse(state.lastCompletedTask.at) + CELEBRATION_MS;
  return end > nowMs ? end : null;
}

/**
 * Atribui a cada funcionário o ponto do escritório onde deve estar.
 * Determinístico: mesma entrada => mesma saída (todos os clientes concordam).
 */
export function allocateAnchors(
  layout: OfficeLayout,
  employees: readonly Pick<Employee, 'id' | 'deskSeatKey' | 'runtime'>[],
  nowMs: number,
): Map<string, Anchor> {
  const seats = getSeatAnchors(layout);
  const byKey = new Map(seats.map((s) => [s.key, s]));
  const pools: Record<'meeting' | 'lounge', Anchor[]> = {
    meeting: seats.filter((s) => s.kind === 'meeting'),
    lounge: seats.filter((s) => s.kind === 'lounge'),
  };
  const meetingRoom = pools.meeting[0]?.roomKey ?? layout.rooms[0]!.key;
  const loungeRoom = pools.lounge[0]?.roomKey ?? layout.rooms[0]!.key;
  const entrance = getEntranceAnchor(layout);

  const result = new Map<string, Anchor>();
  const used = new Set<string>();
  const overflow: Record<'meeting' | 'lounge', number> = { meeting: 0, lounge: 0 };

  const ordered = [...employees].sort(
    (a, b) => a.runtime.statusSince.localeCompare(b.runtime.statusSince) || a.id.localeCompare(b.id),
  );

  for (const e of ordered) {
    const placement = deriveActivity(e.runtime, nowMs).placement;
    if (placement === 'away') {
      result.set(e.id, entrance);
      continue;
    }
    if (placement === 'desk' || placement === 'visit') {
      const desk = byKey.get(e.deskSeatKey);
      result.set(e.id, desk ?? standingAnchor(layout, layout.rooms[0]!.key, 0));
      continue;
    }
    const free = pools[placement].find((s) => !used.has(s.key));
    if (free) {
      used.add(free.key);
      result.set(e.id, free);
    } else {
      const room = placement === 'meeting' ? meetingRoom : loungeRoom;
      result.set(e.id, standingAnchor(layout, room, overflow[placement]++));
    }
  }
  return result;
}
