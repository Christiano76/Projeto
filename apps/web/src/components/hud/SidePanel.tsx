'use client';

import { STATUS_COLORS, STATUS_LABELS } from '@agency/core';
import { useEffect, useMemo, useState } from 'react';
import { useOfficeStore } from '@/store/officeStore';

/** Navegação entre salas e lista rápida de funcionários. */
export function SidePanel() {
  const snapshot = useOfficeStore((s) => s.snapshot);
  const employees = useOfficeStore((s) => s.employees);
  const focusRoomKey = useOfficeStore((s) => s.focusRoomKey);
  const selectedId = useOfficeStore((s) => s.selectedEmployeeId);
  const focusRoom = useOfficeStore((s) => s.focusRoom);
  const select = useOfficeStore((s) => s.select);
  const [open, setOpen] = useState(true);
  // Em telas pequenas começa recolhido para não cobrir o escritório.
  const toggleLabels = useOfficeStore((s) => s.toggleLabels);
  useEffect(() => {
    if (window.innerWidth < 640) {
      setOpen(false);
      // Nomes ocultos por padrão no celular (o selecionado continua rotulado).
      if (useOfficeStore.getState().showLabels) toggleLabels();
    }
  }, [toggleLabels]);

  const rooms = useMemo(
    () => (snapshot?.layout.rooms ?? []).filter((r) => r.kind !== 'corridor').sort((a, b) => a.sortOrder - b.sortOrder),
    [snapshot],
  );
  const list = useMemo(() => Object.values(employees).sort((a, b) => Number(b.isManager) - Number(a.isManager) || a.name.localeCompare(b.name)), [employees]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of list) c[e.runtime.status] = (c[e.runtime.status] ?? 0) + 1;
    return c;
  }, [list]);

  if (!snapshot) return null;

  return (
    <aside className="pointer-events-none absolute left-3 top-20 z-10 flex max-h-[calc(100dvh-12rem)] w-60 flex-col max-sm:top-auto max-sm:bottom-3 max-sm:max-h-[45dvh]">
      <div className="glass anim-panel-in pointer-events-auto flex min-h-0 flex-col overflow-hidden rounded-2xl">
        <button
          className="focus-ring flex items-center justify-between px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-muted hover:text-fg"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          Escritório
          <Chevron />
        </button>
        <div className="collapsible min-h-0" data-open={open} aria-hidden={!open}>
          <div>
          <div className="scrollbar-thin max-h-[calc(100dvh-15rem)] overflow-y-auto px-2 pb-2 max-sm:max-h-[38dvh]">
            <div className="mb-2 flex flex-wrap gap-1 px-1">
              {Object.entries(counts).map(([status, n]) => (
                <span key={status} className="flex items-center gap-1 rounded-full bg-fg/5 px-2 py-0.5 text-[11px] text-fg">
                  <span className="status-dot h-1.5 w-1.5" data-live={status === 'working' || status === 'meeting'} style={{ background: STATUS_COLORS[status as keyof typeof STATUS_COLORS] }} />
                  {n} {STATUS_LABELS[status as keyof typeof STATUS_LABELS].toLowerCase()}
                </span>
              ))}
            </div>
            <div className="px-1 pb-1 text-[11px] font-semibold uppercase text-subtle">Salas</div>
            <ul className="mb-2 space-y-0.5">
              {rooms.map((room) => (
                <li key={room.key}>
                  <button
                    onClick={() => focusRoom(room.key)}
                    tabIndex={open ? 0 : -1}
                    aria-current={focusRoomKey === room.key}
                    className={`row-interactive focus-ring w-full rounded-lg px-2 py-1 text-left text-sm ${
                      focusRoomKey === room.key ? 'font-semibold text-accent' : 'text-fg'
                    }`}
                  >
                    {room.name}
                  </button>
                </li>
              ))}
            </ul>
            <div className="px-1 pb-1 text-[11px] font-semibold uppercase text-subtle">Funcionários</div>
            <ul className="space-y-0.5">
              {list.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => select(e.id)}
                    tabIndex={open ? 0 : -1}
                    aria-current={selectedId === e.id}
                    className="row-interactive focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left"
                  >
                    <span
                      className="status-dot h-2 w-2"
                      data-live={e.runtime.status === 'working' || e.runtime.status === 'meeting'}
                      style={{ background: STATUS_COLORS[e.runtime.status] }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{e.name}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {e.role} · {STATUS_LABELS[e.runtime.status]}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function Chevron() {
  return (
    <svg className="chevron h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
