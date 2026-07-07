import type { CosmeticAnchorType, CosmeticAsset, CosmeticDef } from "./types";

export const FACE_COSMETIC_ANCHORS = ["leftEye", "rightEye", "mouth"] as const;
export const BODY_COSMETIC_ANCHORS = ["head", "chest", "leftHand", "rightHand", "back"] as const;

const BODY_ANCHORS = new Set<string>(BODY_COSMETIC_ANCHORS);
const DEFAULT_ANCHOR_BY_KIND: Record<string, { anchorType: CosmeticAnchorType; anchorId: string }> = {
  goggles: { anchorType: "face", anchorId: "leftEye" },
  mustache: { anchorType: "face", anchorId: "mouth" },
  beard: { anchorType: "face", anchorId: "mouth" },
  hat: { anchorType: "body", anchorId: "head" },
  piercing: { anchorType: "body", anchorId: "chest" },
  tattoo: { anchorType: "body", anchorId: "chest" },
  badge: { anchorType: "body", anchorId: "chest" },
  custom: { anchorType: "body", anchorId: "chest" },
};

interface LegacyCosmetic {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  slot?: unknown;
  cost?: unknown;
  color?: unknown;
}

type CosmeticImport = Partial<CosmeticDef> & LegacyCosmetic;

export function normalizeCosmeticCatalog(
  cosmetics: Record<string, CosmeticDef> | undefined,
  legacyCosmetics: unknown
): Record<string, CosmeticDef> {
  const normalized: Record<string, CosmeticDef> = {};
  if (Array.isArray(legacyCosmetics)) {
    for (const item of legacyCosmetics) {
      const cosmetic = normalizeCosmeticDef(item as CosmeticImport);
      if (cosmetic.id) normalized[cosmetic.id] = cosmetic;
    }
  }
  for (const [key, value] of Object.entries(cosmetics ?? {})) {
    const cosmetic = normalizeCosmeticDef(value as CosmeticImport, key);
    normalized[cosmetic.id] = cosmetic;
  }
  return normalized;
}

export function normalizeCosmeticDef(input: CosmeticImport, key?: string): CosmeticDef {
  const legacySlot = stringValue(input.slot);
  const id = stringValue(input.id) || key || nextCosmeticId(legacySlot);
  const asset = normalizeCosmeticAsset(input, legacySlot);
  const kind = cosmeticAssetKind({ ...input, id, name: stringValue(input.name) || id, asset } as CosmeticDef);
  const defaultAnchor = DEFAULT_ANCHOR_BY_KIND[kind] ?? DEFAULT_ANCHOR_BY_KIND.custom;
  const anchorId = stringValue(input.anchorId) || stringValue(input.anchor) || anchorIdForLegacySlot(legacySlot) || defaultAnchor.anchorId;
  const anchorType = input.anchorType ?? anchorTypeForAnchorId(anchorId, defaultAnchor.anchorType);
  const price = finiteNumber(input.price ?? input.cost, 0);
  const previewColor = stringValue(input.preview?.color) || stringValue(input.color) || colorFromAsset(asset, "color");
  const secondaryColor = stringValue(input.preview?.secondaryColor) || colorFromAsset(asset, "secondaryColor");

  return {
    ...input,
    id,
    name: stringValue(input.name) || humanizeId(id),
    description: stringValue(input.description) || undefined,
    price,
    asset,
    anchorType,
    anchorId,
    transform: input.transform ? { ...input.transform } : undefined,
    compatibility: input.compatibility
      ? {
          ...input.compatibility,
          characterIds: input.compatibility.characterIds ? [...input.compatibility.characterIds] : undefined,
          excludeCharacterIds: input.compatibility.excludeCharacterIds ? [...input.compatibility.excludeCharacterIds] : undefined,
          tags: input.compatibility.tags ? [...input.compatibility.tags] : undefined,
        }
      : undefined,
    preview: {
      ...(input.preview ?? {}),
      color: previewColor || undefined,
      secondaryColor: secondaryColor || undefined,
    },
    tags: input.tags ? [...input.tags] : undefined,
    assetId: stringValue(input.assetId) || kind,
    anchor: stringValue(input.anchor) || anchorId,
  };
}

export function cosmeticAssetKind(cosmetic: Pick<CosmeticDef, "asset" | "assetId">): string {
  if (typeof cosmetic.asset === "string") return cosmetic.asset;
  return stringValue(cosmetic.asset.kind) || stringValue(cosmetic.assetId) || "custom";
}

export function cosmeticPrice(cosmetic: Pick<CosmeticDef, "price">): number {
  return Math.max(0, finiteNumber(cosmetic.price, 0));
}

export function cosmeticAnchorType(cosmetic: Pick<CosmeticDef, "anchorType" | "anchorId">): CosmeticAnchorType {
  return cosmetic.anchorType ?? anchorTypeForAnchorId(cosmetic.anchorId, "body");
}

export function cosmeticAnchorId(cosmetic: Pick<CosmeticDef, "anchorId" | "anchor">): string {
  return stringValue(cosmetic.anchorId) || stringValue(cosmetic.anchor) || "chest";
}

export function isCosmeticCompatibleWithCharacter(
  cosmetic: Pick<CosmeticDef, "compatibility">,
  characterId: string
): boolean {
  const compatibility = cosmetic.compatibility;
  if (!compatibility) return true;
  if (compatibility.excludeCharacterIds?.includes(characterId)) return false;
  if (compatibility.characterIds?.length && !compatibility.characterIds.includes(characterId)) return false;
  return true;
}

export function uniqueCosmeticIds(ids: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids ?? []) {
    const trimmed = stringValue(id);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function normalizeCosmeticAsset(input: CosmeticImport, legacySlot: string): CosmeticAsset | string {
  if (typeof input.asset === "string" && input.asset.trim()) return input.asset.trim();
  if (isRecord(input.asset)) return { ...(input.asset as CosmeticAsset) };
  const kind = stringValue(input.assetId) || assetKindForLegacySlot(legacySlot) || "custom";
  const color = stringValue(input.color);
  return color ? { kind, color } : kind;
}

function assetKindForLegacySlot(slot: string): string {
  const normalized = slot.toLowerCase();
  if (normalized.includes("hat")) return "hat";
  if (normalized.includes("mustache") || normalized.includes("moustache")) return "mustache";
  if (normalized.includes("beard")) return "beard";
  if (normalized.includes("piercing")) return "piercing";
  if (normalized.includes("tattoo")) return "tattoo";
  return "";
}

function anchorIdForLegacySlot(slot: string): string {
  const normalized = slot.toLowerCase();
  if (normalized.includes("hat")) return "head";
  if (normalized.includes("mustache") || normalized.includes("moustache") || normalized.includes("beard")) return "mouth";
  if (normalized.includes("piercing") || normalized.includes("tattoo")) return "chest";
  return "";
}

function anchorTypeForAnchorId(anchorId: string, fallback: CosmeticAnchorType): CosmeticAnchorType {
  if (!anchorId) return fallback;
  if (BODY_ANCHORS.has(anchorId)) return "body";
  return "face";
}

function nextCosmeticId(slot: string): string {
  return `${slot || "cosmetic"}-${Math.random().toString(36).slice(2, 8)}`;
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function colorFromAsset(asset: CosmeticAsset | string, key: "color" | "secondaryColor"): string {
  return typeof asset === "string" ? "" : stringValue(asset[key]);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function humanizeId(id: string): string {
  return id
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
