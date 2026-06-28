import assert from "node:assert/strict";
import { board3DSlots, layoutToWorldPosition } from "./board3d";
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

const worldSlots = board3DSlots(
  Array.from({ length: 24 }, (_, id) => ({ id })),
  2
);
assert.equal(worldSlots.length, 24);
assert.deepEqual(worldSlots[0], { id: 0, position: [-6, 0, -6], rotationY: 0 });
assert.deepEqual(worldSlots[6], { id: 6, position: [6, 0, -6], rotationY: Math.PI / 2 });
assert.deepEqual(worldSlots[12], { id: 12, position: [6, 0, 6], rotationY: Math.PI });
