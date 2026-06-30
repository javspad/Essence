import type {
  GameContent,
  MapArtifact,
  MapAssetDef,
  MapDefinition,
  MapRoute,
  MapTerrain,
  Tile,
  TileLayout,
  TileType,
} from "@essence/shared";

export type BuilderTool = "select" | "cell" | "route" | "artifact" | "json";

export type BuilderSelection =
  | { kind: "node"; id: number }
  | { kind: "route"; id: string }
  | { kind: "artifact"; id: string }
  | null;

export interface BuilderContent {
  activeMapId: string;
  maps: MapDefinition[];
  assetCatalog: MapAssetDef[];
}

export interface MapBuilderState {
  content: BuilderContent;
  activeMapId: string;
  tool: BuilderTool;
  selection: BuilderSelection;
  pendingRouteFrom: number | null;
  message: string;
}

export type MapBuilderEvent =
  | { type: "select_tool"; tool: BuilderTool }
  | { type: "select_map"; mapId: string }
  | { type: "create_map" }
  | { type: "duplicate_map" }
  | { type: "update_map"; patch: Partial<Pick<MapDefinition, "name" | "description" | "theme">> }
  | { type: "select"; selection: BuilderSelection }
  | { type: "add_node"; point: TileLayout; tileType?: TileType }
  | { type: "move_node"; id: number; point: TileLayout }
  | { type: "update_node"; id: number; patch: Partial<Tile> }
  | { type: "start_route"; from: number }
  | { type: "finish_route"; to: number }
  | { type: "add_route"; from: number; to: number; terrain?: MapTerrain }
  | { type: "update_route"; id: string; patch: Partial<MapRoute> }
  | { type: "add_route_point"; id: string; point?: TileLayout }
  | { type: "update_route_point"; id: string; index: number; point: TileLayout }
  | { type: "remove_route_point"; id: string; index: number }
  | { type: "add_artifact"; assetId: string; point: TileLayout }
  | { type: "move_artifact"; id: string; point: TileLayout }
  | { type: "update_artifact"; id: string; patch: Partial<MapArtifact> }
  | { type: "delete_selected" }
  | { type: "replace_content"; content: BuilderContent };

export const TILE_TYPES: TileType[] = [
  "start",
  "finish",
  "minigame",
  "trivia",
  "vote",
  "judge",
  "dare",
  "fate",
  "groom",
  "star",
  "reaction",
  "estimate",
];

export const TERRAIN_TYPES: MapTerrain[] = ["stone", "grass", "sand", "water", "asphalt", "magic"];

const DEFAULT_ASSETS: MapAssetDef[] = [
  { id: "oak-tree", name: "Pino", kind: "tree", defaultScale: 1 },
  { id: "club-house", name: "Casa / escuela", kind: "house", defaultScale: 1 },
  { id: "party-van", name: "Traffic", kind: "vehicle", defaultScale: 1 },
  { id: "pond", name: "Lago", kind: "water", defaultScale: 1 },
  { id: "start-sign", name: "Cartel START", kind: "sign", defaultScale: 1 },
  { id: "finish-sign", name: "Cartel final", kind: "sign", defaultScale: 1 },
];

export function createInitialMapBuilderState(content: GameContent): MapBuilderState {
  const builderContent = normalizeBuilderContent(content);
  return {
    content: builderContent,
    activeMapId: builderContent.activeMapId,
    tool: "select",
    selection: builderContent.maps[0]?.board[0] ? { kind: "node", id: builderContent.maps[0].board[0].id } : null,
    pendingRouteFrom: null,
    message: "Mapa cargado",
  };
}

export function normalizeBuilderContent(content: GameContent): BuilderContent {
  const maps = content.maps?.length
    ? content.maps.map((map) => ({
        ...map,
        board: cloneTiles(map.board.length ? map.board : content.board),
        routes: map.routes?.length ? cloneRoutes(map.routes) : createLinearRoutes(map.board.length ? map.board : content.board),
        artifacts: cloneArtifacts(map.artifacts ?? []),
      }))
    : [
        {
          id: "default-map",
          name: "Mapa principal",
          description: "Mapa generado desde content.board.",
          board: cloneTiles(content.board),
          routes: createLinearRoutes(content.board),
          artifacts: [],
        },
      ];
  const activeMapId = maps.some((map) => map.id === content.activeMapId)
    ? content.activeMapId!
    : maps[0]?.id ?? "default-map";
  return {
    activeMapId,
    maps,
    assetCatalog: content.assetCatalog?.length ? content.assetCatalog.map((asset) => ({ ...asset })) : DEFAULT_ASSETS,
  };
}

export function builderContentToGameContent(base: GameContent, builder: BuilderContent): GameContent {
  const activeMap = builder.maps.find((map) => map.id === builder.activeMapId) ?? builder.maps[0];
  return {
    ...base,
    activeMapId: activeMap?.id ?? builder.activeMapId,
    board: activeMap ? cloneTiles(activeMap.board) : base.board,
    maps: builder.maps.map(cloneMap),
    assetCatalog: builder.assetCatalog.map((asset) => ({ ...asset })),
  };
}

export function mapBuilderReducer(state: MapBuilderState, event: MapBuilderEvent): MapBuilderState {
  switch (event.type) {
    case "select_tool":
      return {
        ...state,
        tool: event.tool,
        pendingRouteFrom: event.tool === "route" ? state.pendingRouteFrom : null,
        message: toolMessage(event.tool),
      };
    case "select_map": {
      const map = state.content.maps.find((candidate) => candidate.id === event.mapId);
      if (!map) return state;
      return {
        ...state,
        activeMapId: map.id,
        content: { ...state.content, activeMapId: map.id },
        selection: map.board[0] ? { kind: "node", id: map.board[0].id } : null,
        pendingRouteFrom: null,
        message: `Mapa activo: ${map.name}`,
      };
    }
    case "create_map": {
      const map = createEmptyMap(nextMapId(state.content.maps));
      return {
        ...state,
        activeMapId: map.id,
        content: {
          ...state.content,
          activeMapId: map.id,
          maps: [...state.content.maps, map],
        },
        selection: { kind: "node", id: map.board[0].id },
        pendingRouteFrom: null,
        message: "Mapa nuevo creado",
      };
    }
    case "duplicate_map": {
      const active = getActiveMap(state);
      const copy = cloneMap(active);
      copy.id = nextMapId(state.content.maps);
      copy.name = `${active.name} copia`;
      return {
        ...state,
        activeMapId: copy.id,
        content: {
          ...state.content,
          activeMapId: copy.id,
          maps: [...state.content.maps, copy],
        },
        selection: copy.board[0] ? { kind: "node", id: copy.board[0].id } : null,
        pendingRouteFrom: null,
        message: "Mapa duplicado",
      };
    }
    case "update_map":
      return updateActiveMapState(state, (map) => ({ ...map, ...event.patch }), "Mapa actualizado");
    case "select":
      return { ...state, selection: event.selection, pendingRouteFrom: null, message: selectionMessage(event.selection) };
    case "add_node":
      return updateActiveMapState(
        state,
        (map) => {
          const tile: Tile = {
            id: nextTileId(map.board),
            type: event.tileType ?? "minigame",
            layout: roundLayout(event.point),
            label: event.tileType === "finish" ? "THE END" : undefined,
          };
          return { ...map, board: [...map.board, tile] };
        },
        "Casillero agregado",
        (map) => ({ kind: "node", id: Math.max(...map.board.map((tile) => tile.id)) })
      );
    case "move_node":
      return updateActiveMapState(
        state,
        (map) => ({
          ...map,
          board: map.board.map((tile) =>
            tile.id === event.id ? { ...tile, layout: { ...(tile.layout ?? { x: 0, y: 0 }), ...roundLayout(event.point) } } : tile
          ),
        }),
        "Casillero movido"
      );
    case "update_node":
      return updateActiveMapState(
        state,
        (map) => ({
          ...map,
          board: map.board.map((tile) => (tile.id === event.id ? normalizeTilePatch(tile, event.patch) : tile)),
        }),
        "Casillero actualizado"
      );
    case "start_route":
      return {
        ...state,
        tool: "route",
        selection: { kind: "node", id: event.from },
        pendingRouteFrom: event.from,
        message: `Ruta: elegí destino desde ${event.from}`,
      };
    case "finish_route":
      if (state.pendingRouteFrom === null || state.pendingRouteFrom === event.to) return state;
      return mapBuilderReducer(
        { ...state, pendingRouteFrom: null },
        { type: "add_route", from: state.pendingRouteFrom, to: event.to }
      );
    case "add_route": {
      let createdId = "";
      return updateActiveMapState(
        state,
        (map) => {
          createdId = nextRouteId(map.routes, event.from, event.to);
          return {
            ...map,
            routes: [
              ...map.routes,
              {
                id: createdId,
                from: event.from,
                to: event.to,
                terrain: event.terrain ?? "stone",
              },
            ],
          };
        },
        "Ruta conectada",
        () => ({ kind: "route", id: createdId })
      );
    }
    case "update_route":
      return updateActiveMapState(
        state,
        (map) => ({
          ...map,
          routes: map.routes.map((route) => (route.id === event.id ? { ...route, ...event.patch } : route)),
        }),
        "Ruta actualizada"
      );
    case "add_route_point":
      return updateActiveMapState(
        state,
        (map) => ({
          ...map,
          routes: map.routes.map((route) =>
            route.id === event.id
              ? {
                  ...route,
                  points: [...(route.points ?? []), roundLayout(event.point ?? midpointForRoute(map.board, route))],
                }
              : route
          ),
        }),
        "Punto de ruta agregado"
      );
    case "update_route_point":
      return updateActiveMapState(
        state,
        (map) => ({
          ...map,
          routes: map.routes.map((route) =>
            route.id === event.id
              ? {
                  ...route,
                  points: (route.points ?? []).map((point, index) => (index === event.index ? roundLayout(event.point) : point)),
                }
              : route
          ),
        }),
        "Punto de ruta movido"
      );
    case "remove_route_point":
      return updateActiveMapState(
        state,
        (map) => ({
          ...map,
          routes: map.routes.map((route) =>
            route.id === event.id
              ? { ...route, points: (route.points ?? []).filter((_, index) => index !== event.index) }
              : route
          ),
        }),
        "Punto de ruta eliminado"
      );
    case "add_artifact": {
      let createdId = "";
      return updateActiveMapState(
        state,
        (map) => {
          createdId = nextArtifactId(map.artifacts, event.assetId);
          return {
            ...map,
            artifacts: [
              ...map.artifacts,
              {
                id: createdId,
                assetId: event.assetId,
                position: roundLayout(event.point),
                scale: 1,
              },
            ],
          };
        },
        "Artefacto agregado",
        () => ({ kind: "artifact", id: createdId })
      );
    }
    case "move_artifact":
      return updateActiveMapState(
        state,
        (map) => ({
          ...map,
          artifacts: map.artifacts.map((artifact) =>
            artifact.id === event.id
              ? { ...artifact, position: { ...artifact.position, ...roundLayout(event.point) } }
              : artifact
          ),
        }),
        "Artefacto movido"
      );
    case "update_artifact":
      return updateActiveMapState(
        state,
        (map) => ({
          ...map,
          artifacts: map.artifacts.map((artifact) =>
            artifact.id === event.id ? { ...artifact, ...event.patch } : artifact
          ),
        }),
        "Artefacto actualizado"
      );
    case "delete_selected":
      return deleteSelection(state);
    case "replace_content":
      {
        const active = event.content.maps.find((map) => map.id === event.content.activeMapId) ?? event.content.maps[0];
        return {
          ...state,
          content: event.content,
          activeMapId: event.content.activeMapId,
          selection: active?.board[0] ? { kind: "node", id: active.board[0].id } : null,
          pendingRouteFrom: null,
          message: "JSON importado",
        };
      }
    default:
      return state;
  }
}

export function getActiveMap(state: MapBuilderState): MapDefinition {
  return state.content.maps.find((map) => map.id === state.activeMapId) ?? state.content.maps[0];
}

export function getSelectedNode(map: MapDefinition, selection: BuilderSelection): Tile | null {
  return selection?.kind === "node" ? map.board.find((tile) => tile.id === selection.id) ?? null : null;
}

export function getSelectedRoute(map: MapDefinition, selection: BuilderSelection): MapRoute | null {
  return selection?.kind === "route" ? map.routes.find((route) => route.id === selection.id) ?? null : null;
}

export function getSelectedArtifact(map: MapDefinition, selection: BuilderSelection): MapArtifact | null {
  return selection?.kind === "artifact" ? map.artifacts.find((artifact) => artifact.id === selection.id) ?? null : null;
}

export function validateMap(map: MapDefinition): string[] {
  const errors: string[] = [];
  const ids = new Set<number>();
  for (const tile of map.board) {
    if (ids.has(tile.id)) errors.push(`Casillero duplicado: ${tile.id}`);
    ids.add(tile.id);
    if (!tile.layout) errors.push(`Casillero ${tile.id} no tiene layout`);
  }
  for (const route of map.routes) {
    if (!ids.has(route.from)) errors.push(`Ruta ${route.id} sale de ${route.from}, que no existe`);
    if (!ids.has(route.to)) errors.push(`Ruta ${route.id} llega a ${route.to}, que no existe`);
  }
  if (!map.board.some((tile) => tile.type === "start")) errors.push("Falta un casillero start");
  if (!map.board.some((tile) => tile.type === "finish")) errors.push("Falta un casillero finish");
  return errors;
}

function updateActiveMapState(
  state: MapBuilderState,
  update: (map: MapDefinition) => MapDefinition,
  message: string,
  select?: (updatedMap: MapDefinition) => BuilderSelection
): MapBuilderState {
  let updatedActive: MapDefinition | null = null;
  const maps = state.content.maps.map((map) => {
    if (map.id !== state.activeMapId) return map;
    const updated = update(map);
    updatedActive = updated;
    return updated;
  });
  return {
    ...state,
    content: { ...state.content, maps },
    selection: updatedActive && select ? select(updatedActive) : state.selection,
    message,
  };
}

function deleteSelection(state: MapBuilderState): MapBuilderState {
  const selection = state.selection;
  if (!selection) return state;
  return updateActiveMapState(
    state,
    (map) => {
      if (selection.kind === "node") {
        return {
          ...map,
          board: map.board.filter((tile) => tile.id !== selection.id),
          routes: map.routes.filter((route) => route.from !== selection.id && route.to !== selection.id),
        };
      }
      if (selection.kind === "route") {
        return { ...map, routes: map.routes.filter((route) => route.id !== selection.id) };
      }
      return { ...map, artifacts: map.artifacts.filter((artifact) => artifact.id !== selection.id) };
    },
    "Selección eliminada",
    () => null
  );
}

function normalizeTilePatch(tile: Tile, patch: Partial<Tile>): Tile {
  const next: Tile = { ...tile, ...patch };
  if (patch.layout) next.layout = { ...(tile.layout ?? { x: 0, y: 0 }), ...roundLayout(patch.layout) };
  if (patch.type && !eventFieldForType(patch.type, "minigame")) next.minigameId = undefined;
  if (patch.type !== "dare") next.dareId = undefined;
  if (patch.type !== "fate") next.fateId = undefined;
  return next;
}

export function eventFieldForType(type: TileType, field: "minigame" | "dare" | "fate"): boolean {
  if (field === "dare") return type === "dare";
  if (field === "fate") return type === "fate";
  return ["minigame", "trivia", "vote", "judge", "groom", "star", "reaction", "estimate"].includes(type);
}

function createLinearRoutes(board: Tile[]): MapRoute[] {
  return board.slice(0, -1).map((tile, index) => ({
    id: `r-${tile.id}-${board[index + 1].id}`,
    from: tile.id,
    to: board[index + 1].id,
    terrain: "stone",
  }));
}

function createEmptyMap(id: string): MapDefinition {
  return {
    id,
    name: "Mapa nuevo",
    description: "Boceto editable.",
    theme: { base: "#6fbe54", path: "#f1d081", accent: "#38bdf8", sky: "#1b1309" },
    board: [
      { id: 0, type: "start", label: "START", layout: { x: 1, y: 3, rot: 0 } },
      { id: 1, type: "minigame", layout: { x: 3, y: 3, rot: 0 } },
      { id: 2, type: "finish", label: "THE END", layout: { x: 5, y: 3, rot: 0 } },
    ],
    routes: [
      { id: "r-0-1", from: 0, to: 1, terrain: "stone" },
      { id: "r-1-2", from: 1, to: 2, terrain: "grass" },
    ],
    artifacts: [],
  };
}

function nextMapId(maps: MapDefinition[]): string {
  const used = new Set(maps.map((map) => map.id));
  let index = maps.length + 1;
  let id = `map-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `map-${index}`;
  }
  return id;
}

function nextTileId(board: Tile[]): number {
  return Math.max(-1, ...board.map((tile) => tile.id)) + 1;
}

function nextRouteId(routes: MapRoute[], from: number, to: number): string {
  const used = new Set(routes.map((route) => route.id));
  let id = `r-${from}-${to}`;
  let index = 2;
  while (used.has(id)) {
    id = `r-${from}-${to}-${index}`;
    index += 1;
  }
  return id;
}

function nextArtifactId(artifacts: MapArtifact[], assetId: string): string {
  const used = new Set(artifacts.map((artifact) => artifact.id));
  const base = assetId.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  let index = artifacts.length + 1;
  let id = `${base}-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `${base}-${index}`;
  }
  return id;
}

function midpointForRoute(board: Tile[], route: MapRoute): TileLayout {
  const from = board.find((tile) => tile.id === route.from)?.layout ?? { x: 0, y: 0 };
  const to = board.find((tile) => tile.id === route.to)?.layout ?? from;
  return roundLayout({
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
    z: ((from.z ?? 0) + (to.z ?? 0)) / 2,
  });
}

function cloneMap(map: MapDefinition): MapDefinition {
  return {
    ...map,
    theme: map.theme ? { ...map.theme } : undefined,
    board: cloneTiles(map.board),
    routes: cloneRoutes(map.routes),
    artifacts: cloneArtifacts(map.artifacts),
  };
}

function cloneTiles(board: Tile[]): Tile[] {
  return board.map((tile) => ({
    ...tile,
    layout: tile.layout ? { ...tile.layout } : undefined,
  }));
}

function cloneRoutes(routes: MapRoute[]): MapRoute[] {
  return routes.map((route) => ({
    ...route,
    points: route.points?.map((point) => ({ ...point })),
  }));
}

function cloneArtifacts(artifacts: MapArtifact[]): MapArtifact[] {
  return artifacts.map((artifact) => ({
    ...artifact,
    position: { ...artifact.position },
    data: artifact.data ? { ...artifact.data } : undefined,
  }));
}

function roundLayout(layout: TileLayout): TileLayout {
  return {
    x: round(layout.x),
    y: round(layout.y),
    ...(layout.z === undefined ? {} : { z: round(layout.z) }),
    ...(layout.rot === undefined ? {} : { rot: round(layout.rot) }),
  };
}

export function round(value: number, step = 0.25): number {
  return Math.round(value / step) * step;
}

function toolMessage(tool: BuilderTool): string {
  const labels: Record<BuilderTool, string> = {
    select: "Seleccioná o arrastrá elementos",
    cell: "Click en el mapa para crear casilleros",
    route: "Click en dos casilleros para conectarlos",
    artifact: "Click en el mapa para colocar artefactos",
    json: "Importá o exportá JSON",
  };
  return labels[tool];
}

function selectionMessage(selection: BuilderSelection): string {
  if (!selection) return "Sin selección";
  if (selection.kind === "node") return `Casillero ${selection.id} seleccionado`;
  if (selection.kind === "route") return `Ruta ${selection.id} seleccionada`;
  return `Artefacto ${selection.id} seleccionado`;
}
