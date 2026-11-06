import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isSupabaseConfigured } from '@/lib/env';
import { getViewer } from '@/server/auth';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/admin', label: 'Visão geral' },
  { href: '/admin/events', label: 'Eventos' },
];

/** Planejado para as próximas fases (exibido desabilitado, sem dados falsos). */
const UPCOMING = ['Tarefas (Fase 2)', 'Orquestrador (Fase 3)', 'CRM e propostas (Fase 4)', 'Projetos (Fase 5)', 'Financeiro'];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (!viewer.companyId) redirect('/onboarding');

  return (
    <div className="min-h-dvh bg-slate-100 md:flex">
      <aside className="border-b border-slate-200 bg-white p-4 md:min-h-dvh md:w-60 md:border-b-0 md:border-r">
        <Link href="/" className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-black text-white">AI</span>
          <span className="font-bold">Agency OS</span>
        </Link>
        <nav className="flex gap-1 md:flex-col" aria-label="Painel administrativo">
          <Link href="/" className="rounded-lg px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50">
            ← Escritório 3D
          </Link>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-lg px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-6 hidden md:block">
          <div className="mb-1 px-3 text-[11px] font-semibold uppercase text-slate-400">Em breve</div>
          {UPCOMING.map((u) => (
            <div key={u} className="px-3 py-1 text-sm text-slate-400">
              {u}
            </div>
          ))}
        </div>
        {isSupabaseConfigured() && (
          <form action="/auth/signout" method="post" className="mt-6">
            <button className="px-3 text-sm text-slate-500 hover:text-slate-800">Sair</button>
          </form>
        )}
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
