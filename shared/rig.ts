import type { RiggedConfig } from "./types";

/**
 * Aplica el "rig" a un ranking ya calculado con scores reales.
 * Se ejecuta SIEMPRE del lado del server, dentro de resolve().
 * El cliente nunca sabe que está arreglado.
 */
export function applyRig(ranking: string[], rigged?: RiggedConfig): string[] {
  let r = [...ranking];
  for (const loser of rigged?.losers ?? []) {
    r = r.filter((id) => id !== loser);
    r.push(loser); // siempre al fondo
  }
  for (const winner of rigged?.winners ?? []) {
    r = r.filter((id) => id !== winner);
    r.unshift(winner); // siempre arriba
  }
  return r;
}
