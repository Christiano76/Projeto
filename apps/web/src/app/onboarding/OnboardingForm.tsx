'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/company/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? 'Não foi possível criar a empresa.');
      return;
    }
    router.replace('/');
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="glass anim-panel-in w-full max-w-md space-y-4 rounded-2xl p-6">
      <h1 className="text-lg font-bold">Crie sua agência</h1>
      <p className="text-sm text-muted">
        Você será o diretor. Criaremos o escritório com 9 ambientes e a equipe inicial (gerente, prospector, comercial,
        desenvolvimento e financeiro). Os agentes de IA começam desligados até você configurá-los.
      </p>
      <input
        className="input py-2"
        placeholder="Nome da agência"
        minLength={2}
        maxLength={120}
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <button disabled={busy} className="btn btn-primary w-full py-2 text-sm">
        {busy ? 'Criando…' : 'Criar empresa'}
      </button>
    </form>
  );
}
