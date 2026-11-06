import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BrandMark } from '@/components/BrandMark';
import { isSupabaseConfigured } from '@/lib/env';
import { getViewer } from '@/server/auth';
import { AdminNav } from './AdminNav';

export const dynamic = 'force-dynamic';

/** Planejado para as próximas fases (exibido desabilitado, sem dados falsos). */
const UPCOMING = ['Tarefas (Fase 2)', 'Orquestrador (Fase 3)', 'CRM e propostas (Fase 4)', 'Projetos (Fase 5)', 'Financeiro'];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (!viewer.companyId) redirect('/onboarding');

  return (
    <div className="app-backdrop min-h-dvh md:flex">
      <aside className="glass anim-panel-in border-b border-line p-4 md:sticky md:top-0 md:h-dvh md:w-60 md:rounded-none md:border-b-0 md:border-r">
        <div className="mb-4 flex items-center justify-between">
          <Link href="/" className="focus-ring flex items-center gap-2 rounded-lg">
            <BrandMark />
            <span className="font-bold tracking-tight">Agency OS</span>
          </Link>
          <ThemeToggle />
        </div>
        <AdminNav />
        <div className="mt-6 hidden md:block">
          <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">Em breve</div>
          {UPCOMING.map((u) => (
            <div key={u} className="px-3 py-1 text-sm text-subtle">
              {u}
            </div>
          ))}
        </div>
        {isSupabaseConfigured() && (
          <form action="/auth/signout" method="post" className="mt-6">
            <button className="btn btn-ghost px-3 py-1 text-sm">Sair</button>
          </form>
        )}
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
