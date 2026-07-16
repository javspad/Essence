import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@essence/shared";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const configuredSocketUrl = import.meta.env.VITE_SOCKET_URL?.trim();
const developmentSocketUrl = typeof window === "undefined"
  ? undefined
  : `${window.location.protocol}//${window.location.hostname}:${import.meta.env.VITE_SERVER_PORT ?? "3001"}`;
const socketUrl = configuredSocketUrl || (import.meta.env.DEV ? developmentSocketUrl : undefined);

// Development connects straight to the authoritative server. Keeping a
// long-lived multiplayer socket out of Vite's proxy avoids LAN EPIPE/timeouts.
export const socket: GameSocket = io(socketUrl, {
  autoConnect: true,
  transports: ["polling", "websocket"],
  upgrade: true,
  tryAllTransports: true,
  timeout: 10_000,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 4_000,
  randomizationFactor: 0.35,
});

export const socketEndpoint = socketUrl ?? "same origin";
