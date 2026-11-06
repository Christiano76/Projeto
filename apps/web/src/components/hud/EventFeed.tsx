'use client';

import { describeEvent } from '@agency/core';
import { useState } from 'react';
import { formatTime } from '@/lib/format';
import { useOfficeStore } from '@/store/officeStore';

/** Feed de eventos reais (o que aconteceu na empresa, em ordem). */
export function EventFeed() {
  const events = useOfficeStore((s) => s.events);
  const employees = useOfficeStore((s) => s.employees);
  const select = useOfficeStore((s) => s.select);
  const [open, setOpen] = useState(true);

  return (
    <section className="pointer-events-none absolute bottom-3 right-3 z-10 w-80 max-sm:hidden" aria-label="Atividades recentes">
      <div className="glass pointer-events-auto overflow-hidden rounded-2xl">
        <button
          className="flex w-full items-center justify-between px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          Atividades recentes
          <span>{open ? '–' : '+'}</span>
        </button>
        {open && (
          <ul className="scrollbar-thin max-h-52 overflow-y-auto px-2 pb-2">
            {events.length === 0 && (
              <li className="px-1 py-2 text-xs text-slate-500">
                Nenhum evento ainda. Os agentes de IA serão ativados na Fase 2; até lá, use o console de eventos do diretor.
              </li>
            )}
            {events.slice(0, 40).map((ev) => (
              <li key={ev.id}>
                <button
                  className="w-full rounded-lg px-1.5 py-1 text-left hover:bg-slate-900/5"
                  onClick={() => select(ev.employeeId)}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs font-semibold">{employees[ev.employeeId]?.name ?? 'Funcionário'}</span>
                    <span className="shrink-0 text-[10px] text-slate-400">
                      {formatTime(ev.createdAt)}
                      {ev.source === 'manual' && <span className="ml-1 rounded bg-slate-200 px-1 text-slate-600">manual</span>}
                    </span>
                  </div>
                  <div className="truncate text-xs text-slate-600">{describeEvent(ev)}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
