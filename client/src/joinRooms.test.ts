import assert from "node:assert/strict";
import type { RoomSummary } from "@essence/shared";
import { joinableCharacterSlots } from "./joinRooms";

const startedRoom: RoomSummary = {
  code: "PLAY",
  name: "Started room",
  phase: "turn",
  players: 1,
  maxPlayers: 3,
  host: "Javi",
  characterSlots: [
    { id: "javi", displayName: "Javi", color: "#fff", groom: true, claimedByPlayerId: "javi", connected: true },
    { id: "nico", displayName: "Nico", color: "#fff", groom: false, claimedByPlayerId: "nico", connected: false },
    { id: "frang", displayName: "Frang", color: "#fff", groom: false },
  ],
};

assert.deepEqual(
  joinableCharacterSlots(startedRoom).map((slot) => slot.id),
  ["nico"],
  "a started room only exposes previously claimed players that are currently disconnected"
);

const lobbyRoom: RoomSummary = { ...startedRoom, phase: "lobby" };
assert.deepEqual(
  joinableCharacterSlots(lobbyRoom).map((slot) => slot.id),
  ["nico", "frang"],
  "a lobby exposes both disconnected seats and characters that have never joined"
);

