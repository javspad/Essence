import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import {
  ContentPayloadTooLargeError,
  isLoopbackAddress,
  readUtf8Body,
} from "./devContentSaveBoundary";

test("local content writes accept loopback peers only", () => {
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(isLoopbackAddress(address), true, `expected ${address} to be loopback`);
  }

  for (const address of [undefined, "", "0.0.0.0", "192.168.1.42", "10.0.0.8", "::ffff:192.168.1.42"]) {
    assert.equal(isLoopbackAddress(address), false, `expected ${String(address)} to be rejected`);
  }
});

test("local content writes accept a body exactly at the streamed byte limit", async () => {
  const request = Readable.from([Buffer.from("12345")]);

  assert.equal(await readUtf8Body(request, 5), "12345");
  assert.equal(request.listenerCount("data"), 0);
  assert.equal(request.listenerCount("end"), 0);
  assert.equal(request.listenerCount("error"), 0);
});

test("local content writes reject streamed bytes over the limit without a Content-Length header", async () => {
  const request = Readable.from([Buffer.from("123"), Buffer.from("456")]);

  await assert.rejects(readUtf8Body(request, 5), ContentPayloadTooLargeError);
  assert.equal(request.listenerCount("data"), 0);
  assert.equal(request.listenerCount("end"), 0);
  assert.equal(request.listenerCount("error"), 0);
});
