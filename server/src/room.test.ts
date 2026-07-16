import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { GameContent, ServerToClientEvents } from "@essence/shared";
import { validateGameContent } from "@essence/shared/contentValidation";
import { effectConditionMatches } from "@essence/shared/consequences";
import { normalizeGameContentEvents, resolveEventMediaRefs, resolveTileEventForPlayer, TileEventQueue } from "@essence/shared/events";
import { resolveActivityResults } from "./activities/index";
import { GameRoom, ROOM_RECONNECT_TTL_MS } from "./room";

type EmittedEvent = {
  room: string;
  event: keyof ServerToClientEvents;
  payload: unknown;
};

assert.deepEqual(
  resolveEventMediaRefs(
    { media: [{ assetId: "portrait", caption: "Portrait", placement: "prompt" }] },
    { media: [{ assetId: "portrait", placement: "reveal" }] }
  ),
  [{ assetId: "portrait", caption: "Portrait", placement: "both" }]
);

{
  const pooledContent = normalizeGameContentEvents({
    board: [{ id: 0, type: "minigame", eventIds: ["first", "second"] }],
    events: {
      first: { name: "First", activity: { type: "prompt" } },
      second: { name: "Second", activity: { type: "prompt" } },
    },
    players: [{ id: "alice", name: "Alice", color: "#f87171" }],
  });
  assert.equal(resolveTileEventForPlayer(pooledContent, pooledContent.board[0], pooledContent.players[0], () => 0)?.id, "first");
  assert.equal(resolveTileEventForPlayer(pooledContent, pooledContent.board[0], pooledContent.players[0], () => 0.999)?.id, "second");

  const queue = new TileEventQueue();
  pooledContent.board[0].eventIds = ["first", "second", "third"];
  pooledContent.events.third = { name: "Third", activity: { type: "prompt" } };
  assert.deepEqual(
    Array.from({ length: 4 }, () => queue.resolve(pooledContent, pooledContent.board[0], pooledContent.players[0], () => 0)?.id),
    ["first", "second", "third", "first"],
    "pooled cells exhaust every event before refilling and do not repeat at the cycle boundary"
  );
}

{
  const sharedContent = normalizeGameContentEvents({
    board: [
      { id: 0, type: "fate", eventQueue: { activityTypes: ["prompt"] } },
      { id: 1, type: "fate", eventQueue: { activityTypes: ["prompt"] } },
    ],
    events: {
      first: { name: "First", activity: { type: "prompt" } },
      second: { name: "Second", activity: { type: "prompt" } },
      third: { name: "Third", activity: { type: "prompt" } },
    },
    players: [{ id: "alice", name: "Alice", color: "#f87171" }],
  });
  const queue = new TileEventQueue();
  assert.deepEqual(
    [
      queue.resolve(sharedContent, sharedContent.board[0], sharedContent.players[0], () => 0)?.id,
      queue.resolve(sharedContent, sharedContent.board[1], sharedContent.players[0], () => 0)?.id,
      queue.resolve(sharedContent, sharedContent.board[0], sharedContent.players[0], () => 0)?.id,
      queue.resolve(sharedContent, sharedContent.board[1], sharedContent.players[0], () => 0)?.id,
    ],
    ["first", "second", "third", "first"],
    "activity queue cells share one room-wide shuffle bag and avoid a repeat at the cycle boundary"
  );
  queue.reset();
  assert.equal(queue.resolve(sharedContent, sharedContent.board[1], sharedContent.players[0], () => 0)?.id, "first");
}

{
  const anchoredContent = normalizeGameContentEvents({
    board: [
      { id: 0, type: "fate", eventId: "hero", eventQueue: { activityTypes: ["prompt"] } },
      { id: 1, type: "fate", eventQueue: { activityTypes: ["prompt"] } },
    ],
    events: {
      hero: { name: "Hero", activity: { type: "prompt" } },
      sharedA: { name: "Shared A", activity: { type: "prompt" } },
      sharedB: { name: "Shared B", activity: { type: "prompt" } },
    },
    players: [{ id: "alice", name: "Alice", color: "#f87171" }],
  });
  const queue = new TileEventQueue();
  assert.equal(queue.resolve(anchoredContent, anchoredContent.board[0], anchoredContent.players[0], () => 0)?.id, "hero");
  assert.equal(queue.resolve(anchoredContent, anchoredContent.board[0], anchoredContent.players[0], () => 0)?.id, "sharedA");
  assert.equal(queue.resolve(anchoredContent, anchoredContent.board[1], anchoredContent.players[0], () => 0)?.id, "sharedB");
}

function createIoRecorder(): { io: unknown; events: EmittedEvent[] } {
  const events: EmittedEvent[] = [];
  return {
    events,
    io: {
      to(room: string) {
        return {
          emit(event: keyof ServerToClientEvents, payload: unknown) {
            events.push({ room, event, payload });
          },
        };
      },
    },
  };
}

async function withRolls<T>(rolls: number[], run: () => Promise<T> | T): Promise<T> {
  const originalRandom = Math.random;
  let index = 0;
  Math.random = () => {
    const roll = rolls[index++] ?? rolls[rolls.length - 1] ?? 1;
    return (roll - 1) / 6;
  };
  try {
    return await run();
  } finally {
    Math.random = originalRandom;
  }
}

const content: GameContent = normalizeGameContentEvents({
  board: [
    { id: 0, type: "start" },
    { id: 1, type: "minigame", eventIds: ["bob-coin"] },
    { id: 2, type: "minigame" },
    { id: 3, type: "finish" },
  ],
  events: {
    "bob-coin": {
      name: "Bob coin bonus",
      kind: "story",
      trigger: { type: "player", playerId: "bob" },
      story: { title: "Bob coin bonus", prompt: "Bob takes a coin lead." },
      actions: [{ type: "coins", value: 100, target: "landing" }],
    },
  },
  players: [
    { id: "alice", name: "Alice", color: "#f87171" },
    { id: "bob", name: "Bob", color: "#60a5fa" },
  ],
});

const characterContent: GameContent = normalizeGameContentEvents({
  board: [
    { id: 0, type: "start" },
    { id: 1, type: "finish" },
  ],
  events: {},
  players: [
    { id: "legacy-a", name: "Legacy A", color: "#111111" },
    { id: "legacy-b", name: "Legacy B", color: "#222222" },
  ],
  characters: {
    groom: { id: "groom", displayName: "Groom", groom: true, color: "#f59e0b" },
    guest: {
      id: "guest",
      displayName: "Guest",
      color: "#38bdf8",
      facePhoto: "data:image/png;base64,guest",
      facePhotoAlignment: { x: 0.42, y: 0.57, scale: 1.2 },
      faceAnchors: { mouth: { x: 0.5, y: 0.64, angle: 0 } },
      bodyAnchors: { head: { x: 0.5, y: 0.14, angle: 0 } },
      defaultLoadout: { cosmeticIds: ["party-goggles", "big-mustache"] },
    },
  },
  cosmetics: {
    "party-goggles": {
      id: "party-goggles",
      name: "Party goggles",
      price: 3,
      asset: { kind: "goggles", color: "#111827", secondaryColor: "#67e8f9" },
      anchorType: "face",
      anchorId: "leftEye",
    },
    "big-mustache": {
      id: "big-mustache",
      name: "Big mustache",
      price: 0,
      asset: { kind: "mustache", color: "#111827" },
      anchorType: "face",
      anchorId: "mouth",
    },
    "party-hat": {
      id: "party-hat",
      name: "Party hat",
      price: 2,
      asset: { kind: "hat", color: "#a855f7", secondaryColor: "#22d3ee" },
      anchorType: "body",
      anchorId: "head",
    },
  },
});

const traitBoard = Array.from({ length: 20 }, (_, id) => ({
  id,
  type: id === 19 ? "finish" as const : "start" as const,
  layout: { x: id, y: 0 },
  ...(id === 6 ? { tags: ["belgrano-4pm"] } : {}),
}));

const traitContent: GameContent = normalizeGameContentEvents({
  board: traitBoard,
  events: {},
  players: [
    { id: "alice", name: "Alice", color: "#f87171" },
    { id: "bob", name: "Bob", color: "#60a5fa" },
    { id: "frang", name: "FranG", color: "#3b82f6" },
  ],
  characters: {
    alice: { id: "alice", displayName: "Alice", color: "#f87171", defaultTraits: ["steady-boots"] },
    bob: { id: "bob", displayName: "Bob", color: "#60a5fa", defaultTraits: ["high-roll-curse"] },
    frang: { id: "frang", displayName: "FranG", color: "#3b82f6", defaultTraits: ["finance-pop-quiz"] },
  },
  characterTraits: {
    "steady-boots": {
      id: "steady-boots",
      name: "Steady boots",
      description: "Moves at double speed for the whole game.",
      effectId: "double-movement-game",
    },
    "high-roll-curse": {
      id: "high-roll-curse",
      name: "High roll curse",
      description: "Move back after two high rolls in a row.",
      effectId: "two-high-rolls-back",
    },
    "finance-pop-quiz": {
      id: "finance-pop-quiz",
      name: "Finance pop quiz",
      description: "High rolls trigger a quick finance challenge.",
      effectId: "finance-challenge-on-four-plus",
    },
  },
  effects: {
    "double-movement-game": {
      id: "double-movement-game",
      name: "Double movement",
      duration: { mode: "game" },
      consequences: [{ type: "movementMultiplier", hook: "beforeMovement", multiplier: 2, rounding: "round" }],
    },
    "two-high-rolls-back": {
      id: "two-high-rolls-back",
      name: "Two high rolls back",
      duration: { mode: "game" },
      consequences: [
        {
          type: "move",
          hook: "afterMovement",
          when: { consecutiveRolls: { atLeast: 5, count: 2 } },
          delta: -5,
          text: "Two high rolls in a row: move back 5.",
        },
      ],
    },
    "finance-challenge-on-four-plus": {
      id: "finance-challenge-on-four-plus",
      name: "Finance challenge",
      duration: { mode: "game" },
      consequences: [
        {
          type: "offlineAction",
          hook: "afterMovement",
          when: { rollGte: 4 },
          action: "custom",
          text: "Solve the finance pop quiz.",
        },
        {
          type: "move",
          hook: "afterMovement",
          when: { rollGte: 4 },
          delta: -1,
          text: "Finance miss: move back 1.",
        },
      ],
    },
  },
});

const players = [
  { id: "alice", name: "Alice", socketId: "socket-alice", connected: true, position: 0, coins: 0, isHost: true, groom: false, color: "#f87171" },
  { id: "bob", name: "Bob", socketId: "socket-bob", connected: true, position: 0, coins: 0, isHost: false, groom: false, color: "#60a5fa" },
  { id: "carla", name: "Carla", socketId: "socket-carla", connected: true, position: 0, coins: 0, isHost: false, groom: false, color: "#34d399" },
];

{
  const result = validateGameContent({
    board: [
      { id: 0, type: "start", layout: { x: 0, y: 0 } },
      { id: 1, type: "finish", layout: { x: 1, y: 0 } },
    ],
    players: [{ id: "alice", name: "Alice", color: "#f87171" }],
    cosmetics: {
      bad: {
        id: "bad",
        name: "Bad price",
        price: -1,
        asset: "badge",
        anchorType: "body",
        anchorId: "chest",
      },
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("cosmetics.bad.price")), "negative cosmetic prices are validation errors");
}

{
  const result = validateGameContent({
    board: [
      { id: 0, type: "start", layout: { x: 0, y: 0 } },
      { id: 1, type: "shop", layout: { x: 1, y: 0 } },
      { id: 2, type: "finish", layout: { x: 2, y: 0 } },
    ],
    players: [{ id: "alice", name: "Alice", color: "#f87171" }],
    artifactRarities: {
      common: { id: "common", name: "Common", weight: 80, color: "#34d399" },
      epic: { id: "epic", name: "Epic", weight: 10, color: "#d946ef" },
    },
    artifacts: {
      bad: {
        id: "bad",
        name: "Bad artifact",
        description: "Invalid artifact for schema regression.",
        price: -1,
        rarity: "common",
        targetMode: "choosePlayer",
        effects: ["missing-effect"],
      },
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("artifactRarities") && error.includes("weights must add to 100")), "rarity weights must add to 100");
  assert.ok(result.errors.some((error) => error.includes("artifacts.bad.price")), "artifact prices must be non-negative");
  assert.ok(
    result.errors.some((error) => error.includes("artifacts.bad.consequences[0].effectId")),
    "legacy artifact effect references are normalized and validated through consequences"
  );
}

{
  const result = validateGameContent({
    board: [
      { id: 0, type: "start", layout: { x: 0, y: 0 } },
      { id: 1, type: "fate", layout: { x: 1, y: 0 }, eventIds: ["missing-economy-cell"] },
      { id: 2, type: "finish", layout: { x: 2, y: 0 } },
    ],
    events: {},
    players: [{ id: "alice", name: "Alice", color: "#f87171" }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("board.1.eventIds[0]")), "tile eventIds references are validated");
}

{
  const result = validateGameContent({
    board: [
      { id: 0, type: "start", layout: { x: 0, y: 0 } },
      { id: 1, type: "finish", layout: { x: 1, y: 0 } },
    ],
    players: [{ id: "alice", name: "Alice", color: "#f87171" }],
    characters: {
      alice: { id: "alice", displayName: "Alice", defaultTraits: ["missing-trait"] },
    },
    characterTraits: {
      "bad-trait": { id: "bad-trait", name: "Bad trait", effectId: "missing-effect" },
    },
    effects: {},
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("characters.alice.defaultTraits")), "default traits must reference character trait definitions");
  assert.ok(result.errors.some((error) => error.includes("characterTraits.bad-trait.effectId")), "character traits must reference reusable effects");
}

{
  const result = validateGameContent({
    board: [
      { id: 0, type: "start", layout: { x: 0, y: 0 } },
      { id: 1, type: "minigame", layout: { x: 1, y: 0 }, eventId: "bad-card-vote" },
      { id: 2, type: "finish", layout: { x: 2, y: 0 } },
    ],
    events: {
      "bad-card-vote": {
        name: "Bad card vote",
        kind: "activity",
        activity: { type: "cardVote", content: { cards: ["", 42], tieMode: "random" } },
      },
    },
    players: [{ id: "alice", name: "Alice", color: "#f87171" }],
  } as unknown as GameContent);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("events.bad-card-vote.activity.content.cards[0]")));
  assert.ok(result.errors.some((error) => error.includes("events.bad-card-vote.activity.content.cards[1]")));
  assert.ok(result.errors.some((error) => error.includes("events.bad-card-vote.activity.content.tieMode")));
}

{
  const { io, events } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "QUIT", "Leave test", content);
  assert.equal(room.join("socket-alice", "Alice").ok, true);
  assert.equal(room.join("socket-bob", "Bob").ok, true);

  assert.deepEqual(room.leave("socket-bob"), { closed: false });
  assert.equal(room.getState().players.find((player) => player.id === "bob")?.connected, false);

  assert.deepEqual(room.leave("socket-alice"), { closed: true });
  assert.equal(room.getState().players.every((player) => !player.connected), true);
  assert.deepEqual(events.at(-1), {
    room: "QUIT",
    event: "room:closed",
    payload: { message: "El host cerró la sala." },
  });
}

{
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "BACK", "Reconnect turn order", content);
  assert.equal(room.join("socket-alice", "Alice").ok, true);
  assert.equal(room.join("socket-bob", "Bob").ok, true);
  assert.deepEqual(room.startGame("socket-alice"), { ok: true });

  room.disconnect("socket-bob");
  (room as unknown as { advanceTurn(): void }).advanceTurn();
  assert.ok(room.getState().turnOrder.includes("bob"), "temporary disconnects must not permanently remove a player from turn order");

  const bobBefore = room.getState().players.find((player) => player.id === "bob");
  assert.ok(bobBefore);
  bobBefore.position = 7;
  bobBefore.coins = 11;
  assert.equal(room.join("socket-bob-2", "Bob", { characterId: "bob" }).ok, true);
  const bobAfter = room.getState().players.find((player) => player.id === "bob");
  assert.equal(bobAfter?.connected, true);
  assert.equal(bobAfter?.position, 7);
  assert.equal(bobAfter?.coins, 11);
  assert.deepEqual(room.join("socket-new", "New", { characterId: "alice" }), { ok: false, error: "Ese personaje ya está ocupado" });
}

{
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "HOST", "Host recovery", content);
  assert.equal(room.join("socket-alice", "Alice").ok, true);
  assert.equal(room.join("socket-bob", "Bob").ok, true);
  assert.deepEqual(room.startGame("socket-alice"), { ok: true });
  assert.deepEqual(
    room.leave("socket-alice"),
    { closed: false },
    "leaving a started game must not destroy the room when the host disconnects"
  );
  assert.equal(room.getState().players.find((player) => player.id === "alice")?.connected, false);
  assert.equal(room.join("socket-alice-new", "Alice", { characterId: "alice" }).ok, true);
  assert.equal(room.getState().players.find((player) => player.id === "alice")?.isHost, true);
}

{
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "TOKN", "Token recovery", content);
  const firstJoin = room.join("socket-alice", "Alice");
  if (!firstJoin.ok) throw new Error(firstJoin.error);
  assert.equal(firstJoin.ok, true);

  assert.deepEqual(room.join("socket-duplicate", "Alice", { characterId: "alice" }), {
    ok: false,
    error: "Ese personaje ya está ocupado",
  });
  const takeover = room.join("socket-alice-new", "Alice", {
    characterId: "alice",
    reconnectToken: firstJoin.reconnectToken,
  });
  if (!takeover.ok) throw new Error(takeover.error);
  assert.equal(takeover.ok, true, "a valid private token can reclaim a seat before the stale socket times out");
  assert.notEqual(takeover.reconnectToken, firstJoin.reconnectToken, "reconnect tokens rotate after every reclaim");
  assert.deepEqual(room.join("socket-stale", "Alice", {
    characterId: "alice",
    reconnectToken: firstJoin.reconnectToken,
  }), { ok: false, error: "Ese personaje ya está ocupado" });

  const disconnectedAt = Date.now();
  room.disconnect("socket-alice-new");
  assert.equal(room.shouldExpire(disconnectedAt + ROOM_RECONNECT_TTL_MS - 100), false);
  assert.equal(room.shouldExpire(disconnectedAt + ROOM_RECONNECT_TTL_MS + 100), true);
}

{
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "MGBK", "Minigame recovery", content);
  assert.equal(room.join("socket-alice", "Alice").ok, true);
  assert.equal(room.join("socket-bob", "Bob").ok, true);
  assert.deepEqual(room.startGame("socket-alice"), { ok: true });

  const activity = { type: "reaction" as const, content: { durationMs: 5_000 } };
  const event = {
    id: "reaction-recovery",
    name: "Reaction recovery",
    kind: "activity" as const,
    story: { title: "Reaction recovery", prompt: "Tap when ready." },
    activity,
  };
  const alice = room.getState().players.find((player) => player.id === "alice");
  assert.ok(alice);
  (room as any).startActivity(event, alice, activity);
  assert.equal(room.getState().phase, "minigame");
  const startedAt = room.getState().activeMinigame?.startedAt;
  assert.equal(typeof startedAt, "number", "a minigame gets one authoritative audio start time");

  await room.submitResult("socket-bob", { score: 42, payload: { timeMs: 420 } });
  assert.deepEqual(room.getState().activeMinigame?.submitted, ["bob"]);
  room.disconnect("socket-bob");
  assert.equal(room.join("socket-bob-new", "Bob", { characterId: "bob" }).ok, true);
  assert.equal(room.getState().phase, "minigame");
  assert.equal(room.getState().activeMinigame?.eventId, "reaction-recovery");
  assert.equal(room.getState().activeMinigame?.startedAt, startedAt, "reconnects keep the same audio instance id and timeline");
  assert.deepEqual(room.getState().activeMinigame?.submitted, ["bob"], "a reconnect preserves an already submitted minigame result");
}

{
  const mapContent: GameContent = normalizeGameContentEvents({
    ...content,
    activeMapId: "short-map",
    maps: [
      {
        id: "short-map",
        name: "Short map",
        description: "Default map",
        board: [
          { id: 0, type: "start" },
          { id: 1, type: "finish" },
        ],
        routes: [{ id: "short-route", from: 0, to: 1, terrain: "grass" }],
        artifacts: [],
      },
      {
        id: "long-map",
        name: "Long map",
        description: "Selected map",
        board: [
          { id: 0, type: "start" },
          { id: 1, type: "minigame" },
          { id: 2, type: "finish" },
        ],
        routes: [
          { id: "long-route-a", from: 0, to: 1, terrain: "stone" },
          { id: "long-route-b", from: 1, to: 2, terrain: "grass" },
        ],
        artifacts: [],
      },
    ],
  });
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "MAPS", "Map selection", mapContent, { mapId: "long-map" });

  assert.equal(room.getState().mapId, "long-map");
  assert.equal(room.getState().boardLength, 3);
  assert.equal(room.getState().board[1]?.type, "minigame");
  assert.equal(room.getState().routes?.length, 2);
  assert.equal(room.summary().mapName, "Long map");
}

{
  const reveal = await resolveActivityResults({
    eventId: "trivia-capital",
    activity: {
      type: "buzzer",
      content: { question: "Capital?", options: ["Rome", "Paris", "Madrid"], answer: 1 },
    },
    results: [
      { playerId: "alice", score: -1200, payload: { answerIndex: 0, timeMs: 1200, correct: false } },
      { playerId: "bob", score: 999_100, payload: { answerIndex: 1, timeMs: 900, correct: true } },
    ],
    participants: ["alice", "bob"],
    players,
    coinPayout: [10, 0],
  });

  assert.deepEqual(reveal.ranking, ["bob", "alice"]);
  assert.equal(reveal.entries[0].resultLabel, "Correcto");
  assert.equal(reveal.entries[0].detailLabel, "Eligió Paris · Correcta: Paris · 900ms");
  assert.equal(reveal.entries[1].resultLabel, "Incorrecto");
  assert.equal(reveal.entries[1].detailLabel, "Eligió Rome · Correcta: Paris · 1200ms");
}

{
  const reveal = await resolveActivityResults({
    eventId: "whack-amigos",
    activity: { type: "whack", content: { label: "Golpeá al objetivo" } },
    results: [
      { playerId: "alice", score: 4, payload: { hits: 4 } },
      { playerId: "bob", score: 9, payload: { hits: 9 } },
    ],
    participants: ["alice", "bob"],
    players,
    coinPayout: [10, 0],
  });

  assert.deepEqual(reveal.ranking, ["bob", "alice"]);
  assert.equal(reveal.entries[0].resultLabel, "9 aciertos");
  assert.equal(reveal.entries[0].score, 9);
  assert.equal(reveal.entries[1].resultLabel, "4 aciertos");
}

{
  const reveal = await resolveActivityResults({
    eventId: "group-vote",
    activity: { type: "vote", content: { question: "¿Quién la rompió?" } },
    results: [
      { playerId: "alice", score: 0, payload: { votedFor: "bob" } },
      { playerId: "bob", score: 0, payload: { votedFor: "bob" } },
      { playerId: "carla", score: 0, payload: { votedFor: "bob" } },
    ],
    participants: ["alice", "bob", "carla"],
    subjects: ["alice", "bob", "carla"],
    players,
    coinPayout: [10, 0, 0],
  });

  assert.deepEqual(reveal.ranking, ["bob", "alice", "carla"]);
  assert.equal(reveal.entries[0].resultLabel, "3 votos");
  assert.equal(reveal.entries[0].detailLabel, "Votos de Alice, Bob, Carla");
  assert.deepEqual(reveal.entries[0].payload, { votes: 3, voters: ["alice", "bob", "carla"], votedFor: "bob" });
}

{
  const reveal = await resolveActivityResults({
    eventId: "friend-cards",
    activity: { type: "cardVote", content: { cards: ["Card A", "Card B"] } },
    results: [
      { playerId: "alice", score: 1, payload: { cards: 1, wonCards: ["Card B"] } },
      { playerId: "bob", score: 2, payload: { cards: 2, wonCards: ["Card A", "Card B"] } },
      { playerId: "carla", score: 0, payload: { cards: 0, wonCards: [] } },
    ],
    participants: ["alice", "bob", "carla"],
    subjects: ["alice", "bob", "carla"],
    players,
    coinPayout: [],
    story: { title: "Friend cards" },
  });

  assert.deepEqual(reveal.ranking, ["bob", "alice", "carla"]);
  assert.equal(reveal.title, "Friend cards");
  assert.equal(reveal.entries[0].resultLabel, "2 cartas");
  assert.equal(reveal.entries[0].detailLabel, "Recibió “Card A” · “Card B”");
  assert.equal(reveal.entries[2].detailLabel, "Sin cartas");
}

{
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "TST1", "Test room", content);

  assert.equal(room.join("socket-alice", "Alice").ok, true);
  assert.equal(room.join("socket-bob", "Bob").ok, true);

  for (const player of room.getState().players) {
    assert.equal("stars" in player, false, "players expose coins, not deprecated stars");
  }
}

{
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "CHAR", "Characters", characterContent);

  const guestJoin = (room as any).join("socket-guest", "Whoever", { characterId: "guest" });
  assert.equal(guestJoin.ok, true);
  assert.equal(guestJoin.playerId, "guest");
  assert.equal(room.getState().characterSlots?.find((slot) => slot.id === "guest")?.claimedByPlayerId, "guest");
  assert.equal(room.getState().players.find((player) => player.id === "guest")?.name, "Guest");
  assert.equal(room.getState().players.find((player) => player.id === "guest")?.color, "#38bdf8");
  assert.equal(room.getState().players.find((player) => player.id === "guest")?.facePhoto, "data:image/png;base64,guest");
  assert.deepEqual(room.getState().players.find((player) => player.id === "guest")?.facePhotoAlignment, { x: 0.42, y: 0.57, scale: 1.2 });
  assert.deepEqual(room.getState().players.find((player) => player.id === "guest")?.faceAnchors, { mouth: { x: 0.5, y: 0.64, angle: 0 } });
  assert.deepEqual(room.getState().players.find((player) => player.id === "guest")?.bodyAnchors, { head: { x: 0.5, y: 0.14, angle: 0 } });
  assert.deepEqual(room.getState().players.find((player) => player.id === "guest")?.ownedCosmeticIds, ["party-goggles", "big-mustache"]);
  assert.deepEqual(room.getState().players.find((player) => player.id === "guest")?.cosmeticIds, ["party-goggles", "big-mustache"]);

  assert.deepEqual((room as any).join("socket-steal", "Steal", { characterId: "guest" }), {
    ok: false,
    error: "Ese personaje ya está ocupado",
  });

  const groomJoin = (room as any).join("socket-groom", "Host", { characterId: "groom" });
  assert.equal(groomJoin.ok, true);
  assert.equal(groomJoin.playerId, "groom");
  assert.equal(room.getState().players.find((player) => player.id === "groom")?.groom, true);
  assert.deepEqual((room as any).join("socket-full", "Full"), { ok: false, error: "La sala está llena" });
}

{
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "TRT0", "Traits", traitContent);

  assert.equal(room.getState().characterSlots?.find((slot) => slot.id === "alice")?.defaultTraits?.[0]?.name, "Steady boots");
  assert.equal(room.getState().characterSlots?.find((slot) => slot.id === "alice")?.defaultTraits?.[0]?.effectId, "double-movement-game");

  room.join("socket-alice", "Alice");
  room.startGame("socket-alice");

  assert.equal(room.getState().activeEffects.length, 1);
  assert.equal(room.getState().activeEffects[0].name, "Steady boots");
  assert.equal(room.getState().activeEffects[0].description, "Moves at double speed for the whole game.");
  assert.equal(room.getState().activeEffects[0].effectId, "double-movement-game");
  assert.equal(room.getState().activeEffects[0].targetPlayerId, "alice");

  room.disconnect("socket-alice");
  room.join("socket-alice-2", "Alice", { characterId: "alice" } as any);
  assert.equal(room.getState().activeEffects.length, 1, "reconnect does not duplicate default trait effects");
}

await withRolls([5, 5], async () => {
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "TRT1", "Trait conditions", traitContent);

  room.join("socket-bob", "Bob", { characterId: "bob" } as any);
  room.startGame("socket-bob");

  room.roll("socket-bob");
  assert.equal(room.getState().players.find((player) => player.id === "bob")?.position, 5);
  assert.equal(room.getState().phase, "turn");

  room.roll("socket-bob");
  assert.equal(room.getState().players.find((player) => player.id === "bob")?.position, 5, "second high roll moves back after landing");
  assert.equal(room.getState().phase, "event");
  assert.equal(room.getState().activeEvent?.actions?.some((action) => action.type === "move" && action.value === -5), true);
});

await withRolls([4], async () => {
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "TRT2", "Trait prompt", traitContent);

  room.join("socket-frang", "FranG", { characterId: "frang" } as any);
  room.startGame("socket-frang");
  room.roll("socket-frang");

  assert.equal(room.getState().phase, "event");
  assert.equal(room.getState().players.find((player) => player.id === "frang")?.position, 3);
  assert.equal(room.getState().activeEvent?.actions?.some((action) => action.type === "offlineAction" && action.requiresConfirmation), true);
  assert.equal(room.getState().activeEvent?.actions?.some((action) => action.type === "move" && action.value === -1), true);
});

assert.equal(
  effectConditionMatches(
    { rollTotal: { turns: 2, gte: 11 } },
    { hook: "afterMovement", rollHistory: [2, 6, 5] }
  ),
  true,
  "roll-total traits can react to the target player's last two rolls"
);
assert.equal(
  effectConditionMatches(
    { rankingPositionGte: 4, activityTypesNone: ["prompt"] },
    { hook: "onActivityResult", targetPlayerId: "nico", ranking: ["alice", "bob", "carla", "nico"], activityType: "reaction" }
  ),
  true,
  "outside-top-three traits match the effect owner's ranking position"
);
assert.equal(
  effectConditionMatches(
    { rankingPositionGte: 4, activityTypesNone: ["prompt"] },
    { hook: "onActivityResult", targetPlayerId: "nico", ranking: ["alice", "bob", "carla", "nico"], activityType: "prompt" }
  ),
  false,
  "minigame traits ignore prompt results"
);

{
  const { io } = createIoRecorder();
  const preTurnContent: GameContent = normalizeGameContentEvents({
    board: Array.from({ length: 8 }, (_, id) => ({ id, type: id === 7 ? "finish" as const : "start" as const })),
    events: {},
    players: [{ id: "javi", name: "Javi", color: "#f59e0b" }],
    characters: { javi: { id: "javi", displayName: "Javi", defaultTraits: ["false-abstemious"] } },
    characterTraits: {
      "false-abstemious": { id: "false-abstemious", name: "Falso abstemio", effectId: "two-starting-shots" },
    },
    effects: {
      "two-starting-shots": {
        id: "two-starting-shots",
        name: "Two starting shots",
        duration: { mode: "turns", value: 2 },
        consequences: [{ type: "offlineAction", hook: "onTurnStart", action: "takeShot", text: "Take a shot before playing." }],
      },
    },
  });
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "PRE1", "Turn-start traits", preTurnContent);
  room.join("socket-javi", "Javi");
  room.startGame("socket-javi");

  assert.equal(room.getState().phase, "event");
  assert.equal(room.getState().activeEvent?.actions?.[0]?.offlineAction, "takeShot");
  room.next("socket-javi");
  assert.equal(room.getState().phase, "turn", "confirming a turn-start action resumes the same turn");

  const internals = room as unknown as { advanceTurn: () => void };
  internals.advanceTurn();
  assert.equal(room.getState().phase, "event", "the second turn starts with the second shot");
  room.next("socket-javi");
  internals.advanceTurn();
  assert.equal(room.getState().phase, "turn", "the two-turn trait expires before the third turn");
}

await withRolls([1], async () => {
  const { io } = createIoRecorder();
  const landingEffectContent: GameContent = normalizeGameContentEvents({
    board: [
      { id: 0, type: "start" },
      { id: 1, type: "reaction" },
      { id: 2, type: "reaction", eventId: "explicit-reaction" },
      { id: 3, type: "finish" },
    ],
    events: {
      "fallback-reaction": {
        name: "Fallback reaction",
        kind: "activity",
        story: { title: "Fallback reaction", prompt: "React now." },
        activity: { type: "reaction", content: { label: "React now." } },
      },
      "explicit-reaction": {
        name: "Explicit reaction",
        kind: "activity",
        story: { title: "Explicit reaction", prompt: "This pool is authored." },
        activity: { type: "reaction", content: { label: "This pool is authored." } },
      },
      "javi-personal-reaction": {
        name: "Javi personal reaction",
        kind: "activity",
        trigger: { type: "player", playerId: "javi" },
        story: { title: "Javi personal reaction", prompt: "Only from an authored pool." },
        activity: { type: "reaction", content: { label: "Only from an authored pool." } },
      },
    },
    players: [{ id: "javi", name: "Javi", color: "#f59e0b" }],
    characters: {
      javi: {
        id: "javi",
        displayName: "Javi",
        defaultTraits: ["false-abstemious", "roll-bonus"],
      },
    },
    characterTraits: {
      "false-abstemious": { id: "false-abstemious", name: "Falso abstemio", effectId: "starting-shot" },
      "roll-bonus": { id: "roll-bonus", name: "Roll bonus", effectId: "roll-bonus-effect" },
    },
    effects: {
      "starting-shot": {
        id: "starting-shot",
        name: "Starting shot",
        duration: { mode: "turns", value: 2 },
        consequences: [{ type: "offlineAction", hook: "onTurnStart", action: "takeShot", text: "Take a shot before playing." }],
      },
      "roll-bonus-effect": {
        id: "roll-bonus-effect",
        name: "Roll bonus",
        duration: { mode: "game" },
        consequences: [{ type: "coins", hook: "beforeRoll", value: 1, text: "Gain a coin before rolling." }],
      },
    },
  });
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "LAND", "Landing effects", landingEffectContent);
  room.join("socket-javi", "Javi");
  room.startGame("socket-javi");

  assert.equal(room.getState().phase, "event", "Javi's turn-start effect keeps its confirmation window");
  assert.equal(room.getState().activeEvent?.actions?.[0]?.offlineAction, "takeShot");
  room.next("socket-javi");
  assert.equal(room.getState().phase, "turn", "confirming the effect window resumes Javi's turn");

  room.roll("socket-javi", 1);
  assert.equal(room.getState().players[0]?.coins, 1, "Javi's before-roll effect still resolves");
  assert.equal(room.getState().phase, "minigame", "an unassigned typed cell starts a catalog event");
  assert.equal(room.getState().activeMinigame?.eventId, "fallback-reaction");
  assert.deepEqual(room.getState().activeEffects.map((effect) => effect.effectId).sort(), ["roll-bonus-effect", "starting-shot"]);

  const explicitRoom = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "LAND2", "Explicit landing effects", landingEffectContent);
  explicitRoom.join("socket-javi-explicit", "Javi");
  explicitRoom.startGame("socket-javi-explicit");
  explicitRoom.next("socket-javi-explicit");
  explicitRoom.roll("socket-javi-explicit", 2);
  assert.equal(explicitRoom.getState().activeMinigame?.eventId, "explicit-reaction", "authored event pools stay authoritative");
});

{
  const { io } = createIoRecorder();
  const rankedTraitContent: GameContent = normalizeGameContentEvents({
    board: Array.from({ length: 8 }, (_, id) => ({ id, type: id === 7 ? "finish" as const : "start" as const })),
    events: {},
    players: [
      { id: "alice", name: "Alice", color: "#f87171" },
      { id: "bob", name: "Bob", color: "#60a5fa" },
      { id: "carla", name: "Carla", color: "#34d399" },
      { id: "nico", name: "Nico", color: "#f59e0b" },
    ],
    characters: {
      alice: { id: "alice", displayName: "Alice" },
      bob: { id: "bob", displayName: "Bob" },
      carla: { id: "carla", displayName: "Carla" },
      nico: { id: "nico", displayName: "Nico", defaultTraits: ["outside-top-three-bonus"] },
    },
    characterTraits: {
      "outside-top-three-bonus": { id: "outside-top-three-bonus", name: "Frustración", effectId: "outside-top-three-coin" },
    },
    effects: {
      "outside-top-three-coin": {
        id: "outside-top-three-coin",
        name: "Outside top three coin",
        duration: { mode: "game" },
        consequences: [{
          type: "coins",
          hook: "onActivityResult",
          when: { rankingPositionGte: 4, activityTypesNone: ["prompt"] },
          value: 1,
          text: "Outside the top three: gain 1 coin.",
        }],
      },
    },
  });
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "RNK1", "Rank traits", rankedTraitContent);
  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  room.join("socket-carla", "Carla");
  room.join("socket-nico", "Nico");
  room.startGame("socket-alice");

  const internals = room as unknown as {
    applyEffectHook: (hook: string, context: Record<string, unknown>) => unknown[];
  };
  internals.applyEffectHook("onActivityResult", {
    ranking: ["alice", "bob", "carla", "nico"],
    activityType: "reaction",
    actingPlayerId: "alice",
    landingPlayerId: "alice",
  });
  assert.equal(room.getState().players.find((player) => player.id === "nico")?.coins, 1);
  internals.applyEffectHook("onActivityResult", {
    ranking: ["alice", "bob", "carla", "nico"],
    activityType: "prompt",
    actingPlayerId: "alice",
    landingPlayerId: "alice",
  });
  assert.equal(room.getState().players.find((player) => player.id === "nico")?.coins, 1, "prompt results do not pay the rank trait");
}

{
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "COSM", "Cosmetics", characterContent);

  room.join("socket-guest", "Guest", { characterId: "guest" } as any);
  const guest = room.getState().players.find((player) => player.id === "guest")!;
  assert.deepEqual(room.buyCosmetic("socket-guest", "party-hat"), { ok: false, error: "No te alcanzan las monedas" });
  assert.equal(guest.coins, 0);
  assert.deepEqual(guest.ownedCosmeticIds, ["party-goggles", "big-mustache"]);
  assert.deepEqual(guest.cosmeticIds, ["party-goggles", "big-mustache"]);
  assert.equal(guest.position, 0);
  assert.equal(room.getState().phase, "lobby");

  guest.coins = 2;
  const cosmeticBuy = room.buyCosmetic("socket-guest", "party-hat") as any;
  assert.equal(cosmeticBuy.ok, true);
  assert.equal(cosmeticBuy.transaction.playerId, "guest");
  assert.equal(cosmeticBuy.transaction.delta, -2);
  assert.equal(cosmeticBuy.transaction.source.kind, "shopPurchase");
  assert.equal(guest.coins, 0);
  assert.deepEqual(guest.ownedCosmeticIds, ["party-goggles", "big-mustache", "party-hat"]);
  assert.deepEqual(guest.cosmeticIds, ["party-goggles", "big-mustache"]);

  assert.deepEqual(room.equipCosmetic("socket-guest", "party-hat", true), { ok: true });
  assert.deepEqual(guest.cosmeticIds, ["party-goggles", "big-mustache", "party-hat"]);
  assert.equal(guest.position, 0);
  assert.equal(room.getState().phase, "lobby");

  assert.deepEqual(room.equipCosmetic("socket-guest", "party-hat", false), { ok: true });
  assert.deepEqual(guest.cosmeticIds, ["party-goggles", "big-mustache"]);
  assert.deepEqual(room.equipCosmetic("socket-guest", "missing", true), { ok: false, error: "Ese cosmetic no existe" });
}

const artifactShopContent: GameContent = normalizeGameContentEvents({
  board: [
    { id: 0, type: "start", layout: { x: 0, y: 0 } },
    { id: 1, type: "shop", label: "Shop", layout: { x: 1, y: 0 } },
    { id: 2, type: "minigame", layout: { x: 2, y: 0 } },
    { id: 3, type: "minigame", layout: { x: 3, y: 0 } },
    { id: 4, type: "minigame", layout: { x: 4, y: 0 } },
    { id: 5, type: "finish", layout: { x: 5, y: 0 } },
  ],
  events: {},
  artifactRarityRates: { common: 100, epic: 0, legendary: 0 },
  artifacts: {
    "mochila-de-gaston": {
      id: "mochila-de-gaston",
      name: "Mochila de Gaston",
      description: "Gaston delivers a backpack that slows the target for 2 rounds.",
      price: 4,
      rarity: "common",
      targetMode: "choosePlayer",
      useFlow: "targeted",
      consequences: [{ type: "applyEffect", effectId: "mochila-half-roll", target: "target" }],
      visual: { assetId: "backpack", anchorType: "body", anchorId: "chest", label: "Backpack" },
      animations: { incoming: "gaston-backpack-drop" },
    },
    "common-coin": {
      id: "common-coin",
      name: "Coin IOU",
      description: "Gain one coin.",
      price: 1,
      rarity: "common",
      targetMode: "self",
      useFlow: "immediate",
      consequences: [{ type: "coins", value: 1, target: "acting" }],
    },
    "common-step": {
      id: "common-step",
      name: "Step ticket",
      description: "Move one cell.",
      price: 1,
      rarity: "common",
      targetMode: "self",
      useFlow: "immediate",
      consequences: [{ type: "move", delta: 1, target: "acting" }],
    },
    "common-text": {
      id: "common-text",
      name: "Toast note",
      description: "Announce a toast.",
      price: 0,
      rarity: "common",
      targetMode: "none",
      useFlow: "immediate",
      consequences: [{ type: "text", text: "A toast is declared." }],
    },
  },
  effects: {
    "mochila-half-roll": {
      id: "mochila-half-roll",
      name: "Mochila de Gaston",
      description: "For 2 rounds, advance half of the die roll. If the target rolls 6, they take a shot.",
      icon: "🎒",
      duration: { mode: "rounds", value: 2 },
      consequences: [
        { type: "movementMultiplier", hook: "beforeMovement", multiplier: 0.5, rounding: "ceil", text: "Move half of the die roll." },
        {
          type: "offlineAction",
          hook: "afterRoll",
          when: { rollEquals: 6 },
          action: "takeShot",
          text: "Rolled a 6 with Mochila de Gaston: take a shot.",
        },
      ],
      visualAssetId: "backpack",
    },
  },
  players: [
    { id: "alice", name: "Alice", color: "#f87171" },
    { id: "bob", name: "Bob", color: "#60a5fa" },
  ],
});

const productionArtifactContent = JSON.parse(
  readFileSync(new URL("../../shared/content.json", import.meta.url), "utf8")
) as GameContent;

{
  const recorder = createIoRecorder();
  const room = new GameRoom(recorder.io as never, "SIZE", "Payload budget", productionArtifactContent, { mapId: "map-2" });
  const stateBytes = Buffer.byteLength(JSON.stringify(room.getState()));
  assert.ok(stateBytes < 500_000, `multiplayer state must stay below the 500 KB LAN budget, received ${stateBytes}`);
}

{
  const map = productionArtifactContent.maps?.find((candidate) => candidate.id === "map-2");
  assert.ok(map, "production Despedida map exists");
  const assignedEventIds = map.board.flatMap((tile) => [tile.eventId, ...(tile.eventIds ?? [])]).filter((id): id is string => Boolean(id));
  assert.equal(map.board.length, 65);
  assert.equal(map.board.filter((tile) => tile.type === "shop").length, 7);
  const queuedActivityTypes = new Set(map.board.flatMap((tile) => tile.eventQueue?.activityTypes ?? []));
  const reachableEvents = Object.entries(productionArtifactContent.events).filter(([id, event]) =>
    assignedEventIds.includes(id) || queuedActivityTypes.has(event.activity?.type ?? "prompt")
  );
  assert.equal(reachableEvents.length, Object.keys(productionArtifactContent.events).length, "Despedida can reach every production event");
  const duplicateAnchors = assignedEventIds.filter((id, index) => assignedEventIds.indexOf(id) !== index);
  assert.ok(duplicateAnchors.every((id) => ["event-098", "event-101", "event-102"].includes(id)), "only finale-core events may be anchored on multiple runway cells");
  assert.equal(new Set(map.mapProps?.map((prop) => prop.assetId)).size, productionArtifactContent.assetCatalog?.length, "Despedida displays every map prop asset type");
  assert.ok(map.board.some((tile) => (tile.eventIds?.length ?? 0) > 1), "Despedida contains event queue cells");
  assert.ok(map.board.some((tile) => Boolean(tile.eventId) && !tile.eventIds?.length), "Despedida preserves singleton cinematic events");
  assert.ok(map.board.filter((tile) => tile.eventQueue?.activityTypes.includes("timing")).length >= 2, "Despedida gives timing multiple shared-queue cells");
}

function focusedProductionArtifactContent(artifactId: string): GameContent {
  const artifact = productionArtifactContent.artifacts?.[artifactId];
  assert.ok(artifact, `production artifact ${artifactId} exists`);
  return normalizeGameContentEvents({
    board: [
      { id: 0, type: "start" },
      { id: 1, type: "shop" },
      ...Array.from({ length: 8 }, (_, index) => ({ id: index + 2, type: "minigame" as const })),
      { id: 10, type: "finish" },
    ],
    events: {},
    artifactRarityRates: { common: 100, epic: 0, legendary: 0 },
    artifacts: {
      [artifactId]: { ...artifact, price: 0, rarity: "common" },
    },
    effects: productionArtifactContent.effects,
    players: [
      { id: "alice", name: "Alice", color: "#f87171" },
      { id: "bob", name: "Bob", color: "#60a5fa" },
      { id: "frang", name: "FranG", color: "#3b82f6" },
    ],
  });
}

function buyFocusedArtifact(room: GameRoom, artifactId: string) {
  const roll = room.rollArtifactShop("socket-alice");
  assert.equal(roll.ok, true);
  const offer = room.getState().artifactShop?.offers.find((candidate) => candidate.artifactId === artifactId);
  assert.ok(offer, `${artifactId} appears in its focused shop`);
  const result = room.buyArtifact("socket-alice", offer.id);
  assert.equal(result.ok, true);
  return result;
}

{
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "ART0", "Artifact shop crossing", artifactShopContent);

  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  room.startGame("socket-alice");

  await withRolls([3], async () => room.roll("socket-alice"));

  const alice = room.getState().players.find((player) => player.id === "alice");
  assert.equal(alice?.position, 1, "passing through a shop stops on the shop cell");
  assert.equal(room.getState().phase, "shop");
  assert.equal(room.getState().artifactShop?.playerId, "alice");
  assert.equal(room.getState().artifactShop?.tileId, 1);
  assert.equal(room.getState().lastRoll, 3, "the displayed/effective roll remains the rolled value");
  assert.equal(room.getState().lastMovement, 1, "presentation movement records the interrupted walk distance");
}

{
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "ART1", "Artifact shop", artifactShopContent);

  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  room.getState().players.find((player) => player.id === "alice")!.coins = 10;
  room.startGame("socket-alice");

  await withRolls([1], async () => room.roll("socket-alice"));
  assert.equal(room.getState().phase, "shop");
  assert.equal(room.getState().artifactShop?.playerId, "alice");
  assert.deepEqual(room.getState().artifactShop?.offers, []);

  const rollResult = room.rollArtifactShop("socket-alice");
  assert.equal(rollResult.ok, true);
  assert.equal(room.getState().artifactShop?.offers.length, 4);
  const mochilaOffer = room.getState().artifactShop?.offers.find((offer) => offer.artifactId === "mochila-de-gaston");
  assert.ok(mochilaOffer, "shop roll includes Mochila de Gaston when all four common artifacts are available");

  const artifactBuy = room.buyArtifact("socket-alice", mochilaOffer.id) as any;
  assert.equal(artifactBuy.ok, true);
  assert.equal(artifactBuy.artifactId, "mochila-de-gaston");
  assert.equal(artifactBuy.requiresTarget, true);
  assert.equal(artifactBuy.transaction.playerId, "alice");
  assert.equal(artifactBuy.transaction.delta, -4);
  assert.equal(artifactBuy.transaction.source.kind, "shopPurchase");
  assert.equal(room.getState().players.find((player) => player.id === "alice")?.coins, 6);
  assert.equal(room.getState().pendingArtifactUse?.artifactId, "mochila-de-gaston");
  assert.equal(room.buyArtifact("socket-alice", room.getState().artifactShop!.offers.find((offer) => offer.id !== mochilaOffer.id)!.id).ok, false);

  assert.deepEqual(room.useArtifact("socket-alice", "bob"), { ok: true });
  assert.equal(room.getState().phase, "event");
  assert.equal(room.getState().activeEvent?.title, "Mochila de Gaston");
  assert.equal(room.getState().activeEvent?.text, "Alice used Mochila de Gaston on Bob.");
  assert.equal(room.getState().activeEvent?.story?.prompt, "Alice used Mochila de Gaston on Bob.");
  assert.deepEqual(room.getState().activeEvent?.artifactUse, {
    artifactId: "mochila-de-gaston",
    artifactName: "Mochila de Gaston",
    sourcePlayerId: "alice",
    targetPlayerId: "bob",
    targetMode: "choosePlayer",
  });
  assert.equal(room.getState().activeEffects.length, 1);
  assert.equal(room.getState().activeEffects[0].targetPlayerId, "bob");
  assert.equal(room.getState().activeEffects[0].effectId, "mochila-half-roll");

  room.next("socket-alice");
  assert.equal(room.getState().turnOrder[room.getState().activeIndex], "bob");

  await withRolls([6], async () => room.roll("socket-bob"));
  assert.equal(room.getState().lastBaseRoll, 6);
  assert.equal(room.getState().lastRoll, 3, "Mochila de Gaston halves Bob's movement roll");
  assert.equal(room.getState().players.find((player) => player.id === "bob")?.position, 1, "Bob stops at the crossed shop before using the rest of the move");
  assert.equal(room.getState().lastMovement, 1);
  assert.equal(room.getState().phase, "shop");
  assert.equal(room.getState().activeEvent?.actions?.some((action) => action.type === "offlineAction"), true);
}

{
  const { io } = createIoRecorder();
  const room = new GameRoom(
    io as ConstructorParameters<typeof GameRoom>[0],
    "ART2",
    "Tarjeta Silver",
    focusedProductionArtifactContent("tarjeta-silver")
  );

  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  room.getState().players.find((player) => player.id === "bob")!.position = 3;
  room.startGame("socket-alice");
  room.roll("socket-alice", 1);
  buyFocusedArtifact(room, "tarjeta-silver");
  assert.equal(room.getState().activeEffects[0]?.effectId, "artifact-tarjeta-silver-income");

  room.next("socket-alice");
  room.roll("socket-bob", 1);
  assert.equal(room.getState().phase, "event", "Tarjeta Silver pays before Alice's next turn");
  assert.equal(room.getState().players.find((player) => player.id === "alice")?.coins, 5);

  room.next("socket-alice");
  room.roll("socket-alice", 1);
  room.roll("socket-bob", 1);
  assert.equal(room.getState().players.find((player) => player.id === "alice")?.coins, 10, "Tarjeta Silver pays on two turn starts");
  assert.equal(room.getState().activeEffects.some((effect) => effect.effectId === "artifact-tarjeta-silver-income"), false);
}

{
  const { io } = createIoRecorder();
  const room = new GameRoom(
    io as ConstructorParameters<typeof GameRoom>[0],
    "ART3",
    "Shampoo de vodka",
    focusedProductionArtifactContent("shampoo-de-vodka")
  );

  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  room.startGame("socket-alice");
  room.roll("socket-alice", 1);
  const result = buyFocusedArtifact(room, "shampoo-de-vodka") as { ok: true; requiresTarget: boolean };
  assert.equal(result.requiresTarget, true);
  assert.deepEqual(room.useArtifact("socket-alice", "bob"), { ok: true });
  assert.equal(room.getState().players.find((player) => player.id === "bob")?.position, 3);
  assert.equal(room.getState().activeEvent?.actions?.filter((action) => action.type === "offlineAction").length, 2);
}

{
  const { io } = createIoRecorder();
  const room = new GameRoom(
    io as ConstructorParameters<typeof GameRoom>[0],
    "ART4",
    "Helado",
    focusedProductionArtifactContent("helado")
  );

  room.join("socket-alice", "Alice");
  room.join("socket-frang", "FranG");
  room.getState().players.find((player) => player.id === "frang")!.position = 5;
  room.startGame("socket-alice");
  room.roll("socket-alice", 1);
  buyFocusedArtifact(room, "helado");
  assert.equal(room.getState().players.find((player) => player.id === "alice")?.position, 5);
  assert.equal(room.getState().players.find((player) => player.id === "frang")?.position, 1);
}

{
  const { io } = createIoRecorder();
  const room = new GameRoom(
    io as ConstructorParameters<typeof GameRoom>[0],
    "ART5",
    "Palo de Hockey",
    focusedProductionArtifactContent("palo-hockey")
  );

  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  const bob = room.getState().players.find((player) => player.id === "bob")!;
  bob.coins = 10;
  bob.position = 3;
  room.startGame("socket-alice");
  room.roll("socket-alice", 1);
  buyFocusedArtifact(room, "palo-hockey");
  assert.deepEqual(room.useArtifact("socket-alice", "bob"), { ok: true });
  assert.equal(bob.coins, 5);
  room.next("socket-alice");
  assert.equal(room.getState().turnOrder[room.getState().activeIndex], "alice", "Palo de Hockey skips Bob's next turn");
}

await withRolls([1, 1, 2], async () => {
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "TST2", "Test room", content);

  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  room.startGame("socket-alice");

  room.roll("socket-alice");
  assert.equal(room.getState().phase, "turn");
  assert.equal(room.getState().players.find((player) => player.id === "alice")?.position, 1);

  room.roll("socket-bob");
  assert.equal(room.getState().phase, "event");
  room.next("socket-alice");
  assert.equal(room.getState().players.find((player) => player.id === "bob")?.coins, 100);

  room.roll("socket-alice");

  assert.equal(room.getState().phase, "finished");
  assert.equal(room.getState().winnerId, "alice", "the first player to reach finish wins before coin ranking");
});

const moveToFinishContent: GameContent = normalizeGameContentEvents({
  board: [
    { id: 0, type: "start" },
    { id: 1, type: "fate", eventId: "finish-move" },
    { id: 2, type: "finish" },
  ],
  events: {
    "finish-move": {
      name: "Finish move",
      kind: "story",
      story: { title: "Finish move", prompt: "Move to the finish." },
      actions: [{ type: "moveTo", tileId: 2, target: "landing" }],
    },
  },
  players: [
    { id: "alice", name: "Alice", color: "#f87171" },
    { id: "bob", name: "Bob", color: "#60a5fa" },
  ],
});

await withRolls([1], async () => {
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "TST3", "Test room", moveToFinishContent);

  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  room.getState().players.find((player) => player.id === "bob")!.coins = 100;
  room.startGame("socket-alice");

  room.roll("socket-alice");
  assert.equal(room.getState().phase, "event");
  assert.equal(room.getState().winnerId, "alice", "consequence movement records the first player to reach finish");

  room.next("socket-alice");
  assert.equal(room.getState().phase, "finished");
  assert.equal(room.getState().winnerId, "alice", "consequence movement ends the game after the event is acknowledged");
});

const promptConfirmationContent: GameContent = normalizeGameContentEvents({
  board: [
    { id: 0, type: "start" },
    { id: 1, type: "dare", eventId: "prenda" },
    { id: 2, type: "finish" },
  ],
  events: {
    prenda: {
      name: "Group-confirmed dare",
      kind: "activity",
      story: { title: "Prenda", prompt: "Alice has to sing." },
      activity: { type: "prompt", content: { prompt: "Sing the chorus." } },
      actions: [{ type: "coins", value: 5, target: "landing" }],
    },
  },
  players: [
    { id: "alice", name: "Alice", color: "#f87171" },
    { id: "bob", name: "Bob", color: "#60a5fa" },
    { id: "carla", name: "Carla", color: "#34d399" },
  ],
});

const effectContent: GameContent = normalizeGameContentEvents({
  board: [
    { id: 0, type: "start" },
    { id: 1, type: "fate", eventId: "apply-half-roll" },
    { id: 2, type: "minigame" },
    { id: 3, type: "minigame" },
    { id: 4, type: "minigame" },
    { id: 5, type: "finish" },
  ],
  events: {
    "apply-half-roll": {
      name: "Apply half roll",
      kind: "story",
      story: { title: "Apply half roll", prompt: "Alice is slowed down." },
      actions: [{ type: "applyEffect", effectId: "half-roll-2-rounds", target: "landing" }],
    },
  },
  effects: {
    "half-roll-2-rounds": {
      id: "half-roll-2-rounds",
      name: "Half movement",
      description: "For 2 rounds, move half of the die roll.",
      duration: { mode: "rounds", value: 2 },
      consequences: [{ type: "movementMultiplier", hook: "beforeMovement", multiplier: 0.5, rounding: "ceil", text: "Move half of the die roll." }],
    },
  },
  players: [{ id: "alice", name: "Alice", color: "#f87171" }],
});

await withRolls([1, 5], async () => {
  const { io, events } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "EFF1", "Effects", effectContent);

  room.join("socket-alice", "Alice");
  room.startGame("socket-alice");
  room.roll("socket-alice");

  assert.equal(room.getState().phase, "event");
  assert.equal(room.getState().players[0].position, 1);
  assert.equal(room.getState().activeEffects.length, 1);
  assert.equal(room.getState().activeEffects[0].name, "Half movement");
  assert.equal(room.getState().activeEffects[0].consequences[0].type, "movementMultiplier");
  assert.deepEqual(room.getState().activeEvent?.actions?.[0].effectInstanceIds, [room.getState().activeEffects[0].id]);

  room.next("socket-alice");
  assert.equal(room.getState().phase, "turn");
  assert.equal(room.getState().round, 2);
  assert.deepEqual(room.getState().activeEffects[0].remaining, { mode: "rounds", remaining: 1 });

  room.roll("socket-alice");
  assert.equal(room.getState().lastRoll, 3, "half movement changes the effective dice roll");
  assert.equal(room.getState().lastBaseRoll, 5, "half movement keeps the original physical die face for UI presentation");
  assert.equal(room.getState().players[0].position, 4, "half movement applies ceiling after multiplying a roll of 5");
  assert.equal(room.getState().phase, "event");
  assert.equal(room.getState().activeEvent?.actions?.some((action) => action.type === "movementMultiplier"), true);
  assert.equal(room.getState().activeEvent?.actions?.some((action) => action.type === "offlineAction"), false);

  room.next("socket-alice");
  assert.equal(room.getState().activeEffects.length, 0);
  assert.equal(events.some((event) => event.event === "effect:ended" && (event.payload as { reason?: string }).reason === "expired"), true);
});

const doubleMovementContent: GameContent = normalizeGameContentEvents({
  board: [
    { id: 0, type: "start" },
    { id: 1, type: "minigame" },
    { id: 2, type: "minigame" },
    { id: 3, type: "minigame" },
    { id: 4, type: "minigame" },
    { id: 5, type: "minigame" },
    { id: 6, type: "minigame" },
    { id: 7, type: "minigame" },
    { id: 8, type: "minigame" },
    { id: 9, type: "minigame" },
    { id: 10, type: "minigame" },
    { id: 11, type: "minigame" },
    { id: 12, type: "finish" },
  ],
  events: {},
  effects: {
    "double-movement": {
      id: "double-movement",
      name: "Double movement",
      description: "Double the effective dice roll.",
      duration: { mode: "uses", value: 1 },
      consequences: [{ type: "movementMultiplier", hook: "beforeMovement", multiplier: 2, rounding: "round", text: "Double movement." }],
    },
  },
  players: [{ id: "alice", name: "Alice", color: "#f87171" }],
});

await withRolls([5], async () => {
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "EFF2", "Double movement", doubleMovementContent);

  room.join("socket-alice", "Alice");
  room.startGame("socket-alice");
  room.debugApplyEffect("socket-alice", { playerId: "alice", effectId: "double-movement" });
  room.roll("socket-alice");

  assert.equal(room.getState().lastBaseRoll, 5, "double movement keeps the original physical die face for UI presentation");
  assert.equal(room.getState().lastRoll, 10, "double movement changes a rolled five into an effective ten");
  assert.equal(room.getState().players[0].position, 10, "double movement moves directly to the effective dice target");
  assert.equal(room.getState().activeEffects.length, 0, "use-based movement modifiers expire after the modified roll");
});

{
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "DBG1", "Debug effects", {
    ...effectContent,
    players: [
      { id: "alice", name: "Alice", color: "#f87171" },
      { id: "bob", name: "Bob", color: "#60a5fa" },
    ],
  });

  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  assert.equal(room.getState().effects?.["half-roll-2-rounds"]?.name, "Half movement");

  room.debugApplyEffect("socket-bob", { playerId: "alice", effectId: "half-roll-2-rounds" });
  assert.equal(room.getState().activeEffects.length, 0, "non-hosts cannot apply debug effects");

  room.debugApplyEffect("socket-alice", { playerId: "bob", effectId: "half-roll-2-rounds" });
  assert.equal(room.getState().activeEffects.length, 1);
  assert.equal(room.getState().activeEffects[0].targetPlayerId, "bob");
  assert.equal(room.getState().activeEffects[0].effectId, "half-roll-2-rounds");
  assert.equal(room.getState().activeEffects[0].sourcePlayerId, "alice");

  room.debugApplyEffect("socket-alice", { playerId: "bob", effectId: "missing-effect" });
  assert.equal(room.getState().activeEffects.length, 1, "missing effects are ignored");

  room.debugApplyEffect("socket-alice", {
    playerId: "bob",
    effectId: "draft-dice-charm",
    effect: {
      id: "draft-dice-charm",
      name: "Draft dice charm",
      duration: { mode: "uses", value: 1 },
      consequences: [{ type: "diceBias", hook: "beforeRoll", face: 5, chanceDeltaPercent: 25 }],
    },
  });
  assert.equal(room.getState().activeEffects.length, 2, "hosts can apply draft-only effect definitions");
  assert.equal(room.getState().activeEffects[1].effectId, "draft-dice-charm");
  assert.equal(room.getState().activeEffects[1].consequences[0].type, "diceBias");
}

await withRolls([4], async () => {
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "DBG4", "Draft movement modifier", {
    ...doubleMovementContent,
    effects: {},
  });

  room.join("socket-alice", "Alice");
  room.startGame("socket-alice");
  room.debugApplyEffect("socket-alice", {
    playerId: "alice",
    effectId: "draft-double-rounds",
    effect: {
      id: "draft-double-rounds",
      name: "Draft double rounds",
      duration: { mode: "rounds", value: 2 },
      consequences: [{ type: "movementMultiplier", hook: "beforeRoll", multiplier: 2, rounding: "round" }],
    },
  });

  assert.equal(room.getState().activeEffects[0].hooks[0], "beforeMovement", "movement multipliers are normalized to the movement hook");
  room.roll("socket-alice");

  assert.equal(room.getState().lastBaseRoll, 4, "draft movement multiplier stores the original physical die face");
  assert.equal(room.getState().lastRoll, 8, "draft movement multiplier changes the effective dice roll");
  assert.equal(room.getState().players[0].position, 8, "draft movement multiplier moves directly to the effective dice target");
  assert.deepEqual(room.getState().activeEffects[0].remaining, { mode: "rounds", remaining: 2 }, "round-based movement modifiers do not expire on first use");
});

await withRolls([5], async () => {
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "DBG5", "Draft half movement", {
    ...doubleMovementContent,
    effects: {},
  });

  room.join("socket-alice", "Alice");
  room.startGame("socket-alice");
  room.debugApplyEffect("socket-alice", {
    playerId: "alice",
    effectId: "draft-half-rounds",
    effect: {
      id: "draft-half-rounds",
      name: "Draft half rounds",
      duration: { mode: "rounds", value: 2 },
      consequences: [{ type: "movementMultiplier", hook: "beforeMovement", multiplier: 0.5, rounding: "ceil" }],
    },
  });

  room.roll("socket-alice");

  assert.equal(room.getState().lastBaseRoll, 5, "draft half movement stores the original physical die face");
  assert.equal(room.getState().lastRoll, 3, "draft half movement changes the effective dice roll");
  assert.equal(room.getState().players[0].position, 3, "draft half movement moves by the rounded half roll");
  assert.deepEqual(room.getState().activeEffects[0].remaining, { mode: "rounds", remaining: 2 }, "round-based half movement does not expire on first use");
});

const timedConsequenceContent: GameContent = normalizeGameContentEvents({
  board: [
    { id: 0, type: "start" },
    { id: 1, type: "fate", eventId: "attach-coin" },
    { id: 2, type: "minigame" },
    { id: 3, type: "finish" },
  ],
  events: {
    "attach-coin": {
      name: "Attach coin",
      kind: "story",
      story: { title: "Attach coin", prompt: "Alice will gain coins when the turn ends." },
      actions: [{ type: "coins", value: 3, target: "landing", hook: "onTurnEnd", duration: { mode: "uses", value: 1 }, text: "End-turn coin" }],
    },
  },
  players: [{ id: "alice", name: "Alice", color: "#f87171" }],
});
const migratedTimedConsequence = timedConsequenceContent.events?.["attach-coin"].consequences?.[0]?.actions[0];
assert.equal(migratedTimedConsequence?.type, "applyEffect", "legacy inline timing is lifted to an Effect reference");
const migratedTimedEffectId = migratedTimedConsequence?.type === "applyEffect" ? migratedTimedConsequence.effectId : "";
assert.deepEqual(timedConsequenceContent.effects?.[migratedTimedEffectId]?.duration, { mode: "uses", value: 1 });
assert.deepEqual(timedConsequenceContent.effects?.[migratedTimedEffectId]?.consequences, [
  { type: "coins", value: 3, hook: "onTurnEnd", text: "End-turn coin" },
]);

await withRolls([1], async () => {
  const { io, events } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "EFF2", "Timed consequences", timedConsequenceContent);

  room.join("socket-alice", "Alice");
  room.startGame("socket-alice");
  room.roll("socket-alice");

  assert.equal(room.getState().phase, "event");
  assert.equal(room.getState().players[0].coins, 0, "duration-based consequences attach before they resolve");
  assert.equal(room.getState().activeEffects.length, 1);
  assert.equal(room.getState().activeEffects[0].targetPlayerId, "alice");
  assert.equal(room.getState().activeEffects[0].consequences[0].type, "coins");
  assert.deepEqual(room.getState().activeEffects[0].remaining, { mode: "uses", remaining: 1 });

  room.next("socket-alice");

  assert.equal(room.getState().phase, "event");
  assert.equal(room.getState().players[0].coins, 3);
  assert.equal(room.getState().activeEvent?.actions?.some((action) => action.type === "coins"), true);
  assert.equal(room.getState().activeEffects.length, 0);
  assert.equal(events.some((event) => event.event === "effect:ended" && (event.payload as { reason?: string }).reason === "triggered"), true);
});

const playerScopedEffectContent: GameContent = normalizeGameContentEvents({
  board: [
    { id: 0, type: "start" },
    { id: 1, type: "fate", eventId: "quiet-cell" },
    { id: 2, type: "finish" },
  ],
  events: {
    "quiet-cell": {
      name: "Quiet cell",
      kind: "story",
      story: { title: "Quiet cell", prompt: "Nothing happens." },
    },
  },
  effects: {
    "turn-end-coin": {
      id: "turn-end-coin",
      name: "Turn-end coin",
      duration: { mode: "uses", value: 1 },
      consequences: [{ type: "coins", value: 2, hook: "onTurnEnd" }],
    },
  },
  players: [
    { id: "alice", name: "Alice", color: "#f87171" },
    { id: "bob", name: "Bob", color: "#60a5fa" },
  ],
});

await withRolls([1, 1], async () => {
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "EFFS", "Scoped effects", playerScopedEffectContent);

  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  room.startGame("socket-alice");
  room.debugApplyEffect("socket-alice", { playerId: "bob", effectId: "turn-end-coin" });

  room.roll("socket-alice");
  room.next("socket-alice");
  assert.equal(room.getState().players.find((player) => player.id === "bob")?.coins, 0, "Bob's effect does not fire at Alice's turn end");
  assert.equal(room.getState().activeEffects.length, 1, "Bob's use remains available for Bob's lifecycle");

  room.roll("socket-bob");
  room.next("socket-alice");
  assert.equal(room.getState().players.find((player) => player.id === "bob")?.coins, 2, "Bob's effect fires at Bob's turn end");
  assert.equal(room.getState().activeEffects.length, 0);
});

const diceBiasContent: GameContent = normalizeGameContentEvents({
  board: [
    { id: 0, type: "start" },
    { id: 1, type: "fate", eventId: "attach-dice-bias" },
    { id: 2, type: "minigame" },
    { id: 3, type: "minigame" },
    { id: 4, type: "minigame" },
    { id: 5, type: "minigame" },
    { id: 6, type: "minigame" },
    { id: 7, type: "finish" },
  ],
  events: {
    "attach-dice-bias": {
      name: "Attach dice bias",
      kind: "story",
      story: { title: "Attach dice bias", prompt: "Alice is much more likely to roll five." },
      actions: [{ type: "diceBias", face: 5, chanceDeltaPercent: 100, hook: "beforeRoll", duration: { mode: "uses", value: 1 }, target: "landing" }],
    },
  },
  players: [{ id: "alice", name: "Alice", color: "#f87171" }],
});

await withRolls([1, 1], async () => {
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "EFF3", "Dice effects", diceBiasContent);

  room.join("socket-alice", "Alice");
  room.startGame("socket-alice");
  room.roll("socket-alice");
  assert.equal(room.getState().activeEffects.length, 1);
  room.next("socket-alice");

  room.roll("socket-alice");

  assert.equal(room.getState().lastRoll, 5, "dice bias can force the configured face when its chance increase reaches 100%");
  assert.equal(room.getState().players[0].position, 6);
  assert.equal(room.getState().activeEvent?.actions?.some((action) => action.type === "diceBias"), true);
  assert.equal(room.getState().activeEffects.length, 0);
});

await withRolls([1], async () => {
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "TST4", "Test room", promptConfirmationContent);

  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  room.join("socket-carla", "Carla");
  room.startGame("socket-alice");
  room.roll("socket-alice");

  assert.equal(room.getState().phase, "minigame");
  assert.deepEqual(room.getState().activeMinigame?.participants, ["bob", "carla"]);
  assert.deepEqual(room.getState().activeMinigame?.subjects, ["alice"]);

  await room.submitResult("socket-alice", { score: 1, payload: { confirmed: true } });
  assert.deepEqual(room.getState().activeMinigame?.submitted, [], "the acting player cannot self-confirm a group-confirmed prompt");

  await room.submitResult("socket-bob", { score: 1, payload: { confirmed: true } });
  assert.equal(room.getState().phase, "minigame", "prompt waits for the whole confirmer set");

  await room.submitResult("socket-carla", { score: 1, payload: { confirmed: true } });
  assert.equal(room.getState().phase, "reveal");
  assert.equal(room.getState().players.find((player) => player.id === "alice")?.coins, 5);
  assert.deepEqual(room.getState().reveal?.ranking, ["alice"]);
  assert.equal(room.getState().reveal?.entries[0].playerId, "alice");
  assert.equal(room.getState().reveal?.entries[0].resultLabel, "2/2 confirmaciones");
  assert.equal(room.getState().reveal?.entries[0].detailLabel, "Confirmaron Bob, Carla");
});

await withRolls([1], async () => {
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "TST5", "Test room", promptConfirmationContent);

  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  room.join("socket-carla", "Carla");
  room.startGame("socket-alice");
  room.roll("socket-alice");

  await room.submitResult("socket-bob", { score: 1, payload: { confirmed: true } });
  await room.forceResolve("socket-alice");

  assert.equal(room.getState().phase, "reveal");
  assert.equal(room.getState().players.find((player) => player.id === "alice")?.coins, 0, "incomplete prompt confirmation does not apply prompt actions");
  assert.deepEqual(room.getState().reveal?.actions, []);
  assert.equal(room.getState().reveal?.entries[0].resultLabel, "1/2 confirmaciones");
  assert.equal(room.getState().reveal?.entries[0].detailLabel, "Confirmaron Bob · Faltan Carla");
});

const judgeVoteContent: GameContent = normalizeGameContentEvents({
  board: [
    { id: 0, type: "start" },
    { id: 1, type: "judge", eventId: "best-line" },
    { id: 2, type: "finish" },
  ],
  events: {
    "best-line": {
      name: "Best line",
      kind: "activity",
      story: { title: "Best line", prompt: "Write the best one-liner." },
      activity: { type: "judge", content: { prompt: "Write anonymously." } },
    },
  },
  players: [
    { id: "alice", name: "Alice", color: "#f87171" },
    { id: "bob", name: "Bob", color: "#60a5fa" },
    { id: "carla", name: "Carla", color: "#34d399" },
  ],
});

await withRolls([1], async () => {
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "TST6", "Test room", judgeVoteContent);

  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  room.join("socket-carla", "Carla");
  room.startGame("socket-alice");
  room.roll("socket-alice");

  await room.submitResult("socket-alice", { score: 0, payload: { message: "Alice line" } });
  await room.submitResult("socket-bob", { score: 0, payload: { message: "Bob line" } });
  await room.submitResult("socket-carla", { score: 0, payload: { message: "Carla line" } });

  assert.equal(room.getState().phase, "minigame");
  assert.equal(room.getState().activeMinigame?.judge?.phase, "voting");
  assert.deepEqual(room.getState().activeMinigame?.submitted, []);

  const submissions = room.getState().activeMinigame?.judge?.submissions ?? [];
  assert.equal(submissions.length, 3);
  assert.equal(submissions.some((submission) => "playerId" in submission), false, "anonymous voting options do not expose authors");
  const optionForText = (text: string) => submissions.find((submission) => submission.text === text)?.id ?? "";

  await room.submitResult("socket-alice", { score: 0, payload: { votedForSubmissionId: optionForText("Bob line") } });
  await room.submitResult("socket-bob", { score: 0, payload: { votedForSubmissionId: optionForText("Carla line") } });
  await room.submitResult("socket-carla", { score: 0, payload: { votedForSubmissionId: optionForText("Bob line") } });

  assert.equal(room.getState().phase, "reveal");
  assert.deepEqual(room.getState().reveal?.ranking, ["bob", "carla", "alice"]);
  assert.equal(room.getState().reveal?.entries[0].resultLabel, "2 votos");
  assert.equal(room.getState().reveal?.entries[0].detailLabel, "Texto: Bob line · Votos de Alice, Carla");
  assert.deepEqual(room.getState().reveal?.entries[0].payload, {
    message: "Bob line",
    votes: 2,
    voters: ["alice", "carla"],
  });
});

const cardVoteContent: GameContent = normalizeGameContentEvents({
  board: [
    { id: 0, type: "start" },
    { id: 1, type: "minigame", eventId: "friend-cards" },
    { id: 2, type: "finish" },
  ],
  events: {
    "friend-cards": {
      name: "Friend cards",
      kind: "activity",
      story: { title: "Friend cards", prompt: "Vote who fits each sentence best." },
      activity: {
        type: "cardVote",
        participants: "everyone",
        subjects: "everyone",
        content: {
          cards: ["Would miss a flight while already at the airport", "Would turn a quiet dinner into a party"],
          allowSelfVote: true,
          tieMode: "shared",
        },
      },
    },
  },
  players: [
    { id: "alice", name: "Alice", color: "#f87171" },
    { id: "bob", name: "Bob", color: "#60a5fa" },
    { id: "carla", name: "Carla", color: "#34d399" },
  ],
});

await withRolls([1], async () => {
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "CARD", "Card vote", cardVoteContent);

  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  room.join("socket-carla", "Carla");
  room.startGame("socket-alice");
  room.roll("socket-alice");

  assert.equal(room.getState().activeMinigame?.type, "cardVote");
  assert.equal(room.getState().activeMinigame?.cardVote?.phase, "voting");
  assert.equal(room.getState().activeMinigame?.cardVote?.cardIndex, 0);
  assert.equal(room.getState().activeMinigame?.cardVote?.totalCards, 2);

  await room.submitResult("socket-alice", { score: 0, payload: { votedFor: "bob" } });
  await room.submitResult("socket-bob", { score: 0, payload: { votedFor: "missing" } });
  assert.deepEqual(room.getState().activeMinigame?.submitted, ["alice"], "invalid card votes are ignored");
  await room.submitResult("socket-bob", { score: 0, payload: { votedFor: "bob" } });
  await room.submitResult("socket-carla", { score: 0, payload: { votedFor: "bob" } });

  assert.equal(room.getState().activeMinigame?.cardVote?.phase, "result");
  assert.deepEqual(room.getState().activeMinigame?.cardVote?.roundResult?.winnerIds, ["bob"]);
  assert.deepEqual(room.getState().activeMinigame?.cardVote?.roundResult?.votersByPlayer.bob, ["alice", "bob", "carla"]);
  assert.equal(room.getState().activeMinigame?.cardVote?.cardCounts.bob, 1);

  await room.minigameAction("socket-bob", { type: "cardVote:next" });
  assert.equal(room.getState().activeMinigame?.cardVote?.cardIndex, 0, "only the host or landing player advances cards");
  await room.minigameAction("socket-alice", { type: "cardVote:next" });
  assert.equal(room.getState().activeMinigame?.cardVote?.phase, "voting");
  assert.equal(room.getState().activeMinigame?.cardVote?.cardIndex, 1);
  assert.deepEqual(room.getState().activeMinigame?.submitted, []);

  await room.submitResult("socket-alice", { score: 0, payload: { votedFor: "bob" } });
  await room.submitResult("socket-bob", { score: 0, payload: { votedFor: "carla" } });
  await room.submitResult("socket-carla", { score: 0, payload: { votedFor: "alice" } });

  assert.deepEqual(room.getState().activeMinigame?.cardVote?.roundResult?.winnerIds, ["alice", "bob", "carla"]);
  assert.deepEqual(room.getState().activeMinigame?.cardVote?.cardCounts, { alice: 1, bob: 2, carla: 1 });

  await room.minigameAction("socket-alice", { type: "cardVote:next" });
  assert.equal(room.getState().phase, "reveal");
  assert.deepEqual(room.getState().reveal?.ranking, ["bob", "alice", "carla"]);
  assert.deepEqual(room.getState().reveal?.entries.map((entry) => [entry.playerId, entry.score]), [
    ["bob", 2],
    ["alice", 1],
    ["carla", 1],
  ]);
  assert.equal(room.getState().reveal?.entries[0].resultLabel, "2 cartas");
});

{
  const { io, events } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "HARD1", "Minigame action hardening", content);

  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  room.getState().phase = "minigame";
  room.getState().activeMinigame = {
    eventId: "manual",
    type: "reaction",
    content: {},
    participants: ["alice", "bob"],
    subjects: ["alice", "bob"],
    submitted: [],
  };

  room.minigameAction("socket-alice", { ok: true });
  assert.equal(events.filter((event) => event.event === "minigame:action").length, 1, "normal minigame actions are re-emitted");

  room.minigameAction("socket-alice", { blob: "x".repeat(2050) });
  assert.equal(events.filter((event) => event.event === "minigame:action").length, 1, "oversized minigame actions are ignored");

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  room.minigameAction("socket-alice", circular);
  assert.equal(events.filter((event) => event.event === "minigame:action").length, 1, "unserializable minigame actions are ignored");
}

{
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "HARD2", "Minigame result hardening", content);

  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  room.getState().phase = "minigame";
  room.getState().activeMinigame = {
    eventId: "manual",
    type: "reaction",
    content: {},
    participants: ["alice", "bob"],
    subjects: ["alice", "bob"],
    submitted: [],
  };

  await room.submitResult("socket-alice", { score: Number.POSITIVE_INFINITY, payload: { hits: 999 } });
  assert.deepEqual(room.getState().activeMinigame?.submitted, [], "non-finite scores do not mark a player as submitted");

  await room.submitResult("socket-alice", { score: 3, payload: { hits: 3 } });
  assert.deepEqual(room.getState().activeMinigame?.submitted, ["alice"], "finite scores still submit normally");
}

const extraTurnContent: GameContent = normalizeGameContentEvents({
  board: [
    { id: 0, type: "start" },
    { id: 1, type: "fate", eventId: "everyone-extra" },
    { id: 2, type: "finish" },
  ],
  events: {
    "everyone-extra": {
      name: "Everyone extra",
      kind: "story",
      story: { title: "Everyone extra", prompt: "The first target keeps the extra turn." },
      actions: [{ type: "extraTurn", target: "everyone" }],
    },
  },
  players: [
    { id: "alice", name: "Alice", color: "#f87171" },
    { id: "bob", name: "Bob", color: "#60a5fa" },
    { id: "carla", name: "Carla", color: "#34d399" },
  ],
});

await withRolls([1], async () => {
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "TURN1", "Extra turn targets", extraTurnContent);

  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  room.join("socket-carla", "Carla");
  room.startGame("socket-alice");
  room.roll("socket-alice");

  assert.deepEqual(room.getState().activeEvent?.actions?.[0].targetPlayerIds, ["alice", "bob", "carla"]);
  room.next("socket-alice");
  assert.equal(room.getState().turnOrder[room.getState().activeIndex], "alice", "multi-target extraTurn keeps the first resolved target");
});

const mapPlaytestContent: GameContent = normalizeGameContentEvents({
  board: Array.from({ length: 12 }, (_, id) => ({
    id,
    type: id === 0 ? "start" : id === 11 ? "finish" : id === 1 || id === 10 ? "fate" : "minigame",
    ...(id === 1 ? { eventId: "landing-consequence" } : {}),
    ...(id === 10 ? { eventId: "forced-roll-target" } : {}),
  })) as GameContent["board"],
  events: {
    "landing-consequence": {
      name: "Landing consequence",
      kind: "story",
      story: { title: "Landing consequence", prompt: "The landing player receives seven coins." },
      actions: [{ type: "coins", value: 7, target: "landing" }],
    },
    "forced-roll-target": {
      name: "Forced roll target",
      kind: "story",
      story: { title: "Forced roll target", prompt: "A forced ten reaches this cell." },
    },
  },
  players: [
    { id: "alice", name: "Alice", color: "#f87171" },
    { id: "bob", name: "Bob", color: "#60a5fa" },
    { id: "carla", name: "Carla", color: "#34d399" },
  ],
});

{
  const { io } = createIoRecorder();
  const room = new GameRoom(
    io as ConstructorParameters<typeof GameRoom>[0],
    "PLAY",
    "Map Builder playtest",
    mapPlaytestContent,
    { playtest: true }
  );

  assert.deepEqual(room.seedPlaytest("socket-director"), { ok: true, playerId: "alice" });
  assert.equal(room.getState().phase, "turn");
  assert.deepEqual(room.getState().players.map((player) => player.id), ["alice", "bob", "carla"]);
  assert.ok(room.getState().players.every((player) => player.connected), "seeded playtest players stay available for multiplayer activities");
  assert.ok(room.getState().players.every((player) => player.coins === 20), "playtest players start with enough coins to exercise shops and economy cells");

  assert.deepEqual(room.rollPlaytest("socket-director", 10), { ok: true });
  assert.equal(room.getState().players.find((player) => player.id === "alice")?.position, 10);
  assert.equal(room.getState().lastBaseRoll, 10, "playtest rolls are not limited to physical die faces");
  assert.equal(room.getState().lastRoll, 10);
  assert.equal(room.getState().phase, "event");
  assert.equal(room.getState().activeEvent?.title, "Forced roll target");

  assert.deepEqual(room.selectPlaytestPlayer("socket-director", "bob"), { ok: true, playerId: "bob" });
  assert.equal(room.getState().phase, "event", "swapping the controlled player preserves the current game screen");
  assert.equal(room.getState().players.find((player) => player.id === "bob")?.isHost, true);
  assert.equal(room.getState().players.find((player) => player.id === "alice")?.isHost, false);

  assert.deepEqual(room.landPlaytest("socket-director", 1), { ok: true });
  assert.equal(room.getState().turnOrder[room.getState().activeIndex], "bob");
  assert.equal(room.getState().players.find((player) => player.id === "bob")?.position, 1);
  assert.equal(room.getState().players.find((player) => player.id === "bob")?.coins, 27, "direct landing applies the real cell consequence");
  assert.equal(room.getState().activeEvent?.playerId, "bob");
  assert.equal(room.getState().activeEvent?.title, "Landing consequence");
  assert.equal(room.getState().lastRoll, null, "direct landing does not pretend a die was rolled");

  const phaseBeforeInvalidCommand = room.getState().phase;
  const eventBeforeInvalidCommand = room.getState().activeEvent;
  assert.equal(room.rollPlaytest("socket-director", 0).ok, false);
  assert.equal(room.landPlaytest("socket-director", 999).ok, false);
  assert.equal(room.getState().phase, phaseBeforeInvalidCommand, "invalid director commands do not clear the current playtest phase");
  assert.equal(room.getState().activeEvent, eventBeforeInvalidCommand);
}

const economySpecialCellContent: GameContent = normalizeGameContentEvents({
  board: [
    { id: 0, type: "start" },
    { id: 1, type: "fate", eventId: "coin-heist" },
    { id: 2, type: "finish" },
  ],
  events: {
    "coin-heist": {
      name: "Coin heist",
      kind: "story",
      story: { title: "Coin heist", prompt: "Steal and redistribute coins." },
      actions: [
        { type: "coinTransfer", amount: 5, from: { coinSelector: "richest" }, target: "landing", text: "Steal from the richest player." },
        { type: "coinRedistribute", amount: 2, from: "everyone", target: "landing", text: "Everyone contributes to the landing player." },
        { type: "coins", value: -4, target: { coinSelector: "poorest" }, text: "The poorest player pays what they can." },
      ],
    },
  },
  players: [
    { id: "alice", name: "Alice", color: "#f87171" },
    { id: "bob", name: "Bob", color: "#60a5fa" },
    { id: "carla", name: "Carla", color: "#34d399" },
  ],
} as any);

await withRolls([1], async () => {
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "ECON1", "Economy special cells", economySpecialCellContent);

  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  room.join("socket-carla", "Carla");
  room.getState().players.find((player) => player.id === "bob")!.coins = 3;
  room.getState().players.find((player) => player.id === "carla")!.coins = 3;
  room.startGame("socket-alice");
  room.roll("socket-alice");

  const balances = Object.fromEntries(room.getState().players.map((player) => [player.id, player.coins]));
  assert.deepEqual(balances, { alice: 5, bob: 0, carla: 1 });
  assert.equal(room.getState().phase, "event");

  const actions = room.getState().activeEvent?.actions ?? [];
  const transfer = actions.find((action) => action.type === "coinTransfer") as any;
  assert.deepEqual(transfer.targetPlayerIds, ["alice"]);
  assert.deepEqual(transfer.coinTransactions.map((transaction: any) => [transaction.playerId, transaction.delta, Boolean(transaction.clamped)]), [
    ["bob", -3, true],
    ["alice", 3, false],
  ]);

  const redistribution = actions.find((action) => action.type === "coinRedistribute") as any;
  assert.deepEqual(redistribution.coinTransactions.map((transaction: any) => [transaction.playerId, transaction.delta]), [
    ["bob", 0],
    ["carla", -2],
    ["alice", 2],
  ]);

  const tax = actions.find((action) => action.type === "coins" && action.text.includes("poorest")) as any;
  assert.equal(tax.coinTransactions[0].playerId, "bob");
  assert.equal(tax.coinTransactions[0].delta, 0);
  assert.equal(tax.coinTransactions[0].clamped, true);
});

const rankingPayoutPolicyContent: GameContent = normalizeGameContentEvents({
  board: [
    { id: 0, type: "start" },
    { id: 1, type: "minigame", eventId: "ranked-self-tap" },
    { id: 2, type: "finish" },
  ],
  events: {
    "ranked-self-tap": {
      name: "Ranked self tap",
      kind: "activity",
      story: { title: "Ranked self tap", prompt: "Tap fastest." },
      consequences: [
        { label: "Winner event bonus", appliesTo: "winner", actions: [{ type: "coins", value: 1, text: "Winner event bonus." }] },
      ],
      activity: {
        type: "selfTap",
        content: { label: "Tap fastest." },
        rankingPayout: {
          consequences: [
            { label: "Winner payout", appliesTo: "winner", actions: [{ type: "coins", value: 6, text: "Winner payout." }] },
            { label: "Runner-up payout", appliesTo: { rank: 2 }, actions: [{ type: "coins", value: 2, text: "Runner-up payout." }] },
          ],
        },
      },
    },
  },
  coinPayout: [100, 50],
  players: [
    { id: "alice", name: "Alice", color: "#f87171" },
    { id: "bob", name: "Bob", color: "#60a5fa" },
  ],
} as any);

await withRolls([1], async () => {
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "PAY1", "Ranking payout policy", rankingPayoutPolicyContent);

  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  room.startGame("socket-alice");
  room.roll("socket-alice");
  await room.submitResult("socket-alice", { score: 1, payload: { confirmed: true } });
  await room.submitResult("socket-bob", { score: 2, payload: { confirmed: true } });

  assert.deepEqual(room.getState().reveal?.ranking, ["bob", "alice"]);
  assert.equal(room.getState().players.find((player) => player.id === "bob")?.coins, 7);
  assert.equal(room.getState().players.find((player) => player.id === "alice")?.coins, 2);
  assert.deepEqual(room.getState().reveal?.entries.map((entry) => [entry.playerId, entry.coins]), [
    ["bob", 6],
    ["alice", 2],
  ]);
  assert.equal(room.getState().reveal?.coinTransactions?.every((transaction: any) => transaction.source.kind === "rankingPayout"), true);
  const eventBonus = room.getState().reveal?.actions?.find((action) => action.text === "Winner event bonus.");
  assert.deepEqual(eventBonus?.targetPlayerIds, ["bob"]);
  assert.equal(eventBonus?.coinTransactions?.[0].source.kind, "consequence");
});

const legacyPayoutContent: GameContent = normalizeGameContentEvents({
  ...rankingPayoutPolicyContent,
  events: {
    "ranked-self-tap": {
      name: "Ranked self tap",
      kind: "activity",
      story: { title: "Ranked self tap", prompt: "Tap fastest." },
      activity: { type: "selfTap", content: { label: "Tap fastest." } },
    },
  },
  coinPayout: [4, 1],
} as any);

await withRolls([1], async () => {
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "PAY2", "Legacy coin payout", legacyPayoutContent);

  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  room.startGame("socket-alice");
  room.roll("socket-alice");
  await room.submitResult("socket-alice", { score: 1, payload: { confirmed: true } });
  await room.submitResult("socket-bob", { score: 2, payload: { confirmed: true } });

  assert.equal(room.getState().players.find((player) => player.id === "bob")?.coins, 4);
  assert.equal(room.getState().players.find((player) => player.id === "alice")?.coins, 1);
  assert.deepEqual(room.getState().reveal?.coinTransactions?.map((transaction: any) => [transaction.playerId, transaction.delta]), [
    ["bob", 4],
    ["alice", 1],
  ]);
});

{
  const { io } = createIoRecorder();
  const movementContent: GameContent = normalizeGameContentEvents({
    board: Array.from({ length: 10 }, (_, id) => ({ id, type: id === 9 ? "finish" as const : "start" as const })),
    events: {},
    players: [
      { id: "alice", name: "Alice", color: "#f87171" },
      { id: "bob", name: "Bob", color: "#60a5fa" },
    ],
  });
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "MOVE", "Character movement", movementContent);
  room.join("socket-alice", "Alice");
  room.join("socket-bob", "Bob");
  room.startGame("socket-alice");
  const state = room.getState();
  state.players.find((player) => player.id === "alice")!.position = 2;
  state.players.find((player) => player.id === "bob")!.position = 7;

  const internals = room as unknown as {
    applyAction: (action: any, targetPlayerIds: string[], context?: any) => any;
    advanceTurn: () => void;
  };
  const moved = internals.applyAction(
    { type: "moveToPlayerPosition", withTarget: { playerId: "bob" } },
    ["alice"],
    { landingPlayerId: "alice", actingPlayerId: "alice" }
  );
  assert.equal(state.players.find((player) => player.id === "alice")?.position, 7);
  assert.equal(moved.tileId, 7);

  const skipped = internals.applyAction({ type: "skipTurn", turns: 2 }, ["bob"], { landingPlayerId: "alice" });
  assert.equal(skipped.value, 2);
  internals.advanceTurn();
  assert.equal(state.players[state.activeIndex]?.id, "alice", "Bob's first skipped turn returns play to Alice");
  internals.advanceTurn();
  assert.equal(state.players[state.activeIndex]?.id, "alice", "Bob's second skipped turn returns play to Alice");
  internals.advanceTurn();
  assert.equal(state.players[state.activeIndex]?.id, "bob", "Bob becomes active after both skipped turns are consumed");
}
