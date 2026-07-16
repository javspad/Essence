import assert from "node:assert/strict";
import { test } from "node:test";
import type { AudioTriggerBindingDef, GameContent } from "@essence/shared";
import {
  audioRandomFromPlaybackId,
  audioAssetPlaybackRange,
  audioTriggerCandidates,
  pickWeightedAudioCandidate,
} from "@essence/shared/audio";
import { normalizeContentSchema, validateGameContent } from "@essence/shared/contentValidation";

const baseContent: GameContent = {
  board: [],
  events: {
    maze: { name: "Maze", kind: "activity", activity: { type: "maze", content: {} } },
  },
  players: [{ id: "javi", name: "Javi" }],
  artifacts: { backpack: { id: "backpack", name: "Backpack", price: 1, rarity: "common", targetMode: "self" } },
  cosmetics: {
    hat: {
      id: "hat",
      name: "Hat",
      price: 1,
      asset: "hat",
      anchorType: "body",
      anchorId: "head",
    },
  },
  effects: {
    slow: {
      id: "slow",
      name: "Slow",
      duration: { mode: "uses", value: 1 },
      consequences: [{ type: "halfMovement", hook: "beforeMovement" }],
    },
  },
};

test("audio trigger candidates combine default and scoped bindings additively", () => {
  const bindings: AudioTriggerBindingDef[] = [
    {
      trigger: "player.clicked",
      variants: [{ assetId: "default-click" }],
    },
    {
      trigger: "player.clicked",
      scope: { type: "player", id: "javi" },
      variants: [{ assetId: "javi-click", weight: 3 }],
      volume: 0.5,
    },
  ];

  const javi = audioTriggerCandidates(bindings, { trigger: "player.clicked", playerId: "javi" });
  assert.deepEqual(javi.map((candidate) => candidate.variant.assetId), ["default-click", "javi-click"]);
  assert.equal(javi[1]?.weight, 3);
  assert.equal(javi[1]?.volume, 0.5);

  const nico = audioTriggerCandidates(bindings, { trigger: "player.clicked", playerId: "nico" });
  assert.deepEqual(nico.map((candidate) => candidate.variant.assetId), ["default-click"]);
});

test("winner audio bindings can filter player and activity independently", () => {
  const bindings: AudioTriggerBindingDef[] = [
    {
      trigger: "activity.playerWon",
      playerId: "javi",
      scope: { type: "minigame", id: "maze" },
      variants: [{ assetId: "javi-maze-win" }],
    },
  ];

  assert.equal(audioTriggerCandidates(bindings, { trigger: "activity.playerWon", playerId: "javi", minigameId: "maze" }).length, 1);
  assert.equal(audioTriggerCandidates(bindings, { trigger: "activity.playerWon", playerId: "nico", minigameId: "maze" }).length, 0);
  assert.equal(audioTriggerCandidates(bindings, { trigger: "activity.playerWon", playerId: "javi", minigameId: "other" }).length, 0);
});

test("weighted audio selection honors candidate weights", () => {
  const candidates = [
    { id: "quiet", weight: 1 },
    { id: "loud", weight: 3 },
  ];

  assert.equal(pickWeightedAudioCandidate(candidates, () => 0.1)?.id, "quiet");
  assert.equal(pickWeightedAudioCandidate(candidates, () => 0.8)?.id, "loud");
});

test("multiplayer audio playback ids resolve weighted variants deterministically", () => {
  const candidates = [
    { id: "one", weight: 1 },
    { id: "two", weight: 1 },
    { id: "three", weight: 1 },
  ];
  const playbackId = "minigame.music:event-050:1720000000000";
  const firstClient = pickWeightedAudioCandidate(candidates, () => audioRandomFromPlaybackId(playbackId));
  const secondClient = pickWeightedAudioCandidate(candidates, () => audioRandomFromPlaybackId(playbackId));

  assert.equal(firstClient?.id, secondClient?.id);
  assert.equal(audioRandomFromPlaybackId(playbackId), audioRandomFromPlaybackId(playbackId));
  assert.notEqual(audioRandomFromPlaybackId(playbackId), audioRandomFromPlaybackId(`${playbackId}:next`));
});

test("audio asset playback ranges preserve non-destructive trims", () => {
  assert.deepEqual(
    audioAssetPlaybackRange({ durationMs: 5_000, trimStartMs: 750, trimEndMs: 3_250 }),
    { startSeconds: 0.75, endSeconds: 3.25 }
  );
  assert.deepEqual(audioAssetPlaybackRange({ durationMs: 5_000, trimStartMs: 9_000 }), {
    startSeconds: 5,
    endSeconds: undefined,
  });
});

test("content validation catches missing audio assets and invalid scoped ids", () => {
  const result = validateGameContent({
    ...baseContent,
    audioAssets: {
      click: { id: "click", name: "Click", src: "data:audio/wav;base64,AAAA" },
    },
    audioTriggers: [
      {
        trigger: "player.clicked",
        scope: { type: "player", id: "missing-player" },
        variants: [{ assetId: "missing-asset", weight: -1 }],
      },
      {
        trigger: "not.real",
        variants: [{ assetId: "click" }],
      },
      {
        trigger: "activity.playerWon",
        playerId: "missing-player",
        variants: [{ assetId: "click" }],
      },
    ],
  });

  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes("references missing player missing-player")));
  assert(result.errors.some((error) => error.includes("references missing audio asset missing-asset")));
  assert(result.errors.some((error) => error.includes("must be a supported audio trigger id")));
  assert(result.errors.some((error) => error.includes("playerId references missing player missing-player")));
});

test("content validation rejects inverted and out-of-range audio trims", () => {
  const result = validateGameContent({
    ...baseContent,
    audioAssets: {
      click: {
        id: "click",
        name: "Click",
        src: "data:audio/wav;base64,AAAA",
        durationMs: 1_000,
        trimStartMs: 1_100,
        trimEndMs: 1_000,
      },
    },
  });

  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes("must be greater than trimStartMs")));
  assert(result.errors.some((error) => error.includes("trimStartMs") && error.includes("must not exceed durationMs")));
});

test("normalizeContentSchema preserves audio assets and trigger bindings", () => {
  const content = normalizeContentSchema({
    ...baseContent,
    audioAssets: {
      click: { id: "click", name: "Click", src: "data:audio/wav;base64,AAAA", durationMs: 1_000, trimStartMs: 125, trimEndMs: 875, tags: ["ui"] },
    },
    audioTriggers: [
      {
        trigger: "player.clicked",
        playerId: "javi",
        scope: { type: "player", id: "javi" },
        category: "sfx",
        variants: [{ assetId: "click", weight: 2 }],
      },
    ],
  });

  assert.equal(content.audioAssets?.click?.name, "Click");
  assert.equal(content.audioAssets?.click?.tags?.[0], "ui");
  assert.equal(content.audioAssets?.click?.trimStartMs, 125);
  assert.equal(content.audioAssets?.click?.trimEndMs, 875);
  assert.equal(content.audioTriggers?.[0]?.scope?.id, "javi");
  assert.equal(content.audioTriggers?.[0]?.playerId, "javi");
  assert.equal(content.audioTriggers?.[0]?.variants[0]?.weight, 2);
});
