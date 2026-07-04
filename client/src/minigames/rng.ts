/**
 * PRNG determinístico (mulberry32). El server inyecta `seed` en el content del
 * minijuego, así todos los clientes generan exactamente el mismo escenario
 * (laberinto, caños, semáforo, largadas) sin sincronizar nada más.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lee la semilla compartida del content; en playtest (sin server) cae en un default fijo. */
export function contentSeed(content: unknown, fallback = 20260703): number {
  const s = (content as { seed?: unknown } | null | undefined)?.seed;
  return typeof s === "number" && Number.isFinite(s) ? Math.floor(s) : fallback;
}
