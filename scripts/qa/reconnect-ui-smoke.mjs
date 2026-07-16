import assert from "node:assert/strict";
import { chromium } from "playwright";
import { io } from "socket.io-client";

const baseUrl = process.argv[2] ?? process.env.ESSENCE_URL ?? "http://127.0.0.1:3001";
const host = createClient();
const guest = createClient();
let roomCode = "";

try {
  await Promise.all([waitForConnection(host), waitForConnection(guest)]);
  const created = await emitAck(host, "room:create", {
    name: "Javi",
    roomName: "Reconnect UI smoke",
    characterId: "javi",
    mapId: "map-2",
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error(created.error);
  roomCode = created.code;

  const joined = await emitAck(guest, "room:join", {
    code: roomCode,
    name: "Nico",
    characterId: "nico",
  });
  assert.equal(joined.ok, true);
  assert.equal((await emitAck(host, "game:start")).ok, true);
  guest.disconnect();
  await waitUntil(async () => (await fetchRoom())?.characterSlots?.find((slot) => slot.id === "nico")?.connected === false);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Unirme" }).click();

  const roomCard = page.locator(`[data-room-code="${roomCode}"]`);
  await roomCard.waitFor();
  await roomCard.getByText("En juego · reconectar").waitFor();
  const reconnectButton = roomCard.getByRole("button", { name: /Nico.*Reconectar/i });
  await reconnectButton.waitFor();
  await reconnectButton.click();
  await waitUntil(async () => (await fetchRoom())?.characterSlots?.find((slot) => slot.id === "nico")?.connected === true);
  await roomCard.waitFor({ state: "detached" });
  assert.deepEqual(consoleErrors, []);
  await browser.close();

  console.log(JSON.stringify({ ok: true, baseUrl, roomCode, reconnectedPlayer: "nico" }, null, 2));
} finally {
  if (host.connected) host.emit("room:leave");
  host.disconnect();
  guest.disconnect();
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

async function fetchRoom() {
  const response = await fetch(`${baseUrl}/api/rooms`);
  assert.equal(response.ok, true);
  const body = await response.json();
  return body.rooms.find((room) => room.code === roomCode);
}

async function waitUntil(predicate, timeout = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition timeout");
}
