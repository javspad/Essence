import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeveloperToolsEnabled } from "@essence/shared/devTools";

test("developer tools stay disabled without an explicit positive flag", () => {
  for (const value of [undefined, null, false, "", "0", "false", "yes", "TRUE", 1]) {
    assert.equal(isDeveloperToolsEnabled(value), false, `expected ${String(value)} to be disabled`);
  }
});

test("developer tools accept only the documented positive values", () => {
  for (const value of [true, "1", "true"]) {
    assert.equal(isDeveloperToolsEnabled(value), true, `expected ${String(value)} to be enabled`);
  }
});
