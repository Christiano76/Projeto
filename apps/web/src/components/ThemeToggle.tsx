'use client';

import { useEffect, useState } from 'react';
import { useThemeStore } from '@/lib/theme';

/** Alterna claro/escuro. Ícones sol/lua animados via CSS (ver globals.css). */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  // Evita divergência de hidratação: o rótulo só reflete o tema após montar.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const label = mounted ? (theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro') : 'Alternar tema';

  return (
    <button
      type="button"
      onClick={toggle}
      className={`btn btn-ghost h-8 w-8 ${className}`}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
    >
      <span className="relative block h-4 w-4">
        <svg className="theme-icon theme-icon--sun absolute inset-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        <svg className="theme-icon theme-icon--moon absolute inset-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      </span>
    </button>
  );
}
