import type { GameState } from "@essence/shared";

export function normalizeGameState(state: GameState): GameState {
  return {
    ...state,
    lastBaseRoll: state.lastBaseRoll ?? state.lastRoll ?? null,
    lastMovement: state.lastMovement ?? state.lastRoll ?? null,
    activeEffects: Array.isArray(state.activeEffects) ? state.activeEffects : [],
    effects: state.effects ?? {},
    artifactCatalog: state.artifactCatalog ?? {},
    artifactRarities: state.artifactRarities,
    artifactRarityRates: state.artifactRarityRates,
    artifactShop: state.artifactShop ?? null,
    pendingArtifactUse: state.pendingArtifactUse ?? null,
  };
}
