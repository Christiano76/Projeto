import { describeEvent } from '@agency/core';
import { redirect } from 'next/navigation';
import { formatDateTime } from '@/lib/format';
import { getViewer } from '@/server/auth';
import { getRepository } from '@/server/repository';
import { ManualConsole } from './ManualConsole';

export const dynamic = 'force-dynamic';

export default async function EventsPage() {
  const viewer = await getViewer();
  if (!viewer?.companyId) redirect('/');
  const repo = getRepository();
  const snapshot = await repo.getOfficeSnapshot(viewer.companyId);
  if (!snapshot) redirect('/onboarding');
  const events = await repo.listEvents(viewer.companyId, { limit: 200 });
  const names = new Map(snapshot.employees.map((e) => [e.id, e.name]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Eventos dos agentes</h1>
        <p className="text-sm text-muted">
          Registro imutável (append-only) de tudo que altera o estado dos funcionários. O escritório 3D é a projeção visual destes eventos.
        </p>
      </header>

      {viewer.role === 'director' && (
        <section className="card anim-panel-in p-4">
          <h2 className="text-sm font-bold text-fg">Console de eventos (teste manual)</h2>
          <p className="mb-3 text-xs text-muted">
            Até a ativação dos agentes (Fase 2), use este console para validar o sistema de estados. Os eventos ficam marcados como
            “manual” e passam pelas mesmas regras de transição.
          </p>
          <ManualConsole employees={snapshot.employees} />
        </section>
      )}

      <section className="card anim-panel-in overflow-x-auto p-4">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-muted">
            <tr>
              <th className="py-2 pr-4">Quando</th>
              <th className="py-2 pr-4">Funcionário</th>
              <th className="py-2 pr-4">Tipo</th>
              <th className="py-2 pr-4">Descrição</th>
              <th className="py-2 pr-4">Origem</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-muted">
                  Nenhum evento registrado.
                </td>
              </tr>
            )}
            {events.map((ev) => (
              <tr key={ev.id} className="border-t border-line transition-colors hover:bg-accent-soft">
                <td className="py-1.5 pr-4 whitespace-nowrap text-muted">{formatDateTime(ev.createdAt)}</td>
                <td className="py-1.5 pr-4">{names.get(ev.employeeId) ?? ev.employeeId}</td>
                <td className="py-1.5 pr-4 font-mono text-xs">{ev.type}</td>
                <td className="py-1.5 pr-4">{describeEvent(ev)}</td>
                <td className="py-1.5 pr-4 text-xs">{ev.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
