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
import { board3DMapBounds, board3DSlots, routeWorldPoints, terrainMaterialStyle } from "./board3d";
import {
  builderContentToGameContent,
  createInitialMapBuilderState,
  getActiveMap,
  mapBuilderReducer,
  normalizeBuilderContent,
  validateMap,
} from "./mapBuilder";

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
