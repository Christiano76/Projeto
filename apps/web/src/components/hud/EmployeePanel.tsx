'use client';

import { STATUS_COLORS, STATUS_LABELS, describeEvent, type AgentEvent } from '@agency/core';
import { useEffect, useState } from 'react';
import { EventConsole } from '@/components/EventConsole';
import { formatRelative, formatTime } from '@/lib/format';
import { useOfficeStore } from '@/store/officeStore';

/** Ficha do funcionário selecionado: identidade, estado real, histórico. */
export function EmployeePanel({ isDirector }: { isDirector: boolean }) {
  const selectedId = useOfficeStore((s) => s.selectedEmployeeId);
  const employee = useOfficeStore((s) => (s.selectedEmployeeId ? s.employees[s.selectedEmployeeId] : undefined));
  const departments = useOfficeStore((s) => s.snapshot?.departments ?? []);
  const employees = useOfficeStore((s) => s.employees);
  const feed = useOfficeStore((s) => s.events);
  const select = useOfficeStore((s) => s.select);
  const applyUpdate = useOfficeStore((s) => s.applyUpdate);
  const [history, setHistory] = useState<AgentEvent[]>([]);
  const [showConsole, setShowConsole] = useState(false);

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
      className="glass absolute right-3 top-20 z-30 flex max-h-[calc(100dvh-14rem)] w-80 flex-col overflow-hidden rounded-2xl max-sm:inset-x-3 max-sm:top-auto max-sm:bottom-3 max-sm:max-h-[60dvh] max-sm:w-auto"
      aria-label={`Ficha de ${employee.name}`}
    >
      <div className="flex items-start gap-3 border-b border-slate-200 p-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white"
          style={{ background: employee.avatar.shirt }}
        >
          {employee.name
            .split(' ')
            .map((p) => p[0])
            .slice(0, 2)
            .join('')}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold">{employee.name}</div>
          <div className="truncate text-xs text-slate-500">
            {employee.role} · <span style={{ color: dept?.color }}>{dept?.name ?? employee.departmentKey}</span>
          </div>
          <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-slate-900/5 px-2 py-0.5 text-xs font-semibold">
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLORS[rt.status] }} />
            {STATUS_LABELS[rt.status]} <span className="font-normal text-slate-500">· {formatRelative(rt.statusSince)}</span>
          </div>
        </div>
        <button onClick={() => select(null)} className="rounded-lg px-2 text-lg leading-none text-slate-400 hover:text-slate-700" aria-label="Fechar">
          ×
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {rt.currentTask && (
          <Info title="Tarefa atual">
            <div className="font-medium">{rt.currentTask.title}</div>
            <div className="text-xs text-slate-500">ID {rt.currentTask.id}</div>
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
          <div className="text-xs text-slate-500">Agente ainda não ativado (Fase 2).</div>
        </Info>

        <Info title="Histórico">
          {merged.length === 0 ? (
            <div className="text-xs text-slate-500">Sem eventos registrados.</div>
          ) : (
            <ul className="space-y-1">
              {merged.map((ev) => (
                <li key={ev.id} className="flex gap-2 text-xs">
                  <span className="shrink-0 text-slate-400">{formatTime(ev.createdAt)}</span>
                  <span className="text-slate-700">
                    {describeEvent(ev)}
                    {ev.type === 'message.sent' && (
                      <span className="text-slate-500"> → {employees[(ev.payload as { toEmployeeId: string }).toEmployeeId]?.name ?? '?'}</span>
                    )}
                    {ev.source === 'manual' && <span className="ml-1 rounded bg-slate-200 px-1 text-slate-600">manual</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Info>

        {isDirector && (
          <div className="rounded-xl border border-dashed border-slate-300 p-2">
            <button className="w-full text-left text-xs font-semibold text-slate-600" onClick={() => setShowConsole((v) => !v)} aria-expanded={showConsole}>
              {showConsole ? '▾' : '▸'} Console de eventos (teste manual)
            </button>
            {showConsole && (
              <div className="mt-2">
                <p className="mb-2 text-[11px] text-slate-500">
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
      <h3 className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <div className="text-slate-800">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-slate-900/5 py-1.5">
      <div className="text-base font-bold">{value}</div>
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
    </div>
  );
}
