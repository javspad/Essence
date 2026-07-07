import assert from "node:assert/strict";
import type { GameState } from "@essence/shared";
import { normalizeGameState } from "./gameState";

const legacyState = {
  code: "OLD1",
  roomName: "Legacy room",
  phase: "turn",
  board: [{ id: 0, type: "start" }],
  players: [],
  turnOrder: [],
  activeIndex: 0,
  round: 1,
  boardLength: 1,
  lastRoll: null,
  activeMinigame: null,
  activeEvent: null,
  reveal: null,
  winnerId: null,
} as unknown as GameState;

const normalized = normalizeGameState(legacyState);

assert.deepEqual(normalized.activeEffects, []);
assert.deepEqual(normalized.effects, {});
assert.equal(normalized.lastBaseRoll, null);
