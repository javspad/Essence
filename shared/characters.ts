import type {
  CharacterDef,
  CharacterSlot,
  GameContent,
  Player,
  PlayerDef,
} from "./types";
import { characterDefaultTraitSummaries } from "./traits";

export function playerDefToCharacter(def: PlayerDef): CharacterDef {
  return {
    id: def.id,
    displayName: def.name,
    groom: def.groom,
    color: def.color,
  };
}

export function characterDisplayName(character: Pick<CharacterDef, "id" | "displayName" | "name">): string {
  return character.displayName || character.name || character.id;
}

export function characterForContent(content: GameContent, characterId: string): CharacterDef | undefined {
  const authored = content.characters?.[characterId];
  if (authored) return authored;
  const legacy = content.players.find((player) => player.id === characterId);
  return legacy ? playerDefToCharacter(legacy) : undefined;
}

export function characterSlotsForContent(
  content: GameContent,
  players: Pick<Player, "id" | "connected">[] = []
): CharacterSlot[] {
  const characters =
    content.characters !== undefined
      ? Object.values(content.characters)
      : content.players.map((player) => playerDefToCharacter(player));

  return characters.map((character) => {
    const id = character.id;
    const claimed = players.find((player) => player.id === id);
    return {
      id,
      displayName: characterDisplayName(character),
      color: character.color ?? "#888888",
      groom: Boolean(character.groom),
      facePhoto: character.facePhoto,
      facePhotoAlignment: character.facePhotoAlignment ? { ...character.facePhotoAlignment } : undefined,
      faceAnchors: character.faceAnchors ? { ...character.faceAnchors } : undefined,
      bodyAnchors: character.bodyAnchors ? { ...character.bodyAnchors } : undefined,
      defaultLoadout: character.defaultLoadout
        ? {
            ...character.defaultLoadout,
            cosmeticIds: character.defaultLoadout.cosmeticIds ? [...character.defaultLoadout.cosmeticIds] : undefined,
          }
        : undefined,
      defaultTraits: characterDefaultTraitSummaries(content, character),
      claimedByPlayerId: claimed?.id,
      connected: claimed?.connected,
    };
  });
}
