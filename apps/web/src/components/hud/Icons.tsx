/** Ícones de traço simples (24×24), herdam a cor do texto. */
const PATHS = {
  camera: 'M3 7h4l2-3h6l2 3h4v12H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  rotateLeft: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  rotateRight: 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5',
  tiltUp: 'M12 19V5M5 12l7-7 7 7',
  tiltDown: 'M12 5v14M19 12l-7 7-7-7',
  zoomIn: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3M11 8v6M8 11h6',
  zoomOut: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3M8 11h6',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  forward: 'M12 4l-7 8h4v8h6v-8h4z',
  back: 'M12 20l7-8h-4V4H9v8H5z',
  reset: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  iso: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  follow: 'M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  walls: 'M3 21h18M5 21V10l7-5 7 5v11',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  close: 'M18 6 6 18M6 6l12 12',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'h-4 w-4' }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
