'use client';

import { STATUS_COLORS, describeEvent } from '@agency/core';
import { useEffect, useRef, useState } from 'react';
import { formatTime } from '@/lib/format';
import { useOfficeStore } from '@/store/officeStore';
import { Chevron } from './SidePanel';

/** Feed de eventos reais (o que aconteceu na empresa, em ordem). */
export function EventFeed() {
  const events = useOfficeStore((s) => s.events);
  const employees = useOfficeStore((s) => s.employees);
  const select = useOfficeStore((s) => s.select);
  // Em telas menores, a ficha do funcionário ocupa o mesmo canto: o feed se recolhe.
  const panelOpen = useOfficeStore((s) => s.selectedEmployeeId !== null);
  const [open, setOpen] = useState(true);
  const [unread, setUnread] = useState(0);
  // IDs já exibidos: só os eventos novos recebem animação de entrada.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(events.map((e) => e.id));
  const fresh = events.filter((e) => !seen.current!.has(e.id)).map((e) => e.id);

  useEffect(() => {
    if (fresh.length === 0) return;
    if (!open) setUnread((n) => n + fresh.length);
    fresh.forEach((id) => seen.current!.add(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  const toggle = () => {
    setOpen((o) => !o);
    setUnread(0);
  };

  return (
    <section
      className="fade-away pointer-events-none absolute bottom-3 right-3 z-10 w-80 max-sm:hidden"
      data-hidden={panelOpen}
      aria-hidden={panelOpen}
      aria-label="Atividades recentes"
    >
      <div className="glass anim-panel-in pointer-events-auto overflow-hidden rounded-2xl">
        <button
          className="focus-ring flex w-full items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted hover:text-fg"
          onClick={toggle}
          aria-expanded={open}
        >
          <span className="flex items-center gap-2">
            Atividades recentes
            {unread > 0 && (
              <span key={unread} className="anim-pop rounded-full bg-accent px-1.5 text-[10px] leading-4 text-accent-fg" aria-label={`${unread} novas`}>
                {unread}
              </span>
            )}
          </span>
          <Chevron />
        </button>
        <div className="collapsible" data-open={open} aria-hidden={!open}>
          <div>
            <ul className="scrollbar-thin max-h-52 overflow-y-auto px-2 pb-2">
              {events.length === 0 && (
                <li className="px-1 py-2 text-xs text-muted">
                  Nenhum evento ainda. Os agentes de IA serão ativados na Fase 2; até lá, use o console de eventos do diretor.
                </li>
              )}
              {events.slice(0, 40).map((ev) => {
                const emp = employees[ev.employeeId];
                return (
                  <li key={ev.id} className={fresh.includes(ev.id) ? 'anim-item-in' : undefined}>
                    <button
                      tabIndex={open ? 0 : -1}
                      className="row-interactive focus-ring w-full rounded-lg px-1.5 py-1 text-left"
                      onClick={() => select(ev.employeeId)}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold">
                          {emp && <span className="status-dot h-1.5 w-1.5" style={{ background: STATUS_COLORS[emp.runtime.status] }} />}
                          {emp?.name ?? 'Funcionário'}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-subtle">
                          {formatTime(ev.createdAt)}
                          {ev.source === 'manual' && <span className="ml-1 rounded bg-surface-3 px-1 font-sans text-muted">manual</span>}
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted">{describeEvent(ev)}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
