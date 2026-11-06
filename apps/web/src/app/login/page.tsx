import { redirect } from 'next/navigation';
import { ThemeToggle } from '@/components/ThemeToggle';
import { isSupabaseConfigured } from '@/lib/env';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  // Sem Supabase não há autenticação (modo local).
  if (!isSupabaseConfigured()) redirect('/');
  return (
    <main className="app-backdrop relative flex min-h-dvh items-center justify-center p-4">
      <div className="glass absolute right-4 top-4 rounded-xl p-1">
        <ThemeToggle />
      </div>
      <LoginForm />
    </main>
  );
}
