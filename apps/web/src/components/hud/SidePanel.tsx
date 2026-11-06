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
      <div className="glass pointer-events-auto flex min-h-0 flex-col overflow-hidden rounded-2xl">
        <button
          className="flex items-center justify-between px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-500"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          Escritório
          <span>{open ? '–' : '+'}</span>
        </button>
        {open && (
          <div className="scrollbar-thin min-h-0 overflow-y-auto px-2 pb-2">
            <div className="mb-2 flex flex-wrap gap-1 px-1">
              {Object.entries(counts).map(([status, n]) => (
                <span key={status} className="flex items-center gap-1 rounded-full bg-slate-900/5 px-2 py-0.5 text-[11px] text-slate-700">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLORS[status as keyof typeof STATUS_COLORS] }} />
                  {n} {STATUS_LABELS[status as keyof typeof STATUS_LABELS].toLowerCase()}
                </span>
              ))}
            </div>
            <div className="px-1 pb-1 text-[11px] font-semibold uppercase text-slate-400">Salas</div>
            <ul className="mb-2 space-y-0.5">
              {rooms.map((room) => (
                <li key={room.key}>
                  <button
                    onClick={() => focusRoom(room.key)}
                    className={`w-full rounded-lg px-2 py-1 text-left text-sm hover:bg-slate-900/5 ${
                      focusRoomKey === room.key ? 'bg-brand-100 font-semibold text-brand-700' : 'text-slate-700'
                    }`}
                  >
                    {room.name}
                  </button>
                </li>
              ))}
            </ul>
            <div className="px-1 pb-1 text-[11px] font-semibold uppercase text-slate-400">Funcionários</div>
            <ul className="space-y-0.5">
              {list.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => select(e.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-slate-900/5 ${
                      selectedId === e.id ? 'bg-brand-100' : ''
                    }`}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_COLORS[e.runtime.status] }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{e.name}</span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {e.role} · {STATUS_LABELS[e.runtime.status]}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
