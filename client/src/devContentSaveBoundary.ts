import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";

export class ContentPayloadTooLargeError extends Error {
  constructor() {
    super("Content payload is too large.");
  }
}

export function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function readUtf8Body(stream: Readable, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder("utf8");
    let body = "";
    let bytes = 0;
    let settled = false;

    const cleanup = () => {
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
      stream.off("aborted", onAborted);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      stream.resume();
      reject(error);
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      bytes += buffer.byteLength;
      if (bytes > maxBytes) {
        fail(new ContentPayloadTooLargeError());
        return;
      }
      body += decoder.write(buffer);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(body + decoder.end());
    };
    const onError = (error: Error) => fail(error);
    const onAborted = () => fail(new Error("Content request was aborted."));

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
    stream.on("aborted", onAborted);
  });
}
