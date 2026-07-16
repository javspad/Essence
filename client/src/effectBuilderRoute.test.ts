import assert from "node:assert/strict";
import { test } from "node:test";
import { sameOriginReturnRoute } from "./effectBuilderRoute";

const origin = "http://localhost:5173";

test("Effect Builder preserves same-origin return routes", () => {
  assert.equal(sameOriginReturnRoute("/tools", origin), "/tools");
  assert.equal(
    sameOriginReturnRoute("/event-builder?section=effects#new", origin),
    "/event-builder?section=effects#new"
  );
  assert.equal(
    sameOriginReturnRoute("http://localhost:5173/map-builder?effect=slow", origin),
    "/map-builder?effect=slow"
  );
});

test("Effect Builder rejects external and malformed return routes", () => {
  assert.equal(sameOriginReturnRoute("//example.com/tools", origin), undefined);
  assert.equal(sameOriginReturnRoute("https://example.com/tools", origin), undefined);
  assert.equal(sameOriginReturnRoute("http://[", origin), undefined);
});
