'use client';

import type { OfficeSnapshot } from '@agency/core';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeLiveUpdates } from '@/lib/liveUpdates';
import { useOfficeStore } from '@/store/officeStore';
import { EmployeePanel } from './hud/EmployeePanel';
import { EventFeed } from './hud/EventFeed';
import { LabelLayer } from './hud/LabelLayer';
import { SidePanel } from './hud/SidePanel';
import { TopBar } from './hud/TopBar';

const OfficeScene = dynamic(() => import('./office/OfficeScene').then((m) => m.OfficeScene), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-500">Carregando escritório 3D…</div>
  ),
});

/**
 * Aplicação principal: escritório 3D + HUD. O estado vem do snapshot do
 * servidor e é mantido atualizado por eventos em tempo real (sem polling).
 */
export function OfficeApp({ initialSnapshot, isDirector }: { initialSnapshot: OfficeSnapshot; isDirector: boolean }) {
  const load = useOfficeStore((s) => s.load);
  const applyUpdate = useOfficeStore((s) => s.applyUpdate);
  const setConnection = useOfficeStore((s) => s.setConnection);
  const loaded = useOfficeStore((s) => s.snapshot !== null);
  const [rotateRequest, setRotateRequest] = useState<{ nonce: number; dir: 1 | -1 }>({ nonce: 0, dir: 1 });
  const wasLive = useRef(false);

  useEffect(() => {
    load(initialSnapshot);
  }, [initialSnapshot, load]);

  // Ao reconectar, busca um snapshot novo para recuperar eventos perdidos.
  const resync = useCallback(async () => {
    try {
      const res = await fetch('/api/office', { cache: 'no-store' });
      if (res.ok) load((await res.json()) as OfficeSnapshot);
    } catch {
      /* tenta novamente na próxima reconexão */
    }
  }, [load]);

  useEffect(() => {
    const unsubscribe = subscribeLiveUpdates(
      initialSnapshot.mode,
      initialSnapshot.company.id,
      applyUpdate,
      (status) => {
        setConnection(status);
        if (status === 'live') {
          if (wasLive.current) void resync();
          wasLive.current = true;
        }
      },
    );
    return unsubscribe;
  }, [initialSnapshot.mode, initialSnapshot.company.id, applyUpdate, setConnection, resync]);

  const rotate = useCallback((dir: 1 | -1) => setRotateRequest((r) => ({ nonce: r.nonce + 1, dir })), []);

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <div className="absolute inset-0">{loaded && <OfficeScene rotateRequest={rotateRequest} />}</div>
      {loaded && <LabelLayer />}
      <TopBar onRotate={rotate} />
      <SidePanel />
      <EventFeed />
      <EmployeePanel isDirector={isDirector} />
    </main>
  );
}
