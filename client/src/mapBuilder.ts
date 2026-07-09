import type {
  GameContent,
  MapArtifact,
  MapAssetDef,
  MapAssetProjection,
  MapBoardShape,
  MapBorderEdge,
  MapDefinition,
  MapGridPoint,
  MapRoute,
  MapTerrace,
  MapTerraceSurface,
  MapTerrain,
  Tile,
  TileLayout,
  TileType,
} from "@essence/shared";
import { normalizeContentSchema } from "@essence/shared/contentValidation";
import { defaultAssetFootprint } from "./artifactProjection";

export type BuilderTool = "select" | "cell" | "route" | "artifact" | "terrace" | "json";

export type BuilderSelection =
  | { kind: "node"; id: number }
  | { kind: "route"; id: string }
  | { kind: "artifact"; id: string }
  | { kind: "terrace"; id: string }
  | null;

export type TerraceCorner = "nw" | "ne" | "sw" | "se";

export interface TerraceRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

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
  | { type: "delete_map" }
  | { type: "update_map"; patch: Partial<Pick<MapDefinition, "name" | "description" | "theme">> }
  | { type: "update_board_shape"; patch: Partial<MapBoardShape> }
  | { type: "toggle_blocked_cell"; point: MapGridPoint }
  | { type: "add_border_edge"; edge?: Partial<MapBorderEdge> }
  | { type: "split_border_edge"; id: string; point: MapGridPoint }
  | { type: "move_border_point"; from: MapGridPoint; to: MapGridPoint }
  | { type: "reset_border_edges" }
  | { type: "update_border_edge"; id: string; patch: Partial<MapBorderEdge> }
  | { type: "remove_border_edge"; id: string }
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
  | { type: "add_artifact"; assetId: string; point: TileLayout; scale?: number }
  | { type: "move_artifact"; id: string; point: TileLayout }
  | { type: "update_artifact"; id: string; patch: Partial<MapArtifact> }
  | { type: "add_terrace"; rect: TerraceRect; elevation?: number; surface?: MapTerraceSurface }
  | { type: "update_terrace"; id: string; patch: Partial<Omit<MapTerrace, "id">> }
  | { type: "move_terrace"; id: string; minX: number; minY: number }
  | { type: "resize_terrace"; id: string; corner: TerraceCorner; point: MapGridPoint }
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
  "reaction",
  "estimate",
  "shop",
];

export const TERRAIN_TYPES: MapTerrain[] = ["stone", "grass", "sand", "water", "asphalt", "magic"];

export const TERRACE_SURFACES: MapTerraceSurface[] = ["grass", "sand", "water", "stone", "plaza"];

/** Elevación por defecto de una meseta nueva y saltos rápidos del inspector. */
export const DEFAULT_TERRACE_ELEVATION = 0.55;
export const TERRACE_ELEVATION_PRESETS = [0.55, 1.1, 1.7];
export const MAX_TERRACE_ELEVATION = 3;

const DEFAULT_ASSETS: MapAssetDef[] = [
  { id: "oak-tree", name: "Pino", kind: "tree", defaultScale: 1 },
  { id: "club-house", name: "Casa / escuela", kind: "house", defaultScale: 1 },
  { id: "party-van", name: "Traffic", kind: "vehicle", defaultScale: 1 },
  { id: "pond", name: "Lago", kind: "water", defaultScale: 1 },
  { id: "start-sign", name: "Cartel START", kind: "sign", defaultScale: 1 },
  { id: "finish-sign", name: "Cartel final", kind: "sign", defaultScale: 1 },
  { id: "fountain", name: "Fuente", kind: "decor", defaultScale: 1 },
  { id: "bench", name: "Banco", kind: "decor", defaultScale: 1 },
  { id: "palm-tree", name: "Palmera", kind: "tree", defaultScale: 1 },
  { id: "flower-bed", name: "Cantero", kind: "decor", defaultScale: 1 },
  { id: "beach-set", name: "Playa set", kind: "decor", defaultScale: 1 },
  { id: "sailboat", name: "Velerito", kind: "vehicle", defaultScale: 1 },
  { id: "waterfall", name: "Cascada", kind: "water", defaultScale: 1 },
  { id: "wedding-arch", name: "Arco de flores", kind: "decor", defaultScale: 1 },
  { id: "fence", name: "Cerco", kind: "decor", defaultScale: 1 },
  { id: "streetlamp", name: "Farol", kind: "decor", defaultScale: 1 },
  { id: "rock", name: "Rocas", kind: "decor", defaultScale: 1 },
  { id: "billboard", name: "Pantallas", kind: "sign", defaultScale: 1 },
  { id: "bus", name: "Bondi", kind: "vehicle", defaultScale: 1 },
  { id: "fallen-fernet", name: "Fernet tirado", kind: "decor", defaultScale: 1 },
  { id: "vomiting-person", name: "Persona vomitando", kind: "decor", defaultScale: 1 },
  { id: "blue-ikea-bag", name: "Bolso azul grande", kind: "decor", defaultScale: 1 },
  { id: "hockey-stick", name: "Palo con vidrios", kind: "decor", defaultScale: 1 },
  { id: "condom-bolas", name: "Boleadora de caca", kind: "decor", defaultScale: 1 },
  { id: "botherlands-disc", name: "Disco Botherlands X360", kind: "decor", defaultScale: 1 },
  { id: "hoodie-log", name: "Tronco con buzo", kind: "decor", defaultScale: 1 },
  { id: "cut-branch-oak", name: "Roble con rama cortada", kind: "tree", defaultScale: 1 },
  { id: "uade-building", name: "UADE vidriada", kind: "house", defaultScale: 1 },
  { id: "uba-building", name: "UBA con carteles", kind: "house", defaultScale: 1 },
  { id: "desk-chair-tower", name: "Torre de bancos y sillas", kind: "decor", defaultScale: 1 },
  { id: "croissant", name: "Medialuna", kind: "decor", defaultScale: 1 },
  { id: "wedding-ring", name: "Anillo de casamiento", kind: "decor", defaultScale: 1 },
  { id: "ukulele", name: "Ukulele", kind: "decor", defaultScale: 1 },
  { id: "rugby-ball", name: "Pelota de rugby", kind: "decor", defaultScale: 1 },
  { id: "basketball", name: "Pelota de básquet", kind: "decor", defaultScale: 1 },
  { id: "football-ball", name: "Pelota de fútbol", kind: "decor", defaultScale: 1 },
  { id: "tuna-can", name: "Lata de atún", kind: "decor", defaultScale: 1 },
  { id: "jardinera-can", name: "Lata de jardinera", kind: "decor", defaultScale: 1 },
  { id: "sunscreen", name: "Protector solar", kind: "decor", defaultScale: 1 },
  { id: "vodka-bottle", name: "Vodka", kind: "decor", defaultScale: 1 },
  { id: "classroom-giant-log", name: "Tronco gigante (aula)", kind: "decor", defaultScale: 1 },
  { id: "split-tree-trunk", name: "Árbol roto", kind: "tree", defaultScale: 1 },
  { id: "bleach-sound-bomb", name: "Frasco de cloro", kind: "decor", defaultScale: 1 },
  { id: "firecracker-box", name: "Caja de petardos", kind: "decor", defaultScale: 1 },
  { id: "upd-noose-chair", name: "Silla con soga UPD", kind: "decor", defaultScale: 1 },
  { id: "vinchuca-jar", name: "Frasco con vinchuca", kind: "decor", defaultScale: 1 },
  { id: "broken-window-frame", name: "Marco de ventana roto", kind: "decor", defaultScale: 1 },
  { id: "school-locker-hiding", name: "Locker con Willy", kind: "house", defaultScale: 1 },
  { id: "locker-row", name: "Lockers para esconderse", kind: "house", defaultScale: 1 },
  { id: "steamy-taxi", name: "Taxi caldeado", kind: "vehicle", defaultScale: 1 },
  { id: "just-dance-kinect", name: "Kinect + pista Just Dance", kind: "decor", defaultScale: 1 },
  { id: "school-desk-pupitre", name: "Pupitre", kind: "decor", defaultScale: 1 },
  { id: "city-barricade-peed", name: "Coso amarillo meado", kind: "sign", defaultScale: 1 },
  { id: "crumpled-exam-ausente", name: "Examen AUSENTE", kind: "decor", defaultScale: 1 },
  { id: "martina-impact-ball", name: "Pelota del pelotazo", kind: "decor", defaultScale: 1 },
  { id: "teacher-figures", name: "Profesores", kind: "custom", defaultScale: 1 },
  { id: "giant-groin-cup", name: "Protector de Javi", kind: "decor", defaultScale: 1 },
  { id: "sleeping-bag", name: "Bolsa de dormir", kind: "decor", defaultScale: 1 },
  { id: "tongue-toy", name: "Lengua loca", kind: "decor", defaultScale: 1 },
  { id: "jony-duck-window", name: "Ventana de Jony", kind: "decor", defaultScale: 1 },
  { id: "flying-chair", name: "Silla voladora", kind: "decor", defaultScale: 1 },
  { id: "kiosco-24hs", name: "Kiosco 24hs", kind: "decor", defaultScale: 1 },
  { id: "kiosk-bag-nofui", name: "Bolsa NO FUI YO", kind: "decor", defaultScale: 1 },
  { id: "tiny-trophy", name: "Trofeo chiquito", kind: "custom", defaultScale: 1 },
  { id: "silly-pool-float", name: "Flotador ridículo", kind: "decor", defaultScale: 1 },
  { id: "broken-umbrella", name: "Paraguas roto", kind: "decor", defaultScale: 1 },
  { id: "megaphone", name: "Megáfono", kind: "decor", defaultScale: 1 },
  { id: "stopwatch", name: "Cronómetro", kind: "decor", defaultScale: 1 },
  { id: "lucky-sock", name: "Media de la suerte", kind: "decor", defaultScale: 1 },
  { id: "cursed-calculator", name: "Calculadora maldita", kind: "decor", defaultScale: 1 },
  { id: "giant-pencil", name: "Lápiz gigante", kind: "decor", defaultScale: 1 },
  { id: "sticker-suitcase", name: "Valija con stickers", kind: "decor", defaultScale: 1 },
  { id: "banana-peel-trap", name: "Cáscara de banana", kind: "decor", defaultScale: 1 },
  { id: "world-cup-trophy", name: "Copa del Mundo", kind: "custom", defaultScale: 1 },
  { id: "rain-tent", name: "Carpa que llueve adentro", kind: "custom", defaultScale: 1 },
];

export function createInitialMapBuilderState(content: GameContent): MapBuilderState {
  const builderContent = normalizeBuilderContent(normalizeContentSchema(content));
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
  const normalizedContent = normalizeContentSchema(content);
  const maps = content.maps?.length
    ? normalizedContent.maps!.map((map) => ({
      ...map,
      board: cloneTiles(map.board.length ? map.board : normalizedContent.board),
      routes: map.routes?.length ? cloneRoutes(map.routes) : createLinearRoutes(map.board.length ? map.board : normalizedContent.board),
      artifacts: cloneArtifacts(map.artifacts ?? []),
      mapProps: cloneArtifacts(map.artifacts ?? []),
      terraces: cloneTerraces(map.terraces),
      boardShape: normalizeBoardShape(cloneBoardShape(map.boardShape) ?? createDefaultBoardShape(map.board.length ? map.board : normalizedContent.board)),
    }))
    : [
        {
          id: "default-map",
          name: "Mapa principal",
          description: "Mapa generado desde content.board.",
          board: cloneTiles(normalizedContent.board),
          routes: createLinearRoutes(normalizedContent.board),
          artifacts: [],
          mapProps: [],
          terraces: [],
          boardShape: createDefaultBoardShape(content.board),
        },
      ];
  const activeMapId = maps.some((map) => map.id === content.activeMapId)
    ? normalizedContent.activeMapId!
    : maps[0]?.id ?? "default-map";
  return {
    activeMapId,
    maps,
    // Unimos el catálogo guardado con los assets por defecto, para que los props
    // nuevos aparezcan aunque haya un borrador viejo en localStorage (sin pisar
    // las personalizaciones ya guardadas).
    assetCatalog: normalizeAssetCatalog(mergeAssetCatalog(content.assetCatalog ?? [], DEFAULT_ASSETS)),
  };
}

/**
 * Une el catálogo guardado con los assets por defecto: refresca nombre/kind/escala
 * de los assets conocidos desde el catálogo por defecto (para que renombres se vean
 * aunque haya un borrador viejo), conserva footprints/tags guardados, y suma los
 * assets nuevos que falten.
 */
function mergeAssetCatalog(stored: MapAssetDef[], defaults: MapAssetDef[]): MapAssetDef[] {
  const defById = new Map(defaults.map((asset) => [asset.id, asset]));
  const storedIds = new Set(stored.map((asset) => asset.id));
  const refreshed = stored.map((asset) => {
    const def = defById.get(asset.id);
    return def ? { ...asset, name: def.name, kind: def.kind, defaultScale: def.defaultScale } : asset;
  });
  return [...refreshed, ...defaults.filter((asset) => !storedIds.has(asset.id))];
}

export function builderContentToGameContent(base: GameContent, builder: BuilderContent): GameContent {
  const activeMap = builder.maps.find((map) => map.id === builder.activeMapId) ?? builder.maps[0];
  return normalizeContentSchema({
    ...normalizeContentSchema(base),
    activeMapId: activeMap?.id ?? builder.activeMapId,
    board: activeMap ? cloneTiles(activeMap.board) : base.board,
    maps: builder.maps.map(cloneMap),
    assetCatalog: builder.assetCatalog.map((asset) => ({ ...asset })),
  });
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
      // Las mesetas duplicadas reciben ids frescos para no arrastrar los originales.
      copy.terraces = (copy.terraces ?? []).map((terrace, index) => ({ ...terrace, id: `terrace-${index + 1}` }));
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
    case "delete_map": {
      const activeIndex = state.content.maps.findIndex((map) => map.id === state.activeMapId);
      if (state.content.maps.length <= 1 || activeIndex < 0) {
        return { ...state, message: "No se puede eliminar el único mapa" };
      }
      const deletedMap = state.content.maps[activeIndex];
      const maps = state.content.maps.filter((_, index) => index !== activeIndex);
      const nextMap = maps[Math.min(activeIndex, maps.length - 1)] ?? maps[0];
      return {
        ...state,
        activeMapId: nextMap.id,
        content: { ...state.content, activeMapId: nextMap.id, maps },
        selection: nextMap.board[0] ? { kind: "node", id: nextMap.board[0].id } : null,
        pendingRouteFrom: null,
        message: `Mapa eliminado: ${deletedMap.name}`,
      };
    }
    case "update_map":
      return updateActiveMapState(state, (map) => ({ ...map, ...event.patch }), "Mapa actualizado");
    case "update_board_shape":
      return updateActiveMapState(
        state,
        (map) => {
          const next = normalizeBoardShape({ ...ensureBoardShape(map), ...event.patch });
          return { ...map, boardShape: { ...next, borderEdges: perimeterEdges(next) } };
        },
        "Borde del mapa actualizado"
      );
    case "toggle_blocked_cell":
      return updateActiveMapState(
        state,
        (map) => {
          const boardShape = ensureBoardShape(map);
          const point = gridPoint(event.point);
          const blockedCells = boardShape.blockedCells ?? [];
          const exists = blockedCells.some((cell) => sameGridPoint(cell, point));
          return {
            ...map,
            boardShape: {
              ...boardShape,
              blockedCells: exists ? blockedCells.filter((cell) => !sameGridPoint(cell, point)) : [...blockedCells, point],
            },
          };
        },
        "Forma del tablero actualizada"
      );
    case "add_border_edge":
      return updateActiveMapState(
        state,
        (map) => {
          const boardShape = ensureBoardShape(map);
          const edge = normalizeBorderEdge(event.edge, boardShape.borderEdges ?? [], boardShape);
          return { ...map, boardShape: { ...boardShape, borderEdges: [...(boardShape.borderEdges ?? []), edge] } };
        },
        "Borde agregado"
      );
    case "split_border_edge":
      return updateActiveMapState(
        state,
        (map) => {
          const boardShape = ensureBoardShape(map);
          const point = clampGridPoint(event.point, boardShape);
          const edgeIndex = (boardShape.borderEdges ?? []).findIndex((edge) => edge.id === event.id);
          if (edgeIndex < 0) return map;
          const edges = [...(boardShape.borderEdges ?? [])];
          const edge = edges[edgeIndex];
          if (sameGridPoint(edge.from, point) || sameGridPoint(edge.to, point)) return map;
          const first: MapBorderEdge = { ...edge, to: point };
          const second: MapBorderEdge = {
            ...edge,
            id: nextBorderEdgeId(edges),
            from: point,
            to: { ...edge.to },
          };
          edges.splice(edgeIndex, 1, first, second);
          return { ...map, boardShape: normalizeBoardShape({ ...boardShape, borderEdges: edges }) };
        },
        "Punto de borde agregado"
      );
    case "move_border_point":
      return updateActiveMapState(
        state,
        (map) => {
          const boardShape = ensureBoardShape(map);
          const from = gridPoint(event.from);
          const to = gridPoint(event.to);
          const movedEdges = (boardShape.borderEdges ?? perimeterEdges(boardShape)).map((edge) => ({
            ...edge,
            from: sameGridPoint(edge.from, from) ? to : edge.from,
            to: sameGridPoint(edge.to, from) ? to : edge.to,
          }));
          return { ...map, boardShape: normalizeBoardShape(boardShapeFromEdges(boardShape, movedEdges)) };
        },
        "Punto de borde movido"
      );
    case "reset_border_edges":
      return updateActiveMapState(
        state,
        (map) => {
          const boardShape = ensureBoardShape(map);
          return { ...map, boardShape: { ...boardShape, borderEdges: perimeterEdges(boardShape) } };
        },
        "Borde reiniciado"
      );
    case "update_border_edge":
      return updateActiveMapState(
        state,
        (map) => {
          const boardShape = ensureBoardShape(map);
          return {
            ...map,
            boardShape: {
              ...boardShape,
              borderEdges: (boardShape.borderEdges ?? []).map((edge) =>
                edge.id === event.id ? normalizeBorderEdge({ ...edge, ...event.patch }, boardShape.borderEdges ?? [], boardShape, edge.id) : edge
              ),
            },
          };
        },
        "Borde actualizado"
      );
    case "remove_border_edge":
      return updateActiveMapState(
        state,
        (map) => {
          const boardShape = ensureBoardShape(map);
          return { ...map, boardShape: { ...boardShape, borderEdges: (boardShape.borderEdges ?? []).filter((edge) => edge.id !== event.id) } };
        },
        "Borde eliminado"
      );
    case "select":
      return { ...state, selection: event.selection, pendingRouteFrom: null, message: selectionMessage(event.selection) };
    case "add_node":
      return updateActiveMapState(
        state,
        (map) => {
          const tile: Tile = {
            id: nextTileId(map.board),
            type: event.tileType ?? "minigame",
            layout: coerceLayoutForMap(map, event.point),
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
            tile.id === event.id ? { ...tile, layout: coerceLayoutForMap(map, event.point, tile.layout) } : tile
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
                position: coerceLayoutForMap(map, event.point),
                scale: event.scale ?? state.content.assetCatalog.find((asset) => asset.id === event.assetId)?.defaultScale ?? 1,
              },
            ],
          };
        },
        "Map prop agregado",
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
              ? { ...artifact, position: coerceLayoutForMap(map, event.point, artifact.position) }
              : artifact
          ),
        }),
        "Map prop movido"
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
        "Map prop actualizado"
      );
    case "add_terrace": {
      let createdId = "";
      return updateActiveMapState(
        state,
        (map) => {
          createdId = nextTerraceId(map.terraces ?? []);
          const rect = normalizeTerraceRect(event.rect);
          return {
            ...map,
            terraces: [
              ...(map.terraces ?? []),
              {
                id: createdId,
                ...rect,
                elevation: event.elevation ?? DEFAULT_TERRACE_ELEVATION,
                surface: event.surface ?? "grass",
              },
            ],
          };
        },
        "Meseta agregada",
        () => ({ kind: "terrace", id: createdId })
      );
    }
    case "update_terrace":
      return updateActiveMapState(
        state,
        (map) => ({
          ...map,
          terraces: (map.terraces ?? []).map((terrace) =>
            terrace.id === event.id ? normalizeTerracePatch(terrace, event.patch) : terrace
          ),
        }),
        "Meseta actualizada"
      );
    case "move_terrace":
      return updateActiveMapState(
        state,
        (map) => ({
          ...map,
          terraces: (map.terraces ?? []).map((terrace) => {
            if (terrace.id !== event.id) return terrace;
            const minX = round(event.minX, 0.5);
            const minY = round(event.minY, 0.5);
            return {
              ...terrace,
              minX,
              minY,
              maxX: minX + (terrace.maxX - terrace.minX),
              maxY: minY + (terrace.maxY - terrace.minY),
            };
          }),
        }),
        "Meseta movida"
      );
    case "resize_terrace":
      return updateActiveMapState(
        state,
        (map) => ({
          ...map,
          terraces: (map.terraces ?? []).map((terrace) => {
            if (terrace.id !== event.id) return terrace;
            const x = round(event.point.x, 0.5);
            const y = round(event.point.y, 0.5);
            const next: MapTerrace = { ...terrace };
            if (event.corner === "nw" || event.corner === "sw") next.minX = x;
            else next.maxX = x;
            if (event.corner === "nw" || event.corner === "ne") next.minY = y;
            else next.maxY = y;
            return { ...next, ...normalizeTerraceRect(next) };
          }),
        }),
        "Meseta redimensionada"
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

export function getSelectedTerrace(map: MapDefinition, selection: BuilderSelection): MapTerrace | null {
  return selection?.kind === "terrace" ? (map.terraces ?? []).find((terrace) => terrace.id === selection.id) ?? null : null;
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
  const terraceIds = new Set<string>();
  for (const terrace of map.terraces ?? []) {
    if (terraceIds.has(terrace.id)) errors.push(`Meseta duplicada: ${terrace.id}`);
    terraceIds.add(terrace.id);
    if (terrace.minX > terrace.maxX || terrace.minY > terrace.maxY) {
      errors.push(`Meseta ${terrace.id} tiene un rectángulo inválido`);
    }
    if (!Number.isFinite(terrace.elevation) || terrace.elevation < 0 || terrace.elevation > MAX_TERRACE_ELEVATION) {
      errors.push(`Meseta ${terrace.id} tiene elevación fuera de rango (0 a ${MAX_TERRACE_ELEVATION})`);
    }
  }
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
    const updated = syncMapProps(update(map));
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
      if (selection.kind === "terrace") {
        return { ...map, terraces: (map.terraces ?? []).filter((terrace) => terrace.id !== selection.id) };
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
  return ["minigame", "trivia", "vote", "judge", "groom", "reaction", "estimate"].includes(type);
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
    mapProps: [],
    terraces: [],
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
  const artifacts = cloneArtifacts(map.artifacts);
  return {
    ...map,
    theme: map.theme ? { ...map.theme } : undefined,
    board: cloneTiles(map.board),
    routes: cloneRoutes(map.routes),
    artifacts,
    mapProps: cloneArtifacts(artifacts),
    terraces: cloneTerraces(map.terraces),
    boardShape: cloneBoardShape(map.boardShape),
  };
}

function syncMapProps(map: MapDefinition): MapDefinition {
  return { ...map, mapProps: cloneArtifacts(map.artifacts) };
}

function cloneTerraces(terraces?: MapTerrace[]): MapTerrace[] {
  return (terraces ?? []).map((terrace) => ({ ...terrace }));
}

function nextTerraceId(terraces: MapTerrace[]): string {
  const used = new Set(terraces.map((terrace) => terrace.id));
  let index = terraces.length + 1;
  let id = `terrace-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `terrace-${index}`;
  }
  return id;
}

/** Ajusta el rect a la grilla de 0.5 y ordena min/max. */
function normalizeTerraceRect(rect: TerraceRect): TerraceRect {
  const x1 = round(rect.minX, 0.5);
  const x2 = round(rect.maxX, 0.5);
  const y1 = round(rect.minY, 0.5);
  const y2 = round(rect.maxY, 0.5);
  return {
    minX: Math.min(x1, x2),
    minY: Math.min(y1, y2),
    maxX: Math.max(x1, x2),
    maxY: Math.max(y1, y2),
  };
}

function normalizeTerracePatch(terrace: MapTerrace, patch: Partial<Omit<MapTerrace, "id">>): MapTerrace {
  const next: MapTerrace = { ...terrace, ...patch };
  const touchesRect =
    patch.minX !== undefined || patch.minY !== undefined || patch.maxX !== undefined || patch.maxY !== undefined;
  if (touchesRect) return { ...next, ...normalizeTerraceRect(next) };
  return next;
}

function cloneTiles(board: Tile[]): Tile[] {
  return board.map((tile) => ({
    ...tile,
    layout: tile.layout ? { ...tile.layout } : undefined,
    storyParams: tile.storyParams ? { ...tile.storyParams } : undefined,
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

function normalizeAssetCatalog(assetCatalog: MapAssetDef[]): MapAssetDef[] {
  return assetCatalog.map((asset) => ({
    ...asset,
    footprint: asset.footprint ? { ...asset.footprint } : defaultAssetFootprint(asset),
    projection: cloneAssetProjection(asset.projection),
  }));
}

function cloneAssetProjection(projection?: MapAssetProjection): MapAssetProjection | undefined {
  if (!projection) return undefined;
  return {
    shape: projection.shape,
    bounds: projection.bounds ? { ...projection.bounds } : undefined,
    points: projection.points?.map((point) => ({ ...point })),
  };
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

function createDefaultBoardShape(board: Tile[]): MapBoardShape {
  const layouts = board.map((tile) => tile.layout ?? { x: 0, y: 0 });
  const minX = Math.floor(Math.min(0, ...layouts.map((layout) => layout.x)) - 1);
  const minY = Math.floor(Math.min(0, ...layouts.map((layout) => layout.y)) - 1);
  const maxX = Math.ceil(Math.max(8, ...layouts.map((layout) => layout.x)) + 1);
  const maxY = Math.ceil(Math.max(6, ...layouts.map((layout) => layout.y)) + 1);
  return { minX, minY, maxX, maxY, blockedCells: [], borderEdges: perimeterEdges({ minX, minY, maxX, maxY }) };
}

function ensureBoardShape(map: MapDefinition): MapBoardShape {
  return cloneBoardShape(map.boardShape) ?? createDefaultBoardShape(map.board);
}

function normalizeBoardShape(shape: MapBoardShape): MapBoardShape {
  const minX = round(Math.min(shape.minX, shape.maxX), 1);
  const minY = round(Math.min(shape.minY, shape.maxY), 1);
  const maxX = round(Math.max(shape.minX, shape.maxX), 1);
  const maxY = round(Math.max(shape.minY, shape.maxY), 1);
  const borderEdges = shape.borderEdges?.length
    ? shape.borderEdges.map((edge, index, edges) =>
        normalizeBorderEdge(edge, edges, { minX, minY, maxX, maxY }, edge.id || `edge-${index + 1}`)
      )
    : perimeterEdges({ minX, minY, maxX, maxY });

  return {
    minX,
    minY,
    maxX,
    maxY,
    blockedCells: shape.blockedCells?.map(gridPoint).filter((point) => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY),
    borderEdges,
  };
}

function boardShapeFromEdges(base: MapBoardShape, borderEdges: MapBorderEdge[]): MapBoardShape {
  const points = borderEdges.flatMap((edge) => [edge.from, edge.to]);
  if (points.length === 0) return { ...base, borderEdges: perimeterEdges(base) };
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    ...base,
    minX,
    minY,
    maxX,
    maxY,
    borderEdges,
  };
}

function coerceLayoutForMap(map: MapDefinition, point: TileLayout, current?: TileLayout): TileLayout {
  const rounded = roundLayout(point);
  const boardShape = map.boardShape;
  if (!boardShape) return rounded;
  const candidate: TileLayout = {
    ...rounded,
    x: clamp(rounded.x, boardShape.minX, boardShape.maxX),
    y: clamp(rounded.y, boardShape.minY, boardShape.maxY),
  };
  if (!isBlockedCell(boardShape, candidate)) return candidate;
  if (current) return coerceLayoutForMap(map, current);
  return nearestOpenLayout(boardShape, candidate);
}

function nearestOpenLayout(boardShape: MapBoardShape, point: TileLayout): TileLayout {
  for (let radius = 0; radius <= Math.max(boardShape.maxX - boardShape.minX, boardShape.maxY - boardShape.minY); radius += 1) {
    for (let y = boardShape.minY; y <= boardShape.maxY; y += 1) {
      for (let x = boardShape.minX; x <= boardShape.maxX; x += 1) {
        if (Math.abs(x - point.x) + Math.abs(y - point.y) !== radius) continue;
        const candidate = { ...point, x, y };
        if (!isBlockedCell(boardShape, candidate)) return candidate;
      }
    }
  }
  return { ...point, x: boardShape.minX, y: boardShape.minY };
}

function isBlockedCell(boardShape: MapBoardShape, layout: Pick<TileLayout, "x" | "y">): boolean {
  return !!boardShape.blockedCells?.some((cell) => sameGridPoint(cell, gridPoint(layout)));
}

function normalizeBorderEdge(
  edge: Partial<MapBorderEdge> | undefined,
  existing: MapBorderEdge[],
  boardShape: Pick<MapBoardShape, "minX" | "minY" | "maxX" | "maxY">,
  currentId?: string
): MapBorderEdge {
  return {
    id: currentId ?? edge?.id ?? nextBorderEdgeId(existing),
    from: clampGridPoint(edge?.from ?? { x: boardShape.minX, y: boardShape.minY }, boardShape),
    to: clampGridPoint(edge?.to ?? { x: boardShape.maxX, y: boardShape.minY }, boardShape),
    terrain: edge?.terrain,
    label: edge?.label,
  };
}

function perimeterEdges(boardShape: Pick<MapBoardShape, "minX" | "minY" | "maxX" | "maxY">): MapBorderEdge[] {
  return [
    { id: "edge-top", from: { x: boardShape.minX, y: boardShape.minY }, to: { x: boardShape.maxX, y: boardShape.minY } },
    { id: "edge-right", from: { x: boardShape.maxX, y: boardShape.minY }, to: { x: boardShape.maxX, y: boardShape.maxY } },
    { id: "edge-bottom", from: { x: boardShape.maxX, y: boardShape.maxY }, to: { x: boardShape.minX, y: boardShape.maxY } },
    { id: "edge-left", from: { x: boardShape.minX, y: boardShape.maxY }, to: { x: boardShape.minX, y: boardShape.minY } },
  ];
}

function nextBorderEdgeId(edges: MapBorderEdge[]): string {
  const used = new Set(edges.map((edge) => edge.id));
  let index = edges.length + 1;
  let id = `edge-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `edge-${index}`;
  }
  return id;
}

function gridPoint(point: Pick<TileLayout, "x" | "y">): MapGridPoint {
  return { x: round(point.x, 1), y: round(point.y, 1) };
}

function clampGridPoint(
  point: Pick<TileLayout, "x" | "y">,
  boardShape: Pick<MapBoardShape, "minX" | "minY" | "maxX" | "maxY">
): MapGridPoint {
  return {
    x: clamp(round(point.x, 1), boardShape.minX, boardShape.maxX),
    y: clamp(round(point.y, 1), boardShape.minY, boardShape.maxY),
  };
}

function sameGridPoint(a: MapGridPoint, b: MapGridPoint): boolean {
  return a.x === b.x && a.y === b.y;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toolMessage(tool: BuilderTool): string {
  const labels: Record<BuilderTool, string> = {
    select: "Seleccioná o arrastrá elementos",
    cell: "Click en el mapa para crear casilleros",
    route: "Click en dos casilleros para conectarlos",
    artifact: "Click en el mapa para colocar map props",
    terrace: "Arrastrá en el lienzo para dibujar mesetas de terreno",
    json: "Importá o exportá JSON",
  };
  return labels[tool];
}

function selectionMessage(selection: BuilderSelection): string {
  if (!selection) return "Sin selección";
  if (selection.kind === "node") return `Casillero ${selection.id} seleccionado`;
  if (selection.kind === "route") return `Ruta ${selection.id} seleccionada`;
  if (selection.kind === "terrace") return `Meseta ${selection.id} seleccionada`;
  return `Map prop ${selection.id} seleccionado`;
}
