import { z } from "zod";

const id = z.string().min(1).max(128);
const name = z.string().max(80);
const emptyPayload = z.object({});

export const socketPayloadSchemas = {
  "room:create": z.object({
    name: name.optional(),
    roomName: z.string().min(1).max(40),
    characterId: id.optional(),
    mapId: id.optional(),
  }),
  "room:join": z.object({
    code: z.string().min(1).max(16),
    name: name.optional(),
    characterId: id.optional(),
    reconnectToken: id.optional(),
  }),
  "minigame:result": z.object({
    score: z.number().finite(),
    payload: z.unknown(),
    outcome: z.enum(["win", "loss"]).optional(),
  }),
  "cosmetic:buy": z.object({ cosmeticId: id }),
  "cosmetic:equip": z.object({ cosmeticId: id, equipped: z.boolean() }),
  "artifact:rollShop": emptyPayload,
  "artifact:buy": z.object({ offerId: id }),
  "artifact:use": z.object({ targetPlayerId: id.optional() }),
  "artifact:skipShop": emptyPayload,
  "debug:applyEffect": z.object({ playerId: id, effectId: id, effect: z.unknown().optional() }),
  "playtest:start": z.object({ content: z.unknown(), mapId: id.optional() }),
  "playtest:selectPlayer": z.object({ playerId: id }),
  "playtest:roll": z.object({ value: z.number().finite() }),
  "playtest:land": z.object({ tileId: z.number().finite().int() }),
};
