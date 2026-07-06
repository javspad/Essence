import type {
  CharacterDef,
  CharacterSetDef,
  CharacterSetSummary,
  CharacterSlot,
  GameContent,
  Player,
  PlayerDef,
} from "./types";

export const DEFAULT_CHARACTER_SET_ID = "default";

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

export function defaultCharacterSetForPlayers(players: PlayerDef[]): CharacterSetDef {
  return {
    id: DEFAULT_CHARACTER_SET_ID,
    name: "Default characters",
    characterIds: players.map((player) => player.id),
  };
}

export function resolveCharacterSet(content: GameContent, characterSetId?: string): CharacterSetDef {
  const sets = content.characterSets ?? {};
  if (characterSetId && sets[characterSetId]) return sets[characterSetId];
  if (sets[DEFAULT_CHARACTER_SET_ID]) return sets[DEFAULT_CHARACTER_SET_ID];
  const first = Object.values(sets)[0];
  if (first) return first;
  return defaultCharacterSetForPlayers(content.players);
}

export function characterForContent(content: GameContent, characterId: string): CharacterDef | undefined {
  const authored = content.characters?.[characterId];
  if (authored) return authored;
  const legacy = content.players.find((player) => player.id === characterId);
  return legacy ? playerDefToCharacter(legacy) : undefined;
}

export function characterSlotsForContent(
  content: GameContent,
  characterSetId?: string,
  players: Pick<Player, "id" | "connected">[] = []
): CharacterSlot[] {
  const set = resolveCharacterSet(content, characterSetId);
  return set.characterIds.map((id) => {
    const character = characterForContent(content, id) ?? {
      id,
      displayName: id,
    };
    const claimed = players.find((player) => player.id === id);
    return {
      id,
      displayName: characterDisplayName(character),
      color: character.color ?? "#888888",
      groom: Boolean(character.groom),
      facePhoto: character.facePhoto,
      faceAnchors: character.faceAnchors ? { ...character.faceAnchors } : undefined,
      bodyAnchors: character.bodyAnchors ? { ...character.bodyAnchors } : undefined,
      claimedByPlayerId: claimed?.id,
      connected: claimed?.connected,
    };
  });
}

export function characterSetSummaries(content: GameContent): CharacterSetSummary[] {
  const sets = content.characterSets ?? {
    [DEFAULT_CHARACTER_SET_ID]: defaultCharacterSetForPlayers(content.players),
  };
  return Object.values(sets).map((set) => ({
    id: set.id,
    name: set.name,
    characters: characterSlotsForContent(content, set.id),
  }));
}
