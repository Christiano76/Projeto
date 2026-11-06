'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
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

  const input = 'input py-2';
  return (
    <form onSubmit={submit} className="glass anim-panel-in w-full max-w-sm space-y-4 rounded-2xl p-6">
      <div className="flex items-center gap-3">
        <BrandMark size={40} />
        <div>
          <h1 className="text-lg font-bold">AI Agency OS</h1>
          <p className="text-xs text-muted">{mode === 'signin' ? 'Entre para acessar sua empresa' : 'Crie a conta do diretor'}</p>
        </div>
      </div>
      <label className="block text-sm">
        <span className="text-xs font-medium text-muted">E-mail</span>
        <input className={input} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="block text-sm">
        <span className="text-xs font-medium text-muted">Senha</span>
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
      {message && <p role="status" className={`anim-item-in text-sm ${message.ok ? 'text-success' : 'text-danger'}`}>{message.text}</p>}
      <button disabled={busy} className="btn btn-primary w-full py-2 text-sm">
        {busy ? 'Aguarde…' : mode === 'signin' ? 'Entrar' : 'Criar conta'}
      </button>
      <button type="button" className="focus-ring w-full rounded text-xs text-accent hover:underline" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
        {mode === 'signin' ? 'Não tem conta? Cadastre-se' : 'Já tem conta? Entrar'}
      </button>
    </form>
  );
}
