import assert from "node:assert/strict";
import {
  applyCameraIntent,
  board3DSlots,
  boardCameraOverviewShot,
  boardMotionSettings,
  boardRenderSettings,
  cameraFollowPosition,
  frameLerp,
  layoutToWorldPosition,
  orbitLightPosition,
  slotMaterialStyle,
  supportsWebGL,
  tokenPathPositions,
  tokenWorldPosition,
} from "./board3d";
import { cameraFocus, movementPath, screenPosition } from "./boardView";

const max = 6;

assert.deepEqual(screenPosition({ x: 0, y: 0 }, max, max), { left: 50, top: 18 });

assert.deepEqual(cameraFocus(screenPosition({ x: 6, y: 0 }, max, max)), {
  x: -18,
  y: 0,
  scale: 1.08,
});
assert.deepEqual(cameraFocus(screenPosition({ x: 0, y: 0 }, max, max)), {
  x: 0,
  y: 18,
  scale: 1.08,
});

assert.deepEqual(movementPath(5, 3, 24), [2, 3, 4, 5]);
assert.deepEqual(movementPath(2, 6, 24), [0, 1, 2]);
assert.deepEqual(movementPath(5, null, 24), []);

assert.deepEqual(layoutToWorldPosition({ x: 0, y: 0 }, max, max, 2), [-6, 0, -6]);
assert.deepEqual(layoutToWorldPosition({ x: 6, y: 6, z: 0.5 }, max, max, 2), [6, 0.5, 6]);
assert.deepEqual(tokenWorldPosition([1, 0, 2], 0, 1), [1, 0.36, 2]);
assert.deepEqual(tokenWorldPosition([1, 0, 2], 0, 2), [0.86, 0.36, 2]);
assert.deepEqual(tokenWorldPosition([1, 0, 2], 1, 2), [1.14, 0.36, 2]);
assert.deepEqual(cameraFollowPosition([2, 0, 3]), [2, 3.9, 9.6]);

const cameraState = { mode: "followActivePlayer" as const, focusedPlayerId: null };
assert.deepEqual(applyCameraIntent(cameraState, { kind: "focusPlayer", playerId: "bob" }), {
  mode: "followActivePlayer",
  focusedPlayerId: "bob",
});
assert.deepEqual(applyCameraIntent({ mode: "followActivePlayer", focusedPlayerId: "bob" }, { kind: "frameOverview" }), {
  mode: "overview",
  focusedPlayerId: "bob",
});
assert.deepEqual(applyCameraIntent({ mode: "overview", focusedPlayerId: "bob" }, { kind: "resetToActivePlayer" }), {
  mode: "followActivePlayer",
  focusedPlayerId: null,
});

const cameraBounds = { minX: 0, minY: 0, maxX: 4, maxY: 3, width: 4, height: 3, spacing: 2 };
assert.deepEqual(boardCameraOverviewShot(cameraBounds), {
  position: [0, 11, 11.8],
  look: [0, 0.35, 0],
});
assert.deepEqual(boardCameraOverviewShot(cameraBounds, [{ elevation: 2 }]), {
  position: [0, 13, 11.8],
  look: [0, 1.25, 0],
});

const worldSlots = board3DSlots(
  Array.from({ length: 24 }, (_, id) => ({ id })),
  2
);
assert.equal(worldSlots.length, 24);
assert.deepEqual(worldSlots[0], { id: 0, position: [-6, 0, -6], rotationY: 0 });
assert.deepEqual(worldSlots[6], { id: 6, position: [6, 0, -6], rotationY: Math.PI / 2 });
assert.deepEqual(worldSlots[12], { id: 12, position: [6, 0, 6], rotationY: Math.PI });

const slotPositions = new Map(worldSlots.map((slot) => [slot.id, slot.position] as const));
assert.deepEqual(tokenPathPositions(slotPositions, [0, 1, 2], 0, 1), [
  [-6, 0.36, -6],
  [-4, 0.36, -6],
  [-2, 0.36, -6],
]);

assert.deepEqual(boardMotionSettings(false, true), {
  cameraLerpSpeed: 3,
  tokenStepSeconds: 0.22,
  orbitLights: true,
});
assert.deepEqual(boardMotionSettings(true, true), {
  cameraLerpSpeed: 0,
  tokenStepSeconds: 0,
  orbitLights: false,
});
assert.deepEqual(boardMotionSettings(false, false), {
  cameraLerpSpeed: 0,
  tokenStepSeconds: 0,
  orbitLights: false,
});
assert.deepEqual(boardRenderSettings({ devicePixelRatio: 2, viewportWidth: 900, visible: true }), {
  dpr: [1, 1.5],
  antialias: true,
  shadows: true,
  frameloop: "always",
  powerPreference: "high-performance",
});
assert.deepEqual(boardRenderSettings({ devicePixelRatio: 3, viewportWidth: 390, visible: true }), {
  dpr: [1, 1],
  antialias: false,
  shadows: false,
  frameloop: "always",
  powerPreference: "default",
});
assert.deepEqual(boardRenderSettings({ devicePixelRatio: 2, viewportWidth: 900, visible: false }), {
  dpr: [1, 1.5],
  antialias: true,
  shadows: false,
  frameloop: "demand",
  powerPreference: "high-performance",
});
assert.equal(frameLerp(0.1, 3), 0.3);
assert.equal(frameLerp(0.1, 0), 1);
assert.deepEqual(orbitLightPosition(0, false), [5.5, 4.8, 0]);
assert.deepEqual(orbitLightPosition(10, true), [-4.5, 5.2, -3.5]);
assert.equal(slotMaterialStyle("finish").decal, "spark");
assert.equal(slotMaterialStyle("reaction").decal, "bolt");
assert.equal(supportsWebGL({ getContext: (name) => (name === "webgl" ? {} : null) }), true);
assert.equal(supportsWebGL({ getContext: () => null }), false);
assert.equal(
  supportsWebGL({
    getContext: () => {
      throw new Error("no canvas");
    },
  }),
  false
);
