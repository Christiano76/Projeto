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

function Icon({ d, className = '' }: { d: string; className?: string }) {
  return (
    <svg className={`h-4 w-4 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

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

  const conn = CONNECTION[connection];
  const btn = 'btn btn-ghost px-2.5 py-1.5 text-xs';

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

      <nav className="glass anim-panel-in pointer-events-auto flex flex-wrap items-center gap-0.5 rounded-2xl p-1" aria-label="Controles do escritório">
        <button className={btn} onClick={() => onRotate(-1)} title="Girar câmera à esquerda" aria-label="Girar à esquerda">
          <Icon className="icon-spin-hover" d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
        </button>
        <button className={btn} onClick={() => onRotate(1)} title="Girar câmera à direita" aria-label="Girar à direita">
          <Icon className="icon-spin-hover cw" d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />
        </button>
        <button className={btn} onClick={() => focusRoom(null)} title="Enquadrar o escritório inteiro">
          <Icon d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          <span className="max-sm:hidden">Visão geral</span>
        </button>
        <button className={btn} onClick={() => setWallMode(wallMode === 'low' ? 'high' : 'low')} aria-pressed={wallMode === 'high'} title="Altura das paredes">
          <Icon d="M3 21h18M5 21V10l7-5 7 5v11" />
          <span className="max-sm:hidden">Paredes: {wallMode === 'low' ? 'baixas' : 'altas'}</span>
        </button>
        <button className={btn} onClick={toggleLabels} aria-pressed={showLabels} title="Mostrar nomes">
          <Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
          <span className="max-sm:hidden">Nomes</span>
        </button>
        <ThemeToggle />
        <Link href="/admin" className="btn btn-primary ml-0.5 px-3 py-1.5 text-xs">
          Painel
        </Link>
      </nav>
    </header>
  );
}
