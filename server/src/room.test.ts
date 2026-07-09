import assert from "node:assert/strict";
import type { GameContent, ServerToClientEvents } from "@essence/shared";
import { validateGameContent } from "@essence/shared/contentValidation";
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

const characterContent: GameContent = normalizeGameContentEvents({
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
    minigames: {},
    dares: {},
    fates: {},
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
    minigames: {},
    dares: {},
    fates: {},
    players: [{ id: "alice", name: "Alice", color: "#f87171" }],
    artifactRarityRates: { common: 70, epic: -10, legendary: 0 },
    artifacts: {
      bad: {
        id: "bad",
        name: "Bad artifact",
        description: "Invalid artifact for schema regression.",
        price: -1,
        rarity: "rare",
        targetMode: "choosePlayer",
        effects: ["missing-effect"],
      },
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("artifactRarityRates.epic")), "rarity rates reject negative weights");
  assert.ok(result.errors.some((error) => error.includes("artifacts.bad.price")), "artifact prices must be non-negative");
  assert.ok(result.errors.some((error) => error.includes("artifacts.bad.rarity")), "artifact rarity is limited to S4 buckets");
  assert.ok(result.errors.some((error) => error.includes("artifacts.bad.effects")), "artifact effect references are validated");
}

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
  const room = new GameRoom(io as ConstructorParameters<typeof GameRoom>[0], "CHAR", "Characters", characterContent);

  assert.deepEqual((room as any).join("socket-guest", "Whoever", { characterId: "guest" }), {
    ok: true,
    playerId: "guest",
  });
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

  assert.deepEqual((room as any).join("socket-groom", "Host", { characterId: "groom" }), {
    ok: true,
    playerId: "groom",
  });
  assert.equal(room.getState().players.find((player) => player.id === "groom")?.groom, true);
  assert.deepEqual((room as any).join("socket-full", "Full"), { ok: false, error: "La sala está llena" });
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
  assert.deepEqual(room.buyCosmetic("socket-guest", "party-hat"), { ok: true });
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
  minigames: {},
  dares: {},
  fates: {},
  players: [
    { id: "alice", name: "Alice", color: "#f87171" },
    { id: "bob", name: "Bob", color: "#60a5fa" },
  ],
});

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

  assert.deepEqual(room.buyArtifact("socket-alice", mochilaOffer.id), {
    ok: true,
    artifactId: "mochila-de-gaston",
    requiresTarget: true,
  });
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
  minigames: {},
  dares: {},
  fates: {},
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
  minigames: {},
  dares: {},
  fates: {},
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
  minigames: {},
  dares: {},
  fates: {},
  players: [{ id: "alice", name: "Alice", color: "#f87171" }],
});

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
  minigames: {},
  dares: {},
  fates: {},
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
