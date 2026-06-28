import assert from "node:assert/strict";
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
