import assert from "node:assert/strict";
import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";
import type { GameContent, MapAssetDef, MapBoardShape, MapRoute, Tile } from "@essence/shared";
import {
  assetProjectionRadius,
  defaultAssetFootprint,
  projectArtifactFootprint,
  projectGroundPointToMap,
  projectObject3DToGroundPlane,
} from "./artifactProjection";
import { board3DMapBounds, board3DSlots, routeWorldPoints, slotMaterialStyle, terrainMaterialStyle } from "./board3d";
import {
  builderContentToGameContent,
  createInitialMapBuilderState,
  getActiveMap,
  getSelectedTerrace,
  mapBuilderReducer,
  normalizeBuilderContent,
  validateMap,
} from "./mapBuilder";
import {
  eventTriggerScore,
  normalizeGameContentEvents,
  resolveEventActionTargetIds,
  resolveEventForPlayer,
  resolveTileEventForPlayer,
} from "@essence/shared/events";
import { normalizeContentSchema, validateGameContent } from "@essence/shared/contentValidation";

const board: Tile[] = [
  { id: 0, type: "start", layout: { x: 0, y: 0 } },
  { id: 1, type: "minigame", minigameId: "quiz", layout: { x: 1, y: 0 } },
  { id: 2, type: "finish", layout: { x: 2, y: 0 } },
];

const content: GameContent = {
  board,
  minigames: {
    quiz: { type: "vote", content: { question: "test" } },
  },
  dares: {},
  fates: {},
  players: [{ id: "p1", name: "P1" }],
};

const builder = normalizeBuilderContent(content);
assert.equal(builder.maps.length, 1);
assert.equal(builder.maps[0].routes.length, 2);
assert.equal(builder.maps[0].routes[0].from, 0);
assert.equal(builder.maps[0].routes[0].to, 1);
assert.equal(builder.maps[0].board[1].eventId, "event-quiz");

const normalizedEvents = normalizeGameContentEvents(content);
assert.equal(normalizedEvents.events?.["event-quiz"].activity?.type, "vote");

let state = createInitialMapBuilderState(content);
state = mapBuilderReducer(state, { type: "start_route", from: 0 });
state = mapBuilderReducer(state, { type: "finish_route", to: 2 });
const active = getActiveMap(state);
assert.equal(active.routes.some((route) => route.from === 0 && route.to === 2), true);
assert.deepEqual(validateMap(active), []);

state = mapBuilderReducer(state, { type: "update_route", id: active.routes[0].id, patch: { to: 99 } });
assert.equal(validateMap(getActiveMap(state))[0], `Ruta ${active.routes[0].id} llega a 99, que no existe`);

const exported = builderContentToGameContent(content, builder);
assert.equal(exported.activeMapId, builder.activeMapId);
assert.equal(exported.board.length, 3);
assert.equal(exported.board[1].eventId, "event-quiz");
assert.equal(exported.events?.["event-quiz"].activity?.type, "vote");
assert.deepEqual(exported.maps?.[0].mapProps, exported.maps?.[0].artifacts);
assert.equal(slotMaterialStyle("timing" as any).top, "#64748b");
assert.equal(terrainMaterialStyle("legacy-road" as any).top, "#e6cf9d");

const canonicalMapPropImport = normalizeContentSchema({
  ...content,
  activeMapId: "props-map",
  assetCatalog: [{ id: "oak-tree", name: "Pino", kind: "tree" }],
  maps: [
    {
      id: "props-map",
      name: "Props map",
      board,
      routes: [],
      mapProps: [{ id: "tree-1", assetId: "oak-tree", position: { x: 1, y: 1 } }],
    },
  ],
});
assert.equal(canonicalMapPropImport.maps?.[0].artifacts.length, 1);
assert.deepEqual(canonicalMapPropImport.maps?.[0].mapProps, canonicalMapPropImport.maps?.[0].artifacts);
assert.equal(normalizeBuilderContent(canonicalMapPropImport).maps[0].artifacts[0].id, "tree-1");

const invalidSchemaResult = validateGameContent({
  ...content,
  players: [{ id: "p1", name: "P1" }],
  events: {
    "bad-target": {
      name: "Bad target",
      story: { title: "Bad target" },
      actions: [{ type: "coins", value: 3, target: { playerId: "missing" } }],
    },
  },
  activeMapId: "bad-map",
  assetCatalog: [{ id: "oak-tree", name: "Pino", kind: "tree" }],
  maps: [
    {
      id: "bad-map",
      name: "Bad map",
      board,
      routes: [{ id: "bad-route", from: 1, to: 99, terrain: "stone" }],
      artifacts: [{ id: "missing-prop", assetId: "missing-asset", position: { x: 1, y: 1 } }],
    },
  ],
});
assert.deepEqual(invalidSchemaResult.errors, [
  "events.bad-target.actions[0].target references missing player missing",
  "maps.bad-map.routes.bad-route.to references missing board cell 99",
  "maps.bad-map.mapProps.missing-prop references missing asset missing-asset",
]);

const futureCatalogValidation = validateGameContent({
  ...content,
  effects: {
    "bad-effect": { id: "bad-effect", name: "Bad effect" },
  },
});
assert.deepEqual(futureCatalogValidation.errors, ["effects.bad-effect.duration is required"]);

const overrideContent = normalizeGameContentEvents({
  ...content,
  events: {
    "custom-event": {
      name: "Custom event",
      kind: "activity",
      tags: ["dare"],
      story: { title: "Default", prompt: "Default prompt" },
      activity: { type: "prompt", resolutionMode: "selfTap", content: { prompt: "Default prompt" } },
      outcomes: [{ when: "loser", actions: [{ type: "move", delta: -2, target: "loser" }] }],
    },
  },
  playerStories: {
    p1: {
      overrides: [
        {
          eventId: "custom-event",
          story: { prompt: "P1 prompt" },
          activity: { content: { prompt: "P1 activity prompt" } },
          outcomes: [{ when: "winner", actions: [{ type: "coins", value: 5, target: "winner" }] }],
        },
      ],
    },
  },
});
const resolvedOverride = resolveEventForPlayer(overrideContent, "custom-event", { id: "p1" });
assert.equal(resolvedOverride?.story.prompt, "P1 prompt");
assert.equal(resolvedOverride?.activity?.type, "selfTap");
assert.deepEqual(resolvedOverride?.activity?.content, { prompt: "P1 activity prompt" });
assert.equal(resolvedOverride?.outcomes?.[0].when, "winner");

const legacyPromptVoteContent = normalizeGameContentEvents({
  ...content,
  events: {
    "legacy-prompt-vote": {
      name: "Legacy prompt vote",
      kind: "activity",
      story: { prompt: "Vote this dare" },
      activity: { type: "prompt", resolutionMode: "vote", content: { prompt: "Vote this dare" } },
    },
  },
});
assert.equal(legacyPromptVoteContent.events?.["legacy-prompt-vote"].activity?.type, "vote");
assert.deepEqual(legacyPromptVoteContent.events?.["legacy-prompt-vote"].activity?.content, {
  prompt: "Vote this dare",
  question: "Vote this dare",
});

const scopedContent = normalizeGameContentEvents({
  ...content,
  players: [
    { id: "p1", name: "P1" },
    { id: "p2", name: "P2" },
  ],
  events: {
    generic: {
      name: "Generic",
      trigger: { type: "anyPlayer" },
      story: { title: "Generic" },
      activity: { type: "prompt", content: { prompt: "Anyone" } },
    },
    "p1-only": {
      name: "P1 only",
      trigger: { type: "player", playerId: "p1" },
      story: { title: "P1 only" },
      activity: { type: "prompt", content: { prompt: "P1" } },
    },
  },
});
const scopedTile: Tile = { id: 7, type: "dare", eventIds: ["generic", "p1-only"] };
assert.equal(eventTriggerScore(scopedContent.events!.generic, { id: "p2" }), 1);
assert.equal(eventTriggerScore(scopedContent.events!["p1-only"], { id: "p1" }), 2);
assert.equal(eventTriggerScore(scopedContent.events!["p1-only"], { id: "p2" }), 0);
assert.equal(resolveTileEventForPlayer(scopedContent, scopedTile, { id: "p1" })?.id, "p1-only");
assert.equal(resolveTileEventForPlayer(scopedContent, scopedTile, { id: "p2" })?.id, "generic");
assert.equal(resolveTileEventForPlayer(scopedContent, { id: 8, type: "dare", eventIds: ["p1-only"] }, { id: "p2" }), null);
assert.deepEqual(resolveEventActionTargetIds({ playerId: "p2" }, { playerIds: ["p1", "p2"] }), ["p2"]);
assert.deepEqual(resolveEventActionTargetIds("winner", { ranking: ["p1", "p2"] }), ["p1"]);
assert.deepEqual(resolveEventActionTargetIds("loser", { ranking: ["p1", "p2"] }), ["p2"]);
assert.deepEqual(resolveEventActionTargetIds({ rankFrom: 1, rankTo: 2 }, { ranking: ["p1", "p2", "p3"] }), ["p1", "p2"]);

const boundedContent: GameContent = {
  ...content,
  activeMapId: "bounded-map",
  maps: [
    {
      id: "bounded-map",
      name: "Bounded",
      board,
      routes: [],
      artifacts: [],
      boardShape: {
        minX: 0,
        minY: 0,
        maxX: 4,
        maxY: 3,
        blockedCells: [{ x: 2, y: 1 }],
      },
    } as any,
  ],
};

let boundedState = createInitialMapBuilderState(boundedContent);
boundedState = mapBuilderReducer(boundedState, { type: "move_node", id: 1, point: { x: 99, y: -10 } });
assert.deepEqual(getActiveMap(boundedState).board.find((tile) => tile.id === 1)?.layout, { x: 4, y: 0 });

boundedState = mapBuilderReducer(boundedState, { type: "move_node", id: 1, point: { x: 2, y: 1 } });
assert.deepEqual(getActiveMap(boundedState).board.find((tile) => tile.id === 1)?.layout, { x: 4, y: 0 });

const outlineShape = getActiveMap(boundedState).boardShape as MapBoardShape;
const topEdge = outlineShape.borderEdges?.find((edge) => edge.id === "edge-top");
assert.ok(topEdge);
boundedState = mapBuilderReducer(boundedState, { type: "split_border_edge", id: topEdge.id, point: { x: 2, y: 0 } });
assert.equal(getActiveMap(boundedState).boardShape?.borderEdges?.length, (outlineShape.borderEdges?.length ?? 0) + 1);
boundedState = mapBuilderReducer(boundedState, { type: "move_border_point", from: { x: 2, y: 0 }, to: { x: 3, y: -1 } });
const movedOutline = getActiveMap(boundedState).boardShape as MapBoardShape;
assert.equal(movedOutline.borderEdges?.filter((edge) => edge.from.x === 3 && edge.from.y === -1 || edge.to.x === 3 && edge.to.y === -1).length, 2);

const shapedAssetContent: GameContent = {
  ...content,
  assetCatalog: [{ id: "wide-van", name: "Wide van", kind: "vehicle", defaultScale: 1.5 }],
};
const shapedAssetState = createInitialMapBuilderState(shapedAssetContent);
assert.deepEqual((shapedAssetState.content.assetCatalog[0] as any).footprint, { width: 1.5, height: 0.75, shape: "rect" });

const placedAssetState = mapBuilderReducer(shapedAssetState, { type: "add_artifact", assetId: "wide-van", point: { x: 1, y: 1 } });
assert.equal(getActiveMap(placedAssetState).artifacts[0].scale, 1.5);

const builtinTree: MapAssetDef = { id: "oak-tree", name: "Pino", kind: "tree" };
assert.deepEqual(defaultAssetFootprint(builtinTree), { width: 0.325926, height: 0.325926, shape: "circle" });
assert.equal(assetProjectionRadius(builtinTree).toFixed(6), "0.162963");
assert.deepEqual(projectGroundPointToMap({ x: 1, y: 0 }, 90), { x: 0, y: -1 });

const projectedHouse = projectArtifactFootprint(
  { position: { x: 1, y: 1.5, rot: 90 }, scale: 1 },
  { id: "club-house", name: "Casa / escuela", kind: "house" }
);
assert.equal(projectedHouse.bounds.minY < 1.5, true);
assert.equal(projectedHouse.width.toFixed(6), "0.992592");
assert.equal(projectedHouse.height.toFixed(6), "1.718518");

const projectionMaterial = new MeshBasicMaterial();
const projectionMesh = new Mesh(new BoxGeometry(2, 3, 4), projectionMaterial);
const objectProjection = projectObject3DToGroundPlane(projectionMesh, 2);
assert.equal(objectProjection.width, 1);
assert.equal(objectProjection.height, 2);
projectionMesh.geometry.dispose();
projectionMaterial.dispose();

const routeWithPoint: MapRoute = {
  id: "r-0-2",
  from: 0,
  to: 2,
  terrain: "water",
  points: [{ x: 1, y: 1 }],
};
const bounds = board3DMapBounds(board, [routeWithPoint], []);
assert.equal(bounds.minX, 0);
assert.equal(bounds.width, 2);
const slots = board3DSlots(board, 2, bounds);
const slotPositions = new Map(slots.map((slot) => [slot.id, slot.position] as const));
assert.equal(routeWorldPoints(routeWithPoint, slotPositions, bounds).length, 3);
assert.equal(terrainMaterialStyle("water").top, "#67d6f7");

const shapedBounds = board3DMapBounds(board, [routeWithPoint], [], {
  minX: -2,
  minY: -1,
  maxX: 5,
  maxY: 4,
  borderEdges: [{ id: "edge-top", from: { x: -2, y: -1 }, to: { x: 5, y: -1 } }],
});
assert.equal(shapedBounds.minX, -2);
assert.equal(shapedBounds.width, 7);

// --- Mesetas (terraces) ---

// Sin terrazas en el contenido, normalize inicializa el array vacío.
assert.deepEqual(normalizeBuilderContent(content).maps[0].terraces, []);

const terraceContent: GameContent = {
  ...content,
  activeMapId: "terrace-map",
  maps: [
    {
      id: "terrace-map",
      name: "Con mesetas",
      board,
      routes: [],
      artifacts: [],
      terraces: [{ id: "meseta-original", minX: 0, minY: 0, maxX: 2, maxY: 2, elevation: 0.55, surface: "grass" }],
    } as any,
  ],
};

let terraceState = createInitialMapBuilderState(terraceContent);
assert.equal(getActiveMap(terraceState).terraces?.length, 1);

// add_terrace: ajusta el rect a la grilla de 0.5, elevación y superficie por defecto, y selecciona la meseta.
terraceState = mapBuilderReducer(terraceState, { type: "add_terrace", rect: { minX: 3.2, minY: 1.1, maxX: 5.4, maxY: 2.9 } });
const addedTerrace = getActiveMap(terraceState).terraces?.find((terrace) => terrace.id === "terrace-2");
assert.ok(addedTerrace);
assert.deepEqual(
  { minX: addedTerrace.minX, minY: addedTerrace.minY, maxX: addedTerrace.maxX, maxY: addedTerrace.maxY },
  { minX: 3, minY: 1, maxX: 5.5, maxY: 3 }
);
assert.equal(addedTerrace.elevation, 0.55);
assert.equal(addedTerrace.surface, "grass");
assert.deepEqual(terraceState.selection, { kind: "terrace", id: "terrace-2" });
assert.equal(getSelectedTerrace(getActiveMap(terraceState), terraceState.selection)?.id, "terrace-2");

// update_terrace: patch parcial de elevación / superficie / color / etiqueta.
terraceState = mapBuilderReducer(terraceState, {
  type: "update_terrace",
  id: "terrace-2",
  patch: { elevation: 1.1, surface: "stone", color: "#e8a7a0", label: "Meta" },
});
const updatedTerrace = getActiveMap(terraceState).terraces?.find((terrace) => terrace.id === "terrace-2");
assert.equal(updatedTerrace?.elevation, 1.1);
assert.equal(updatedTerrace?.surface, "stone");
assert.equal(updatedTerrace?.color, "#e8a7a0");
assert.equal(updatedTerrace?.label, "Meta");

// update_terrace con rect invertido lo reordena.
terraceState = mapBuilderReducer(terraceState, { type: "update_terrace", id: "terrace-2", patch: { minX: 10 } });
const reorderedTerrace = getActiveMap(terraceState).terraces?.find((terrace) => terrace.id === "terrace-2");
assert.equal(reorderedTerrace?.minX, 5.5);
assert.equal(reorderedTerrace?.maxX, 10);
terraceState = mapBuilderReducer(terraceState, { type: "update_terrace", id: "terrace-2", patch: { minX: 3, maxX: 5.5 } });

// move_terrace: mueve la esquina min ajustada a 0.5 y conserva el tamaño.
terraceState = mapBuilderReducer(terraceState, { type: "move_terrace", id: "terrace-2", minX: 1.26, minY: -0.9 });
const movedTerrace = getActiveMap(terraceState).terraces?.find((terrace) => terrace.id === "terrace-2");
assert.deepEqual(
  { minX: movedTerrace?.minX, minY: movedTerrace?.minY, maxX: movedTerrace?.maxX, maxY: movedTerrace?.maxY },
  { minX: 1.5, minY: -1, maxX: 4, maxY: 1 }
);

// resize_terrace: la esquina arrastrada actualiza el rect (con snap a 0.5).
terraceState = mapBuilderReducer(terraceState, { type: "resize_terrace", id: "terrace-2", corner: "se", point: { x: 2.2, y: 0.4 } });
const resizedTerrace = getActiveMap(terraceState).terraces?.find((terrace) => terrace.id === "terrace-2");
assert.deepEqual(
  { minX: resizedTerrace?.minX, minY: resizedTerrace?.minY, maxX: resizedTerrace?.maxX, maxY: resizedTerrace?.maxY },
  { minX: 1.5, minY: -1, maxX: 2, maxY: 0.5 }
);

// resize que cruza la esquina opuesta reordena min/max en vez de romper el rect.
terraceState = mapBuilderReducer(terraceState, { type: "resize_terrace", id: "terrace-2", corner: "se", point: { x: 0, y: -3 } });
const flippedTerrace = getActiveMap(terraceState).terraces?.find((terrace) => terrace.id === "terrace-2");
assert.deepEqual(
  { minX: flippedTerrace?.minX, minY: flippedTerrace?.minY, maxX: flippedTerrace?.maxX, maxY: flippedTerrace?.maxY },
  { minX: 0, minY: -3, maxX: 1.5, maxY: -1 }
);

// Export → import: las mesetas sobreviven el round-trip de JSON.
const terraceExport = builderContentToGameContent(content, terraceState.content);
const exportedMap = terraceExport.maps?.find((map) => map.id === "terrace-map");
assert.equal(exportedMap?.terraces?.length, 2);
const reimported = normalizeBuilderContent(JSON.parse(JSON.stringify(terraceExport)) as GameContent);
assert.deepEqual(reimported.maps.find((map) => map.id === "terrace-map")?.terraces, getActiveMap(terraceState).terraces);

// duplicate_map: clona las mesetas con ids nuevos.
terraceState = mapBuilderReducer(terraceState, { type: "duplicate_map" });
const duplicatedMap = getActiveMap(terraceState);
assert.notEqual(duplicatedMap.id, "terrace-map");
assert.equal(duplicatedMap.terraces?.length, 2);
assert.deepEqual(duplicatedMap.terraces?.map((terrace) => terrace.id), ["terrace-1", "terrace-2"]);
assert.equal(duplicatedMap.terraces?.[0].elevation, 0.55);
const originalMap = terraceState.content.maps.find((map) => map.id === "terrace-map");
assert.equal(originalMap?.terraces?.[0].id, "meseta-original");
assert.notEqual(duplicatedMap.terraces?.[0], originalMap?.terraces?.[0]);

// delete_selected elimina la meseta seleccionada.
terraceState = mapBuilderReducer(terraceState, { type: "select", selection: { kind: "terrace", id: "terrace-2" } });
terraceState = mapBuilderReducer(terraceState, { type: "delete_selected" });
assert.equal(getActiveMap(terraceState).terraces?.length, 1);
assert.equal(getActiveMap(terraceState).terraces?.some((terrace) => terrace.id === "terrace-2"), false);
assert.equal(terraceState.selection, null);

// validateMap: rect inválido, elevación fuera de rango e ids duplicados.
const invalidTerraceMap = {
  ...getActiveMap(terraceState),
  terraces: [
    { id: "meseta-mala", minX: 5, minY: 0, maxX: 1, maxY: 2, elevation: 9 },
    { id: "meseta-mala", minX: 0, minY: 0, maxX: 1, maxY: 1, elevation: 0.55 },
  ],
};
const terraceErrors = validateMap(invalidTerraceMap);
assert.ok(terraceErrors.includes("Meseta meseta-mala tiene un rectángulo inválido"));
assert.ok(terraceErrors.includes("Meseta meseta-mala tiene elevación fuera de rango (0 a 3)"));
assert.ok(terraceErrors.includes("Meseta duplicada: meseta-mala"));
assert.deepEqual(validateMap(getActiveMap(terraceState)), []);
