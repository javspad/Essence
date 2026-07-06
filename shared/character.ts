import type { CharacterBaseConfig, CharacterCosmeticDef, PlayerCharacter, PlayerDef } from "./types";

export const DEFAULT_CHARACTER_BASE: CharacterBaseConfig = {
  color: "#f59e0b",
  height: 1,
  weight: 1,
  movement: "walk",
  limbs: {
    arms: false,
    legs: false,
  },
};

export const DEFAULT_CHARACTER_COSMETICS: CharacterCosmeticDef[] = [
  {
    id: "hat-piluso",
    name: "Piluso de after",
    slot: "hat",
    cost: 8,
    color: "#facc15",
    description: "Sombrero comprable para cuando aparezca el shop del mapa.",
  },
  {
    id: "mustache-gala",
    name: "Bigote de gala",
    slot: "mustache",
    cost: 6,
    color: "#1f1307",
    description: "Bigote equipado sobre la placa de la cara.",
  },
  {
    id: "mustache-chaplin",
    name: "Bigote Chaplin",
    slot: "mustache",
    cost: 9,
    color: "#160b05",
    description: "Bigote corto de comedia muda para la cara del personaje.",
  },
  {
    id: "shirt-argentina-10",
    name: "Camiseta Argentina 10",
    slot: "shirt",
    cost: 14,
    color: "#75c7f0",
    description: "Camiseta celeste y blanca para jugar con mística.",
  },
  {
    id: "shoes-cancheras",
    name: "Zapatillas cancheras",
    slot: "shoes",
    cost: 8,
    color: "#f8fafc",
    description: "Zapatillas blancas para moverse por el mapa con facha.",
  },
  {
    id: "piercing-pezon-plata",
    name: "Piercing de pezones",
    slot: "nipplePiercing",
    cost: 10,
    color: "#dbeafe",
    description: "Dos aros plateados para el pecho del personaje.",
  },
  {
    id: "tattoo-rayo",
    name: "Tatuaje rayo",
    slot: "tattoo",
    cost: 7,
    color: "#111827",
    description: "Tatuaje visible en cuerpo o brazo, según la forma elegida.",
  },
];

export function clampCharacterNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export function normalizePlayerCharacter(input: PlayerCharacter | undefined, fallbackColor = DEFAULT_CHARACTER_BASE.color): PlayerCharacter {
  const base = input?.base;
  return {
    base: {
      color: base?.color ?? fallbackColor,
      height: clampCharacterNumber(base?.height, DEFAULT_CHARACTER_BASE.height, 0.75, 1.35),
      weight: clampCharacterNumber(base?.weight, DEFAULT_CHARACTER_BASE.weight, 0.75, 1.45),
      movement: base?.movement === "hop" ? "hop" : "walk",
      limbs: {
        arms: Boolean(base?.limbs?.arms),
        legs: Boolean(base?.limbs?.legs),
      },
    },
    unlockedCosmeticIds: [...(input?.unlockedCosmeticIds ?? [])],
    equippedCosmeticIds: { ...(input?.equippedCosmeticIds ?? {}) },
  };
}

export function characterForPlayerDef(player: PlayerDef): PlayerCharacter {
  return normalizePlayerCharacter(player.character, player.color ?? DEFAULT_CHARACTER_BASE.color);
}
