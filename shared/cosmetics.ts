import type { CosmeticAnchorRef, CosmeticAnchorType, CosmeticAsset, CosmeticDef } from "./types";

export const FACE_COSMETIC_ANCHORS = ["leftEye", "rightEye", "mouth"] as const;
export const BODY_COSMETIC_ANCHORS = ["head", "chest", "leftHand", "rightHand", "back"] as const;

const BODY_ANCHORS = new Set<string>(BODY_COSMETIC_ANCHORS);
const COSMETIC_ANCHOR_TYPES = new Set<CosmeticAnchorType>(["face", "body", "token"]);
const FALLBACK_ANCHOR: CosmeticAnchorRef = { anchorType: "body", anchorId: "chest" };
const DEFAULT_ANCHORS_BY_KIND: Record<string, CosmeticAnchorRef[]> = {
  goggles: [
    { anchorType: "face", anchorId: "leftEye", label: "Left lens" },
    { anchorType: "face", anchorId: "rightEye", label: "Right lens" },
  ],
  mustache: [{ anchorType: "face", anchorId: "mouth" }],
  "mustache-handlebar": [{ anchorType: "face", anchorId: "mouth" }],
  "mustache-pencil": [{ anchorType: "face", anchorId: "mouth" }],
  beard: [{ anchorType: "face", anchorId: "mouth" }],
  hat: [{ anchorType: "body", anchorId: "head" }],
  "top-hat": [{ anchorType: "body", anchorId: "head" }],
  cap: [{ anchorType: "body", anchorId: "head" }],
  "field-hat": [{ anchorType: "body", anchorId: "head" }],
  "coin-crown": [{ anchorType: "body", anchorId: "head" }],
  "gold-chain": [{ anchorType: "body", anchorId: "chest" }],
  "dice-necklace": [{ anchorType: "body", anchorId: "chest" }],
  wristwatch: [{ anchorType: "body", anchorId: "rightHand" }],
  tuxedo: [{ anchorType: "body", anchorId: "chest" }],
  "pet-dog": [{ anchorType: "body", anchorId: "back" }],
  "pet-cat": [{ anchorType: "body", anchorId: "back" }],
  piercing: [{ anchorType: "body", anchorId: "chest" }],
  tattoo: [{ anchorType: "body", anchorId: "chest" }],
  badge: [{ anchorType: "body", anchorId: "chest" }],
  custom: [{ anchorType: "body", anchorId: "chest" }],
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
  const defaultAnchors = DEFAULT_ANCHORS_BY_KIND[kind] ?? DEFAULT_ANCHORS_BY_KIND.custom;
  const defaultAnchor = defaultAnchors[0] ?? FALLBACK_ANCHOR;
  const explicitAnchorId = stringValue(input.anchorId) || stringValue(input.anchor) || anchorIdForLegacySlot(legacySlot) || defaultAnchor.anchorId;
  const explicitAnchorType = safeAnchorType(input.anchorType) ?? anchorTypeForAnchorId(explicitAnchorId, defaultAnchor.anchorType);
  const anchors = normalizeAnchorRefs(input.anchors, { anchorType: explicitAnchorType, anchorId: explicitAnchorId }, defaultAnchors);
  const primaryAnchor = anchors[0] ?? { anchorType: explicitAnchorType, anchorId: explicitAnchorId };
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
    anchors,
    anchorType: primaryAnchor.anchorType,
    anchorId: primaryAnchor.anchorId,
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
    anchor: stringValue(input.anchor) || primaryAnchor.anchorId,
  };
}

export function cosmeticAssetKind(cosmetic: Pick<CosmeticDef, "asset" | "assetId">): string {
  if (typeof cosmetic.asset === "string") return cosmetic.asset;
  return stringValue(cosmetic.asset.kind) || stringValue(cosmetic.assetId) || "custom";
}

export function cosmeticPrice(cosmetic: Pick<CosmeticDef, "price">): number {
  return Math.max(0, finiteNumber(cosmetic.price, 0));
}

export function defaultCosmeticAnchorsForKind(kind: string): CosmeticAnchorRef[] {
  return (DEFAULT_ANCHORS_BY_KIND[kind] ?? DEFAULT_ANCHORS_BY_KIND.custom).map((anchor) => ({ ...anchor }));
}

export function cosmeticAnchorRefs(cosmetic: Pick<CosmeticDef, "anchorType" | "anchorId" | "anchor" | "anchors">): CosmeticAnchorRef[] {
  const primaryId = stringValue(cosmetic.anchorId) || stringValue(cosmetic.anchor) || "chest";
  const primary = {
    anchorType: safeAnchorType(cosmetic.anchorType) ?? anchorTypeForAnchorId(primaryId, "body"),
    anchorId: primaryId,
  };
  return normalizeAnchorRefs(cosmetic.anchors, primary, [primary]);
}

export function cosmeticAnchorType(cosmetic: Pick<CosmeticDef, "anchorType" | "anchorId" | "anchor" | "anchors">): CosmeticAnchorType {
  return cosmeticAnchorRefs(cosmetic)[0]?.anchorType ?? "body";
}

export function cosmeticAnchorId(cosmetic: Pick<CosmeticDef, "anchorType" | "anchorId" | "anchor" | "anchors">): string {
  return cosmeticAnchorRefs(cosmetic)[0]?.anchorId ?? "chest";
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

function normalizeAnchorRefs(
  anchors: readonly CosmeticAnchorRef[] | undefined,
  primary: CosmeticAnchorRef,
  defaults: readonly CosmeticAnchorRef[]
): CosmeticAnchorRef[] {
  const source = Array.isArray(anchors)
    ? anchors
    : sameAnchor(primary, defaults[0])
      ? defaults
      : [primary];
  const normalized: CosmeticAnchorRef[] = [];
  const seen = new Set<string>();

  for (const anchor of source) {
    const anchorId = stringValue(anchor?.anchorId) || stringValue((anchor as { anchor?: unknown } | undefined)?.anchor) || primary.anchorId;
    const anchorType = safeAnchorType(anchor?.anchorType) ?? anchorTypeForAnchorId(anchorId, primary.anchorType);
    const key = `${anchorType}:${anchorId}`;
    if (!anchorId || seen.has(key)) continue;
    seen.add(key);
    const label = stringValue(anchor?.label);
    normalized.push(label ? { anchorType, anchorId, label } : { anchorType, anchorId });
  }

  return normalized.length ? normalized : [primary];
}

function safeAnchorType(value: unknown): CosmeticAnchorType | undefined {
  return COSMETIC_ANCHOR_TYPES.has(value as CosmeticAnchorType) ? (value as CosmeticAnchorType) : undefined;
}

function sameAnchor(a: CosmeticAnchorRef | undefined, b: CosmeticAnchorRef | undefined): boolean {
  return Boolean(a && b && a.anchorType === b.anchorType && a.anchorId === b.anchorId);
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
