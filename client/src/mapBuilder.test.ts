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
import { contentWithCharacterList } from "./components/builderContent";
import { defaultTokenAnchor, TOKEN_HEAD_DEFAULT_ANCHOR_Z, TOKEN_HEAD_TOP_ANCHOR_Y } from "./characterTokenRig";
import {
  eventTriggerScore,
  normalizeGameContentEvents,
  removeEventFromContent,
  resolveEventActionTargetIds,
  resolveEventForPlayer,
  resolveTileEventForPlayer,
} from "@essence/shared/events";
import { durationStateFromDef, effectConsequencesFor, effectRemainingLabel, resolveTargetPlayerIds } from "@essence/shared/consequences";
import { normalizeContentSchema, validateGameContent } from "@essence/shared/contentValidation";

const board: Tile[] = [
  { id: 0, type: "start", layout: { x: 0, y: 0 } },
  { id: 1, type: "minigame", eventId: "event-quiz", layout: { x: 1, y: 0 } },
  { id: 2, type: "finish", layout: { x: 2, y: 0 } },
];

const content: GameContent = {
  board,
  events: {
    "event-quiz": {
      name: "Test vote",
      kind: "activity",
      story: { title: "Test vote", prompt: "test" },
      activity: { type: "vote", content: { question: "test" } },
    },
  },
  players: [{ id: "p1", name: "P1" }],
};

const malformedContentCases: Array<{ name: string; value: unknown; expectedError: string }> = [
  { name: "null root", value: null, expectedError: "content must be an object" },
  { name: "array root", value: [], expectedError: "content must be an object" },
  { name: "missing events", value: { board, players: content.players }, expectedError: "events must be an object" },
  { name: "array events", value: { ...content, events: [null] }, expectedError: "events must be an object" },
  { name: "non-array players", value: { ...content, players: {} }, expectedError: "players must be an array" },
  { name: "non-array board", value: { ...content, board: "bad" }, expectedError: "board must be an array" },
  { name: "non-array maps", value: { ...content, maps: {} }, expectedError: "maps must be an array" },
  {
    name: "non-array asset catalog",
    value: { ...content, assetCatalog: {} },
    expectedError: "assetCatalog must be an array",
  },
  {
    name: "non-array audio triggers",
    value: { ...content, audioTriggers: {} },
    expectedError: "audioTriggers must be an array",
  },
  {
    name: "non-array map board",
    value: { ...content, maps: [{ id: "bad-map", name: "Bad map", board: "bad", routes: [] }] },
    expectedError: "maps[0].board must be an array",
  },
  {
    name: "non-array map routes",
    value: { ...content, maps: [{ id: "bad-map", name: "Bad map", board, routes: "bad" }] },
    expectedError: "maps[0].routes must be an array",
  },
  {
    name: "non-array map terraces",
    value: { ...content, maps: [{ id: "bad-map", name: "Bad map", board, routes: [], terraces: {} }] },
    expectedError: "maps[0].terraces must be an array",
  },
];

for (const malformed of malformedContentCases) {
  let result: ReturnType<typeof validateGameContent> | undefined;
  assert.doesNotThrow(() => {
    result = validateGameContent(malformed.value);
  }, malformed.name);
  assert.equal(result?.ok, false, malformed.name);
  assert.equal(result?.errors.includes(malformed.expectedError), true, malformed.name);
}

function contentWithDiscreteActions(actions: unknown[]): unknown {
  return {
    ...content,
    events: {
      ...content.events,
      "discrete-actions": {
        name: "Discrete actions",
        story: { title: "Discrete actions" },
        consequences: [{ appliesTo: "landing", actions }],
      },
    },
  };
}

const invalidDiscreteActions: Array<{ action: unknown; field: string }> = [
  { action: { type: "coins", value: 1.5 }, field: "value" },
  { action: { type: "coins", value: Number.NaN }, field: "value" },
  { action: { type: "coinTransfer", amount: 1.5, from: "landing" }, field: "amount" },
  { action: { type: "coinRedistribute", amount: -1.5, from: "landing" }, field: "amount" },
  { action: { type: "move", delta: -1.5 }, field: "delta" },
];

for (const invalid of invalidDiscreteActions) {
  const result = validateGameContent(contentWithDiscreteActions([invalid.action]));
  assert.equal(result.ok, false);
  assert.equal(
    result.errors.some((error) => error.startsWith(`events.discrete-actions.consequences[0].actions[0].${invalid.field} `)),
    true
  );
}

const validDiscreteActions = validateGameContent(
  contentWithDiscreteActions([
    { type: "coins", value: -1 },
    { type: "coinTransfer", amount: 0, from: "landing" },
    { type: "coinRedistribute", amount: 2, from: "landing" },
    { type: "move", delta: 0 },
  ])
);
assert.equal(validDiscreteActions.ok, true, validDiscreteActions.errors.join("\n"));

const builder = normalizeBuilderContent(content);
assert.equal(builder.maps.length, 1);
assert.equal(builder.maps[0].routes.length, 2);
assert.equal(builder.maps[0].routes[0].from, 0);
assert.equal(builder.maps[0].routes[0].to, 1);
assert.equal(builder.maps[0].board[1].eventId, "event-quiz");

const sharedQueueContent: GameContent = {
  ...content,
  board: [board[0], { ...board[1], eventId: undefined, eventQueue: { activityTypes: ["vote"] } }, board[2]],
};
const sharedQueueBuilder = normalizeBuilderContent(sharedQueueContent);
assert.deepEqual(sharedQueueBuilder.maps[0].board[1].eventQueue, { activityTypes: ["vote"] });
const sharedQueueRoundTrip = builderContentToGameContent(sharedQueueContent, sharedQueueBuilder);
assert.deepEqual(sharedQueueRoundTrip.board[1].eventQueue, { activityTypes: ["vote"] });
const invalidSharedQueue = validateGameContent({
  ...sharedQueueContent,
  board: [board[0], { ...board[1], eventId: undefined, eventQueue: { activityTypes: ["legacy-vote"] } }, board[2]],
} as unknown as GameContent);
assert.ok(invalidSharedQueue.errors.some((error) => error.includes("eventQueue.activityTypes[0]")));

assert.equal(content.events["event-quiz"].activity?.type, "vote");

const legacyEventConfigInput = {
  ...content,
  minigames: { old: { type: "vote", content: { question: "Old" } } },
  dares: { old: { text: "Old dare" } },
  fates: { old: { text: "Old fate" } },
  board: [
    board[0],
    { ...board[1], minigameId: "old", dareId: "old", fateId: "old", storyParams: { prompt: "Old override" } },
    board[2],
  ],
} as unknown;
const eventOnlyImport = normalizeContentSchema(legacyEventConfigInput);
assert.equal("minigames" in eventOnlyImport, false);
assert.equal("dares" in eventOnlyImport, false);
assert.equal("fates" in eventOnlyImport, false);
assert.equal("minigameId" in eventOnlyImport.board[1], false);
assert.equal("dareId" in eventOnlyImport.board[1], false);
assert.equal("fateId" in eventOnlyImport.board[1], false);
assert.equal("storyParams" in eventOnlyImport.board[1], false);
assert.equal(eventOnlyImport.board[1].eventId, "event-quiz");
const rejectedLegacyConfig = validateGameContent(legacyEventConfigInput);
assert.equal(rejectedLegacyConfig.ok, false);
assert.equal(rejectedLegacyConfig.errors.includes("minigames is no longer supported; configure content through events and activities"), true);
assert.equal(rejectedLegacyConfig.errors.some((error) => error.includes("minigameId is no longer supported")), true);

const removedResolutionModeInput = {
  ...content,
  events: {
    "event-quiz": {
      ...content.events["event-quiz"],
      activity: { ...content.events["event-quiz"].activity, resolutionMode: "vote" },
    },
  },
};
assert.equal(
  validateGameContent(removedResolutionModeInput).errors.includes(
    "events.event-quiz.activity.resolutionMode is no longer supported; use an explicit activity type"
  ),
  true
);
assert.equal("resolutionMode" in normalizeContentSchema(removedResolutionModeInput).events["event-quiz"].activity!, false);

const missingEventReference = validateGameContent({
  ...content,
  board: [board[0], { ...board[1], eventId: "missing-event" }, board[2]],
});
assert.deepEqual(missingEventReference.errors, ["maps.board.board.1.eventId references missing event missing-event"]);

const missingEventsCatalog = validateGameContent({ board, players: content.players });
assert.equal(missingEventsCatalog.errors[0], "events must be an object");

const missingOverrideEvent = validateGameContent({
  ...content,
  playerStories: { p1: { overrides: [{ eventId: "missing-event" }] } },
});
assert.equal(
  missingOverrideEvent.errors.includes("playerStories.p1.overrides[0].eventId references missing event missing-event"),
  true
);

const legacyPlayerContent = {
  ...content,
  players: [
    { id: "javi", name: "Javi", groom: true, color: "#f59e0b" },
    { id: "nico", name: "Nico", color: "#ef4444" },
  ],
};
const migratedCharacters = normalizeContentSchema(legacyPlayerContent);
assert.deepEqual(Object.keys(migratedCharacters.characters ?? {}), ["javi", "nico"]);
assert.equal(migratedCharacters.characters?.javi.displayName, "Javi");
assert.equal(migratedCharacters.characters?.javi.groom, true);
assert.equal("characterSets" in migratedCharacters, false);
assert.equal(validateGameContent(legacyPlayerContent).ok, true);

const authoredCharactersAreSourceOfTruth = normalizeContentSchema({
  ...content,
  players: [
    { id: "javi", name: "Javi", groom: true, color: "#f59e0b" },
    { id: "nico", name: "Nico", color: "#ef4444" },
  ],
  characters: {
    javi: { id: "javi", displayName: "Javi" },
  },
});
assert.deepEqual(Object.keys(authoredCharactersAreSourceOfTruth.characters ?? {}), ["javi"]);

const legacySetImport = normalizeContentSchema({
  ...content,
  characters: {
    p1: { id: "p1", displayName: "P1" },
  },
  characterSets: {
    bad: { id: "bad", name: "Bad set", characterIds: ["missing"] },
  },
} as unknown);
assert.equal("characterSets" in legacySetImport, false);

const authoredCharacterIdsAreStable = normalizeContentSchema({
  ...content,
  characters: {
    "character-4": { id: "character-4", displayName: "Facu" },
    "character-5": { id: "character-5", displayName: "Beltro" },
    "character-6": { id: "character-6", displayName: "Willy" },
  },
});
assert.deepEqual(Object.keys(authoredCharacterIdsAreStable.characters ?? {}), ["character-4", "character-5", "character-6"]);

const characterBuilderDraft = contentWithCharacterList(
  {
    ...content,
    characters: {
      javi: {
        id: "javi",
        displayName: "Javi",
        bodyAnchors: { head: { x: 0.5, y: 0.16, angle: 0 } },
      },
      custom: {
        id: "custom",
        displayName: "Custom",
        bodyAnchors: { head: { x: 0.45, y: 0.13, angle: 0 } },
      },
      legacyDefaults: {
        id: "legacyDefaults",
        displayName: "Legacy defaults",
        faceAnchors: {
          leftEye: { x: 0.42, y: 0.38, z: 0 },
          rightEye: { x: 0.58, y: 0.38, z: 0 },
          mouth: { x: 0.5, y: 0.62, z: 0 },
        },
        bodyAnchors: {
          head: { x: 0.5, y: 0.09, z: 0 },
          chest: { x: 0.5, y: 0.44, z: 0 },
          leftHand: { x: 0.28, y: 0.46, z: 0 },
          rightHand: { x: 0.72, y: 0.46, z: 0 },
          back: { x: 0.5, y: 0.48, z: 0 },
        },
      },
    },
    cosmetics: {},
    assetCatalog: [],
  },
  {
    ...content,
    cosmetics: { kept: { id: "kept", name: "Kept", price: 0, asset: "hat", anchorType: "body", anchorId: "head" } },
    assetCatalog: [{ id: "oak-tree", name: "Oak", kind: "tree", defaultScale: 1 }],
  }
);
assert.equal(characterBuilderDraft.characters?.javi.bodyAnchors?.head.y, TOKEN_HEAD_TOP_ANCHOR_Y);
assert.equal(characterBuilderDraft.characters?.javi.bodyAnchors?.head.z, TOKEN_HEAD_DEFAULT_ANCHOR_Z);
assert.equal(characterBuilderDraft.characters?.custom.bodyAnchors?.head.y, 0.13);
assert.deepEqual(characterBuilderDraft.characters?.legacyDefaults.faceAnchors?.leftEye, defaultTokenAnchor("leftEye"));
assert.deepEqual(characterBuilderDraft.characters?.legacyDefaults.faceAnchors?.rightEye, defaultTokenAnchor("rightEye"));
assert.deepEqual(characterBuilderDraft.characters?.legacyDefaults.faceAnchors?.mouth, defaultTokenAnchor("mouth"));
assert.deepEqual(characterBuilderDraft.characters?.legacyDefaults.bodyAnchors?.chest, defaultTokenAnchor("chest"));
assert.deepEqual(characterBuilderDraft.characters?.legacyDefaults.bodyAnchors?.back, defaultTokenAnchor("back"));
assert.deepEqual(Object.keys(characterBuilderDraft.cosmetics ?? {}), ["kept"]);
assert.equal(characterBuilderDraft.assetCatalog?.length, 1);

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
assert.equal(exported.events["event-quiz"].activity?.type, "vote");
assert.deepEqual(exported.maps?.[0].mapProps, exported.maps?.[0].artifacts);
assert.equal(slotMaterialStyle("timing" as any).top, "#64748b");
assert.equal(terrainMaterialStyle("legacy-road" as any).top, "#e6cf9d");

let mapDeleteState = createInitialMapBuilderState(content);
mapDeleteState = mapBuilderReducer(mapDeleteState, { type: "duplicate_map" });
const duplicatedMapId = mapDeleteState.activeMapId;
mapDeleteState = mapBuilderReducer(mapDeleteState, { type: "delete_map" });
assert.equal(mapDeleteState.content.maps.some((map) => map.id === duplicatedMapId), false);
assert.equal(mapDeleteState.content.maps.length, 1);
assert.equal(mapDeleteState.activeMapId, mapDeleteState.content.maps[0].id);
const protectedMapState = mapBuilderReducer(mapDeleteState, { type: "delete_map" });
assert.equal(protectedMapState.content.maps.length, 1);
assert.equal(protectedMapState.activeMapId, mapDeleteState.activeMapId);

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
    ...content.events,
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
  "events.bad-target.consequences[0].appliesTo references missing player missing",
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

const overrideContent: GameContent = normalizeGameContentEvents({
  ...content,
  events: {
    "custom-event": {
      name: "Custom event",
      kind: "activity",
      tags: ["dare"],
      story: { title: "Default", prompt: "Default prompt" },
      activity: { type: "selfTap", content: { prompt: "Default prompt" } },
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
assert.equal(resolvedOverride?.consequences?.[0].appliesTo, "winner");
assert.equal(overrideContent.events?.["custom-event"].actions, undefined);
assert.equal(overrideContent.events?.["custom-event"].outcomes, undefined);
assert.equal(overrideContent.playerStories?.p1.overrides[0].outcomes, undefined);

const legacyConsequenceImport = normalizeGameContentEvents({
  ...content,
  events: {
    legacy: {
      name: "Legacy consequences",
      activity: {
        type: "selfTap",
        rankingPayout: {
          outcomes: [{ when: "winner", actions: [{ type: "coins", value: 4, target: "winner" }] }],
        },
      },
      actions: [{ type: "move", delta: 1, target: "landing" }],
      outcomes: [{ when: "loser", actions: [{ type: "move", delta: -1, target: "loser" }] }],
    },
  },
});
const canonicalLegacyEvent = legacyConsequenceImport.events?.legacy;
assert.deepEqual(canonicalLegacyEvent?.consequences?.map((rule) => rule.appliesTo), ["landing", "loser"]);
assert.deepEqual(canonicalLegacyEvent?.consequences?.map((rule) => rule.actions[0]), [
  { type: "move", delta: 1 },
  { type: "move", delta: -1 },
]);
assert.equal(canonicalLegacyEvent?.actions, undefined);
assert.equal(canonicalLegacyEvent?.outcomes, undefined);
assert.deepEqual(canonicalLegacyEvent?.activity?.rankingPayout?.consequences?.[0], {
  appliesTo: "winner",
  actions: [{ type: "coins", value: 4 }],
});
assert.equal(canonicalLegacyEvent?.activity?.rankingPayout?.outcomes, undefined);

const legacyInlineEffectImport = normalizeGameContentEvents({
  ...content,
  events: {
    "legacy-inline-effect": {
      name: "Legacy inline effect",
      actions: [
        {
          type: "coins",
          value: 2,
          target: "landing",
          hook: "onTurnEnd",
          duration: { mode: "rounds", value: 3 },
          text: "Gain two coins at turn end",
        },
      ],
    },
  },
});
const liftedEffectReference = legacyInlineEffectImport.events?.["legacy-inline-effect"].consequences?.[0]?.actions[0];
assert.equal(liftedEffectReference?.type, "applyEffect");
const liftedEffectId = liftedEffectReference?.type === "applyEffect" ? liftedEffectReference.effectId : "";
assert.deepEqual(legacyInlineEffectImport.effects?.[liftedEffectId]?.duration, { mode: "rounds", value: 3 });
assert.deepEqual(legacyInlineEffectImport.effects?.[liftedEffectId]?.consequences, [
  { type: "coins", value: 2, hook: "onTurnEnd", text: "Gain two coins at turn end" },
]);
const renormalizedInlineEffectImport = normalizeGameContentEvents(legacyInlineEffectImport);
assert.equal(renormalizedInlineEffectImport.events?.["legacy-inline-effect"].consequences?.[0]?.actions[0]?.type, "applyEffect");
assert.equal(Object.keys(renormalizedInlineEffectImport.effects ?? {}).length, Object.keys(legacyInlineEffectImport.effects ?? {}).length);

const explicitVoteContent: GameContent = {
  ...content,
  events: {
    "prompt-vote": {
      name: "Prompt vote",
      kind: "activity",
      story: { prompt: "Vote this dare" },
      activity: { type: "vote", content: { prompt: "Vote this dare", question: "Vote this dare" } },
    },
  },
};
assert.equal(explicitVoteContent.events["prompt-vote"].activity?.type, "vote");
assert.deepEqual(explicitVoteContent.events["prompt-vote"].activity?.content, {
  prompt: "Vote this dare",
  question: "Vote this dare",
});

const scopedContent: GameContent = {
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
};
const scopedTile: Tile = { id: 7, type: "dare", eventId: "p1-only" };
assert.equal(eventTriggerScore(scopedContent.events.generic, { id: "p2" }), 1);
assert.equal(eventTriggerScore(scopedContent.events["p1-only"], { id: "p1" }), 2);
assert.equal(eventTriggerScore(scopedContent.events["p1-only"], { id: "p2" }), 0);
assert.equal(resolveTileEventForPlayer(scopedContent, scopedTile, { id: "p1" })?.id, "p1-only");
assert.equal(resolveTileEventForPlayer(scopedContent, scopedTile, { id: "p2" }), null);
assert.equal(resolveTileEventForPlayer(scopedContent, { id: 8, type: "dare", eventId: "generic" }, { id: "p2" })?.id, "generic");
assert.deepEqual(resolveEventActionTargetIds({ playerId: "p2" }, { playerIds: ["p1", "p2"] }), ["p2"]);
assert.deepEqual(resolveEventActionTargetIds("winner", { ranking: ["p1", "p2"] }), ["p1"]);
assert.deepEqual(resolveEventActionTargetIds("loser", { ranking: ["p1", "p2"] }), ["p2"]);
assert.deepEqual(resolveEventActionTargetIds({ rankFrom: 1, rankTo: 2 }, { ranking: ["p1", "p2", "p3"] }), ["p1", "p2"]);
assert.deepEqual(resolveTargetPlayerIds("acting", { actingPlayerId: "p1" }), ["p1"]);
assert.deepEqual(resolveTargetPlayerIds("target", { targetPlayerId: "p2" }), ["p2"]);
assert.deepEqual(
  resolveTargetPlayerIds(
    { nearest: "ahead", from: "acting" },
    {
      actingPlayerId: "p1",
      players: [
        { id: "p1", position: 3, connected: true },
        { id: "p2", position: 8, connected: true },
        { id: "p3", position: 5, connected: true },
      ],
    }
  ),
  ["p3"]
);
assert.deepEqual(
  resolveTargetPlayerIds(
    { nearest: "behind", from: { playerId: "p2" } },
    {
      players: [
        { id: "p1", position: 3, connected: true },
        { id: "p2", position: 8, connected: true },
        { id: "p3", position: 5, connected: true },
      ],
    }
  ),
  ["p3"]
);
assert.deepEqual(durationStateFromDef({ mode: "rounds", value: 2 }), { mode: "rounds", remaining: 2 });
assert.equal(effectRemainingLabel({ mode: "uses", remaining: 1 }), "1 use");
const migratedUntilTriggeredDurations = normalizeContentSchema({
  ...content,
  effects: {
    "legacy-next-trigger": {
      id: "legacy-next-trigger",
      name: "Legacy next trigger",
      duration: { mode: "untilTriggered" },
      consequences: [{ type: "coins", value: 1 }],
    },
  },
  artifacts: {
    "legacy-attached-consequence": {
      id: "legacy-attached-consequence",
      name: "Legacy attached consequence",
      price: 1,
      rarity: "common",
      targetMode: "self",
      consequences: [{ type: "coins", value: 1, duration: { mode: "untilTriggered" } }],
    },
  },
});
assert.deepEqual(migratedUntilTriggeredDurations.effects?.["legacy-next-trigger"]?.duration, { mode: "uses", value: 1 });
const migratedArtifactConsequence = migratedUntilTriggeredDurations.artifacts?.["legacy-attached-consequence"]?.consequences?.[0];
assert.equal(migratedArtifactConsequence?.type, "applyEffect");
const migratedArtifactEffectId = migratedArtifactConsequence?.type === "applyEffect" ? migratedArtifactConsequence.effectId : "";
assert.deepEqual(migratedUntilTriggeredDurations.effects?.[migratedArtifactEffectId]?.duration, { mode: "uses", value: 1 });
assert.deepEqual(migratedUntilTriggeredDurations.effects?.[migratedArtifactEffectId]?.consequences, [{ type: "coins", value: 1 }]);
assert.deepEqual(effectConsequencesFor({ id: "half", name: "Half", duration: { mode: "rounds", value: 2 }, consequences: [{ type: "movementMultiplier", multiplier: 0.5 }] }), [
  { type: "movementMultiplier", multiplier: 0.5, hook: "beforeMovement" },
]);
assert.deepEqual(effectConsequencesFor({ id: "legacy-action-half", name: "Legacy action half", duration: { mode: "rounds", value: 2 }, actions: [{ type: "movementMultiplier", hook: "beforeRoll", multiplier: 0.5 }] }), [
  { type: "movementMultiplier", hook: "beforeMovement", multiplier: 0.5 },
]);
assert.deepEqual(
  effectConsequencesFor({
    id: "legacy-half",
    name: "Legacy half",
    duration: { mode: "rounds", value: 2 },
    modifiers: [{ type: "halfMovement", hook: "beforeMovement", rounding: "ceil" }],
  }),
  [{ type: "halfMovement", hook: "beforeMovement", rounding: "ceil" }]
);
assert.deepEqual(durationStateFromDef({ mode: "uses", value: 1 }), { mode: "uses", remaining: 1 });
assert.equal(effectRemainingLabel({ mode: "uses", remaining: 2 }), "2 uses");

const invalidEffectReference = validateGameContent({
  ...content,
  events: {
    ...content.events,
    "bad-effect-ref": {
      name: "Bad effect ref",
      story: { title: "Bad effect ref" },
      actions: [{ type: "applyEffect", effectId: "missing-effect", target: "acting" }],
    },
  },
});
assert.deepEqual(invalidEffectReference.errors, ["events.bad-effect-ref.consequences[0].actions[0].effectId references missing effect missing-effect"]);

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

const cameraMediaContent: GameContent = {
  ...content,
  activeMapId: "camera-map",
  mediaAssets: {
    meme: {
      id: "meme",
      type: "image",
      src: "data:image/png;base64,AAAA",
      alt: "Tiny meme",
      crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
      fit: "cover",
    },
  },
  events: {
    ...content.events,
    "camera-event": {
      name: "Camera event",
      story: { title: "Camera event", prompt: "Look here" },
      media: [{ assetId: "meme", caption: "Prompt meme", placement: "prompt" }],
      activity: {
        type: "prompt",
        content: { prompt: "Look here" },
        media: [{ assetId: "meme", caption: "Reveal meme", placement: "reveal" }],
      },
    },
  },
  maps: [
    {
      id: "camera-map",
      name: "Camera map",
      board: [{ ...board[0], cameraPresetId: "cell-0-camera" }, board[1], board[2]],
      routes: [],
      artifacts: [],
      defaultCamera: { focus: "activePlayer", yaw: 15, pitch: 26, distance: 7, fov: 40 },
      cameraPresets: {
        "cell-0-camera": { id: "cell-0-camera", focus: "activePlayer", yaw: 90, pitch: 30, distance: 8 },
      },
    },
  ],
};
assert.equal(validateGameContent(cameraMediaContent).ok, true);
const cameraBuilder = normalizeBuilderContent(cameraMediaContent);
assert.equal(cameraBuilder.maps[0].defaultCamera?.yaw, 15);
assert.equal(cameraBuilder.maps[0].cameraPresets?.["cell-0-camera"].distance, 8);
const cameraRoundTrip = builderContentToGameContent(cameraMediaContent, cameraBuilder);
assert.equal(cameraRoundTrip.maps?.[0].cameraPresets?.["cell-0-camera"].pitch, 30);
assert.equal(cameraRoundTrip.mediaAssets?.meme.crop?.width, 0.5);

const removedCameraEvent = removeEventFromContent(
  {
    ...cameraMediaContent,
    playerStories: {
      p1: {
        overrides: [{ eventId: "camera-event", activity: { media: [{ assetId: "meme" }] } }],
      },
    },
  },
  "camera-event"
);
assert.equal("camera-event" in removedCameraEvent.events, false);
assert.deepEqual(removedCameraEvent.playerStories?.p1.overrides, []);
assert.equal("meme" in (removedCameraEvent.mediaAssets ?? {}), false);

const invalidCameraMedia = validateGameContent({
  ...content,
  mediaAssets: {
    bad: { id: "bad", type: "image", src: "javascript:alert(1)", crop: { x: 0.8, y: 0, width: 0.4, height: 1 } },
  },
  events: {
    "bad-media": {
      name: "Bad media",
      media: [{ assetId: "missing", placement: "elsewhere" }],
    },
  },
  maps: [
    {
      id: "bad-camera-map",
      name: "Bad camera map",
      board: [{ ...board[0], cameraPresetId: "missing-camera" }, board[1], board[2]],
      routes: [],
      artifacts: [],
      cameraPresets: {
        "bad-camera": { focus: "activePlayer", yaw: 0, pitch: 99, distance: -1 },
      },
    },
  ],
});
assert.ok(invalidCameraMedia.errors.some((error) => error.includes("mediaAssets.bad.src")));
assert.ok(invalidCameraMedia.errors.some((error) => error.includes("events.bad-media.media[0].assetId references missing media asset missing")));
assert.ok(invalidCameraMedia.errors.some((error) => error.includes("maps.bad-camera-map.board.0.cameraPresetId references missing camera preset missing-camera")));
assert.ok(invalidCameraMedia.errors.some((error) => error.includes("maps.bad-camera-map.cameraPresets.bad-camera.pitch")));

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
