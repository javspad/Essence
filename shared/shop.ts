import type { CharacterCosmeticDef, GameContent, ShopItemDef } from "./types";

export const DEFAULT_SHOP_ITEMS: ShopItemDef[] = [
  {
    id: "steroid-creatina-24hs",
    name: "Creatina 24hs",
    category: "steroid",
    cost: 12,
    color: "#a7f3d0",
    description: "Mejora permanente: un poco más alto y ancho.",
    effect: { type: "characterScale", heightDelta: 0.06, weightDelta: 0.04 },
  },
  {
    id: "steroid-anabolico-sospechoso",
    name: "Anabólico sospechoso",
    category: "steroid",
    cost: 18,
    color: "#f0abfc",
    description: "Mejora permanente fuerte: más presencia en el mapa.",
    effect: { type: "characterScale", heightDelta: 0.1, weightDelta: 0.08 },
  },
  {
    id: "weapon-palo-hockey",
    name: "Palo de hockey",
    category: "weapon",
    cost: 16,
    color: "#d6a15d",
    description: "Arma guardada: retrasa 2 casilleros a otro jugador cuando habilitemos uso de armas.",
    effect: { type: "weaponMove", target: "chosenOpponent", delta: -2 },
  },
  {
    id: "weapon-bomba-humo",
    name: "Bomba de humo",
    category: "weapon",
    cost: 11,
    color: "#94a3b8",
    description: "Arma guardada para molestar a otro jugador en una próxima interacción.",
    effect: { type: "weaponMove", target: "nextOpponent", delta: -1 },
  },
];

export function cosmeticShopItem(cosmetic: CharacterCosmeticDef): ShopItemDef {
  return {
    id: cosmetic.id,
    name: cosmetic.name,
    category: "cosmetic",
    cost: cosmetic.cost,
    color: cosmetic.color,
    description: cosmetic.description,
    effect: { type: "unlockCosmetic", cosmeticId: cosmetic.id },
  };
}

export function shopItemsForContent(content: Pick<GameContent, "characterCosmetics" | "shopItems">): ShopItemDef[] {
  const cosmeticItems = (content.characterCosmetics ?? []).map(cosmeticShopItem);
  const customItems = content.shopItems ?? [];
  const byId = new Map<string, ShopItemDef>();
  for (const item of [...cosmeticItems, ...DEFAULT_SHOP_ITEMS, ...customItems]) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}
