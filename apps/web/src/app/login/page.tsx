import { redirect } from 'next/navigation';
import { isSupabaseConfigured } from '@/lib/env';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  // Sem Supabase não há autenticação (modo local).
  if (!isSupabaseConfigured()) redirect('/');
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-brand-50 to-slate-200 p-4">
      <LoginForm />
    </main>
  );
}
