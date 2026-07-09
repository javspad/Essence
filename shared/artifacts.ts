import type {
  ArtifactDef,
  ArtifactOffer,
  ArtifactRarity,
  ArtifactRarityDef,
  ArtifactRarityRates,
  ArtifactTargetMode,
  ArtifactUseFlow,
  EventAction,
  GameContent,
} from "./types";

export const ARTIFACT_RARITIES: ArtifactRarity[] = ["common", "epic", "legendary"];
export const DEFAULT_ARTIFACT_RARITY_DEFS: Record<string, ArtifactRarityDef> = {
  common: { id: "common", name: "Common", weight: 70, color: "#34d399" },
  epic: { id: "epic", name: "Epic", weight: 25, color: "#d946ef" },
  legendary: { id: "legendary", name: "Legendary", weight: 5, color: "#fbbf24" },
};
export const DEFAULT_ARTIFACT_RARITY_RATES: ArtifactRarityRates = {
  common: 70,
  epic: 25,
  legendary: 5,
};
export const ARTIFACT_SHOP_OFFER_COUNT = 4;

export function artifactPrice(artifact: Pick<ArtifactDef, "price">): number {
  return Math.max(0, Math.round(Number.isFinite(artifact.price) ? artifact.price : 0));
}

export function artifactRarity(
  artifact: Pick<ArtifactDef, "rarity">,
  rarities: Record<string, ArtifactRarityDef> = DEFAULT_ARTIFACT_RARITY_DEFS
): ArtifactRarity {
  if (artifact.rarity && rarities[artifact.rarity]) return artifact.rarity;
  return Object.keys(rarities)[0] ?? "common";
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
  content: Pick<GameContent, "artifacts" | "artifactRarities" | "artifactRarityRates">,
  count = ARTIFACT_SHOP_OFFER_COUNT,
  visitId = "shop"
): ArtifactOffer[] {
  const catalog = Object.values(content.artifacts ?? {}).filter(isRollableArtifact);
  if (!catalog.length || count <= 0) return [];
  const rarities = artifactRarityDefinitions(content);
  const selected: ArtifactDef[] = [];

  for (let index = 0; index < count; index += 1) {
    const remaining = catalog.filter((artifact) => !selected.some((entry) => entry.id === artifact.id));
    const rarity = pickWeightedRarity(rarities);
    const rarityPool = remaining.filter((artifact) => artifactRarity(artifact, rarities) === rarity);
    const fallbackPool = remaining.length ? remaining : catalog;
    const pool = rarityPool.length ? rarityPool : fallbackPool;
    const artifact = pickArtifact(pool);
    if (!artifact) break;
    selected.push(artifact);
  }

  return selected.map((artifact, index) => ({
    id: `${visitId}-${index + 1}-${artifact.id}`,
    artifactId: artifact.id,
    price: artifactPrice(artifact),
    rarity: artifactRarity(artifact, rarities),
  }));
}

export function normalizeArtifactRarityRates(rates: ArtifactRarityRates | undefined): ArtifactRarityRates {
  return artifactRarityRatesFromDefinitions(artifactRarityDefinitions({ artifactRarityRates: rates }));
}

export function artifactRarityDefinitions(
  content?: Pick<GameContent, "artifacts" | "artifactRarities" | "artifactRarityRates">
): Record<string, ArtifactRarityDef> {
  const configured = content?.artifactRarities;
  const sourceEntries = configured && Object.keys(configured).length
    ? Object.entries(configured).map(([id, rarity]) => [
        id,
        {
          id: rarity.id || id,
          name: rarity.name || titleFromId(rarity.id || id),
          weight: numberOr(rarity.weight, DEFAULT_ARTIFACT_RARITY_DEFS[id]?.weight ?? 0),
          color: rarity.color || DEFAULT_ARTIFACT_RARITY_DEFS[id]?.color || colorForRarityId(id),
        } satisfies ArtifactRarityDef,
      ] as const)
    : Object.entries(DEFAULT_ARTIFACT_RARITY_DEFS).map(([id, rarity]) => [
        id,
        {
          ...rarity,
          weight: numberOr(content?.artifactRarityRates?.[id], rarity.weight),
        },
      ] as const);

  const rarities: Record<string, ArtifactRarityDef> = {};
  for (const [key, rarity] of sourceEntries) {
    const id = idFromRarity(rarity.id || key);
    if (!id) continue;
    rarities[id] = {
      ...rarity,
      id,
      name: rarity.name || titleFromId(id),
      color: rarity.color || colorForRarityId(id),
    };
  }

  for (const artifact of Object.values(content?.artifacts ?? {})) {
    const id = idFromRarity(artifact.rarity);
    if (!id || rarities[id]) continue;
    rarities[id] = { id, name: titleFromId(id), weight: 0, color: colorForRarityId(id) };
  }

  return Object.keys(rarities).length ? rarities : { ...DEFAULT_ARTIFACT_RARITY_DEFS };
}

export function artifactRarityRatesFromDefinitions(rarities: Record<string, ArtifactRarityDef>): ArtifactRarityRates {
  return Object.fromEntries(
    Object.entries(rarities).map(([id, rarity]) => [id, numberOr(rarity.weight, 0)])
  );
}

function isRollableArtifact(artifact: ArtifactDef): boolean {
  return Boolean(artifact.id && artifact.name);
}

function pickWeightedRarity(rarities: Record<string, ArtifactRarityDef>): ArtifactRarity {
  const entries = Object.values(rarities).map((rarity) => ({ rarity: rarity.id, weight: Math.max(0, rarity.weight) }));
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return entries[0]?.rarity ?? "common";
  let cursor = Math.random() * total;
  for (const entry of entries) {
    cursor -= entry.weight;
    if (cursor < 0) return entry.rarity;
  }
  return entries[entries.length - 1].rarity;
}

function pickArtifact(pool: ArtifactDef[]): ArtifactDef | null {
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)] ?? pool[0] ?? null;
}

function idFromRarity(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function titleFromId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ") || "Rarity";
}

function colorForRarityId(id: string): string {
  const palette = ["#34d399", "#60a5fa", "#d946ef", "#fbbf24", "#fb7185", "#a78bfa"];
  const hash = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palette[hash % palette.length] ?? "#34d399";
}

function numberOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}
