import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@essence/shared";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// En dev, Vite hace proxy de /socket.io al server (3001). En prod, mismo origen.
export const socket: GameSocket = io({
  autoConnect: true,
  transports: ["websocket", "polling"],
});
