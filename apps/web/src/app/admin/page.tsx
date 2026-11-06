import { EMPLOYEE_STATUSES, STATUS_COLORS, STATUS_LABELS, describeEvent } from '@agency/core';
import { redirect } from 'next/navigation';
import { formatDateTime } from '@/lib/format';
import { getViewer } from '@/server/auth';
import { getRepository } from '@/server/repository';

export const dynamic = 'force-dynamic';

export default async function AdminOverview() {
  const viewer = await getViewer();
  if (!viewer?.companyId) redirect('/');
  const repo = getRepository();
  const snapshot = await repo.getOfficeSnapshot(viewer.companyId);
  if (!snapshot) redirect('/onboarding');
  const events = await repo.listEvents(viewer.companyId, { limit: 500 });

  const employees = snapshot.employees;
  const byStatus = Object.fromEntries(EMPLOYEE_STATUSES.map((s) => [s, employees.filter((e) => e.runtime.status === s).length]));
  const active = employees.filter((e) => e.runtime.status !== 'offline').length;
  const running = employees.filter((e) => e.runtime.currentTask).length;
  const completed = employees.reduce((n, e) => n + e.runtime.tasksCompleted, 0);
  const failed = employees.reduce((n, e) => n + e.runtime.tasksFailed, 0);
  const maxCompleted = Math.max(1, ...employees.map((e) => e.runtime.tasksCompleted));
  const deptName = new Map(snapshot.departments.map((d) => [d.key, d]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{snapshot.company.name}</h1>
        <p className="text-sm text-slate-500">
          Visão geral em tempo real · {snapshot.mode === 'memory' ? 'modo local (dados em memória)' : 'Supabase'}
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Funcionários ativos" value={`${active}/${employees.length}`} />
        <Kpi label="Tarefas em execução" value={running} />
        <Kpi label="Tarefas concluídas" value={completed} />
        <Kpi label="Falhas" value={failed} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="Status da equipe">
          <div className="space-y-2">
            {EMPLOYEE_STATUSES.map((s) => (
              <div key={s} className="flex items-center gap-3 text-sm">
                <span className="w-36 text-slate-600">{STATUS_LABELS[s]}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full" style={{ width: `${(byStatus[s]! / Math.max(1, employees.length)) * 100}%`, background: STATUS_COLORS[s] }} />
                </div>
                <span className="w-6 text-right font-semibold tabular-nums">{byStatus[s]}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Produtividade (tarefas concluídas)">
          <div className="space-y-2">
            {employees.map((e) => (
              <div key={e.id} className="flex items-center gap-3 text-sm">
                <span className="w-36 truncate text-slate-600">{e.name}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${(e.runtime.tasksCompleted / maxCompleted) * 100}%` }} />
                </div>
                <span className="w-6 text-right font-semibold tabular-nums">{e.runtime.tasksCompleted}</span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <Card title="Funcionários">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-4">Nome</th>
                <th className="py-2 pr-4">Cargo</th>
                <th className="py-2 pr-4">Departamento</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Tarefa atual</th>
                <th className="py-2 pr-4">Modelo</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="py-2 pr-4 font-medium">{e.name}</td>
                  <td className="py-2 pr-4">{e.role}</td>
                  <td className="py-2 pr-4" style={{ color: deptName.get(e.departmentKey)?.color }}>
                    {deptName.get(e.departmentKey)?.name ?? e.departmentKey}
                  </td>
                  <td className="py-2 pr-4">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLORS[e.runtime.status] }} />
                      {STATUS_LABELS[e.runtime.status]}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-slate-600">{e.runtime.currentTask?.title ?? '—'}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-500">{e.model.model}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`Eventos recentes (${events.length})`}>
        {events.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum evento registrado.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {events.slice(0, 15).map((ev) => (
              <li key={ev.id} className="flex flex-wrap gap-x-3 py-1.5">
                <span className="text-slate-400">{formatDateTime(ev.createdAt)}</span>
                <span className="font-medium">{employees.find((e) => e.id === ev.employeeId)?.name}</span>
                <span className="text-slate-600">{describeEvent(ev)}</span>
                <span className="text-xs text-slate-400">[{ev.source}]</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-xs text-slate-500">
        Oportunidades, propostas, clientes, contratos, projetos, faturamento, despesas e custos de IA serão exibidos aqui a partir
        das Fases 2–5, quando houver dados reais nessas tabelas.
      </p>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-bold text-slate-700">{title}</h2>
      {children}
    </section>
  );
}
