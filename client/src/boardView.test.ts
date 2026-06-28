import assert from "node:assert/strict";
import { cameraFocus, movementPath, screenPosition, tableBaseBounds, tableCanvasPoints } from "./boardView";

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

const canvasPoints = tableCanvasPoints(
  [
    { id: 0, layout: { x: 0, y: 0 } },
    { id: 6, layout: { x: 6, y: 0 } },
  ],
  max,
  max
);
assert.deepEqual(canvasPoints, [
  { id: 0, left: 50, top: 18 },
  { id: 6, left: 84, top: 50 },
]);
assert.deepEqual(tableBaseBounds(canvasPoints, 4), { left: 46, top: 14, right: 88, bottom: 54, width: 42, height: 40 });
assert.deepEqual(tableBaseBounds([], 8), { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 });
