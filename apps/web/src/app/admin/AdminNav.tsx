'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/admin', label: 'Visão geral' },
  { href: '/admin/events', label: 'Eventos' },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 md:flex-col" aria-label="Painel administrativo">
      <Link href="/" className="row-interactive focus-ring rounded-lg px-3 py-1.5 text-sm font-semibold text-accent">
        ← Escritório 3D
      </Link>
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          aria-current={path === n.href ? 'page' : undefined}
          className={`row-interactive focus-ring rounded-lg px-3 py-1.5 text-sm ${path === n.href ? 'bg-accent-soft font-semibold text-accent' : 'text-fg'}`}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
