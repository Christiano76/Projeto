'use client';

import { STATUS_COLORS, STATUS_LABELS, roomCenter } from '@agency/core';
import { useEffect, useMemo } from 'react';
import { useOfficeStore } from '@/store/officeStore';
import { fixedTarget, labelRef, setLabelTarget } from '../office/labels';

/** Rótulos de salas e funcionários (posicionados pelo LabelProjector). */
export function LabelLayer() {
  const layout = useOfficeStore((s) => s.snapshot?.layout);
  const employees = useOfficeStore((s) => s.employees);
  const selectedId = useOfficeStore((s) => s.selectedEmployeeId);
  const showLabels = useOfficeStore((s) => s.showLabels);
  const rooms = useMemo(() => (layout?.rooms ?? []).filter((r) => r.kind !== 'corridor'), [layout]);

  useEffect(() => {
    for (const r of rooms) {
      const [cx] = roomCenter(r);
      setLabelTarget(`room:${r.key}`, fixedTarget(cx, 0.05, r.bounds.z + r.bounds.d - 0.45));
    }
    return () => rooms.forEach((r) => setLabelTarget(`room:${r.key}`, null));
  }, [rooms]);

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
      {rooms.map((r) => (
        <div key={r.key} ref={labelRef(`room:${r.key}`)} className="label-anchor" style={{ visibility: 'hidden' }}>
          <div className="room-label">{r.name}</div>
        </div>
      ))}
      {Object.values(employees).map((e) => {
        const selected = e.id === selectedId;
        if (!showLabels && !selected) return null;
        return (
          <div key={e.id} ref={labelRef(`emp:${e.id}`)} className="label-anchor label-anchor--top" style={{ visibility: 'hidden' }}>
            <div className={`avatar-label${selected ? ' avatar-label--selected' : ''}`}>
              <span className="avatar-label__dot" style={{ background: STATUS_COLORS[e.runtime.status] }} />
              <span className="avatar-label__name">{e.name.split(' ')[0]}</span>
              {selected && <span className="avatar-label__status">{STATUS_LABELS[e.runtime.status]}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
