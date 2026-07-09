import type { CharacterDef, GameContent, PlayerDef } from "@essence/shared";
import { characterDisplayName } from "@essence/shared/characters";
import { normalizeContentSchema } from "@essence/shared/contentValidation";
import { defaultTokenAnchor } from "../characterTokenRig";

const FACE_ANCHOR_IDS = ["leftEye", "rightEye", "mouth"] as const;
const BODY_ANCHOR_IDS = ["head", "chest", "leftHand", "rightHand", "back"] as const;
const LEGACY_DEFAULT_FACE_ANCHORS = {
  leftEye: { x: 0.42, y: 0.38, z: 0 },
  rightEye: { x: 0.58, y: 0.38, z: 0 },
  mouth: { x: 0.5, y: 0.62, z: 0 },
};
const LEGACY_DEFAULT_BODY_ANCHORS = {
  head: { x: 0.5, y: 0.09, z: 0 },
  chest: { x: 0.5, y: 0.44, z: 0 },
  leftHand: { x: 0.28, y: 0.46, z: 0 },
  rightHand: { x: 0.72, y: 0.46, z: 0 },
  back: { x: 0.5, y: 0.48, z: 0 },
};
const ANCHOR_EPSILON = 0.000000001;

export function contentWithCharacterList(input: unknown, baseContent: GameContent): GameContent {
  const imported = normalizeContentSchema(input);
  const characters = migrateLegacyDefaultAnchors(migrateLegacyHeadAnchors(imported.characters ?? {}));
  return normalizeContentSchema({
    ...baseContent,
    effects: imported.effects ?? baseContent.effects,
    characterTraits: imported.characterTraits ?? baseContent.characterTraits,
    players: playersForCharacters(characters, imported.players ?? baseContent.players ?? []),
    characters,
  });
}

function migrateLegacyDefaultAnchors(characters: Record<string, CharacterDef>): Record<string, CharacterDef> {
  return Object.fromEntries(
    Object.entries(characters).map(([id, character]) => {
      const faceAnchors = migrateAnchorSet(character.faceAnchors, LEGACY_DEFAULT_FACE_ANCHORS, FACE_ANCHOR_IDS);
      const bodyAnchors = migrateAnchorSet(character.bodyAnchors, LEGACY_DEFAULT_BODY_ANCHORS, BODY_ANCHOR_IDS);
      if (faceAnchors === character.faceAnchors && bodyAnchors === character.bodyAnchors) return [id, character];
      return [
        id,
        {
          ...character,
          faceAnchors,
          bodyAnchors,
        },
      ];
    })
  );
}

function migrateLegacyHeadAnchors(characters: Record<string, CharacterDef>): Record<string, CharacterDef> {
  return Object.fromEntries(
    Object.entries(characters).map(([id, character]) => {
      const head = character.bodyAnchors?.head;
      if (!head || !sameAnchor(head, { x: 0.5, y: 0.16, z: 0 })) return [id, character];
      return [
        id,
        {
          ...character,
          bodyAnchors: {
            ...(character.bodyAnchors ?? {}),
            head: defaultTokenAnchor("head"),
          },
        },
      ];
    })
  );
}

function migrateAnchorSet<const T extends readonly string[]>(
  anchors: CharacterDef["faceAnchors"],
  legacyDefaults: Record<T[number], { x: number; y: number; z: number }>,
  ids: T
) {
  if (!anchors) return anchors;
  let changed = false;
  const next = { ...anchors };
  for (const id of ids) {
    const anchorId = id as T[number];
    const current = anchors[anchorId];
    if (!current || !sameAnchor(current, legacyDefaults[anchorId])) continue;
    next[anchorId] = defaultTokenAnchor(anchorId);
    changed = true;
  }
  return changed ? next : anchors;
}

function sameAnchor(anchor: { x: number; y: number; z?: number; angle?: number }, expected: { x: number; y: number; z: number }) {
  return (
    Math.abs(anchor.x - expected.x) < ANCHOR_EPSILON &&
    Math.abs(anchor.y - expected.y) < ANCHOR_EPSILON &&
    Math.abs((anchor.z ?? 0) - expected.z) < ANCHOR_EPSILON &&
    Math.abs((anchor.angle ?? 0) - 0) < ANCHOR_EPSILON
  );
}

function playersForCharacters(characters: Record<string, CharacterDef>, players: PlayerDef[]): PlayerDef[] {
  const playersById = new Map(players.map((player) => [player.id, player]));
  return Object.entries(characters).map(([id, character]) => {
    const player = playersById.get(id);
    return {
      id,
      name: player?.name ?? characterDisplayName(character),
      groom: character.groom ?? player?.groom,
      color: character.color ?? player?.color,
    };
  });
}
