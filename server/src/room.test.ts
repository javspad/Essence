import assert from "node:assert/strict";
import type { GameContent, ServerToClientEvents } from "@essence/shared";
import { normalizeGameContentEvents } from "@essence/shared/events";
import { resolveMinigame } from "./minigames/index";
import { GameRoom } from "./room";

type EmittedEvent = {
  room: string;
  event: keyof ServerToClientEvents;
  payload: unknown;
};

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
  minigames: {},
  dares: {},
  fates: {},
  players: [
    { id: "alice", name: "Alice", color: "#f87171" },
    { id: "bob", name: "Bob", color: "#60a5fa" },
  ],
});

const players = [
  { id: "alice", name: "Alice", socketId: "socket-alice", connected: true, position: 0, coins: 0, isHost: true, groom: false, color: "#f87171" },
  { id: "bob", name: "Bob", socketId: "socket-bob", connected: true, position: 0, coins: 0, isHost: false, groom: false, color: "#60a5fa" },
  { id: "carla", name: "Carla", socketId: "socket-carla", connected: true, position: 0, coins: 0, isHost: false, groom: false, color: "#34d399" },
];

{
  const reveal = await resolveMinigame({
    minigameId: "trivia-capital",
    def: {
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
  const reveal = await resolveMinigame({
    minigameId: "whack-amigos",
    def: { type: "whack", content: { label: "Golpeá al objetivo" } },
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
  const reveal = await resolveMinigame({
    minigameId: "group-vote",
    def: { type: "vote", content: { question: "¿Quién la rompió?" } },
    results: [
      { playerId: "alice", score: 0, payload: { votedFor: "bob" } },
      { playerId: "bob", score: 0, payload: { votedFor: "carla" } },
      { playerId: "carla", score: 0, payload: { votedFor: "bob" } },
    ],
    participants: ["alice", "bob", "carla"],
    subjects: ["alice", "bob", "carla"],
    players,
    coinPayout: [10, 0, 0],
  });

  assert.deepEqual(reveal.ranking, ["bob", "carla", "alice"]);
  assert.equal(reveal.entries[0].resultLabel, "2 votos");
  assert.equal(reveal.entries[0].detailLabel, "Votos de Alice, Carla");
  assert.deepEqual(reveal.entries[0].payload, { votes: 2, voters: ["alice", "carla"], votedFor: "carla" });
}

{
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "TST1", "Test room", content);

  assert.deepEqual(room.join("socket-alice", "Alice"), { ok: true, playerId: "alice" });
  assert.deepEqual(room.join("socket-bob", "Bob"), { ok: true, playerId: "bob" });

  for (const player of room.getState().players) {
    assert.equal("stars" in player, false, "players expose coins, not deprecated stars");
  }
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
  minigames: {},
  dares: {},
  fates: {},
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
  minigames: {},
  dares: {},
  fates: {},
  players: [
    { id: "alice", name: "Alice", color: "#f87171" },
    { id: "bob", name: "Bob", color: "#60a5fa" },
    { id: "carla", name: "Carla", color: "#34d399" },
  ],
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
