import type {
  ArtifactDef,
  ArtifactRarityRates,
  CharacterDef,
  CharacterTraitDef,
  CosmeticDef,
  EffectDef,
  EffectDuration,
  EffectModifier,
  EventAction,
  EventActionTarget,
  EventOutcomeBranch,
  FaceAnchor,
  GameContent,
  GameEventDef,
  MapBoardShape,
  MapDefinition,
  MapProp,
  MapRoute,
  MapTerrace,
  PlayerDef,
  Tile,
} from "./types";
import { TILE_TYPES } from "./types";
import { EVENT_ACTIVITY_TYPES, normalizeGameContentEvents } from "./events";
import { playerDefToCharacter } from "./characters";
import { ARTIFACT_RARITIES, artifactPrice, artifactShopWeight } from "./artifacts";
import {
  cosmeticAnchorId,
  cosmeticAnchorRefs,
  cosmeticAnchorType,
  cosmeticPrice,
  normalizeCosmeticCatalog,
  normalizeCosmeticDef,
} from "./cosmetics";
import { z } from "zod";

export type ContentValidationSeverity = "error" | "warning";

export interface ContentValidationIssue {
  severity: ContentValidationSeverity;
  path: string;
  message: string;
}

export interface ContentValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  issues: ContentValidationIssue[];
}

type MapDefinitionImport = Omit<MapDefinition, "artifacts"> & {
  artifacts?: MapProp[];
  mapProps?: MapProp[];
};

const FaceAnchorSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite().optional(),
  angle: z.number().finite().optional(),
});

const FacePhotoAlignmentSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  scale: z.number().finite().positive(),
  angle: z.number().finite().optional(),
});

const CharacterLoadoutSchema = z
  .object({
    cosmeticIds: z.array(z.string()).optional(),
  })
  .passthrough();

const CharacterDefSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    name: z.string().optional(),
    color: z.string().optional(),
    groom: z.boolean().optional(),
    facePhoto: z.string().optional(),
    facePhotoAlignment: FacePhotoAlignmentSchema.optional(),
    faceAnchors: z.record(FaceAnchorSchema).optional(),
    bodyAnchors: z.record(FaceAnchorSchema).optional(),
    defaultLoadout: CharacterLoadoutSchema.optional(),
    defaultCosmetics: z.array(z.string()).optional(),
    defaultTraits: z.array(z.string()).optional(),
  })
  .passthrough();

const CharacterTraitDefSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    effectId: z.string().min(1),
    icon: z.string().optional(),
  })
  .passthrough();

const CosmeticAssetSchema = z.union([
  z.string().min(1),
  z
    .object({
      kind: z.string().min(1),
      color: z.string().optional(),
      secondaryColor: z.string().optional(),
      src: z.string().optional(),
      label: z.string().optional(),
    })
    .passthrough(),
]);

const CosmeticTransformSchema = z
  .object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    z: z.number().finite().optional(),
    scale: z.number().finite().positive().optional(),
    scaleX: z.number().finite().positive().optional(),
    scaleY: z.number().finite().positive().optional(),
    scaleZ: z.number().finite().positive().optional(),
    rotation: z.number().finite().optional(),
    rotationX: z.number().finite().optional(),
    rotationY: z.number().finite().optional(),
    rotationZ: z.number().finite().optional(),
  })
  .passthrough();

const CosmeticAnchorRefSchema = z
  .object({
    anchorType: z.enum(["face", "body", "token"]),
    anchorId: z.string().min(1),
    label: z.string().optional(),
  })
  .passthrough();

const CosmeticCompatibilitySchema = z
  .object({
    characterIds: z.array(z.string().min(1)).optional(),
    excludeCharacterIds: z.array(z.string().min(1)).optional(),
    tags: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

const CosmeticPreviewSchema = z
  .object({
    color: z.string().optional(),
    secondaryColor: z.string().optional(),
    label: z.string().optional(),
    order: z.number().finite().optional(),
  })
  .passthrough();

const CosmeticDefSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    price: z.number().finite().nonnegative(),
    asset: CosmeticAssetSchema,
    anchors: z.array(CosmeticAnchorRefSchema).min(1).optional(),
    anchorType: z.enum(["face", "body", "token"]),
    anchorId: z.string().min(1),
    transform: CosmeticTransformSchema.optional(),
    compatibility: CosmeticCompatibilitySchema.optional(),
    preview: CosmeticPreviewSchema.optional(),
    tags: z.array(z.string().min(1)).optional(),
    assetId: z.string().optional(),
    anchor: z.string().optional(),
  })
  .passthrough();

const ArtifactRarityRatesSchema = z
  .object({
    common: z.number().finite().nonnegative(),
    epic: z.number().finite().nonnegative(),
    legendary: z.number().finite().nonnegative(),
  })
  .passthrough();

const ArtifactVisualSchema = z
  .object({
    assetId: z.string().min(1).optional(),
    anchorType: z.enum(["face", "body", "token"]).optional(),
    anchorId: z.string().min(1).optional(),
    label: z.string().optional(),
    color: z.string().optional(),
  })
  .passthrough();

const ArtifactAnimationSchema = z
  .object({
    outgoing: z.string().min(1).optional(),
    incoming: z.string().min(1).optional(),
  })
  .passthrough();

const ArtifactWeightOverridesSchema = z
  .object({
    shop: z.number().finite().nonnegative().optional(),
  })
  .passthrough();

const ArtifactDefSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    price: z.number().finite().nonnegative(),
    rarity: z.enum(["common", "epic", "legendary"]),
    targetMode: z.enum(["none", "self", "choosePlayer"]),
    useFlow: z.enum(["immediate", "targeted"]).optional(),
    target: z.any().optional(),
    consequences: z.array(z.any()).optional(),
    effects: z.array(z.string().min(1)).optional(),
    visual: ArtifactVisualSchema.optional(),
    animations: ArtifactAnimationSchema.optional(),
    weightOverrides: ArtifactWeightOverridesSchema.optional(),
    visualAssetId: z.string().optional(),
    shopWeight: z.number().finite().nonnegative().optional(),
  })
  .passthrough();

const TILE_TYPE_SET = new Set<string>(TILE_TYPES);

export function normalizeContentSchema(input: unknown): GameContent {
  const content = input as GameContent;
  const normalized = normalizeGameContentEvents(content);
  const { characterSets: _legacyCharacterSets, ...contentWithoutCharacterSets } = normalized as GameContent & {
    characterSets?: unknown;
  };
  const players = clonePlayers(normalized.players ?? []);
  const characters = normalizeCharacters(normalized.characters, players);
  const cosmetics = normalizeCosmeticCatalog(normalized.cosmetics, normalized.characterCosmetics);
  return {
    ...contentWithoutCharacterSets,
    players,
    characters,
    characterTraits: cloneCharacterTraits(normalized.characterTraits),
    effects: cloneEffects(normalized.effects),
    cosmetics: cloneCosmetics(cosmetics),
    artifactRarityRates: normalized.artifactRarityRates ? { ...normalized.artifactRarityRates } : undefined,
    artifacts: cloneArtifacts(normalized.artifacts),
    board: cloneTiles(normalized.board),
    maps: normalized.maps?.map((map) => normalizeMapDefinition(map as MapDefinitionImport)),
    assetCatalog: normalized.assetCatalog?.map((asset) => ({
      ...asset,
      footprint: asset.footprint ? { ...asset.footprint } : undefined,
      projection: asset.projection
        ? {
            ...asset.projection,
            bounds: asset.projection.bounds ? { ...asset.projection.bounds } : undefined,
            points: asset.projection.points?.map((point) => ({ ...point })),
          }
        : undefined,
      tags: asset.tags ? [...asset.tags] : undefined,
    })),
  };
}

export function validateGameContent(content: unknown): ContentValidationResult {
  const normalized = normalizeContentSchema(content);
  const issues: ContentValidationIssue[] = [];
  const error = (path: string, message: string) => issues.push({ severity: "error", path, message });
  const warning = (path: string, message: string) => issues.push({ severity: "warning", path, message });

  const legacyPlayerIds = validatePlayers(normalized.players, error);
  const characterIds = validateCharacters(normalized.characters, error);
  const playerIds = new Set([...legacyPlayerIds, ...characterIds]);
  const assetIds = validateAssetCatalog(normalized, error);
  const effectIds = new Set(Object.keys(normalized.effects ?? {}));
  const traitIds = validateCharacterTraits(normalized.characterTraits, effectIds, error);

  for (const [id, event] of Object.entries(normalized.events ?? {})) {
    validateEvent(`events.${id}`, event, playerIds, effectIds, error);
  }

  validateCatalogIds(normalized.cosmetics, "cosmetics", error);
  validateCosmetics(normalized.cosmetics, characterIds, error, warning);
  validateCatalogIds(normalized.characterTraits, "characterTraits", error);
  validateArtifactRarityRates(normalized.artifactRarityRates, error);
  validateCatalogIds(normalized.artifacts, "artifacts", error);
  validateArtifacts(normalized.artifacts, playerIds, effectIds, error);
  validateCatalogIds(normalized.effects, "effects", error);
  validateFutureCatalogReferences(normalized, traitIds, error, warning);

  const maps = normalized.maps ?? [
    {
      id: "board",
      name: "Board",
      board: normalized.board,
      routes: createLinearRoutes(normalized.board),
      artifacts: [],
      mapProps: [],
    },
  ];
  if (normalized.activeMapId && normalized.maps?.length && !maps.some((map) => map.id === normalized.activeMapId)) {
    error("activeMapId", `references missing map ${normalized.activeMapId}`);
  }
  for (const map of maps) {
    validateMapDefinition(map, assetIds, error);
  }

  const errors = issues.filter((issue) => issue.severity === "error").map(formatIssue);
  const warnings = issues.filter((issue) => issue.severity === "warning").map(formatIssue);
  return { ok: errors.length === 0, errors, warnings, issues };
}

export function assertValidGameContent(content: unknown, label = "content.json"): GameContent {
  const normalized = normalizeContentSchema(content);
  const result = validateGameContent(normalized);
  if (!result.ok) {
    throw new Error(`${label}:\n${result.errors.map((line) => `  - ${line}`).join("\n")}`);
  }
  return normalized;
}

function normalizeMapDefinition(map: MapDefinitionImport): MapDefinition {
  const mapProps = cloneMapProps(map.mapProps ?? map.artifacts ?? []);
  return {
    ...map,
    board: cloneTiles(map.board),
    routes: cloneRoutes(map.routes ?? []),
    artifacts: cloneMapProps(mapProps),
    mapProps: cloneMapProps(mapProps),
    terraces: map.terraces?.map((terrace) => ({ ...terrace })),
    boardShape: cloneBoardShape(map.boardShape),
    theme: map.theme ? { ...map.theme } : undefined,
  };
}

function validatePlayers(players: PlayerDef[], error: (path: string, message: string) => void): Set<string> {
  const ids = new Set<string>();
  if (!players.length) error("players", "must include at least one player slot");
  for (const player of players) {
    if (!player.id) {
      error("players", "contains a player with no id");
      continue;
    }
    if (ids.has(player.id)) error(`players.${player.id}`, "is duplicated");
    ids.add(player.id);
    if (!player.name?.trim()) error(`players.${player.id}.name`, "must not be empty");
  }
  return ids;
}

function validateCharacters(
  characters: Record<string, CharacterDef> | undefined,
  error: (path: string, message: string) => void
): Set<string> {
  const ids = new Set<string>();
  for (const [id, character] of Object.entries(characters ?? {})) {
    if (ids.has(id)) error(`characters.${id}`, "is duplicated");
    ids.add(id);
    const result = CharacterDefSchema.safeParse(character);
    if (!result.success) {
      for (const issue of result.error.issues) {
        error(zodPath(`characters.${id}`, issue.path), issue.message);
      }
    }
    if (character.id && character.id !== id) error(`characters.${id}.id`, `must match catalog key ${id}`);
  }
  return ids;
}

function validateCharacterTraits(
  traits: Record<string, CharacterTraitDef> | undefined,
  effectIds: Set<string>,
  error: (path: string, message: string) => void
): Set<string> {
  const ids = new Set<string>();
  for (const [id, trait] of Object.entries(traits ?? {})) {
    if (ids.has(id)) error(`characterTraits.${id}`, "is duplicated");
    ids.add(id);
    const result = CharacterTraitDefSchema.safeParse(trait);
    if (!result.success) {
      for (const issue of result.error.issues) {
        error(zodPath(`characterTraits.${id}`, issue.path), issue.message);
      }
    }
    if (trait.id && trait.id !== id) error(`characterTraits.${id}.id`, `must match catalog key ${id}`);
    if (trait.effectId && !effectIds.has(trait.effectId)) {
      error(`characterTraits.${id}.effectId`, `references missing effect ${trait.effectId}`);
    }
  }
  return ids;
}

function validateAssetCatalog(content: GameContent, error: (path: string, message: string) => void): Set<string> {
  const ids = new Set<string>();
  for (const asset of content.assetCatalog ?? []) {
    if (!asset.id) {
      error("assetCatalog", "contains an asset with no id");
      continue;
    }
    if (ids.has(asset.id)) error(`assetCatalog.${asset.id}`, "is duplicated");
    ids.add(asset.id);
    if (!asset.name?.trim()) error(`assetCatalog.${asset.id}.name`, "must not be empty");
  }
  return ids;
}

function validateEvent(
  path: string,
  event: GameEventDef,
  playerIds: Set<string>,
  effectIds: Set<string>,
  error: (path: string, message: string) => void
) {
  if (!event.name?.trim()) error(`${path}.name`, "must not be empty");
  if (event.trigger?.type === "player" && !playerIds.has(event.trigger.playerId)) {
    error(`${path}.trigger.playerId`, `references missing player ${event.trigger.playerId}`);
  }
  if (event.activity && !EVENT_ACTIVITY_TYPES.includes(event.activity.type)) {
    error(`${path}.activity.type`, `is not supported: ${event.activity.type}`);
  }
  event.actions?.forEach((action, index) => validateAction(`${path}.actions[${index}]`, action, playerIds, effectIds, error));
  event.outcomes?.forEach((outcome, index) => validateOutcome(`${path}.outcomes[${index}]`, outcome, playerIds, effectIds, error));
}

function validateOutcome(
  path: string,
  outcome: EventOutcomeBranch,
  playerIds: Set<string>,
  effectIds: Set<string>,
  error: (path: string, message: string) => void
) {
  validateTarget(`${path}.when`, outcome.when, playerIds, error);
  outcome.actions.forEach((action, index) => validateAction(`${path}.actions[${index}]`, action, playerIds, effectIds, error));
}

function validateAction(
  path: string,
  action: EventAction,
  playerIds: Set<string>,
  effectIds: Set<string>,
  error: (path: string, message: string) => void
) {
  if ("target" in action && action.target) validateTarget(`${path}.target`, action.target, playerIds, error);
  if (action.type === "coins" && !Number.isFinite(action.value)) error(`${path}.value`, "must be a finite number");
  if (action.type === "move" && !Number.isFinite(action.delta)) error(`${path}.delta`, "must be a finite number");
  if (action.type === "moveTo" && !Number.isInteger(action.tileId)) error(`${path}.tileId`, "must be an integer board cell id");
  if (action.type === "applyEffect" && !effectIds.has(action.effectId)) error(`${path}.effectId`, `references missing effect ${action.effectId}`);
  if (action.type === "movementMultiplier") {
    if (!Number.isFinite(action.multiplier) || action.multiplier < 0) error(`${path}.multiplier`, "must be a non-negative finite number");
  }
  if (action.type === "diceBias") {
    if (!Number.isInteger(action.face) || action.face < 1 || action.face > 6) error(`${path}.face`, "must be an integer from 1 to 6");
    if (!Number.isFinite(action.chanceDeltaPercent)) error(`${path}.chanceDeltaPercent`, "must be a finite number");
  }
  if (action.duration) validateDuration(`${path}.duration`, action.duration, error);
  if (action.type === "offlineAction" && !action.action) error(`${path}.action`, "must not be empty");
  if (action.type === "swapPositions") validateTarget(`${path}.withTarget`, action.withTarget, playerIds, error);
  if (action.type === "moveToNearest" && action.direction !== "ahead" && action.direction !== "behind") {
    error(`${path}.direction`, "must be ahead or behind");
  }
  if (action.when) validateCondition(`${path}.when`, action.when, error);
}

function validateDuration(path: string, duration: EffectDuration | undefined, error: (path: string, message: string) => void) {
  if (!duration) return;
  if ((duration.mode === "turns" || duration.mode === "rounds" || duration.mode === "uses") && (!Number.isInteger(duration.value) || duration.value < 1)) {
    error(`${path}.value`, "must be a positive integer");
  }
}

function validateCondition(path: string, condition: NonNullable<EventAction["when"]>, error: (path: string, message: string) => void) {
  if (condition.rollEquals !== undefined && !Number.isFinite(condition.rollEquals)) error(`${path}.rollEquals`, "must be finite");
  if (condition.rollGte !== undefined && !Number.isFinite(condition.rollGte)) error(`${path}.rollGte`, "must be finite");
  if (condition.rollLte !== undefined && !Number.isFinite(condition.rollLte)) error(`${path}.rollLte`, "must be finite");
  if (condition.movementGte !== undefined && !Number.isFinite(condition.movementGte)) error(`${path}.movementGte`, "must be finite");
  if (condition.movementLte !== undefined && !Number.isFinite(condition.movementLte)) error(`${path}.movementLte`, "must be finite");
  if (condition.consecutiveRolls) {
    if (!Number.isInteger(condition.consecutiveRolls.count) || condition.consecutiveRolls.count < 1) error(`${path}.consecutiveRolls.count`, "must be a positive integer");
    if (condition.consecutiveRolls.atLeast !== undefined && !Number.isFinite(condition.consecutiveRolls.atLeast)) error(`${path}.consecutiveRolls.atLeast`, "must be finite");
    if (condition.consecutiveRolls.atMost !== undefined && !Number.isFinite(condition.consecutiveRolls.atMost)) error(`${path}.consecutiveRolls.atMost`, "must be finite");
  }
  if (condition.movementTotal) {
    if (!Number.isInteger(condition.movementTotal.turns) || condition.movementTotal.turns < 1) error(`${path}.movementTotal.turns`, "must be a positive integer");
    if (condition.movementTotal.lte !== undefined && !Number.isFinite(condition.movementTotal.lte)) error(`${path}.movementTotal.lte`, "must be finite");
    if (condition.movementTotal.gte !== undefined && !Number.isFinite(condition.movementTotal.gte)) error(`${path}.movementTotal.gte`, "must be finite");
  }
  if (condition.cellTagsAny && !condition.cellTagsAny.every((tag) => tag.trim())) error(`${path}.cellTagsAny`, "must include non-empty tags");
}

function validateTarget(
  path: string,
  target: EventActionTarget,
  playerIds: Set<string>,
  error: (path: string, message: string) => void
) {
  if (typeof target === "string") return;
  if ("playerId" in target) {
    if (!playerIds.has(target.playerId)) error(path, `references missing player ${target.playerId}`);
    return;
  }
  if ("rank" in target) {
    if (!Number.isInteger(target.rank) || target.rank < 1) error(path, "rank must be a positive integer");
    return;
  }
  if ("nearest" in target) {
    if (target.nearest !== "ahead" && target.nearest !== "behind") error(path, "nearest must be ahead or behind");
    if (typeof target.from === "object" && !playerIds.has(target.from.playerId)) error(`${path}.from`, `references missing player ${target.from.playerId}`);
    return;
  }
  if (!Number.isInteger(target.rankFrom) || !Number.isInteger(target.rankTo) || target.rankFrom < 1 || target.rankTo < target.rankFrom) {
    error(path, "rank range must be positive and ordered");
  }
}

function validateMapDefinition(
  map: MapDefinition,
  assetIds: Set<string>,
  error: (path: string, message: string) => void
) {
  const path = `maps.${map.id}`;
  if (!map.id) error("maps", "contains a map with no id");
  if (!map.name?.trim()) error(`${path}.name`, "must not be empty");

  const tileIds = new Set<number>();
  for (const tile of map.board) {
    if (tileIds.has(tile.id)) error(`${path}.board.${tile.id}`, "is duplicated");
    tileIds.add(tile.id);
    validateTile(`${path}.board.${tile.id}`, tile, error);
  }

  for (const route of map.routes) {
    validateRoute(`${path}.routes.${route.id}`, route, tileIds, error);
  }

  if (!map.board.some((tile) => tile.type === "start")) error(`${path}.board`, "must include a start cell");
  if (!map.board.some((tile) => tile.type === "finish")) error(`${path}.board`, "must include a finish cell");

  validateMapProps(path, map.artifacts, assetIds, error);
  validateTerraces(path, map.terraces ?? [], error);
  validateBoardShape(path, map.boardShape, map.board, error);
}

function validateTile(path: string, tile: Tile, error: (path: string, message: string) => void) {
  if (!Number.isInteger(tile.id)) error(`${path}.id`, "must be an integer");
  if (!TILE_TYPE_SET.has(tile.type)) error(`${path}.type`, `is not supported: ${tile.type}`);
  if (!tile.layout) {
    error(`${path}.layout`, "is required");
    return;
  }
  if (!Number.isFinite(tile.layout.x) || !Number.isFinite(tile.layout.y)) {
    error(`${path}.layout`, "must include finite x and y coordinates");
  }
}

function validateRoute(
  path: string,
  route: MapRoute,
  tileIds: Set<number>,
  error: (path: string, message: string) => void
) {
  if (!route.id) error(path, "must include an id");
  if (!tileIds.has(route.from)) error(`${path}.from`, `references missing board cell ${route.from}`);
  if (!tileIds.has(route.to)) error(`${path}.to`, `references missing board cell ${route.to}`);
}

function validateMapProps(
  mapPath: string,
  mapProps: MapProp[],
  assetIds: Set<string>,
  error: (path: string, message: string) => void
) {
  const ids = new Set<string>();
  for (const prop of mapProps) {
    if (ids.has(prop.id)) error(`${mapPath}.mapProps.${prop.id}`, "is duplicated");
    ids.add(prop.id);
    if (!assetIds.has(prop.assetId)) error(`${mapPath}.mapProps.${prop.id}`, `references missing asset ${prop.assetId}`);
    if (!Number.isFinite(prop.position.x) || !Number.isFinite(prop.position.y)) {
      error(`${mapPath}.mapProps.${prop.id}.position`, "must include finite x and y coordinates");
    }
  }
}

function validateTerraces(
  mapPath: string,
  terraces: MapTerrace[],
  error: (path: string, message: string) => void
) {
  const ids = new Set<string>();
  for (const terrace of terraces) {
    if (ids.has(terrace.id)) error(`${mapPath}.terraces.${terrace.id}`, "is duplicated");
    ids.add(terrace.id);
    if (terrace.minX > terrace.maxX || terrace.minY > terrace.maxY) {
      error(`${mapPath}.terraces.${terrace.id}`, "has an invalid rectangle");
    }
    if (!Number.isFinite(terrace.elevation) || terrace.elevation < 0) {
      error(`${mapPath}.terraces.${terrace.id}.elevation`, "must be a non-negative number");
    }
  }
}

function validateBoardShape(
  mapPath: string,
  boardShape: MapBoardShape | undefined,
  board: Tile[],
  error: (path: string, message: string) => void
) {
  if (!boardShape) return;
  if (boardShape.minX > boardShape.maxX || boardShape.minY > boardShape.maxY) {
    error(`${mapPath}.boardShape`, "has invalid bounds");
    return;
  }
  for (const tile of board) {
    const layout = tile.layout;
    if (!layout) continue;
    if (layout.x < boardShape.minX || layout.x > boardShape.maxX || layout.y < boardShape.minY || layout.y > boardShape.maxY) {
      error(`${mapPath}.board.${tile.id}.layout`, "is outside boardShape");
    }
  }
}

function validateCatalogIds<T extends { id: string }>(
  catalog: Record<string, T> | undefined,
  path: string,
  error: (path: string, message: string) => void
) {
  for (const [id, def] of Object.entries(catalog ?? {})) {
    if (!def.id) error(`${path}.${id}.id`, "must not be empty");
    if (def.id && def.id !== id) error(`${path}.${id}.id`, `must match catalog key ${id}`);
  }
}

function validateArtifactRarityRates(
  rates: ArtifactRarityRates | undefined,
  error: (path: string, message: string) => void
) {
  if (!rates) return;
  const result = ArtifactRarityRatesSchema.safeParse(rates);
  if (!result.success) {
    for (const issue of result.error.issues) {
      error(zodPath("artifactRarityRates", issue.path), issue.message);
    }
    return;
  }
  const total = ARTIFACT_RARITIES.reduce((sum, rarity) => sum + rates[rarity], 0);
  if (total <= 0) error("artifactRarityRates", "must include at least one positive rarity rate");
}

function validateArtifacts(
  artifacts: Record<string, ArtifactDef> | undefined,
  playerIds: Set<string>,
  effectIds: Set<string>,
  error: (path: string, message: string) => void
) {
  for (const [id, artifact] of Object.entries(artifacts ?? {})) {
    const result = ArtifactDefSchema.safeParse(artifact);
    if (!result.success) {
      for (const issue of result.error.issues) {
        error(zodPath(`artifacts.${id}`, issue.path), issue.message);
      }
    }
    if (artifact.id && artifact.id !== id) error(`artifacts.${id}.id`, `must match catalog key ${id}`);
    if (artifactPrice(artifact) < 0) error(`artifacts.${id}.price`, "must be non-negative");
    if (artifactShopWeight(artifact) < 0) error(`artifacts.${id}.weightOverrides.shop`, "must be non-negative");
    if (artifact.target) validateTarget(`artifacts.${id}.target`, artifact.target, playerIds, error);
    artifact.consequences?.forEach((action, index) => {
      validateAction(`artifacts.${id}.consequences[${index}]`, action, playerIds, effectIds, error);
    });
    for (const effectId of artifact.effects ?? []) {
      if (!effectIds.has(effectId)) error(`artifacts.${id}.effects`, `references missing effect ${effectId}`);
    }
  }
}

function validateFutureCatalogReferences(
  content: GameContent,
  traitIds: Set<string>,
  error: (path: string, message: string) => void,
  warning: (path: string, message: string) => void
) {
  const cosmeticIds = new Set(Object.keys(content.cosmetics ?? {}));
  const effectIds = new Set(Object.keys(content.effects ?? {}));
  const targetIds = new Set([...content.players.map((player) => player.id), ...Object.keys(content.characters ?? {})]);

  for (const [id, character] of Object.entries(content.characters ?? {}) as [string, CharacterDef][]) {
    for (const cosmeticId of [...(character.defaultLoadout?.cosmeticIds ?? []), ...(character.defaultCosmetics ?? [])]) {
      if (!cosmeticIds.has(cosmeticId)) error(`characters.${id}.defaultLoadout.cosmeticIds`, `references missing cosmetic ${cosmeticId}`);
    }
    for (const traitId of character.defaultTraits ?? []) {
      if (!traitIds.has(traitId)) error(`characters.${id}.defaultTraits`, `references missing character trait ${traitId}`);
    }
  }
  for (const [id, effect] of Object.entries(content.effects ?? {}) as [string, EffectDef][]) {
    if (!effect.duration) {
      error(`effects.${id}.duration`, "is required");
      continue;
    }
    validateDuration(`effects.${id}.duration`, effect.duration, error);
    effect.consequences?.forEach((action, index) => validateAction(`effects.${id}.consequences[${index}]`, action, targetIds, effectIds, error));
    effect.actions?.forEach((action, index) => validateAction(`effects.${id}.actions[${index}]`, action, targetIds, effectIds, error));
    effect.modifiers?.forEach((modifier, index) => {
      if (modifier.type === "conditionalConsequences") {
        if (modifier.when) validateCondition(`effects.${id}.modifiers[${index}].when`, modifier.when, error);
        modifier.consequences.forEach((action, actionIndex) => {
          validateAction(`effects.${id}.modifiers[${index}].consequences[${actionIndex}]`, action, targetIds, effectIds, error);
        });
      }
      if (modifier.type === "movementMultiplier" && (!Number.isFinite(modifier.multiplier) || modifier.multiplier < 0)) {
        error(`effects.${id}.modifiers[${index}].multiplier`, "must be a non-negative finite number");
      }
      if (modifier.type === "diceBias") {
        if (!Number.isInteger(modifier.face) || modifier.face < 1 || modifier.face > 6) error(`effects.${id}.modifiers[${index}].face`, "must be an integer from 1 to 6");
        if (!Number.isFinite(modifier.chanceDeltaPercent)) error(`effects.${id}.modifiers[${index}].chanceDeltaPercent`, "must be a finite number");
      }
      if (modifier.type === "swapPositions") validateTarget(`effects.${id}.modifiers[${index}].target`, modifier.target, targetIds, error);
    });
  }
  for (const [id, cosmetic] of Object.entries(content.cosmetics ?? {}) as [string, CosmeticDef][]) {
    if (cosmeticPrice(cosmetic) < 0) error(`cosmetics.${id}.price`, "must be non-negative");
  }
}

function validateCosmetics(
  cosmetics: Record<string, CosmeticDef> | undefined,
  characterIds: Set<string>,
  error: (path: string, message: string) => void,
  warning: (path: string, message: string) => void
) {
  for (const [id, cosmetic] of Object.entries(cosmetics ?? {})) {
    const normalized = normalizeCosmeticDef(cosmetic, id);
    const result = CosmeticDefSchema.safeParse(normalized);
    if (!result.success) {
      for (const issue of result.error.issues) {
        error(zodPath(`cosmetics.${id}`, issue.path), issue.message);
      }
    }
    const anchorRefs = cosmeticAnchorRefs(normalized);
    if (!cosmeticAnchorId(normalized) || !anchorRefs.length) error(`cosmetics.${id}.anchorId`, "must not be empty");
    if (anchorRefs.some((anchor) => anchor.anchorType === "token") || cosmeticAnchorType(normalized) === "token") {
      warning(`cosmetics.${id}.anchorType`, "token cosmetics are visual-only and render without face/body anchor checks");
    }
    for (const characterId of normalized.compatibility?.characterIds ?? []) {
      if (!characterIds.has(characterId)) error(`cosmetics.${id}.compatibility.characterIds`, `references missing character ${characterId}`);
    }
    for (const characterId of normalized.compatibility?.excludeCharacterIds ?? []) {
      if (!characterIds.has(characterId)) error(`cosmetics.${id}.compatibility.excludeCharacterIds`, `references missing character ${characterId}`);
    }
  }
}

function normalizeCharacters(
  characters: Record<string, CharacterDef> | undefined,
  players: PlayerDef[]
): Record<string, CharacterDef> {
  const normalized: Record<string, CharacterDef> = {};
  const source = characters ?? Object.fromEntries(players.map((player) => [player.id, playerDefToCharacter(player)]));
  for (const [key, character] of Object.entries(source)) {
    const id = stringValue(character.id) || key;
    const legacyPlayer = players.find((player) => player.id === id);
    const legacyCharacter = legacyPlayer ? playerDefToCharacter(legacyPlayer) : undefined;
    const displayName = stringValue(character.displayName) || stringValue(character.name) || legacyCharacter?.displayName || id;
    const defaultLoadout = isRecord(character.defaultLoadout) ? character.defaultLoadout : undefined;
    const defaultCosmetics = stringArray(character.defaultCosmetics);
    const defaultTraits = stringArray(character.defaultTraits);
    const cosmeticIds = stringArray(defaultLoadout?.cosmeticIds ?? defaultCosmetics);
    normalized[id] = cloneCharacter({
      ...character,
      id,
      displayName,
      color: character.color ?? legacyCharacter?.color,
      groom: character.groom ?? legacyCharacter?.groom,
      facePhotoAlignment: character.facePhotoAlignment ? { ...character.facePhotoAlignment } : undefined,
      faceAnchors: cloneAnchors(character.faceAnchors),
      bodyAnchors: cloneAnchors(character.bodyAnchors),
      defaultLoadout: cosmeticIds.length ? { ...defaultLoadout, cosmeticIds } : (defaultLoadout as CharacterDef["defaultLoadout"]),
      defaultCosmetics: defaultCosmetics.length ? defaultCosmetics : undefined,
      defaultTraits: defaultTraits.length ? defaultTraits : undefined,
    });
  }
  return normalized;
}

function clonePlayers(players: PlayerDef[]): PlayerDef[] {
  return players.map((player) => ({ ...player }));
}

function cloneCharacter(character: CharacterDef): CharacterDef {
  return {
    ...character,
    faceAnchors: cloneAnchors(character.faceAnchors),
    bodyAnchors: cloneAnchors(character.bodyAnchors),
    facePhotoAlignment: character.facePhotoAlignment ? { ...character.facePhotoAlignment } : undefined,
    defaultLoadout: character.defaultLoadout
      ? {
          ...character.defaultLoadout,
          cosmeticIds: character.defaultLoadout.cosmeticIds ? [...character.defaultLoadout.cosmeticIds] : undefined,
        }
      : undefined,
    defaultCosmetics: character.defaultCosmetics ? [...character.defaultCosmetics] : undefined,
    defaultTraits: character.defaultTraits ? [...character.defaultTraits] : undefined,
  };
}

function cloneCharacterTraits(traits: Record<string, CharacterTraitDef> | undefined): Record<string, CharacterTraitDef> | undefined {
  if (!traits) return undefined;
  return Object.fromEntries(
    Object.entries(traits).map(([id, trait]) => [
      id,
      {
        ...trait,
      },
    ])
  );
}

function cloneEffects(effects: Record<string, EffectDef> | undefined): Record<string, EffectDef> | undefined {
  if (!effects) return undefined;
  return Object.fromEntries(
    Object.entries(effects).map(([id, effect]) => [
      id,
      {
        ...effect,
        duration: effect.duration ? { ...effect.duration } : effect.duration,
        hooks: effect.hooks ? [...effect.hooks] : undefined,
        consequences: effect.consequences?.map(cloneAction),
        actions: effect.actions?.map(cloneAction),
        modifiers: effect.modifiers?.map(cloneEffectModifier),
      },
    ])
  );
}

function cloneEffectModifier<T extends EffectModifier>(modifier: T): T {
  const copy = { ...modifier } as EffectModifier;
  if ("when" in copy && copy.when) copy.when = cloneCondition(copy.when);
  if (copy.type === "conditionalConsequences") copy.consequences = copy.consequences.map(cloneAction);
  if (copy.type === "swapPositions") copy.target = cloneTarget(copy.target);
  return copy as T;
}

function cloneCosmetics(cosmetics: Record<string, CosmeticDef>): Record<string, CosmeticDef> {
  return Object.fromEntries(
    Object.entries(cosmetics).map(([id, cosmetic]) => [
      id,
      {
        ...cosmetic,
        asset: typeof cosmetic.asset === "string" ? cosmetic.asset : { ...cosmetic.asset },
        anchors: cosmetic.anchors?.map((anchor) => ({ ...anchor })),
        transform: cosmetic.transform ? { ...cosmetic.transform } : undefined,
        compatibility: cosmetic.compatibility
          ? {
              ...cosmetic.compatibility,
              characterIds: cosmetic.compatibility.characterIds ? [...cosmetic.compatibility.characterIds] : undefined,
              excludeCharacterIds: cosmetic.compatibility.excludeCharacterIds ? [...cosmetic.compatibility.excludeCharacterIds] : undefined,
              tags: cosmetic.compatibility.tags ? [...cosmetic.compatibility.tags] : undefined,
            }
          : undefined,
        preview: cosmetic.preview ? { ...cosmetic.preview } : undefined,
        tags: cosmetic.tags ? [...cosmetic.tags] : undefined,
      },
    ])
  );
}

function cloneArtifacts(artifacts: Record<string, ArtifactDef> | undefined): Record<string, ArtifactDef> | undefined {
  if (!artifacts) return undefined;
  return Object.fromEntries(
    Object.entries(artifacts).map(([id, artifact]) => [
      id,
      {
        ...artifact,
        target: cloneTarget(artifact.target),
        consequences: artifact.consequences?.map(cloneAction),
        effects: artifact.effects ? [...artifact.effects] : undefined,
        visual: artifact.visual ? { ...artifact.visual } : undefined,
        animations: artifact.animations ? { ...artifact.animations } : undefined,
        weightOverrides: artifact.weightOverrides ? { ...artifact.weightOverrides } : undefined,
      },
    ])
  );
}

function cloneAction<T extends EventAction>(action: T): T {
  const copy = { ...action } as EventAction;
  if ("target" in copy && copy.target) copy.target = cloneTarget(copy.target);
  if ("withTarget" in copy) copy.withTarget = cloneTarget(copy.withTarget);
  if (copy.duration) copy.duration = { ...copy.duration };
  if (copy.when) copy.when = cloneCondition(copy.when);
  if (copy.type === "offlineAction" && copy.confirmation) copy.confirmation = { ...copy.confirmation, playerIds: copy.confirmation.playerIds ? [...copy.confirmation.playerIds] : undefined };
  return copy as T;
}

function cloneCondition(condition: NonNullable<EventAction["when"]>): NonNullable<EventAction["when"]> {
  return {
    ...condition,
    movementTotal: condition.movementTotal ? { ...condition.movementTotal } : undefined,
    consecutiveRolls: condition.consecutiveRolls ? { ...condition.consecutiveRolls } : undefined,
    cellTagsAny: condition.cellTagsAny ? [...condition.cellTagsAny] : undefined,
  };
}

function cloneTarget<T extends EventActionTarget | undefined>(target: T): T {
  if (!target || typeof target === "string") return target;
  return { ...(target as Exclude<EventActionTarget, string>) } as T;
}

function cloneAnchors(anchors: unknown): Record<string, FaceAnchor> | undefined {
  if (!isRecord(anchors)) return undefined;
  const out: Record<string, FaceAnchor> = {};
  for (const [id, anchor] of Object.entries(anchors)) {
    if (!isRecord(anchor)) continue;
    out[id] = { ...(anchor as unknown as FaceAnchor) };
  }
  return out;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneTiles(board: Tile[]): Tile[] {
  return board.map((tile) => ({
    ...tile,
    layout: tile.layout ? { ...tile.layout } : undefined,
    eventIds: tile.eventIds ? [...tile.eventIds] : undefined,
    storyParams: tile.storyParams ? { ...tile.storyParams } : undefined,
    tags: tile.tags ? [...tile.tags] : undefined,
  }));
}

function cloneRoutes(routes: MapRoute[]): MapRoute[] {
  return routes.map((route) => ({
    ...route,
    points: route.points?.map((point) => ({ ...point })),
  }));
}

function cloneMapProps(mapProps: MapProp[]): MapProp[] {
  return mapProps.map((prop) => ({
    ...prop,
    position: { ...prop.position },
    data: prop.data ? { ...prop.data } : undefined,
  }));
}

function cloneBoardShape(boardShape?: MapBoardShape): MapBoardShape | undefined {
  if (!boardShape) return undefined;
  return {
    ...boardShape,
    blockedCells: boardShape.blockedCells?.map((cell) => ({ ...cell })),
    borderEdges: boardShape.borderEdges?.map((edge) => ({
      ...edge,
      from: { ...edge.from },
      to: { ...edge.to },
    })),
  };
}

function createLinearRoutes(board: Tile[]): MapRoute[] {
  return board.slice(0, -1).map((tile, index) => ({
    id: `r-${tile.id}-${board[index + 1].id}`,
    from: tile.id,
    to: board[index + 1].id,
    terrain: "stone",
  }));
}

function formatIssue(issue: ContentValidationIssue): string {
  return issue.path ? `${issue.path} ${issue.message}` : issue.message;
}

function zodPath(prefix: string, path: (string | number)[]): string {
  return path.length ? `${prefix}.${path.join(".")}` : prefix;
}
