import { useEffect, useRef, useState } from "react";
import { socket } from "../socket";

export interface RemoteAction {
  playerId: string;
  data: unknown;
}

/**
 * Suscripción al relay en vivo de la sala: cada `onAction(data)` que emite un
 * jugador vuelve por acá a TODOS (incluido el emisor — filtrar por playerId).
 * Los motores realtime lo usan para dibujar fantasmas/rivales.
 */
export function useMinigameActions(handler: (action: RemoteAction) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const on = (payload: RemoteAction) => ref.current(payload);
    socket.on("minigame:action", on);
    return () => {
      socket.off("minigame:action", on);
    };
  }, []);
}

/** Cuenta regresiva de largada (3..2..1). Devuelve los segundos restantes; 0 = jugar. */
export function useCountdown(seconds = 3): number {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return left;
}
