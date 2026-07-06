import type { Player } from "./types";

type StandingPlayer = Pick<Player, "id" | "name" | "position" | "coins">;

export function rankPlayersByProgress<T extends StandingPlayer>(players: T[]): T[] {
  return [...players].sort(compareByProgressThenCoins);
}

export function rankPlayersForFinishedGame<T extends StandingPlayer>(players: T[], winnerId: string | null): T[] {
  return [...players].sort((a, b) => {
    const aWon = a.id === winnerId;
    const bWon = b.id === winnerId;
    if (aWon !== bWon) return aWon ? -1 : 1;
    return compareByCoinsThenProgress(a, b);
  });
}

function compareByProgressThenCoins(a: StandingPlayer, b: StandingPlayer): number {
  return b.position - a.position || b.coins - a.coins || a.name.localeCompare(b.name);
}

function compareByCoinsThenProgress(a: StandingPlayer, b: StandingPlayer): number {
  return b.coins - a.coins || b.position - a.position || a.name.localeCompare(b.name);
}
