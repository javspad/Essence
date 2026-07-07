import type { GameState } from "@essence/shared";

export function normalizeGameState(state: GameState): GameState {
  return {
    ...state,
    activeEffects: Array.isArray(state.activeEffects) ? state.activeEffects : [],
    effects: state.effects ?? {},
    devSettings: state.devSettings ?? { skipMinigames: false },
  };
}
