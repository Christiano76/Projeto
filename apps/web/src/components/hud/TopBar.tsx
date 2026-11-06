'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useOfficeStore } from '@/store/officeStore';

const CONNECTION_LABEL = {
  connecting: ['Conectando…', 'bg-amber-400'],
  live: ['Ao vivo', 'bg-emerald-500'],
  reconnecting: ['Reconectando…', 'bg-amber-400'],
  offline: ['Desconectado', 'bg-rose-500'],
} as const;

export function TopBar({ onRotate }: { onRotate: (dir: 1 | -1) => void }) {
  const company = useOfficeStore((s) => s.snapshot?.company.name);
  const mode = useOfficeStore((s) => s.snapshot?.mode);
  const connection = useOfficeStore((s) => s.connection);
  const wallMode = useOfficeStore((s) => s.wallMode);
  const showLabels = useOfficeStore((s) => s.showLabels);
  const setWallMode = useOfficeStore((s) => s.setWallMode);
  const toggleLabels = useOfficeStore((s) => s.toggleLabels);
  const focusRoom = useOfficeStore((s) => s.focusRoom);
  const [clock, setClock] = useState('');

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  const [label, dot] = CONNECTION_LABEL[connection];
  const btn = 'rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-900/5 active:bg-slate-900/10';

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-2 p-3">
      <div className="glass pointer-events-auto flex items-center gap-3 rounded-2xl px-3 py-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-600 text-sm font-black text-white">AI</div>
        <div className="leading-tight">
          <div className="text-sm font-bold">{company ?? 'AI Agency OS'}</div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
            {label}
            <span>· {clock}</span>
            {mode === 'memory' && (
              <span
                className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800"
                title="Sem Supabase configurado: dados em memória, perdidos ao reiniciar o servidor."
              >
                modo local
              </span>
            )}
          </div>
        </div>
      </div>

      <nav className="glass pointer-events-auto flex flex-wrap items-center gap-0.5 rounded-2xl p-1" aria-label="Controles do escritório">
        <button className={btn} onClick={() => onRotate(-1)} title="Girar câmera à esquerda" aria-label="Girar à esquerda">
          ⟲
        </button>
        <button className={btn} onClick={() => onRotate(1)} title="Girar câmera à direita" aria-label="Girar à direita">
          ⟳
        </button>
        <button className={btn} onClick={() => focusRoom(null)} title="Enquadrar o escritório inteiro">
          Visão geral
        </button>
        <button className={btn} onClick={() => setWallMode(wallMode === 'low' ? 'high' : 'low')} aria-pressed={wallMode === 'high'}>
          Paredes: {wallMode === 'low' ? 'baixas' : 'altas'}
        </button>
        <button className={btn} onClick={toggleLabels} aria-pressed={showLabels}>
          Nomes
        </button>
        <Link href="/admin" className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
          Painel
        </Link>
      </nav>
    </header>
  );
}
