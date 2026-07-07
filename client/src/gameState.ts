import type { GameState } from "@essence/shared";

export function normalizeGameState(state: GameState): GameState {
  return {
    ...state,
    lastBaseRoll: state.lastBaseRoll ?? state.lastRoll ?? null,
    activeEffects: Array.isArray(state.activeEffects) ? state.activeEffects : [],
    effects: state.effects ?? {},
  };
}
