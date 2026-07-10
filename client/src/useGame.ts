import { useCallback, useEffect, useState } from "react";
import type { ArtifactOffer, EffectDef, EffectInstance, GameState, RevealPayload, ServerToClientEvents } from "@essence/shared";
import { normalizeGameState } from "./gameState";
import { socket } from "./socket";

type MinigameStart = Parameters<ServerToClientEvents["minigame:start"]>[0];

const STORAGE_KEY = "essence:session:v1";
const LEGACY_STORAGE_KEY = "essence:session";

interface Session {
  code: string;
  name: string;
  playerId: string;
  characterId?: string;
}

export interface EffectNotice {
  id: string;
  effectInstance: EffectInstance;
  reason: "expired" | "triggered";
}

function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (
      typeof parsed.code === "string" &&
      typeof parsed.name === "string" &&
      typeof parsed.playerId === "string" &&
      (parsed.characterId === undefined || typeof parsed.characterId === "string")
    ) {
      return parsed as Session;
    }
  } catch {
    // Ignore stale or malformed sessions.
  }
  return null;
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

function loadSession(): Session | null {
  const versioned = parseSession(localStorage.getItem(STORAGE_KEY));
  if (versioned) return versioned;

  const legacy = parseSession(localStorage.getItem(LEGACY_STORAGE_KEY));
  if (!legacy) return null;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // The in-memory session is still usable for this render.
  }
  return legacy;
}

export function useGame() {
  const [connected, setConnected] = useState(socket.connected);
  const [state, setState] = useState<GameState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(loadSession()?.playerId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [minigameStart, setMinigameStart] = useState<MinigameStart | null>(null);
  const [effectNotices, setEffectNotices] = useState<EffectNotice[]>([]);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      // Reconexión automática si había sesión.
      const s = loadSession();
      if (s) {
        socket.emit("room:join", { code: s.code, name: s.name, characterId: s.characterId }, (res) => {
          if (res.ok) setPlayerId(res.playerId);
          else clearSession();
        });
      }
    };
    const onDisconnect = () => setConnected(false);
    const onState = (s: GameState) => {
      const nextState = normalizeGameState(s);
      setState(nextState);
      // Limpiar la pantalla de minijuego local cuando ya no estamos jugando.
      if (nextState.phase !== "minigame") setMinigameStart(null);
    };
    const onMinigameStart = (m: MinigameStart) => setMinigameStart(m);
    const onReveal = (_r: RevealPayload) => setMinigameStart(null);
    const onError = (e: { message: string }) => setError(e.message);
    const onEffectEnded = (payload: { effectInstance: EffectInstance; reason: "expired" | "triggered" }) => {
      const id = `${payload.effectInstance.id}-${Date.now()}`;
      setEffectNotices((current) => [...current.slice(-2), { id, effectInstance: payload.effectInstance, reason: payload.reason }]);
      window.setTimeout(() => {
        setEffectNotices((current) => current.filter((notice) => notice.id !== id));
      }, 6500);
    };
    const onRoomClosed = (payload: { message: string }) => {
      clearSession();
      setPlayerId(null);
      setState(null);
      setMinigameStart(null);
      setEffectNotices([]);
      setError(payload.message);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("state", onState);
    socket.on("room:closed", onRoomClosed);
    socket.on("minigame:start", onMinigameStart);
    socket.on("minigame:reveal", onReveal);
    socket.on("effect:ended", onEffectEnded);
    socket.on("error", onError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("state", onState);
      socket.off("room:closed", onRoomClosed);
      socket.off("minigame:start", onMinigameStart);
      socket.off("minigame:reveal", onReveal);
      socket.off("effect:ended", onEffectEnded);
      socket.off("error", onError);
    };
  }, []);

  const persist = (code: string, name: string, pid: string, characterId?: string) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ code, name, playerId: pid, characterId }));
  };

  const create = useCallback((name: string, roomName: string, characterId?: string, mapId?: string) => {
    setError(null);
    socket.emit("room:create", { name, roomName, characterId, mapId }, (res) => {
      if (res.ok) {
        setPlayerId(res.playerId);
        persist(res.code, name, res.playerId, characterId ?? res.playerId);
      } else setError(res.error);
    });
  }, []);

  const join = useCallback((code: string, name: string, characterId?: string) => {
    setError(null);
    socket.emit("room:join", { code: code.toUpperCase(), name, characterId }, (res) => {
      if (res.ok) {
        setPlayerId(res.playerId);
        persist(res.code, name, res.playerId, characterId ?? res.playerId);
      } else setError(res.error);
    });
  }, []);

  const leave = useCallback(() => {
    socket.emit("room:leave");
    clearSession();
    setPlayerId(null);
    setState(null);
  }, []);

  const buyCosmetic = useCallback((cosmeticId: string, onResult?: (res: { ok: true } | { ok: false; error: string }) => void) => {
    socket.emit("cosmetic:buy", { cosmeticId }, (res) => {
      if (!res.ok) setError(res.error);
      onResult?.(res);
    });
  }, []);

  const equipCosmetic = useCallback((
    cosmeticId: string,
    equipped: boolean,
    onResult?: (res: { ok: true } | { ok: false; error: string }) => void
  ) => {
    socket.emit("cosmetic:equip", { cosmeticId, equipped }, (res) => {
      if (!res.ok) setError(res.error);
      onResult?.(res);
    });
  }, []);

  const rollArtifactShop = useCallback((onResult?: (res: { ok: true; offers: ArtifactOffer[] } | { ok: false; error: string }) => void) => {
    socket.emit("artifact:rollShop", {}, (res) => {
      if (!res.ok) setError(res.error);
      onResult?.(res);
    });
  }, []);

  const buyArtifact = useCallback((
    offerId: string,
    onResult?: (res: { ok: true; artifactId: string; requiresTarget: boolean } | { ok: false; error: string }) => void
  ) => {
    socket.emit("artifact:buy", { offerId }, (res) => {
      if (!res.ok) setError(res.error);
      onResult?.(res);
    });
  }, []);

  const useArtifact = useCallback((targetPlayerId: string | undefined, onResult?: (res: { ok: true } | { ok: false; error: string }) => void) => {
    socket.emit("artifact:use", { targetPlayerId }, (res) => {
      if (!res.ok) setError(res.error);
      onResult?.(res);
    });
  }, []);

  const skipArtifactShop = useCallback((onResult?: (res: { ok: true } | { ok: false; error: string }) => void) => {
    socket.emit("artifact:skipShop", {}, (res) => {
      if (!res.ok) setError(res.error);
      onResult?.(res);
    });
  }, []);

  const me = state?.players.find((p) => p.id === playerId) ?? null;
  const activeId = state?.turnOrder[state.activeIndex] ?? null;
  const isMyTurn = !!me && me.id === activeId;
  const isHost = !!me?.isHost;
  const dismissEffectNotice = useCallback((noticeId: string) => {
    setEffectNotices((current) => current.filter((notice) => notice.id !== noticeId));
  }, []);

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
    effectNotices,
    dismissEffectNotice,
    actions: {
      create,
      join,
      leave,
      start: () => socket.emit("game:start"),
      roll: () => socket.emit("turn:roll"),
      next: () => socket.emit("turn:next"),
      debugApplyEffect: (playerId: string, effect: EffectDef) => socket.emit("debug:applyEffect", { playerId, effectId: effect.id, effect }),
      buyCosmetic,
      equipCosmetic,
      rollArtifactShop,
      buyArtifact,
      useArtifact,
      skipArtifactShop,
      forceResolve: () => socket.emit("minigame:force"),
      submitResult: (score: number, payload: unknown, outcome?: "win" | "loss") =>
        socket.emit("minigame:result", { score, payload, outcome }),
      action: (data: unknown) => socket.emit("minigame:action", data),
    },
  };
}
