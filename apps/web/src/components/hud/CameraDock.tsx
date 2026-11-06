'use client';

import { useEffect, useRef, useState } from 'react';
import { useCameraStore, type CameraCommand, type HeldAxis, type Quality } from '@/store/cameraStore';
import { useOfficeStore } from '@/store/officeStore';
import { Icon, type IconName } from './Icons';

/**
 * Aba retrátil de controles da câmera (canto inferior). Recolhida, é só um
 * botão discreto; expandida, mostra órbita, zoom, deslocamento, redefinição,
 * vista isométrica, acompanhamento, velocidade, qualidade e opções de vista.
 *
 * Botões direcionais: toque curto = passo; manter pressionado = movimento contínuo.
 */
export function CameraDock() {
  const [open, setOpen] = useState(false);
  const speed = useCameraStore((s) => s.speed);
  const setSpeed = useCameraStore((s) => s.setSpeed);
  const follow = useCameraStore((s) => s.follow);
  const setFollow = useCameraStore((s) => s.setFollow);
  const quality = useCameraStore((s) => s.quality);
  const effective = useCameraStore((s) => s.effectiveQuality);
  const setQuality = useCameraStore((s) => s.setQuality);
  const push = useCameraStore((s) => s.push);
  const selectedId = useOfficeStore((s) => s.selectedEmployeeId);
  const selectedName = useOfficeStore((s) => (s.selectedEmployeeId ? s.employees[s.selectedEmployeeId]?.name : undefined));
  const wallMode = useOfficeStore((s) => s.wallMode);
  const setWallMode = useOfficeStore((s) => s.setWallMode);
  const showLabels = useOfficeStore((s) => s.showLabels);
  const toggleLabels = useOfficeStore((s) => s.toggleLabels);

  // Sem ninguém selecionado não há o que seguir.
  useEffect(() => {
    if (!selectedId && follow) setFollow(false);
  }, [selectedId, follow, setFollow]);

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex flex-col items-start gap-2 max-sm:left-auto max-sm:right-3 max-sm:items-end sm:left-[16.5rem]">
      <div
        id="camera-dock-panel"
        className="collapsible pointer-events-auto origin-bottom"
        data-open={open}
        aria-hidden={!open}
        role="region"
        aria-label="Controles da câmera"
      >
        <div>
          <div className="glass dock-panel w-[17.5rem] rounded-2xl p-3" data-open={open}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Câmera</span>
              <span className="text-[10px] text-subtle max-sm:hidden">WASD · Q/E · R/F · +/−</span>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <HoldButton icon="rotateLeft" label="Girar à esquerda" axis="rotate" dir={1} step={{ type: 'rotate', amount: Math.PI / 6 }} disabled={!open} />
              <HoldButton icon="tiltUp" label="Inclinar para cima (mais de cima)" axis="tilt" dir={-1} step={{ type: 'tilt', amount: -0.18 }} disabled={!open} />
              <HoldButton icon="rotateRight" label="Girar à direita" axis="rotate" dir={-1} step={{ type: 'rotate', amount: -Math.PI / 6 }} disabled={!open} />
              <HoldButton icon="left" label="Mover para a esquerda" axis="panX" dir={-1} step={{ type: 'pan', x: -1, z: 0 }} disabled={!open} />
              <HoldButton icon="forward" label="Mover para frente" axis="panZ" dir={1} step={{ type: 'pan', x: 0, z: 1 }} disabled={!open} />
              <HoldButton icon="right" label="Mover para a direita" axis="panX" dir={1} step={{ type: 'pan', x: 1, z: 0 }} disabled={!open} />
              <HoldButton icon="zoomOut" label="Afastar" axis="zoom" dir={-1} step={{ type: 'zoom', amount: -0.25 }} disabled={!open} />
              <HoldButton icon="back" label="Mover para trás" axis="panZ" dir={-1} step={{ type: 'pan', x: 0, z: -1 }} disabled={!open} />
              <HoldButton icon="zoomIn" label="Aproximar" axis="zoom" dir={1} step={{ type: 'zoom', amount: 0.25 }} disabled={!open} />
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              <HoldButton icon="tiltDown" label="Inclinar para baixo (mais lateral)" axis="tilt" dir={1} step={{ type: 'tilt', amount: 0.18 }} disabled={!open} />
              <DockButton icon="iso" label="Vista isométrica" text="Iso" onClick={() => push({ type: 'iso' })} disabled={!open} />
              <DockButton icon="reset" label="Redefinir câmera" text="Início" onClick={() => push({ type: 'reset' })} disabled={!open} />
            </div>

            <div className="mt-2.5 grid grid-cols-3 gap-1.5">
              <DockToggle
                icon="follow"
                label={selectedName ? `Acompanhar ${selectedName}` : 'Selecione alguém para acompanhar'}
                text="Seguir"
                pressed={follow}
                disabled={!open || !selectedId}
                onClick={() => setFollow(!follow)}
              />
              <DockToggle icon="walls" label="Paredes altas" text={wallMode === 'low' ? 'Baixas' : 'Altas'} pressed={wallMode === 'high'} disabled={!open} onClick={() => setWallMode(wallMode === 'low' ? 'high' : 'low')} />
              <DockToggle icon="user" label="Mostrar nomes" text="Nomes" pressed={showLabels} disabled={!open} onClick={toggleLabels} />
            </div>

            <label className="mt-3 flex items-center gap-2 text-[11px] text-muted">
              <span className="w-20 shrink-0">Velocidade</span>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.25}
                value={speed}
                tabIndex={open ? 0 : -1}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="range h-1 flex-1"
                aria-label="Velocidade da câmera"
              />
              <span className="w-8 text-right font-mono tabular-nums text-fg">{speed.toFixed(2).replace(/0$/, '')}×</span>
            </label>

            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
              <span className="w-20 shrink-0">Qualidade</span>
              <div className="flex flex-1 rounded-lg bg-fg/5 p-0.5" role="radiogroup" aria-label="Qualidade gráfica">
                {(['auto', 'high', 'medium', 'low'] as Quality[]).map((q) => (
                  <button
                    key={q}
                    role="radio"
                    aria-checked={quality === q}
                    tabIndex={open ? 0 : -1}
                    onClick={() => setQuality(q)}
                    className={`btn flex-1 rounded-md px-1 py-1 text-[10px] ${quality === q ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg'}`}
                  >
                    {{ auto: 'Auto', high: 'Alta', medium: 'Média', low: 'Baixa' }[q]}
                  </button>
                ))}
              </div>
            </div>
            {quality === 'auto' && (
              <p className="mt-1 text-right text-[10px] text-subtle">em uso: {{ high: 'alta', medium: 'média', low: 'baixa' }[effective]}</p>
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="camera-dock-panel"
        aria-label={open ? 'Recolher controles da câmera' : 'Abrir controles da câmera'}
        title="Controles da câmera"
        data-testid="camera-dock-toggle"
        className={`glass btn pointer-events-auto h-11 w-11 rounded-2xl ${open ? 'text-accent' : 'text-muted hover:text-fg'}`}
      >
        <span className="dock-toggle-icon" data-open={open}>
          <Icon name={open ? 'close' : 'camera'} className="h-5 w-5" />
        </span>
      </button>
    </div>
  );
}

/** Depois deste tempo pressionado, o movimento passa a ser contínuo. */
const HOLD_DELAY_MS = 350;

/** Botão com passo no toque curto e movimento contínuo enquanto pressionado. */
function HoldButton({
  icon,
  label,
  axis,
  dir,
  step,
  disabled,
}: {
  icon: IconName;
  label: string;
  axis: HeldAxis;
  dir: number;
  step: CameraCommand;
  disabled?: boolean;
}) {
  const setHeld = useCameraStore((s) => s.setHeld);
  const push = useCameraStore((s) => s.push);
  const pressedAt = useRef<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = useState(false);

  const start = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pressedAt.current = performance.now();
    setActive(true);
    // Toque: um passo imediato (resposta garantida mesmo em aparelhos lentos).
    push(step);
    // Mantido pressionado: movimento contínuo.
    holdTimer.current = setTimeout(() => setHeld(axis, dir), HOLD_DELAY_MS);
  };
  const end = () => {
    if (pressedAt.current === null) return;
    pressedAt.current = null;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    setHeld(axis, 0);
    setActive(false);
  };
  useEffect(() => () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }, []);

  return (
    <button
      type="button"
      className="btn btn-ghost dock-btn h-10 touch-none select-none"
      aria-label={label}
      title={label}
      tabIndex={disabled ? -1 : 0}
      data-active={active}
      onPointerDown={start}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          push(step);
        }
      }}
    >
      <Icon name={icon} />
    </button>
  );
}

function DockButton({ icon, label, text, onClick, disabled }: { icon: IconName; label: string; text: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="btn btn-ghost dock-btn h-10 gap-1 text-[11px]" aria-label={label} title={label} tabIndex={disabled ? -1 : 0} onClick={onClick}>
      <Icon name={icon} />
      {text}
    </button>
  );
}

function DockToggle({
  icon,
  label,
  text,
  pressed,
  onClick,
  disabled,
}: {
  icon: IconName;
  label: string;
  text: string;
  pressed: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="btn btn-ghost dock-btn h-9 gap-1 text-[11px]"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      tabIndex={disabled ? -1 : 0}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
      {text}
    </button>
  );
}
