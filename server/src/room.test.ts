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

const characterSetContent: GameContent = normalizeGameContentEvents({
  board: [
    { id: 0, type: "start" },
    { id: 1, type: "finish" },
  ],
  events: {},
  minigames: {},
  dares: {},
  fates: {},
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
  characterSets: {
    duo: { id: "duo", name: "Duo", characterIds: ["groom", "guest"] },
  },
});

const players = [
  { id: "alice", name: "Alice", socketId: "socket-alice", connected: true, position: 0, coins: 0, isHost: true, groom: false, color: "#f87171" },
  { id: "bob", name: "Bob", socketId: "socket-bob", connected: true, position: 0, coins: 0, isHost: false, groom: false, color: "#60a5fa" },
  { id: "carla", name: "Carla", socketId: "socket-carla", connected: true, position: 0, coins: 0, isHost: false, groom: false, color: "#34d399" },
];

{
  const { io, events } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "QUIT", "Leave test", content);
  assert.deepEqual(room.join("socket-alice", "Alice"), { ok: true, playerId: "alice" });
  assert.deepEqual(room.join("socket-bob", "Bob"), { ok: true, playerId: "bob" });

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

{
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "CHAR", "Characters", characterSetContent, {
    characterSetId: "duo",
  } as any);

  assert.deepEqual((room as any).join("socket-guest", "Whoever", { characterId: "guest" }), {
    ok: true,
    playerId: "guest",
  });
  assert.equal(room.getState().characterSetId, "duo");
  assert.equal(room.getState().characterSlots?.find((slot) => slot.id === "guest")?.claimedByPlayerId, "guest");
  assert.equal(room.getState().players.find((player) => player.id === "guest")?.name, "Guest");
  assert.equal(room.getState().players.find((player) => player.id === "guest")?.color, "#38bdf8");
  assert.equal(room.getState().players.find((player) => player.id === "guest")?.facePhoto, "data:image/png;base64,guest");
  assert.deepEqual(room.getState().players.find((player) => player.id === "guest")?.facePhotoAlignment, { x: 0.42, y: 0.57, scale: 1.2 });
  assert.deepEqual(room.getState().players.find((player) => player.id === "guest")?.faceAnchors, { mouth: { x: 0.5, y: 0.64, angle: 0 } });
  assert.deepEqual(room.getState().players.find((player) => player.id === "guest")?.bodyAnchors, { head: { x: 0.5, y: 0.14, angle: 0 } });
  assert.deepEqual(room.getState().players.find((player) => player.id === "guest")?.cosmeticIds, ["party-goggles", "big-mustache"]);

  assert.deepEqual((room as any).join("socket-steal", "Steal", { characterId: "guest" }), {
    ok: false,
    error: "Ese personaje ya está ocupado",
  });

  assert.deepEqual((room as any).join("socket-groom", "Host", { characterId: "groom" }), {
    ok: true,
    playerId: "groom",
  });
  assert.equal(room.getState().players.find((player) => player.id === "groom")?.groom, true);
  assert.deepEqual((room as any).join("socket-full", "Full"), { ok: false, error: "La sala está llena" });
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

const underdogContent: GameContent = normalizeGameContentEvents({
  board: [
    { id: 0, type: "start" },
    { id: 1, type: "minigame" },
    { id: 2, type: "minigame" },
    { id: 3, type: "minigame" },
    { id: 4, type: "finish" },
  ],
  events: {},
  minigames: {},
  dares: {},
  fates: {},
  players: [
    { id: "quejoso", name: "Quejoso", color: "#f87171" },
    { id: "ana", name: "Ana", color: "#60a5fa" },
    { id: "beto", name: "Beto", color: "#34d399" },
  ],
  characters: {
    quejoso: { id: "quejoso", displayName: "Quejoso", color: "#f87171", defaultTraits: ["underdog"] },
    ana: { id: "ana", displayName: "Ana", color: "#60a5fa" },
    beto: { id: "beto", displayName: "Beto", color: "#34d399" },
  },
  characterSets: {
    squad: { id: "squad", name: "Squad", characterIds: ["quejoso", "ana", "beto"] },
  },
});

// Sacar un 1 con el trait "underdog" abre el duelo "todos contra uno". Ganarlo = volver a tirar.
await withRolls([1], async () => {
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "DUEL", "Underdog win", underdogContent, {
    characterSetId: "squad",
  } as any);

  room.join("socket-q", "Quejoso", { characterId: "quejoso" });
  room.join("socket-a", "Ana", { characterId: "ana" });
  room.join("socket-b", "Beto", { characterId: "beto" });
  assert.deepEqual(room.getState().players.find((player) => player.id === "quejoso")?.traits, ["underdog"]);
  room.startGame("socket-q");

  room.roll("socket-q");
  assert.equal(room.getState().phase, "minigame", "rolling a 1 opens the duel instead of moving");
  assert.equal(room.getState().activeMinigame?.type, "tapduel");
  assert.equal(room.getState().activeMinigame?.protagonistId, "quejoso");
  assert.deepEqual(room.getState().activeMinigame?.participants, ["quejoso", "ana", "beto"]);
  assert.equal(room.getState().players.find((player) => player.id === "quejoso")?.position, 0, "the underdog does not move when the duel opens");

  await room.submitResult("socket-q", { score: 12, payload: { taps: 12 } });
  await room.submitResult("socket-a", { score: 4, payload: { taps: 4 } });
  await room.submitResult("socket-b", { score: 2, payload: { taps: 2 } });

  assert.equal(room.getState().phase, "reveal");
  assert.equal(room.getState().reveal?.ranking[0], "quejoso");
  assert.equal(room.getState().reveal?.entries[0].resultLabel, "12 toques");
  assert.equal(room.getState().reveal?.actions?.[0]?.type, "extraTurn");
  assert.equal(room.getState().players.find((player) => player.id === "quejoso")?.coins, 0, "the duel pays no coins");

  room.next("socket-q");
  assert.equal(room.getState().phase, "turn");
  assert.equal(room.getState().turnOrder[room.getState().activeIndex], "quejoso", "winning the duel earns another roll");
});

// Perder el duelo retrocede al perseguido un casillero y pasa el turno.
await withRolls([1], async () => {
  const { io } = createIoRecorder();
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "DUE2", "Underdog loss", underdogContent, {
    characterSetId: "squad",
  } as any);

  room.join("socket-q", "Quejoso", { characterId: "quejoso" });
  room.join("socket-a", "Ana", { characterId: "ana" });
  room.join("socket-b", "Beto", { characterId: "beto" });
  room.startGame("socket-q");
  room.getState().players.find((player) => player.id === "quejoso")!.position = 2;

  room.roll("socket-q");
  assert.equal(room.getState().phase, "minigame");

  await room.submitResult("socket-q", { score: 1, payload: { taps: 1 } });
  await room.submitResult("socket-a", { score: 9, payload: { taps: 9 } });
  await room.submitResult("socket-b", { score: 5, payload: { taps: 5 } });

  assert.equal(room.getState().phase, "reveal");
  assert.equal(room.getState().reveal?.ranking[0], "ana");
  assert.equal(room.getState().reveal?.actions?.[0]?.type, "move");
  assert.equal(room.getState().players.find((player) => player.id === "quejoso")?.position, 1, "losing the duel moves the underdog back one cell");

  room.next("socket-q");
  assert.equal(room.getState().phase, "turn");
  assert.equal(room.getState().turnOrder[room.getState().activeIndex], "ana", "losing the duel passes the turn on");
});
