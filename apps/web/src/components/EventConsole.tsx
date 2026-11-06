'use client';

import { EVENT_LABELS, type AgentEventType, type Employee, type LiveUpdate } from '@agency/core';
import { useMemo, useState } from 'react';

type Field = 'taskId' | 'title' | 'note' | 'summary' | 'error' | 'reason' | 'meetingId' | 'topic' | 'toEmployeeId' | 'subject';

const FIELDS: Record<AgentEventType, Field[]> = {
  'employee.online': [],
  'employee.offline': [],
  'task.started': ['taskId', 'title'],
  'task.progress': ['taskId', 'note'],
  'task.completed': ['taskId', 'summary'],
  'task.failed': ['taskId', 'error'],
  'task.blocked': ['taskId', 'reason'],
  'task.unblocked': ['taskId'],
  'meeting.joined': ['meetingId', 'topic'],
  'meeting.left': ['meetingId'],
  'break.started': [],
  'break.ended': [],
  'message.sent': ['toEmployeeId', 'subject'],
};

const FIELD_LABELS: Record<Field, string> = {
  taskId: 'ID da tarefa',
  title: 'Título da tarefa',
  note: 'Nota de progresso',
  summary: 'Resumo (opcional)',
  error: 'Erro',
  reason: 'Motivo do bloqueio',
  meetingId: 'ID da reunião',
  topic: 'Pauta',
  toEmployeeId: 'Destinatário',
  subject: 'Assunto',
};

/**
 * Console de eventos MANUAIS do diretor. Serve para validar o sistema de
 * estados antes dos agentes de IA (Fase 2). Os eventos são registrados com
 * origem "manual" e passam pela mesma validação que os eventos dos agentes.
 */
export function EventConsole({
  employees,
  defaultEmployeeId,
  onApplied,
  compact = false,
}: {
  employees: Employee[];
  defaultEmployeeId?: string;
  onApplied?: (u: LiveUpdate) => void;
  compact?: boolean;
}) {
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId ?? employees[0]?.id ?? '');
  const [type, setType] = useState<AgentEventType>('task.started');
  const [values, setValues] = useState<Partial<Record<Field, string>>>({});
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveEmployeeId = defaultEmployeeId ?? employeeId;
  const employee = employees.find((e) => e.id === effectiveEmployeeId);
  const fields = FIELDS[type];

  // Sugestões coerentes com o estado atual (ex.: ID da tarefa em andamento).
  const placeholder = useMemo(() => {
    const p: Partial<Record<Field, string>> = {
      taskId: employee?.runtime.currentTask?.id ?? `tarefa-${Math.floor(Date.now() / 1000) % 100000}`,
      title: 'Ex.: Criar landing page do cliente',
      meetingId: employee?.runtime.meeting?.id ?? 'reuniao-planejamento',
      topic: 'Ex.: Planejamento semanal',
    };
    return p;
  }, [employee]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const payload: Record<string, string> = {};
    for (const f of fields) {
      const v = (values[f] ?? '').trim() || (f === 'taskId' || f === 'meetingId' ? (placeholder[f] ?? '') : '');
      if (v) payload[f] = v;
    }
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: effectiveEmployeeId, type, payload }),
      });
      const body = await res.json();
      if (res.status === 201) {
        setResult({ ok: true, text: 'Evento aplicado.' });
        onApplied?.({ event: body.event, employee: body.employee });
        setValues({});
      } else {
        setResult({ ok: false, text: body.reason ?? body.error ?? `Erro ${res.status}` });
      }
    } catch {
      setResult({ ok: false, text: 'Falha de rede.' });
    } finally {
      setBusy(false);
    }
  };

  const input = 'input';

  return (
    <form onSubmit={submit} className="space-y-2 text-sm">
      {!defaultEmployeeId && (
        <label className="block">
          <span className="text-xs font-medium text-muted">Funcionário</span>
          <select className={input} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} — {e.role}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className="text-xs font-medium text-muted">Evento</span>
        <select className={input} value={type} onChange={(e) => setType(e.target.value as AgentEventType)}>
          {(Object.keys(FIELDS) as AgentEventType[]).map((t) => (
            <option key={t} value={t}>
              {EVENT_LABELS[t]} ({t})
            </option>
          ))}
        </select>
      </label>
      <div className={compact ? 'space-y-2' : 'grid gap-2 sm:grid-cols-2'}>
        {fields.map((f) => (
          <label key={f} className="block">
            <span className="text-xs font-medium text-muted">{FIELD_LABELS[f]}</span>
            {f === 'toEmployeeId' ? (
              <select className={input} value={values[f] ?? ''} onChange={(e) => setValues({ ...values, [f]: e.target.value })}>
                <option value="">Selecione…</option>
                {employees
                  .filter((e) => e.id !== effectiveEmployeeId)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
              </select>
            ) : (
              <input
                className={input}
                value={values[f] ?? ''}
                placeholder={placeholder[f] ?? ''}
                onChange={(e) => setValues({ ...values, [f]: e.target.value })}
              />
            )}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || !effectiveEmployeeId}
          className="btn btn-primary px-3 py-1.5 text-sm"
        >
          {busy ? 'Enviando…' : 'Registrar evento'}
        </button>
        {result && (
          <span role="status" key={result.text + String(result.ok)} className={`anim-item-in text-xs ${result.ok ? 'text-success' : 'text-danger'}`}>
            {result.text}
          </span>
        )}
      </div>
    </form>
  );
}
