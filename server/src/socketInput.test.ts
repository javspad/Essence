import assert from "node:assert/strict";
import { test } from "node:test";
import { socketPayloadSchemas } from "@essence/shared/socketSchemas";
import {
  INVALID_SOCKET_INPUT_ERROR,
  isSocketAck,
  parseSocketInput,
  parseSocketRequest,
} from "./socketInput";

const validPayloads = {
  "room:create": { roomName: "Party", name: "Javi", characterId: "javi", mapId: "board" },
  "room:join": { code: "ABCD", name: "Nico", characterId: "nico", reconnectToken: "token" },
  "minigame:result": { score: 42, payload: { answer: 1 }, outcome: "win" },
  "cosmetic:buy": { cosmeticId: "hat" },
  "cosmetic:equip": { cosmeticId: "hat", equipped: true },
  "artifact:rollShop": {},
  "artifact:buy": { offerId: "offer-1" },
  "artifact:use": { targetPlayerId: "nico" },
  "artifact:skipShop": {},
  "debug:applyEffect": { playerId: "javi", effectId: "slow" },
  "playtest:start": { content: {}, mapId: "board" },
  "playtest:selectPlayer": { playerId: "javi" },
  "playtest:roll": { value: 6 },
  "playtest:land": { tileId: 4 },
} satisfies Record<keyof typeof socketPayloadSchemas, unknown>;

test("every socket payload schema accepts its current client contract", () => {
  for (const [event, schema] of Object.entries(socketPayloadSchemas)) {
    assert.equal(schema.safeParse(validPayloads[event as keyof typeof validPayloads]).success, true, event);
  }
});

test("socket payload schemas reject unsafe envelope values", () => {
  for (const payload of [undefined, null, []]) {
    assert.equal(socketPayloadSchemas["room:create"].safeParse(payload).success, false);
  }
  assert.equal(socketPayloadSchemas["room:create"].safeParse({ roomName: "" }).success, false);
  assert.equal(socketPayloadSchemas["room:create"].safeParse({ roomName: "x".repeat(41) }).success, false);
  assert.equal(socketPayloadSchemas["room:join"].safeParse({ code: "" }).success, false);
  assert.equal(socketPayloadSchemas["room:join"].safeParse({ code: "A".repeat(17) }).success, false);
  assert.equal(socketPayloadSchemas["room:join"].safeParse({ code: "ABCD", reconnectToken: "x".repeat(129) }).success, false);
  assert.equal(socketPayloadSchemas["cosmetic:buy"].safeParse({ cosmeticId: "" }).success, false);
  assert.equal(socketPayloadSchemas["artifact:buy"].safeParse({ offerId: "x".repeat(129) }).success, false);
  assert.equal(socketPayloadSchemas["minigame:result"].safeParse({ score: Number.NaN, payload: null }).success, false);
  assert.equal(socketPayloadSchemas["minigame:result"].safeParse({ score: Number.POSITIVE_INFINITY, payload: null }).success, false);
  assert.equal(socketPayloadSchemas["minigame:result"].safeParse({ score: 1, payload: null, outcome: "draw" }).success, false);
  assert.equal(socketPayloadSchemas["playtest:roll"].safeParse({ value: Number.NEGATIVE_INFINITY }).success, false);
});

test("socket request parsing never throws or dispatches without valid input and ack", () => {
  const replies: unknown[] = [];
  const ack = (reply: unknown) => replies.push(reply);
  let dispatches = 0;

  for (const payload of [undefined, null, []]) {
    assert.doesNotThrow(() => {
      const request = parseSocketRequest(socketPayloadSchemas["room:create"], payload, ack);
      if (request) dispatches += 1;
    });
  }
  assert.equal(dispatches, 0);
  assert.deepEqual(replies, Array.from({ length: 3 }, () => ({ ok: false, error: INVALID_SOCKET_INPUT_ERROR })));

  assert.equal(parseSocketRequest(socketPayloadSchemas["room:create"], validPayloads["room:create"], undefined), undefined);
  assert.equal(parseSocketRequest(socketPayloadSchemas["room:create"], validPayloads["room:create"], {}), undefined);
  assert.equal(isSocketAck(undefined), false);
  assert.equal(isSocketAck("ack"), false);
  assert.equal(isSocketAck(ack), true);
});

test("socket input parsing returns validated data without requiring an ack", () => {
  assert.deepEqual(
    parseSocketInput(socketPayloadSchemas["minigame:result"], validPayloads["minigame:result"]),
    validPayloads["minigame:result"]
  );
  assert.equal(parseSocketInput(socketPayloadSchemas["minigame:result"], { score: Number.NaN, payload: null }), undefined);
});
