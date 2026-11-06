import type { Employee } from '../domain/types';
import type { AgentEvent } from '../events/schema';
import type { Anchor } from '../office/anchors';
import type { OfficeLayout, Vec2 } from '../office/layout';
import { deriveActivity, type Pose, type VisualActivity } from '../state/activity';
import type { Poi } from './poi';
import { hash01 } from './random';

/**
 * Decide PARA ONDE cada funcionário vai, a partir do estado real.
 *
 * Prioridade (do mais forte ao mais fraco):
 *  1. Estado real: fora do expediente → sai; reunião → sala de reuniões;
 *     pausa → descanso; trabalhando/bloqueado/erro → própria mesa.
 *  2. Gerente em visita de supervisão (registrada pelo servidor) → vai até
 *     o funcionário inspecionado.
 *  3. Mensagem interna real enviada há pouco → leva a mensagem ao colega.
 *  4. Ocioso → rotina de ociosidade determinística (mesa, café, visita a um
 *     colega também ocioso, passeio). Rotulada como ociosidade, nunca como
 *     trabalho.
 */

export type GoalSpec =
  | { kind: 'exit'; key: string; label: string; activity: string }
  | { kind: 'seat'; key: string; anchor: Anchor; pose: Pose; label: string; activity: string }
  | {
      kind: 'near';
      key: string;
      point: Vec2;
      lookAt: Vec2;
      pose: Pose;
      label: string;
      activity: string;
      interactWith?: string;
      interaction?: 'talk' | 'inspect';
      minR?: number;
      maxR?: number;
    };

/** Duração de cada "fatia" da rotina de ociosidade. */
export const AMBIENT_SLOT_MS = 42_000;
/** Tempo mínimo ocioso antes de sair da mesa. */
export const AMBIENT_MIN_IDLE_MS = 15_000;
/** Por quanto tempo uma mensagem real faz o remetente ir até o destinatário. */
export const MESSAGE_VISIT_MS = 16_000;

export interface BehaviorInput {
  layout: OfficeLayout;
  employees: readonly Employee[];
  anchors: ReadonlyMap<string, Anchor>;
  pois: readonly Poi[];
  strolls: readonly Poi[];
  recentEvents: readonly AgentEvent[];
  nowMs: number;
}

export function resolveGoals(input: BehaviorInput): Map<string, GoalSpec> {
  const { layout, employees, anchors, nowMs } = input;
  const roomName = (key: string) => layout.rooms.find((r) => r.key === key)?.name ?? key;
  const byId = new Map(employees.map((e) => [e.id, e]));
  const activities = new Map<string, VisualActivity>(employees.map((e) => [e.id, deriveActivity(e.runtime, nowMs)]));
  const deskOf = (e: Employee) => anchors.get(e.id);
  const out = new Map<string, GoalSpec>();
  /** Metas de rotina de ociosidade (podem ceder lugar a "esperar visita na mesa"). */
  const ambient = new Set<string>();

  // Funcionários que podem receber visita de rotina: ociosos à mesa.
  const hosts = employees.filter((e) => {
    const act = activities.get(e.id)!;
    return e.runtime.status === 'idle' && act.placement === 'desk' && !e.runtime.supervision;
  });

  for (const e of employees) {
    const act = activities.get(e.id)!;
    const anchor = anchors.get(e.id);
    const first = e.name.split(' ')[0] ?? e.name;

    if (act.placement === 'away' || !anchor) {
      out.set(e.id, { kind: 'exit', key: 'exit', label: 'Saída', activity: 'Fora do expediente' });
      continue;
    }

    // 1) Estados reais com lugar definido
    if (act.placement === 'meeting' || act.placement === 'lounge') {
      const label = roomName(anchor.roomKey);
      const activity = act.placement === 'meeting' ? `Em reunião: ${e.runtime.meeting?.topic ?? ''}`.trim() : 'Em pausa';
      out.set(e.id, seatOrStand(anchor, act.pose, label, activity));
      continue;
    }
    if (e.runtime.status !== 'idle') {
      const activity =
        e.runtime.status === 'working'
          ? `Trabalhando: ${e.runtime.currentTask?.title ?? ''}`
          : e.runtime.status === 'blocked'
            ? `Bloqueado: ${e.runtime.blockedReason ?? ''}`
            : 'Analisando falha da última tarefa';
      const msg = recentMessage(input.recentEvents, e.id, nowMs);
      const target = msg ? byId.get(msg.toId) : undefined;
      if (msg && target && e.runtime.status === 'working' && onSite(target, activities)) {
        out.set(e.id, visitGoal(e, target, anchors, `Levando mensagem a ${target.name.split(' ')[0]}`, 'talk', msg.subject));
        continue;
      }
      out.set(e.id, seatOrStand(anchor, act.pose, `Mesa (${roomName(anchor.roomKey)})`, activity));
      continue;
    }

    // 2) Gerente em supervisão (estado real registrado pelo servidor)
    if (e.runtime.supervision) {
      const target = byId.get(e.runtime.supervision.targetEmployeeId);
      const tAnchor = target ? anchors.get(target.id) : undefined;
      if (target && tAnchor) {
        out.set(e.id, {
          kind: 'near',
          key: `inspect:${target.id}:${tAnchor.key}`,
          point: tAnchor.position,
          lookAt: tAnchor.position,
          pose: 'inspect',
          label: `${target.name} (${roomName(tAnchor.roomKey)})`,
          activity: `Inspecionando ${target.name.split(' ')[0]}`,
          interactWith: target.id,
          interaction: 'inspect',
          minR: 0.7,
          maxR: 1.6,
        });
        continue;
      }
    }

    // Comemoração de tarefa concluída: fica na mesa
    if (act.pose === 'celebrate') {
      out.set(e.id, seatOrStand(anchor, 'celebrate', `Mesa (${roomName(anchor.roomKey)})`, 'Concluiu uma tarefa'));
      continue;
    }

    // 3) Mensagem real recente → leva ao destinatário
    const msg = recentMessage(input.recentEvents, e.id, nowMs);
    const msgTarget = msg ? byId.get(msg.toId) : undefined;
    if (msg && msgTarget && onSite(msgTarget, activities)) {
      out.set(e.id, visitGoal(e, msgTarget, anchors, `Levando mensagem a ${msgTarget.name.split(' ')[0]}`, 'talk', msg.subject));
      continue;
    }

    // 4) Rotina de ociosidade
    out.set(e.id, ambientGoal(e, anchor, hosts, input, roomName, first));
    ambient.add(e.id);
  }

  // Quem vai receber visita (mensagem real ou conversa) espera na própria mesa.
  for (const spec of [...out.values()]) {
    if (spec.kind !== 'near' || spec.interaction !== 'talk' || !spec.interactWith) continue;
    const host = byId.get(spec.interactWith);
    const desk = host ? anchors.get(host.id) : undefined;
    if (!host || !desk || !ambient.has(host.id)) continue;
    const visitor = employees.find((x) => out.get(x.id) === spec);
    out.set(
      host.id,
      seatOrStand(desk, 'sit_talking', `Mesa (${roomName(desk.roomKey)})`, `Recebendo ${visitor?.name.split(' ')[0] ?? 'um colega'}`),
    );
  }
  return out;
}

function seatOrStand(anchor: Anchor, pose: Pose, label: string, activity: string): GoalSpec {
  if (anchor.kind === 'stand') {
    return {
      kind: 'near',
      key: `stand:${anchor.key}`,
      point: anchor.position,
      lookAt: [anchor.position[0] + Math.sin(anchor.facing), anchor.position[1] + Math.cos(anchor.facing)],
      pose: pose.startsWith('sit_') ? 'stand_talk' : pose,
      label,
      activity,
      minR: 0,
      maxR: 1.6,
    };
  }
  return { kind: 'seat', key: `seat:${anchor.key}`, anchor, pose, label, activity };
}

function onSite(e: Employee, acts: Map<string, VisualActivity>): boolean {
  const p = acts.get(e.id)?.placement;
  return p === 'desk';
}

function visitGoal(
  e: Employee,
  target: Employee,
  anchors: ReadonlyMap<string, Anchor>,
  activity: string,
  interaction: 'talk' | 'inspect',
  subject?: string,
): GoalSpec {
  const tAnchor = anchors.get(target.id)!;
  return {
    kind: 'near',
    key: `visit:${target.id}:${tAnchor.key}`,
    point: tAnchor.position,
    lookAt: tAnchor.position,
    pose: 'stand_talk',
    label: `Mesa de ${target.name}`,
    activity: subject ? `${activity} — ${subject}` : activity,
    interactWith: target.id,
    interaction,
    minR: 0.7,
    maxR: 1.6,
  };
}

function recentMessage(events: readonly AgentEvent[], fromId: string, nowMs: number) {
  for (const ev of events) {
    if (ev.employeeId !== fromId || ev.type !== 'message.sent') continue;
    const age = nowMs - Date.parse(ev.createdAt);
    if (age >= 0 && age < MESSAGE_VISIT_MS) return { toId: ev.payload.toEmployeeId, subject: ev.payload.subject };
  }
  return null;
}

/** Fatia de rotina do funcionário (fase própria, para não se moverem todos juntos). */
export function ambientSlot(employeeId: string, nowMs: number): number {
  const phase = hash01(`phase:${employeeId}`) * AMBIENT_SLOT_MS;
  return Math.floor((nowMs + phase) / AMBIENT_SLOT_MS);
}

function ambientGoal(
  e: Employee,
  desk: Anchor,
  hosts: readonly Employee[],
  input: BehaviorInput,
  roomName: (k: string) => string,
  first: string,
): GoalSpec {
  const atDesk = seatOrStand(desk, 'sit_idle', `Mesa (${roomName(desk.roomKey)})`, 'Disponível, aguardando tarefas');
  const idleFor = input.nowMs - Date.parse(e.runtime.statusSince);
  if (idleFor < AMBIENT_MIN_IDLE_MS) return atDesk;

  const slot = ambientSlot(e.id, input.nowMs);
  const r = hash01(`ambient:${e.id}:${slot}`);
  const pick = <T,>(list: readonly T[], salt: string): T | undefined =>
    list.length ? list[Math.floor(hash01(`${salt}:${e.id}:${slot}`) * list.length)] : undefined;

  if (e.isManager) {
    // Gerente ocioso circula periodicamente pelos departamentos.
    if (r < 0.45) return atDesk;
    const departments = input.strolls.filter((s) => {
      const room = input.layout.rooms.find((x) => x.key === s.roomKey);
      return room && (room.kind === 'department' || room.kind === 'reception' || room.kind === 'meeting');
    });
    const p = pick(departments, 'patrol');
    if (!p) return atDesk;
    return {
      kind: 'near',
      key: `patrol:${p.key}:${slot}`,
      point: p.position,
      lookAt: p.lookAt,
      pose: 'stand_idle',
      label: p.label,
      activity: 'Circulando pelo escritório (sem inspeção)',
      minR: 0,
      maxR: 1.8,
    };
  }

  if (r < 0.48) return atDesk;
  if (r < 0.7) {
    const p = pick(input.pois, 'poi');
    if (p) {
      return {
        kind: 'near',
        key: `poi:${p.key}:${slot}`,
        point: p.position,
        lookAt: p.lookAt,
        pose: 'stand_idle',
        label: `${p.label} — ${roomName(p.roomKey)}`,
        activity: `Pausa rápida (${p.label.toLowerCase()})`,
        minR: 0,
        maxR: 1.6,
      };
    }
  }
  if (r < 0.86) {
    const host = pick(
      hosts.filter((h) => h.id !== e.id),
      'host',
    );
    const hAnchor = host ? input.anchors.get(host.id) : undefined;
    if (host && hAnchor) {
      return {
        kind: 'near',
        key: `chat:${host.id}:${slot}`,
        point: hAnchor.position,
        lookAt: hAnchor.position,
        pose: 'stand_talk',
        label: `Mesa de ${host.name}`,
        activity: `Conversando com ${host.name.split(' ')[0]} (ocioso)`,
        interactWith: host.id,
        interaction: 'talk',
        minR: 0.7,
        maxR: 1.6,
      };
    }
  }
  const s = pick(input.strolls, 'stroll');
  if (!s) return atDesk;
  return {
    kind: 'near',
    key: `stroll:${s.key}:${slot}`,
    point: s.position,
    lookAt: s.lookAt,
    pose: 'stand_idle',
    label: s.label,
    activity: `${first} está circulando (ocioso)`,
    minR: 0,
    maxR: 1.8,
  };
}
