export const INVALID_SOCKET_INPUT_ERROR = "Los datos enviados no son válidos";

export type SocketAck = (response: unknown) => void;
type SocketSchema<T> = {
  safeParse(payload: unknown): { success: true; data: T } | { success: false };
};

export function isSocketAck(value: unknown): value is SocketAck {
  return typeof value === "function";
}

export function parseSocketInput<T>(schema: SocketSchema<T>, payload: unknown, ack?: unknown): T | undefined {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;
  if (isSocketAck(ack)) ack({ ok: false, error: INVALID_SOCKET_INPUT_ERROR });
  return undefined;
}

export function parseSocketRequest<T>(schema: SocketSchema<T>, payload: unknown, ack: unknown): T | undefined {
  if (!isSocketAck(ack)) return undefined;
  return parseSocketInput(schema, payload, ack);
}
