import { useCallback, useEffect, useState } from "react";
import type { GameState, RevealPayload } from "@essence/shared";
import { socket } from "./socket";

interface MinigameStart {
  id: string;
  type: string;
  skin?: string;
  content: unknown;
  participants: string[];
}

const STORAGE_KEY = "essence:session";

interface Session {
  code: string;
  name: string;
  playerId: string;
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function useGame() {
  const [connected, setConnected] = useState(socket.connected);
  const [state, setState] = useState<GameState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(loadSession()?.playerId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [minigameStart, setMinigameStart] = useState<MinigameStart | null>(null);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      // Reconexión automática si había sesión.
      const s = loadSession();
      if (s) {
        socket.emit("room:join", { code: s.code, name: s.name }, (res) => {
          if (res.ok) setPlayerId(res.playerId);
          else localStorage.removeItem(STORAGE_KEY);
        });
      }
    };
    const onDisconnect = () => setConnected(false);
    const onState = (s: GameState) => {
      setState(s);
      // Limpiar la pantalla de minijuego local cuando ya no estamos jugando.
      if (s.phase !== "minigame") setMinigameStart(null);
    };
    const onMinigameStart = (m: MinigameStart) => setMinigameStart(m);
    const onReveal = (_r: RevealPayload) => setMinigameStart(null);
    const onError = (e: { message: string }) => setError(e.message);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("state", onState);
    socket.on("minigame:start", onMinigameStart);
    socket.on("minigame:reveal", onReveal);
    socket.on("error", onError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("state", onState);
      socket.off("minigame:start", onMinigameStart);
      socket.off("minigame:reveal", onReveal);
      socket.off("error", onError);
    };
  }, []);

  const persist = (code: string, name: string, pid: string) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ code, name, playerId: pid }));
  };

  const create = useCallback((name: string, roomName: string) => {
    setError(null);
    socket.emit("room:create", { name, roomName }, (res) => {
      if (res.ok) {
        setPlayerId(res.playerId);
        persist(res.code, name, res.playerId);
      } else setError(res.error);
    });
  }, []);

  const join = useCallback((code: string, name: string) => {
    setError(null);
    socket.emit("room:join", { code: code.toUpperCase(), name }, (res) => {
      if (res.ok) {
        setPlayerId(res.playerId);
        persist(res.code, name, res.playerId);
      } else setError(res.error);
    });
  }, []);

  const leave = useCallback(() => {
    socket.emit("room:leave");
    localStorage.removeItem(STORAGE_KEY);
    setPlayerId(null);
    setState(null);
  }, []);

  const me = state?.players.find((p) => p.id === playerId) ?? null;
  const activeId = state?.turnOrder[state.activeIndex] ?? null;
  const isMyTurn = !!me && me.id === activeId;
  const isHost = !!me?.isHost;

  return {
    connected,
    state,
    playerId,
    me,
    activeId,
    isMyTurn,
    isHost,
    error,
    minigameStart,
    actions: {
      create,
      join,
      leave,
      start: () => socket.emit("game:start"),
      roll: () => socket.emit("turn:roll"),
      next: () => socket.emit("turn:next"),
      skipShop: () => socket.emit("shop:skip"),
      buyShopItem: (itemId: string) => socket.emit("shop:buy", { itemId }),
      forceResolve: () => socket.emit("minigame:force"),
      submitResult: (score: number, payload: unknown, outcome?: "win" | "loss") =>
        socket.emit("minigame:result", { score, payload, outcome }),
      action: (data: unknown) => socket.emit("minigame:action", data),
    },
  };
}
