import "dotenv/config";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { existsSync } from "node:fs";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import type { CharacterSlot, ClientToServerEvents, ContentMapSummary, GameContent, MapDefinition, RoomSummary, ServerToClientEvents } from "@essence/shared";
import { characterSlotsForContent } from "@essence/shared/characters";
import { assertValidGameContent } from "@essence/shared/contentValidation";
import { isDeveloperToolsEnabled } from "@essence/shared/devTools";
import { socketPayloadSchemas } from "@essence/shared/socketSchemas";
import { loadContent } from "./content.js";
import { GameRoom } from "./room.js";
import { isSocketAck, parseSocketInput, parseSocketRequest } from "./socketInput.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const developerToolsEnabled = isDeveloperToolsEnabled(process.env.ENABLE_DEV_TOOLS);

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: "*" },
  maxHttpBufferSize: 10_000_000,
  pingInterval: 10_000,
  pingTimeout: 20_000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
});

// --- Salas en memoria -------------------------------------------------------

const rooms = new Map<string, GameRoom>();
const socketIndex = new Map<string, string>(); // socketId -> code

function genCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sin I/O para no confundir
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

/** Resumen público de todas las salas abiertas (lobby o en curso). */
function listRooms(): RoomSummary[] {
  const out: RoomSummary[] = [];
  for (const room of rooms.values()) {
    if (room.isPlaytest || room.shouldExpire()) continue;
    out.push(room.summary());
  }
  return out.sort((a, b) => Number(a.phase !== "lobby") - Number(b.phase !== "lobby"));
}

function listCharacters(): CharacterSlot[] {
  return characterSlotsForContent(loadContent());
}

function listMaps(): ContentMapSummary[] {
  return mapSummariesForContent(loadContent());
}

function mapSummariesForContent(content: GameContent): ContentMapSummary[] {
  const maps = content.maps?.length
    ? content.maps
    : [
        {
          id: "board",
          name: "Board",
          description: "Legacy board layout",
          board: content.board,
          routes: [],
          artifacts: [],
        } satisfies MapDefinition,
      ];
  const activeMapId = content.activeMapId && maps.some((map) => map.id === content.activeMapId) ? content.activeMapId : maps[0]?.id;
  return maps.map((map) => ({
    id: map.id,
    name: map.name,
    description: map.description,
    cells: map.board.length,
    routes: map.routes.length,
    props: (map.mapProps ?? map.artifacts ?? []).length,
    terraces: map.terraces?.length ?? 0,
    active: map.id === activeMapId,
  }));
}

function mapIdForRoom(content: GameContent, requestedMapId?: string): { ok: true; mapId?: string } | { ok: false; error: string } {
  const trimmed = requestedMapId?.trim();
  const maps = content.maps ?? [];
  if (!trimmed) return { ok: true, mapId: content.activeMapId ?? maps[0]?.id };
  if (!maps.some((map) => map.id === trimmed)) return { ok: false, error: "Ese mapa no existe en content.json" };
  return { ok: true, mapId: trimmed };
}

function contentLoadError(error: unknown): string {
  const detail = error instanceof Error ? error.message : "Error desconocido";
  return `No pude cargar content.json: ${detail}`;
}

io.on("connection", (socket) => {
  const closeCurrentPlaytest = async () => {
    const code = socketIndex.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room?.isPlaytest) return;
    await socket.leave(code);
    socketIndex.delete(socket.id);
    rooms.delete(code);
  };

  socket.on("room:create", (payload, ack) => {
    const input = parseSocketRequest(socketPayloadSchemas["room:create"], payload, ack);
    if (!input) return;
    const { name, roomName, characterId, mapId } = input;
    const trimmedRoom = (roomName ?? "").trim();
    if (!trimmedRoom) {
      ack({ ok: false, error: "Poné un nombre a la sala" });
      return;
    }
    let roomContent: GameContent;
    try {
      roomContent = loadContent();
    } catch (error) {
      ack({ ok: false, error: contentLoadError(error) });
      return;
    }
    const selectedMap = mapIdForRoom(roomContent, mapId);
    if (!selectedMap.ok) {
      ack(selectedMap);
      return;
    }
    const code = genCode();
    const room = new GameRoom(io, code, trimmedRoom.slice(0, 40), roomContent, { mapId: selectedMap.mapId });
    rooms.set(code, room);
    socket.join(code);
    socketIndex.set(socket.id, code);
    const res = room.join(socket.id, name, { characterId });
    if (!res.ok) {
      socket.leave(code);
      socketIndex.delete(socket.id);
      rooms.delete(code);
      ack(res);
      return;
    }
    ack({ ok: true, playerId: res.playerId, code, reconnectToken: res.reconnectToken });
  });

  socket.on("room:join", (payload, ack) => {
    const input = parseSocketRequest(socketPayloadSchemas["room:join"], payload, ack);
    if (!input) return;
    const { code, name, characterId, reconnectToken } = input;
    const room = rooms.get(code.toUpperCase());
    if (!room) {
      ack({ ok: false, error: "Sala inexistente" });
      return;
    }
    socket.join(room.code);
    socketIndex.set(socket.id, room.code);
    const res = room.join(socket.id, name, { characterId, reconnectToken });
    if (!res.ok) {
      socket.leave(room.code);
      socketIndex.delete(socket.id);
      ack(res);
      return;
    }
    if (res.replacedSocketId) {
      socketIndex.delete(res.replacedSocketId);
      const replacedSocket = io.sockets.sockets.get(res.replacedSocketId);
      replacedSocket?.emit("session:replaced", { message: "Esta sesión se recuperó desde otro dispositivo." });
      replacedSocket?.disconnect(true);
    }
    ack({ ok: true, playerId: res.playerId, code: room.code, reconnectToken: res.reconnectToken });
  });

  const withRoom = (fn: (room: GameRoom) => void) => {
    const code = socketIndex.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (room) fn(room);
  };
  const currentPlaytestRoom = (ack: (response: { ok: false; error: string }) => void): GameRoom | undefined => {
    const code = socketIndex.get(socket.id);
    const room = code ? rooms.get(code) : undefined;
    if (room?.isPlaytest) return room;
    ack({ ok: false, error: "No hay un playtest activo" });
    return undefined;
  };

  socket.on("room:leave", async () => {
    const code = socketIndex.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) {
      socketIndex.delete(socket.id);
      return;
    }

    const result = room.leave(socket.id);
    if (result.closed) {
      const socketIds = await io.in(code).allSockets();
      for (const id of socketIds) socketIndex.delete(id);
      io.in(code).socketsLeave(code);
      rooms.delete(code);
      return;
    }

    socket.leave(code);
    socketIndex.delete(socket.id);
  });

  socket.on("game:start", (ack) => {
    if (!isSocketAck(ack)) return;
    const code = socketIndex.get(socket.id);
    const room = code ? rooms.get(code) : undefined;
    ack(room ? room.startGame(socket.id) : { ok: false, error: "No estás en una sala" });
  });
  socket.on("turn:roll", () => withRoom((r) => r.roll(socket.id)));
  socket.on("turn:next", () => withRoom((r) => r.next(socket.id)));
  socket.on("reveal:next", () => withRoom((r) => r.next(socket.id)));
  socket.on("minigame:action", (data) => withRoom((r) => r.minigameAction(socket.id, data)));
  socket.on("minigame:result", (payload) => {
    const input = parseSocketInput(socketPayloadSchemas["minigame:result"], payload);
    if (!input) return;
    withRoom((r) => void r.submitResult(socket.id, { score: input.score, payload: input.payload, outcome: input.outcome }));
  });
  socket.on("cosmetic:buy", (payload, ack) => {
    const input = parseSocketRequest(socketPayloadSchemas["cosmetic:buy"], payload, ack);
    if (!input) return;
    withRoom((r) => {
      const result = r.buyCosmetic(socket.id, input.cosmeticId);
      ack(result);
      if (!result.ok) socket.emit("error", { message: result.error });
    });
  });
  socket.on("cosmetic:equip", (payload, ack) => {
    const input = parseSocketRequest(socketPayloadSchemas["cosmetic:equip"], payload, ack);
    if (!input) return;
    withRoom((r) => {
      const result = r.equipCosmetic(socket.id, input.cosmeticId, input.equipped);
      ack(result);
      if (!result.ok) socket.emit("error", { message: result.error });
    });
  });
  socket.on("artifact:rollShop", (payload, ack) => {
    const input = parseSocketRequest(socketPayloadSchemas["artifact:rollShop"], payload, ack);
    if (!input) return;
    withRoom((r) => {
      const result = r.rollArtifactShop(socket.id);
      ack(result);
      if (!result.ok) socket.emit("error", { message: result.error });
    });
  });
  socket.on("artifact:buy", (payload, ack) => {
    const input = parseSocketRequest(socketPayloadSchemas["artifact:buy"], payload, ack);
    if (!input) return;
    withRoom((r) => {
      const result = r.buyArtifact(socket.id, input.offerId);
      ack(result);
      if (!result.ok) socket.emit("error", { message: result.error });
    });
  });
  socket.on("artifact:use", (payload, ack) => {
    const input = parseSocketRequest(socketPayloadSchemas["artifact:use"], payload, ack);
    if (!input) return;
    withRoom((r) => {
      const result = r.useArtifact(socket.id, input.targetPlayerId);
      ack(result);
      if (!result.ok) socket.emit("error", { message: result.error });
    });
  });
  socket.on("artifact:skipShop", (payload, ack) => {
    const input = parseSocketRequest(socketPayloadSchemas["artifact:skipShop"], payload, ack);
    if (!input) return;
    withRoom((r) => {
      const result = r.skipArtifactShop(socket.id);
      ack(result);
      if (!result.ok) socket.emit("error", { message: result.error });
    });
  });
  socket.on("minigame:force", () => withRoom((r) => void r.forceResolve(socket.id)));
  if (developerToolsEnabled) {
    socket.on("debug:applyEffect", (payload) => {
      const input = parseSocketInput(socketPayloadSchemas["debug:applyEffect"], payload);
      if (!input) return;
      withRoom((r) => r.debugApplyEffect(socket.id, input));
    });
  }

  socket.on("playtest:start", async (payload, ack) => {
    const input = parseSocketRequest(socketPayloadSchemas["playtest:start"], payload, ack);
    if (!input) return;
    if (!developerToolsEnabled) {
      ack({ ok: false, error: "El playtest del builder está deshabilitado en producción" });
      return;
    }
    const { content: rawContent, mapId } = input;
    const currentCode = socketIndex.get(socket.id);
    const currentRoom = currentCode ? rooms.get(currentCode) : undefined;
    if (currentRoom && !currentRoom.isPlaytest) {
      ack({ ok: false, error: "Salí de la sala actual antes de abrir el playtest" });
      return;
    }
    await closeCurrentPlaytest();

    let playtestContent: GameContent;
    try {
      playtestContent = assertValidGameContent(rawContent, "Map Builder playtest");
    } catch (error) {
      ack({ ok: false, error: error instanceof Error ? error.message : "El contenido del playtest no es válido" });
      return;
    }
    const selectedMap = mapIdForRoom(playtestContent, mapId);
    if (!selectedMap.ok) {
      ack(selectedMap);
      return;
    }

    const code = genCode();
    const room = new GameRoom(io, code, "Map Builder playtest", playtestContent, {
      mapId: selectedMap.mapId,
      playtest: true,
    });
    rooms.set(code, room);
    await socket.join(code);
    socketIndex.set(socket.id, code);
    const result = room.seedPlaytest(socket.id);
    if (!result.ok) {
      await closeCurrentPlaytest();
      ack(result);
      return;
    }
    ack(result);
  });

  socket.on("playtest:selectPlayer", (payload, ack) => {
    const input = parseSocketRequest(socketPayloadSchemas["playtest:selectPlayer"], payload, ack);
    if (!input) return;
    const room = currentPlaytestRoom(ack);
    if (!room) return;
    ack(room.selectPlaytestPlayer(socket.id, input.playerId));
  });

  socket.on("playtest:roll", (payload, ack) => {
    const input = parseSocketRequest(socketPayloadSchemas["playtest:roll"], payload, ack);
    if (!input) return;
    const room = currentPlaytestRoom(ack);
    if (!room) return;
    ack(room.rollPlaytest(socket.id, input.value));
  });

  socket.on("playtest:land", (payload, ack) => {
    const input = parseSocketRequest(socketPayloadSchemas["playtest:land"], payload, ack);
    if (!input) return;
    const room = currentPlaytestRoom(ack);
    if (!room) return;
    ack(room.landPlaytest(socket.id, input.tileId));
  });

  socket.on("playtest:stop", async (ack) => {
    if (!isSocketAck(ack)) return;
    await closeCurrentPlaytest();
    ack({ ok: true });
  });

  socket.on("disconnect", async () => {
    const code = socketIndex.get(socket.id);
    const room = code ? rooms.get(code) : undefined;
    if (room?.isPlaytest) {
      rooms.delete(room.code);
    } else {
      room?.disconnect(socket.id);
    }
    socketIndex.delete(socket.id);
  });
});

// Limpieza de salas vacías cada 5 min.
setInterval(() => {
  for (const [code, room] of rooms) if (room.shouldExpire()) rooms.delete(code);
}, 5 * 60 * 1000);

// --- Salud + estáticos (producción) -----------------------------------------

app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.size }));

/** Listado de salas disponibles para la pantalla "unirme". */
app.get("/api/rooms", (_req, res) => {
  res.json({ rooms: listRooms() });
});

app.get("/api/characters", (_req, res) => {
  try {
    res.json({ characters: listCharacters() });
  } catch (error) {
    res.status(500).json({ error: contentLoadError(error) });
  }
});

app.get("/api/maps", (_req, res) => {
  try {
    res.json({ maps: listMaps() });
  } catch (error) {
    res.status(500).json({ error: contentLoadError(error) });
  }
});

const clientDist = resolve(__dirname, "../../client/dist");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(resolve(clientDist, "index.html")));
}

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🎲 Essence server escuchando en 0.0.0.0:${PORT} (LAN accesible)`);
  for (const address of lanAddresses()) console.log(`   LAN: http://${address}:${PORT}/`);
  console.log(`   Anthropic API: ${process.env.ANTHROPIC_API_KEY ? "configurada ✅" : "sin key (judge usa fallback)"}`);
});

function lanAddresses(): string[] {
  return [...new Set(Object.values(networkInterfaces()).flatMap((entries) =>
    (entries ?? []).flatMap((entry) => entry.family === "IPv4" && !entry.internal ? [entry.address] : [])
  ))];
}
