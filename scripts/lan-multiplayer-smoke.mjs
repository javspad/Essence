import { io } from "socket.io-client";

const baseUrl = process.argv[2] ?? process.env.ESSENCE_URL ?? "http://127.0.0.1:3001";
const characters = ["javi", "nico", "frang", "facu", "beltro", "willy", "gaston"];
const clients = characters.map(() => createClient());
const states = new Array(characters.length);
const reconnectTokens = new Array(characters.length);
const startedAt = Date.now();

clients.forEach(watchState);

try {
  await Promise.all(clients.map(waitForConnection));
  const created = await emitAck(clients[0], "room:create", {
    name: "Javi",
    roomName: "LAN smoke",
    characterId: "javi",
    mapId: "map-2",
  });
  assertOk(created, "create room");
  reconnectTokens[0] = created.reconnectToken;

  const joined = await Promise.all(clients.slice(1).map((socket, index) => emitAck(socket, "room:join", {
    code: created.code,
    name: characters[index + 1],
    characterId: characters[index + 1],
  })));
  joined.forEach((result, index) => assertOk(result, `join ${characters[index + 1]}`));
  joined.forEach((result, index) => { reconnectTokens[index + 1] = result.reconnectToken; });
  await waitUntil(() => states.every((state) => state?.phase === "lobby" && state.players.filter((player) => player.connected).length === 7), "seven-player lobby");
  const joinedAt = Date.now();

  const staleFrang = clients[2];
  const frangTakeover = createClient();
  clients[2] = frangTakeover;
  watchState(frangTakeover, 2);
  await waitForConnection(frangTakeover);
  const takeoverResult = await emitAck(frangTakeover, "room:join", {
    code: created.code,
    name: "Frang",
    characterId: "frang",
    reconnectToken: reconnectTokens[2],
  });
  assertOk(takeoverResult, "token takeover Frang");
  reconnectTokens[2] = takeoverResult.reconnectToken;
  staleFrang.disconnect();

  clients[1].disconnect();
  await waitUntil(() => states[0]?.players.filter((player) => player.connected).length === 6, "disconnect propagation");
  const reconnected = createClient();
  clients[1] = reconnected;
  watchState(reconnected, 1);
  await waitForConnection(reconnected);
  const lobbyRejoin = await emitAck(reconnected, "room:join", { code: created.code, name: "Nico", characterId: "nico" });
  assertOk(lobbyRejoin, "rejoin Nico");
  reconnectTokens[1] = lobbyRejoin.reconnectToken;
  await waitUntil(() => states.every((state) => state?.players.filter((player) => player.connected).length === 7), "reconnected lobby");

  assertOk(await emitAck(clients[0], "game:start"), "start game");
  await waitUntil(() => states.every((state) => state && state.phase !== "lobby"), "game start propagation");

  const nicoBeforeDrop = states[0].players.find((player) => player.id === "nico");
  if (!nicoBeforeDrop) throw new Error("Nico missing before active-game drop");
  const preserved = { position: nicoBeforeDrop.position, coins: nicoBeforeDrop.coins };
  clients[1].disconnect();
  await waitUntil(() => states[0]?.players.find((player) => player.id === "nico")?.connected === false, "active-game disconnect propagation");
  await waitUntil(async () => {
    const room = await fetchRoom(created.code);
    return room?.phase !== "lobby" && room.characterSlots?.some((slot) => slot.id === "nico" && slot.claimedByPlayerId === "nico" && slot.connected === false);
  }, "active room advertises disconnected Nico");

  const activeReconnect = createClient();
  clients[1] = activeReconnect;
  watchState(activeReconnect, 1);
  await waitForConnection(activeReconnect);
  const activeRejoin = await emitAck(activeReconnect, "room:join", { code: created.code, name: "Nico", characterId: "nico" });
  assertOk(activeRejoin, "active-game rejoin Nico");
  reconnectTokens[1] = activeRejoin.reconnectToken;
  await waitUntil(() => states.every((state) => state?.players.find((player) => player.id === "nico")?.connected === true), "active-game reconnect propagation");
  const nicoAfterDrop = states[0].players.find((player) => player.id === "nico");
  if (nicoAfterDrop?.position !== preserved.position || nicoAfterDrop?.coins !== preserved.coins) {
    throw new Error(`Nico state changed across reconnect: ${JSON.stringify({ before: preserved, after: nicoAfterDrop })}`);
  }
  if (!states[0].turnOrder.includes("nico")) throw new Error("Nico disappeared from turn order after reconnect");

  clients.forEach((socket) => socket.disconnect());
  await waitUntil(async () => (await fetchRoom(created.code))?.players === 0, "room retained after full-party network drop");
  const hostRecovery = createClient();
  clients[0] = hostRecovery;
  watchState(hostRecovery, 0);
  await waitForConnection(hostRecovery);
  const hostRejoin = await emitAck(hostRecovery, "room:join", {
    code: created.code,
    name: "Javi",
    characterId: "javi",
    reconnectToken: reconnectTokens[0],
  });
  assertOk(hostRejoin, "host recovery after full-party drop");
  reconnectTokens[0] = hostRejoin.reconnectToken;
  await waitUntil(() => states[0]?.players.find((player) => player.id === "javi")?.connected === true, "host recovery propagation");

  const stateBytes = Buffer.byteLength(JSON.stringify(states[0]));
  if (stateBytes > 500_000) throw new Error(`state payload ${stateBytes} exceeds 500000-byte LAN budget`);
  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    roomCode: created.code,
    players: states[0].players.length,
    phase: states[0].phase,
    joinAndSyncMs: joinedAt - startedAt,
    totalMs: Date.now() - startedAt,
    stateBytes,
    recoveredDuringActiveGame: true,
    recoveredAfterFullPartyDrop: true,
    transports: clients.map((socket) => socket.io.engine.transport.name),
  }, null, 2));
} finally {
  clients.forEach((socket) => socket.disconnect());
}

function createClient() {
  return io(baseUrl, {
    forceNew: true,
    reconnection: false,
    timeout: 8_000,
    transports: ["polling", "websocket"],
    tryAllTransports: true,
  });
}

function watchState(socket, index = clients.indexOf(socket)) {
  socket.on("state", (state) => {
    states[index] = state;
  });
}

function waitForConnection(socket) {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("connection timeout")), 8_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function emitAck(socket, event, payload) {
  const args = payload === undefined ? [] : [payload];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timeout`)), 10_000);
    socket.emit(event, ...args, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

function waitUntil(predicate, label, timeout = 12_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      Promise.resolve(predicate()).then((passed) => {
      if (passed) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started >= timeout) {
        clearInterval(timer);
        reject(new Error(`${label} timeout: ${states.map((state) => state ? `${state.phase}/${state.players.filter((player) => player.connected).length}` : "none").join(", ")}`));
      }
      }).catch((error) => {
        clearInterval(timer);
        reject(error);
      });
    }, 20);
  });
}

async function fetchRoom(code) {
  const response = await fetch(`${baseUrl}/api/rooms`);
  if (!response.ok) throw new Error(`room list failed with ${response.status}`);
  const body = await response.json();
  return body.rooms.find((room) => room.code === code);
}

function assertOk(result, label) {
  if (!result?.ok) throw new Error(`${label} failed: ${result?.error ?? "no response"}`);
}
