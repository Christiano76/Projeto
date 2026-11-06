'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/browser';

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const supabase = getBrowserSupabase();
    const { data, error } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) {
      setMessage({ ok: false, text: error.message });
      return;
    }
    if (mode === 'signup' && !data.session) {
      setMessage({ ok: true, text: 'Conta criada. Confirme o e-mail para entrar.' });
      return;
    }
    router.replace('/');
    router.refresh();
  };

  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none';
  return (
    <form onSubmit={submit} className="glass w-full max-w-sm space-y-4 rounded-2xl p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 font-black text-white">AI</div>
        <div>
          <h1 className="text-lg font-bold">AI Agency OS</h1>
          <p className="text-xs text-slate-500">{mode === 'signin' ? 'Entre para acessar sua empresa' : 'Crie a conta do diretor'}</p>
        </div>
      </div>
      <label className="block text-sm">
        <span className="text-xs font-medium text-slate-600">E-mail</span>
        <input className={input} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="block text-sm">
        <span className="text-xs font-medium text-slate-600">Senha</span>
        <input
          className={input}
          type="password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {message && <p className={`text-sm ${message.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{message.text}</p>}
      <button disabled={busy} className="w-full rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
        {busy ? 'Aguarde…' : mode === 'signin' ? 'Entrar' : 'Criar conta'}
      </button>
      <button type="button" className="w-full text-xs text-brand-700 hover:underline" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
        {mode === 'signin' ? 'Não tem conta? Cadastre-se' : 'Já tem conta? Entrar'}
      </button>
    </form>
  );
}
