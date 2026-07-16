import assert from "node:assert/strict";
import type { GameContent, MapDefinition, Tile } from "@essence/shared";
import seedContent from "../../shared/content.json";
import { normalizeContentSchema } from "@essence/shared/contentValidation";
import { simulateMapGames } from "./mapSimulation";

function mapFrom(board: Tile[], id = "simulation-test"): MapDefinition {
  return {
    id,
    name: "Simulation test",
    board,
    routes: [],
    artifacts: [],
  };
}

function contentFor(map: MapDefinition, events: GameContent["events"] = {}): GameContent {
  return {
    board: map.board,
    activeMapId: map.id,
    maps: [map],
    events,
    players: [
      { id: "p1", name: "P1" },
      { id: "p2", name: "P2" },
    ],
    coinPayout: [3, 1],
  };
}

function deterministicView(result: ReturnType<typeof simulateMapGames>) {
  return { ...result, summary: { ...result.summary, runtimeMs: 0 } };
}

const plainMap = mapFrom([
  { id: 0, type: "start" },
  { id: 1, type: "minigame" },
  { id: 2, type: "minigame" },
  { id: 3, type: "minigame" },
  { id: 4, type: "minigame" },
  { id: 5, type: "minigame" },
  { id: 6, type: "finish" },
]);
const plainContent = contentFor(plainMap);
const deterministicConfig = { playerCount: 2, games: 120, seed: 1729, includeTraits: false };
const first = simulateMapGames(plainContent, plainMap, deterministicConfig);
const second = simulateMapGames(plainContent, plainMap, deterministicConfig);
assert.deepEqual(deterministicView(first), deterministicView(second), "same seed should reproduce every simulated decision");

const changedSeed = simulateMapGames(plainContent, plainMap, { ...deterministicConfig, seed: 1730 });
assert.notDeepEqual(first.dice.baseRolls, changedSeed.dice.baseRolls, "a different seed should change the dice sequence");
assert.equal(first.summary.completedGames, deterministicConfig.games);
assert.equal(first.summary.cappedGames, 0);
assert.equal(first.summary.totalLandings, first.summary.totalTurns);
assert.equal(first.cells.reduce((sum, cell) => sum + cell.landings, 0), first.summary.totalLandings);
assert.equal(first.cells[0].landings, 0, "the start position is not counted as a dice landing");
assert.ok(first.sampleTrace.length > 0 && first.sampleTrace.length <= first.config.traceLimit);

const shopMap = mapFrom([
  { id: 0, type: "start" },
  { id: 1, type: "shop", label: "Guaranteed stop" },
  { id: 2, type: "minigame" },
  { id: 3, type: "minigame" },
  { id: 4, type: "minigame" },
  { id: 5, type: "finish" },
], "shop-test");
const shopRuns = simulateMapGames(contentFor(shopMap), shopMap, { playerCount: 1, games: 80, seed: 4, includeTraits: false });
assert.equal(shopRuns.cells[1].shopStops, 80, "the first crossed shop should interrupt every game's opening roll");
assert.equal(shopRuns.cells[1].landings, 80);

const moveEventId = "move-forward";
const effectBoard: Tile[] = [
  { id: 0, type: "start" },
  ...Array.from({ length: 6 }, (_, index): Tile => ({ id: index + 1, type: "fate", eventId: moveEventId })),
  { id: 7, type: "finish" },
];
const effectMap = mapFrom(effectBoard, "effect-test");
const effectRuns = simulateMapGames(
  contentFor(effectMap, {
    [moveEventId]: {
      name: "Step forward",
      activity: { type: "prompt" },
      consequences: [{ appliesTo: "landing", actions: [{ type: "move", delta: 1 }] }],
    },
  }),
  effectMap,
  { playerCount: 1, games: 60, seed: 99, includeTraits: false }
);
assert.ok(effectRuns.cells.reduce((sum, cell) => sum + cell.consequenceArrivals, 0) >= 60, "prompt movement should be applied and counted separately");
assert.ok(effectRuns.events.find((event) => event.eventId === moveEventId)?.triggers);

const slowEventId = "apply-slow";
const slowEffectId = "slow-next-roll";
const slowMap = mapFrom([
  { id: 0, type: "start" },
  ...Array.from({ length: 18 }, (_, index): Tile => ({ id: index + 1, type: "fate", eventId: slowEventId })),
  { id: 19, type: "finish" },
], "persistent-effect-test");
const slowContent: GameContent = {
  ...contentFor(slowMap, {
    [slowEventId]: {
      name: "Slow down",
      activity: { type: "prompt" },
      consequences: [{ appliesTo: "landing", actions: [{ type: "applyEffect", effectId: slowEffectId }] }],
    },
  }),
  effects: {
    [slowEffectId]: {
      id: slowEffectId,
      name: "Half next movement",
      duration: { mode: "uses", value: 1 },
      consequences: [{ type: "movementMultiplier", multiplier: 0.5, rounding: "round" }],
    },
  },
};
const slowRuns = simulateMapGames(slowContent, slowMap, { playerCount: 1, games: 1, seed: 1234, includeTraits: false });
assert.ok(slowRuns.sampleTrace.length >= 2);
assert.equal(
  slowRuns.sampleTrace[1].effectiveRoll,
  Math.round(slowRuns.sampleTrace[1].baseRoll * 0.5),
  "an event-applied movement effect should modify and consume the following roll"
);

const biasMap = mapFrom([
  { id: 0, type: "start" },
  ...Array.from({ length: 48 }, (_, index): Tile => ({ id: index + 1, type: "minigame" })),
  { id: 49, type: "finish" },
], "trait-bias-test");
const biasContent: GameContent = {
  ...contentFor(biasMap),
  players: [{ id: "biased", name: "Biased" }],
  characters: { biased: { id: "biased", displayName: "Biased", defaultTraits: ["bias-trait"] } },
  characterTraits: { "bias-trait": { id: "bias-trait", name: "Six magnet", effectId: "bias-six" } },
  effects: {
    "bias-six": {
      id: "bias-six",
      name: "Six magnet",
      duration: { mode: "game" },
      consequences: [{ type: "diceBias", face: 6, chanceDeltaPercent: 50 }],
    },
  },
};
const unbiased = simulateMapGames(biasContent, biasMap, { playerCount: 1, games: 300, seed: 8, includeTraits: false });
const biased = simulateMapGames(biasContent, biasMap, { playerCount: 1, games: 300, seed: 8, includeTraits: true });
const unbiasedSixRate = unbiased.dice.baseRolls["6"] / unbiased.summary.totalRolls;
const biasedSixRate = biased.dice.baseRolls["6"] / biased.summary.totalRolls;
assert.ok(biasedSixRate > unbiasedSixRate + 0.3, "enabled character dice-bias traits should materially change the roll distribution");

const productionContent = normalizeContentSchema(seedContent);
const productionMap = productionContent.maps?.find((map) => map.id === "map-2");
assert.ok(productionMap, "the Despedida production map should exist");
const productionSnapshot = JSON.stringify(productionMap);
const productionRuns = simulateMapGames(productionContent, productionMap, {
  playerCount: 4,
  games: 100,
  seed: 20260712,
  includeTraits: true,
});
assert.equal(productionRuns.cells.length, 65);
assert.equal(productionRuns.summary.games, 100);
assert.equal(productionRuns.summary.completedGames + productionRuns.summary.cappedGames, 100);
assert.equal(JSON.stringify(productionMap), productionSnapshot, "simulation must never mutate authored map content");
assert.ok(productionRuns.activityTypes.some((entry) => entry.triggers > 0));
assert.ok(
  productionRuns.cells.filter((cell) => cell.type === "shop").every((cell) => cell.eventTriggers === 0),
  "event triggers remain attributed to the landed event cell when an on-enter effect moves the player"
);

console.log("map simulation tests passed");
