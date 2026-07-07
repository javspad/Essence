import type { Player } from "@essence/shared";

// ============================================================================
// Motor de ventajas/desventajas (traits pasivos).
// El catálogo completo vive en content.json; acá está la lógica de los que YA
// funcionan. Un trait sin handler simplemente no hace nada (no-op).
// ============================================================================

/** Ids de traits que ya tienen efecto en el motor (fase 1). */
export const LIVE_TRAITS: ReadonlySet<string> = new Set<string>([
  // dado
  "cargado-a-favor",
  "dado-timido",
  "ancla-de-plomo",
  "atajo-del-segundo",
  "impulso-de-remonte",
  "corona",
  // mapa
  "recuperacion",
  "fragil",
  // monedas (fin de ronda)
  "interes-compuesto",
  "manos-rotas",
  "diezmo",
  // minijuegos (pago)
  "fortuna",
  "cobrador-de-podios",
  "cobarde",
  "nunca-ultimo",
  // turnos
  "ultimo-siempre",
  "peso-muerto",
]);

function has(player: Player | undefined, trait: string): boolean {
  return !!player?.traits?.includes(trait);
}

export interface DiceContext {
  /** posición del jugador dentro de turnOrder (0 = primero) */
  turnIndex: number;
  /** jugadores conectados, para leer posiciones del tablero */
  players: Player[];
}

/**
 * Ajusta la tirada del jugador activo según sus traits (y los de la mesa).
 * Nunca devuelve menos de 1.
 */
export function applyDiceTraits(roll: number, roller: Player, ctx: DiceContext): number {
  let r = roll;
  // Propios
  if (has(roller, "cargado-a-favor") && r === 1) r = 2; // nunca 1
  if (has(roller, "dado-timido") && r === 6) r = 3; // nunca 6
  if (has(roller, "atajo-del-segundo") && ctx.turnIndex === 1 && r === 1) r = 2; // el 2° evita el 1
  if (has(roller, "ancla-de-plomo") && r > 4) r = 4; // tope 4
  if (has(roller, "impulso-de-remonte") && isStrictlyLast(roller, ctx.players)) r += 2; // remonte del último
  // De otros: Corona — mientras un rival va 1° con corona, el resto saca -1
  if (!has(roller, "corona") && someoneElseLeadsWithCorona(roller, ctx.players)) r -= 1;
  return Math.max(1, r);
}

function isStrictlyLast(roller: Player, players: Player[]): boolean {
  const positions = players.map((p) => p.position);
  const min = Math.min(...positions);
  const max = Math.max(...positions);
  return max > min && roller.position === min;
}

function someoneElseLeadsWithCorona(roller: Player, players: Player[]): boolean {
  const max = Math.max(...players.map((p) => p.position));
  if (max <= 0) return false;
  return players.some((p) => p.id !== roller.id && has(p, "corona") && p.position === max);
}

/**
 * Ajusta un retroceso (delta < 0) según los traits del jugador.
 * Los avances (delta >= 0) quedan igual.
 */
export function applyMoveTraits(delta: number, player: Player | undefined): number {
  if (delta >= 0) return delta;
  let d = delta;
  if (has(player, "recuperacion")) d = Math.trunc(d / 2); // retroceso a la mitad (hacia 0)
  if (has(player, "fragil")) d = d * 2; // retroceso doble
  return d === 0 ? 0 : d; // normaliza -0 -> 0
}

/** Monedas que gana/pierde un jugador al cerrar una ronda. */
export function roundEndCoinDelta(player: Player): number {
  let delta = 0;
  if (has(player, "interes-compuesto")) delta += Math.floor(player.coins / 10); // +1 por cada 10
  if (has(player, "manos-rotas")) delta -= 1;
  if (has(player, "diezmo")) delta -= Math.floor(player.coins * 0.25);
  return delta;
}

/** Ajusta el pago de monedas de un minijuego para un jugador según su puesto. */
export function applyPayoutTraits(coins: number, rank: number, player: Player | undefined): number {
  let c = coins;
  if (has(player, "fortuna") && c > 0) c *= 2; // todo lo ganado x2
  if (has(player, "cobrador-de-podios") && rank === 1) c += 2; // +2 al 1°
  if (has(player, "cobarde") && rank === 1) c = 0; // el 1° no cobra
  if (has(player, "nunca-ultimo")) c = Math.max(c, 1); // nunca 0
  return Math.max(0, c);
}

/** El jugador ignora los turnos extra que le tocarían. */
export function blocksExtraTurn(player: Player | undefined): boolean {
  return has(player, "peso-muerto");
}

/** Reordena turnOrder mandando a los "ultimo-siempre" al fondo (estable). */
export function orderWithTurnTraits(order: string[], players: Player[]): string[] {
  const byId = new Map(players.map((p) => [p.id, p] as const));
  const last = order.filter((id) => has(byId.get(id), "ultimo-siempre"));
  const rest = order.filter((id) => !has(byId.get(id), "ultimo-siempre"));
  return [...rest, ...last];
}
