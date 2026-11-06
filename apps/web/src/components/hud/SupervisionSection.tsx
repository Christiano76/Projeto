'use client';

import {
  FINDING_LABELS,
  SUPERVISION_REASON_LABELS,
  STATUS_LABELS,
  type AgentEvent,
  type Employee,
  type InspectionFinding,
} from '@agency/core';
import { useEffect, useState } from 'react';
import { formatRelative, formatTime } from '@/lib/format';
import { useAgentInfo } from '@/lib/simulationHost';
import { useOfficeStore } from '@/store/officeStore';

type Inspected = Extract<AgentEvent, { type: 'supervision.inspected' }>;

/**
 * Painel de supervisão do gerente. Tudo aqui vem de registros do servidor
 * (eventos `supervision.*`), que consultaram o estado real de cada funcionário.
 */
export function SupervisionSection({ manager, feed, history }: { manager: Employee; feed: AgentEvent[]; history: AgentEvent[] }) {
  const employees = useOfficeStore((s) => s.employees);
  const agent = useAgentInfo(manager.id);
  const [more, setMore] = useState<AgentEvent[]>([]);
  const name = (id: string) => employees[id]?.name ?? 'Funcionário';

  // Histórico de supervisão mais longo (além dos 30 eventos da ficha).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/events?employeeId=${encodeURIComponent(manager.id)}&limit=150`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((b: { events: AgentEvent[] }) => !cancelled && setMore(b.events))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [manager.id, manager.runtime.inspectionsDone]);

  const events = [...feed, ...history, ...more]
    .filter((e) => e.employeeId === manager.id && e.type.startsWith('supervision.'))
    .filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const inspections = events.filter((e): e is Inspected => e.type === 'supervision.inspected');

  // Último resultado por funcionário inspecionado
  const latestByEmployee = new Map<string, Inspected>();
  for (const ins of inspections) if (!latestByEmployee.has(ins.payload.targetEmployeeId)) latestByEmployee.set(ins.payload.targetEmployeeId, ins);
  const problems = [...latestByEmployee.values()].filter((i) => !i.payload.findings.includes('ok'));

  const visit = manager.runtime.supervision;
  const status = (() => {
    if (manager.runtime.status !== 'idle') return `Supervisão pausada — ${STATUS_LABELS[manager.runtime.status].toLowerCase()}`;
    if (visit) {
      const arrived = agent?.phase === 'standing' && agent.engagedWith === visit.targetEmployeeId;
      return arrived ? `Inspecionando ${name(visit.targetEmployeeId)}` : `A caminho de ${name(visit.targetEmployeeId)}`;
    }
    return agent?.phase === 'walking' ? 'Circulando pelo escritório' : 'Na sala do gerente';
  })();

  return (
    <section className="rounded-xl border border-line p-2.5" data-testid="supervision-section" aria-label="Supervisão">
      <h3 className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-subtle">
        Supervisão
        <span className="font-mono normal-case tracking-normal text-muted">{manager.runtime.inspectionsDone ?? 0} inspeções</span>
      </h3>
      <div className="flex items-center gap-1.5 text-sm font-medium" data-testid="supervision-status">
        <span className="status-dot h-2 w-2" data-live={!!visit} style={{ background: visit ? 'var(--accent-2)' : 'var(--fg-subtle)' }} />
        {status}
      </div>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="text-muted">Inspeção atual</dt>
        <dd className="text-fg">
          {visit ? `${name(visit.targetEmployeeId)} — ${SUPERVISION_REASON_LABELS[visit.reason]} (${formatRelative(visit.startedAt)})` : '—'}
        </dd>
        <dt className="text-muted">Próximo destino</dt>
        <dd className="text-fg">{agent?.destination ?? '—'}</dd>
        <dt className="text-muted">Inspecionados</dt>
        <dd className="text-fg">
          {latestByEmployee.size === 0 ? '—' : [...latestByEmployee.keys()].map((id) => name(id).split(' ')[0]).join(', ')}
        </dd>
      </dl>

      <div className="mt-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Problemas identificados</div>
        {problems.length === 0 ? (
          <div className="text-xs text-muted">Nenhum problema nas últimas inspeções.</div>
        ) : (
          <ul className="mt-0.5 space-y-0.5" data-testid="supervision-problems">
            {problems.map((p) => (
              <li key={p.id} className="text-xs">
                <span className="font-semibold text-danger">{name(p.payload.targetEmployeeId)}</span>
                <span className="text-fg"> — {p.payload.findings.map((f: InspectionFinding) => FINDING_LABELS[f]).join(', ')}</span>
                <span className="text-subtle"> · {formatRelative(p.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Histórico de supervisão</div>
        {events.length === 0 ? (
          <div className="text-xs text-muted">Nenhuma ronda registrada ainda.</div>
        ) : (
          <ul className="mt-0.5 max-h-36 space-y-0.5 overflow-y-auto scrollbar-thin" data-testid="supervision-history">
            {events.slice(0, 20).map((e) => (
              <li key={e.id} className="flex gap-2 text-xs">
                <span className="shrink-0 font-mono text-subtle">{formatTime(e.createdAt)}</span>
                <span className="text-fg">{describeSupervision(e, name)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function describeSupervision(e: AgentEvent, name: (id: string) => string): string {
  switch (e.type) {
    case 'supervision.visit_started':
      return `Foi até ${name(e.payload.targetEmployeeId)} (${SUPERVISION_REASON_LABELS[e.payload.reason].toLowerCase()})`;
    case 'supervision.visit_ended':
      return `Visita a ${name(e.payload.targetEmployeeId)} encerrada (${e.payload.reason === 'timeout' ? 'tempo esgotado' : 'funcionário indisponível'})`;
    case 'supervision.inspected': {
      const p = e.payload;
      const what = p.taskTitle ? ` — tarefa "${p.taskTitle}"` : '';
      const status = STATUS_LABELS[p.observedStatus as keyof typeof STATUS_LABELS] ?? p.observedStatus;
      const findings = p.findings.map((f) => FINDING_LABELS[f]).join(', ');
      return `Inspecionou ${name(p.targetEmployeeId)}: ${status.toLowerCase()}${what} · ${findings}`;
    }
    default:
      return e.type;
  }
}
