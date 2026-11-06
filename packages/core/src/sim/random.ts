/** Hash FNV-1a determinístico → número em [0, 1). Mesma entrada, mesmo resultado em todos os clientes. */
export function hash01(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 1_000_003) / 1_000_003;
}
