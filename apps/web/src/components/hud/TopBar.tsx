'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useOfficeStore } from '@/store/officeStore';

const CONNECTION = {
  connecting: { label: 'Conectando…', color: '#f59e0b', live: true },
  live: { label: 'Ao vivo', color: '#22d3a5', live: true },
  reconnecting: { label: 'Reconectando…', color: '#f59e0b', live: true },
  offline: { label: 'Desconectado', color: '#f43f5e', live: false },
} as const;

export function TopBar() {
  const company = useOfficeStore((s) => s.snapshot?.company.name);
  const mode = useOfficeStore((s) => s.snapshot?.mode);
  const connection = useOfficeStore((s) => s.connection);
  const [clock, setClock] = useState('');

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  const conn = CONNECTION[connection];

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-2 p-3">
      <div className="glass anim-panel-in pointer-events-auto flex items-center gap-3 rounded-2xl px-3 py-2">
        <BrandMark />
        <div className="leading-tight">
          <div className="text-sm font-bold tracking-tight">{company ?? 'AI Agency OS'}</div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted" aria-live="polite">
            <span className="status-dot h-2 w-2" data-live={conn.live && connection === 'live'} style={{ background: conn.color }} />
            {conn.label}
            <span className="font-mono tabular-nums">· {clock}</span>
            {mode === 'memory' && (
              <span
                className="rounded bg-info-soft px-1.5 py-0.5 font-semibold text-info"
                title="Sem Supabase configurado: dados em memória, perdidos ao reiniciar o servidor."
              >
                modo local
              </span>
            )}
          </div>
        </div>
      </div>

      <nav className="glass anim-panel-in pointer-events-auto flex items-center gap-1 rounded-2xl p-1" aria-label="Ações">
        <ThemeToggle />
        <Link href="/admin" className="btn btn-primary px-3 py-1.5 text-xs">
          Painel
        </Link>
      </nav>
    </header>
  );
}
