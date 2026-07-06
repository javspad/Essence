import type {
  ArtifactDef,
  CharacterDef,
  CharacterSetDef,
  CosmeticDef,
  EffectDef,
  EventAction,
  EventActionTarget,
  EventOutcomeBranch,
  GameContent,
  GameEventDef,
  MapBoardShape,
  MapDefinition,
  MapProp,
  MapRoute,
  MapTerrace,
  PlayerDef,
  Tile,
  TileLayout,
} from "./types";
import { EVENT_ACTIVITY_TYPES, normalizeGameContentEvents } from "./events";

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

export function normalizeContentSchema(input: unknown): GameContent {
  const content = input as GameContent;
  const normalized = normalizeGameContentEvents(content);
  return {
    ...normalized,
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

  const playerIds = validatePlayers(normalized.players, error);
  const assetIds = validateAssetCatalog(normalized, error);

  for (const [id, event] of Object.entries(normalized.events ?? {})) {
    validateEvent(`events.${id}`, event, playerIds, error);
  }

  validateCatalogIds(normalized.characters, "characters", error);
  validateCatalogIds(normalized.characterSets, "characterSets", error);
  validateCatalogIds(normalized.cosmetics, "cosmetics", error);
  validateCatalogIds(normalized.artifacts, "artifacts", error);
  validateCatalogIds(normalized.effects, "effects", error);
  validateFutureCatalogReferences(normalized, error, warning);

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
  error: (path: string, message: string) => void
) {
  if (!event.name?.trim()) error(`${path}.name`, "must not be empty");
  if (event.trigger?.type === "player" && !playerIds.has(event.trigger.playerId)) {
    error(`${path}.trigger.playerId`, `references missing player ${event.trigger.playerId}`);
  }
  if (event.activity && !EVENT_ACTIVITY_TYPES.includes(event.activity.type)) {
    error(`${path}.activity.type`, `is not supported: ${event.activity.type}`);
  }
  event.actions?.forEach((action, index) => validateAction(`${path}.actions[${index}]`, action, playerIds, error));
  event.outcomes?.forEach((outcome, index) => validateOutcome(`${path}.outcomes[${index}]`, outcome, playerIds, error));
}

function validateOutcome(
  path: string,
  outcome: EventOutcomeBranch,
  playerIds: Set<string>,
  error: (path: string, message: string) => void
) {
  validateTarget(`${path}.when`, outcome.when, playerIds, error);
  outcome.actions.forEach((action, index) => validateAction(`${path}.actions[${index}]`, action, playerIds, error));
}

function validateAction(
  path: string,
  action: EventAction,
  playerIds: Set<string>,
  error: (path: string, message: string) => void
) {
  if ("target" in action && action.target) validateTarget(`${path}.target`, action.target, playerIds, error);
  if (action.type === "coins" && !Number.isFinite(action.value)) error(`${path}.value`, "must be a finite number");
  if (action.type === "move" && !Number.isFinite(action.delta)) error(`${path}.delta`, "must be a finite number");
  if (action.type === "moveTo" && !Number.isInteger(action.tileId)) error(`${path}.tileId`, "must be an integer board cell id");
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

function validateFutureCatalogReferences(
  content: GameContent,
  error: (path: string, message: string) => void,
  warning: (path: string, message: string) => void
) {
  const characterIds = new Set(Object.keys(content.characters ?? {}));
  const cosmeticIds = new Set(Object.keys(content.cosmetics ?? {}));
  const effectIds = new Set(Object.keys(content.effects ?? {}));

  for (const [id, set] of Object.entries(content.characterSets ?? {}) as [string, CharacterSetDef][]) {
    for (const characterId of set.characterIds ?? []) {
      if (!characterIds.has(characterId)) error(`characterSets.${id}.characterIds`, `references missing character ${characterId}`);
    }
  }
  for (const [id, character] of Object.entries(content.characters ?? {}) as [string, CharacterDef][]) {
    for (const cosmeticId of character.defaultCosmetics ?? []) {
      if (!cosmeticIds.has(cosmeticId)) error(`characters.${id}.defaultCosmetics`, `references missing cosmetic ${cosmeticId}`);
    }
    for (const traitId of character.defaultTraits ?? []) {
      if (!effectIds.has(traitId)) error(`characters.${id}.defaultTraits`, `references missing effect ${traitId}`);
    }
  }
  for (const [id, artifact] of Object.entries(content.artifacts ?? {}) as [string, ArtifactDef][]) {
    artifact.consequences?.forEach((action, index) => {
      if (action.type === "skipTurn" || action.type === "extraTurn" || action.type === "coins" || action.type === "move" || action.type === "moveTo" || action.type === "text") {
        return;
      }
      warning(`artifacts.${id}.consequences[${index}]`, "uses an unknown consequence action");
    });
    for (const effectId of artifact.effects ?? []) {
      if (!effectIds.has(effectId)) error(`artifacts.${id}.effects`, `references missing effect ${effectId}`);
    }
  }
  for (const [id, effect] of Object.entries(content.effects ?? {}) as [string, EffectDef][]) {
    if (!effect.duration) {
      error(`effects.${id}.duration`, "is required");
      continue;
    }
    if ((effect.duration.mode === "turns" || effect.duration.mode === "rounds") && effect.duration.value < 1) {
      error(`effects.${id}.duration.value`, "must be at least 1");
    }
  }
  for (const [id, cosmetic] of Object.entries(content.cosmetics ?? {}) as [string, CosmeticDef][]) {
    if (cosmetic.price !== undefined && cosmetic.price < 0) error(`cosmetics.${id}.price`, "must be non-negative");
  }
}

function cloneTiles(board: Tile[]): Tile[] {
  return board.map((tile) => ({
    ...tile,
    layout: tile.layout ? { ...tile.layout } : undefined,
    eventIds: tile.eventIds ? [...tile.eventIds] : undefined,
    storyParams: tile.storyParams ? { ...tile.storyParams } : undefined,
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
