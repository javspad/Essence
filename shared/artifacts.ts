import type {
  ArtifactDef,
  ArtifactOffer,
  ArtifactRarity,
  ArtifactRarityRates,
  ArtifactTargetMode,
  ArtifactUseFlow,
  EventAction,
  GameContent,
} from "./types";

export const ARTIFACT_RARITIES: ArtifactRarity[] = ["common", "epic", "legendary"];
export const DEFAULT_ARTIFACT_RARITY_RATES: ArtifactRarityRates = {
  common: 70,
  epic: 25,
  legendary: 5,
};
export const ARTIFACT_SHOP_OFFER_COUNT = 4;

export function artifactPrice(artifact: Pick<ArtifactDef, "price">): number {
  return Math.max(0, Math.round(Number.isFinite(artifact.price) ? artifact.price : 0));
}

export function artifactRarity(artifact: Pick<ArtifactDef, "rarity">): ArtifactRarity {
  return ARTIFACT_RARITIES.includes(artifact.rarity) ? artifact.rarity : "common";
}

export function artifactTargetMode(artifact: Pick<ArtifactDef, "targetMode">): ArtifactTargetMode {
  if (artifact.targetMode === "none" || artifact.targetMode === "self" || artifact.targetMode === "choosePlayer") {
    return artifact.targetMode;
  }
  return "self";
}

export function artifactUseFlow(artifact: Pick<ArtifactDef, "targetMode" | "useFlow">): ArtifactUseFlow {
  if (artifact.useFlow === "immediate" || artifact.useFlow === "targeted") return artifact.useFlow;
  return artifactTargetMode(artifact) === "choosePlayer" ? "targeted" : "immediate";
}

export function artifactRequiresTarget(artifact: Pick<ArtifactDef, "targetMode">): boolean {
  return artifactTargetMode(artifact) === "choosePlayer";
}

export function artifactShopWeight(artifact: Pick<ArtifactDef, "weightOverrides" | "shopWeight">): number {
  const override = artifact.weightOverrides?.shop ?? artifact.shopWeight ?? 1;
  return Number.isFinite(override) ? Math.max(0, override) : 1;
}

export function artifactActionsForUse(artifact: Pick<ArtifactDef, "consequences" | "effects">): EventAction[] {
  const consequences = artifact.consequences?.map((action) => ({ ...action })) ?? [];
  const effectActions = (artifact.effects ?? []).map((effectId) => ({
    type: "applyEffect" as const,
    effectId,
    target: "target" as const,
  }));
  return [...consequences, ...effectActions];
}

export function validArtifactTargetIds(
  artifact: Pick<ArtifactDef, "targetMode">,
  playerIds: string[],
  actingPlayerId: string
): string[] {
  const mode = artifactTargetMode(artifact);
  if (mode === "none") return [];
  if (mode === "self") return playerIds.includes(actingPlayerId) ? [actingPlayerId] : [];
  return [...playerIds];
}

export function rollArtifactShopOffers(
  content: Pick<GameContent, "artifacts" | "artifactRarityRates">,
  count = ARTIFACT_SHOP_OFFER_COUNT,
  visitId = "shop"
): ArtifactOffer[] {
  const catalog = Object.values(content.artifacts ?? {}).filter(isRollableArtifact);
  if (!catalog.length || count <= 0) return [];
  const rates = normalizeArtifactRarityRates(content.artifactRarityRates);
  const selected: ArtifactDef[] = [];

  for (let index = 0; index < count; index += 1) {
    const remaining = catalog.filter((artifact) => !selected.some((entry) => entry.id === artifact.id));
    const rarity = pickWeightedRarity(rates);
    const rarityPool = remaining.filter((artifact) => artifactRarity(artifact) === rarity);
    const fallbackPool = remaining.length ? remaining : catalog;
    const pool = rarityPool.length ? rarityPool : fallbackPool;
    const artifact = pickWeightedArtifact(pool);
    if (!artifact) break;
    selected.push(artifact);
  }

  return selected.map((artifact, index) => ({
    id: `${visitId}-${index + 1}-${artifact.id}`,
    artifactId: artifact.id,
    price: artifactPrice(artifact),
    rarity: artifactRarity(artifact),
  }));
}

export function normalizeArtifactRarityRates(rates: ArtifactRarityRates | undefined): ArtifactRarityRates {
  if (!rates) return { ...DEFAULT_ARTIFACT_RARITY_RATES };
  return {
    common: nonnegativeRate(rates.common, DEFAULT_ARTIFACT_RARITY_RATES.common),
    epic: nonnegativeRate(rates.epic, DEFAULT_ARTIFACT_RARITY_RATES.epic),
    legendary: nonnegativeRate(rates.legendary, DEFAULT_ARTIFACT_RARITY_RATES.legendary),
  };
}

function isRollableArtifact(artifact: ArtifactDef): boolean {
  return Boolean(artifact.id && artifact.name && artifactShopWeight(artifact) > 0);
}

function pickWeightedRarity(rates: ArtifactRarityRates): ArtifactRarity {
  const entries = ARTIFACT_RARITIES.map((rarity) => ({ rarity, weight: Math.max(0, rates[rarity]) }));
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return "common";
  let cursor = Math.random() * total;
  for (const entry of entries) {
    cursor -= entry.weight;
    if (cursor < 0) return entry.rarity;
  }
  return entries[entries.length - 1].rarity;
}

function pickWeightedArtifact(pool: ArtifactDef[]): ArtifactDef | null {
  const weighted = pool.map((artifact) => ({ artifact, weight: artifactShopWeight(artifact) }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return pool[0] ?? null;
  let cursor = Math.random() * total;
  for (const entry of weighted) {
    cursor -= entry.weight;
    if (cursor < 0) return entry.artifact;
  }
  return weighted[weighted.length - 1]?.artifact ?? null;
}

function nonnegativeRate(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}
