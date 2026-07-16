import type { CharacterSlot, RoomSummary } from "@essence/shared";

/** Characters that the Join screen currently allows a player to claim. */
export function joinableCharacterSlots(room: RoomSummary): CharacterSlot[] {
  return (room.characterSlots ?? []).filter((slot) => {
    if (slot.claimedByPlayerId) return slot.connected === false;
    return room.phase === "lobby";
  });
}
