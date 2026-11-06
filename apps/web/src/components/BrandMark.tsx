/** Marca da agência: monograma com filete luminoso frio. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <div
      className="relative flex shrink-0 items-center justify-center rounded-xl text-[13px] font-black tracking-tight text-white"
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(135deg, #1d6bf3, #0891b2)',
        boxShadow: '0 0 0 1px rgb(125 211 252 / 0.35), 0 6px 18px -6px var(--glow)',
      }}
      aria-hidden
    >
      AI
    </div>
  );
}
