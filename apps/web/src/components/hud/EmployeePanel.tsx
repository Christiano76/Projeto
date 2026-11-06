'use client';

import { STATUS_COLORS, STATUS_LABELS, describeEvent, type AgentEvent } from '@agency/core';
import { useAgentInfo } from '@/lib/simulationHost';
import { useCameraStore } from '@/store/cameraStore';
import { Icon } from './Icons';
import { SupervisionSection } from './SupervisionSection';
import { useEffect, useState } from 'react';
import { EventConsole } from '@/components/EventConsole';
import { formatRelative, formatTime } from '@/lib/format';
import { usePresence } from '@/lib/usePresence';
import { useOfficeStore } from '@/store/officeStore';

/** Ficha do funcionário selecionado: identidade, estado real, histórico. */
export function EmployeePanel({ isDirector }: { isDirector: boolean }) {
  const selectedId = useOfficeStore((s) => s.selectedEmployeeId);
  const current = useOfficeStore((s) => (s.selectedEmployeeId ? s.employees[s.selectedEmployeeId] : undefined));
  // Mantém a ficha montada durante a animação de saída.
  const { item: employee, state: presence } = usePresence(current, 220);
  const departments = useOfficeStore((s) => s.snapshot?.departments ?? []);
  const employees = useOfficeStore((s) => s.employees);
  const feed = useOfficeStore((s) => s.events);
  const select = useOfficeStore((s) => s.select);
  const applyUpdate = useOfficeStore((s) => s.applyUpdate);
  const [history, setHistory] = useState<AgentEvent[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const agent = useAgentInfo(employee?.id ?? null);
  const follow = useCameraStore((s) => s.follow);
  const setFollow = useCameraStore((s) => s.setFollow);

  // Histórico completo do funcionário (servidor) + eventos ao vivo do feed.
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    fetch(`/api/events?employeeId=${encodeURIComponent(selectedId)}&limit=30`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((b: { events: AgentEvent[] }) => !cancelled && setHistory(b.events))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  if (!employee) return null;
  const dept = departments.find((d) => d.key === employee.departmentKey);
  const rt = employee.runtime;
  const merged = [...feed.filter((e) => e.employeeId === employee.id), ...history]
    .filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30);

  return (
    <aside
      key={employee.id}
      className={`glass ${presence === 'in' ? 'anim-panel-in' : 'anim-panel-out pointer-events-none'} absolute right-3 top-20 z-30 flex max-h-[calc(100dvh-14rem)] w-80 flex-col overflow-hidden rounded-2xl max-sm:inset-x-3 max-sm:top-auto max-sm:bottom-16 max-sm:max-h-[55dvh] max-sm:w-auto`}
      aria-label={`Ficha de ${employee.name}`}
    >
      <div className="flex items-start gap-3 border-b border-line p-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white"
          style={{
            background: employee.avatar.shirt,
            boxShadow: `0 0 0 1px rgb(255 255 255 / 0.15), 0 0 0 3px ${STATUS_COLORS[employee.runtime.status]}55, 0 8px 20px -10px ${STATUS_COLORS[employee.runtime.status]}`,
          }}
        >
          {employee.name
            .split(' ')
            .map((p) => p[0])
            .slice(0, 2)
            .join('')}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold">{employee.name}</div>
          <div className="truncate text-xs text-muted">
            {employee.role} · <span style={{ color: dept?.color }}>{dept?.name ?? employee.departmentKey}</span>
          </div>
          <div key={rt.status} className="anim-pop mt-1 inline-flex items-center gap-1.5 rounded-full bg-fg/5 px-2 py-0.5 text-xs font-semibold" role="status">
            <span className="status-dot h-2 w-2" data-live={rt.status === 'working' || rt.status === 'meeting'} style={{ background: STATUS_COLORS[rt.status] }} />
            {STATUS_LABELS[rt.status]} <span className="font-normal text-muted">· {formatRelative(rt.statusSince)}</span>
          </div>
        </div>
        <button onClick={() => select(null)} className="btn btn-ghost h-7 w-7 text-lg leading-none" aria-label="Fechar">
          ×
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        <Info title="Agora">
          <div className="font-medium" data-testid="agent-activity">
            {agent?.activity ?? STATUS_LABELS[rt.status]}
          </div>
          {agent && (agent.phase === 'walking' || agent.phase === 'standing_up' || agent.phase === 'entering') && agent.destination && (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-accent" data-testid="agent-destination">
              <span className="status-dot h-1.5 w-1.5" data-live="true" style={{ background: 'var(--accent)' }} />
              Caminhando até {agent.destination}
              {agent.waitReason && <span className="text-muted"> · {agent.waitReason}</span>}
            </div>
          )}
          {agent && agent.phase !== 'walking' && agent.destination && agent.phase !== 'hidden' && (
            <div className="mt-0.5 text-xs text-muted">Local: {agent.destination}</div>
          )}
          <div className="mt-0.5 text-xs text-muted">
            Última atividade: {merged[0] ? `${describeEvent(merged[0])} · ${formatRelative(merged[0].createdAt)}` : agent?.history[0]?.label ?? '—'}
          </div>
          <button
            type="button"
            className="btn btn-ghost dock-btn mt-2 h-8 w-full gap-1.5 text-xs"
            aria-pressed={follow}
            onClick={() => setFollow(!follow)}
            data-testid="follow-toggle"
          >
            <Icon name="follow" className="h-3.5 w-3.5" />
            {follow ? 'Acompanhando com a câmera' : 'Acompanhar com a câmera'}
          </button>
        </Info>

        {employee.isManager && <SupervisionSection manager={employee} feed={feed} history={history} />}

        {rt.currentTask && (
          <Info title="Tarefa atual">
            <div className="font-medium">{rt.currentTask.title}</div>
            <div className="text-xs text-muted">ID {rt.currentTask.id}</div>
          </Info>
        )}
        {rt.meeting && <Info title="Reunião">{rt.meeting.topic}</Info>}
        {rt.blockedReason && <Info title="Bloqueio">{rt.blockedReason}</Info>}
        {rt.status === 'error' && rt.lastError && <Info title="Último erro">{rt.lastError}</Info>}

        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Concluídas" value={rt.tasksCompleted} />
          <Stat label="Falhas" value={rt.tasksFailed} />
          <Stat
            label="Sucesso"
            value={rt.tasksCompleted + rt.tasksFailed === 0 ? '—' : `${Math.round((rt.tasksCompleted / (rt.tasksCompleted + rt.tasksFailed)) * 100)}%`}
          />
        </div>

        <Info title="Personalidade profissional">{employee.personality}</Info>
        <Info title="Objetivos">
          <ul className="list-disc space-y-0.5 pl-4">
            {employee.objectives.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </Info>
        <Info title="Modelo de IA">
          <span className="font-mono text-xs">
            {employee.model.provider} / {employee.model.model || '—'}
          </span>
          <div className="text-xs text-muted">Agente ainda não ativado (Fase 2).</div>
        </Info>

        <Info title="Histórico">
          {merged.length === 0 ? (
            <div className="text-xs text-muted">Sem eventos registrados.</div>
          ) : (
            <ul className="space-y-1">
              {merged.map((ev) => (
                <li key={ev.id} className="flex gap-2 text-xs">
                  <span className="shrink-0 text-subtle">{formatTime(ev.createdAt)}</span>
                  <span className="text-fg">
                    {describeEvent(ev)}
                    {ev.type === 'message.sent' && (
                      <span className="text-muted"> → {employees[(ev.payload as { toEmployeeId: string }).toEmployeeId]?.name ?? '?'}</span>
                    )}
                    {ev.source === 'manual' && <span className="ml-1 rounded bg-surface-3 px-1 text-muted">manual</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Info>

        <Info title="Movimentação recente">
          {!agent || agent.history.length === 0 ? (
            <div className="text-xs text-muted">Sem deslocamentos registrados.</div>
          ) : (
            <ul className="space-y-0.5" data-testid="movement-history">
              {agent.history.slice(0, 8).map((h, i) => (
                <li key={`${h.at}-${i}`} className="flex gap-2 text-xs">
                  <span className="shrink-0 font-mono text-subtle">{formatTime(new Date(h.at).toISOString())}</span>
                  <span className="text-fg">{h.label}</span>
                </li>
              ))}
            </ul>
          )}
          {agent && <div className="mt-1 text-[11px] text-subtle">Distância percorrida: {agent.distance.toFixed(0)} m</div>}
        </Info>

        {isDirector && (
          <div className="rounded-xl border border-dashed border-line-strong p-2">
            <button className="focus-ring w-full rounded text-left text-xs font-semibold text-muted hover:text-fg" onClick={() => setShowConsole((v) => !v)} aria-expanded={showConsole}>
              {showConsole ? '▾' : '▸'} Console de eventos (teste manual)
            </button>
            {showConsole && (
              <div className="anim-panel-in mt-2">
                <p className="mb-2 text-[11px] text-muted">
                  Registra eventos com origem “manual” para validar o sistema de estados antes dos agentes de IA. Transições inválidas são recusadas.
                </p>
                <EventConsole compact employees={Object.values(employees)} defaultEmployeeId={employee.id} onApplied={applyUpdate} />
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function Info({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">{title}</h3>
      <div className="text-fg">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-fg/5 py-1.5">
      <div key={String(value)} className="anim-pop text-base font-bold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase text-muted">{label}</div>
    </div>
  );
}
