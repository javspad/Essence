import type { Server } from "socket.io";
import type {
  ActiveMinigame,
  ClientToServerEvents,
  GameContent,
  GameState,
  MinigameResult,
  Player,
  ServerToClientEvents,
  Tile,
} from "@essence/shared";
import { resolveMinigame } from "./minigames/index.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

const TILE_TRIGGERS_MINIGAME = new Set(["minigame", "trivia", "vote", "judge", "groom", "star"]);

export class GameRoom {
  readonly code: string;
  private io: IO;
  private content: GameContent;
  private state: GameState;
  private pendingResults = new Map<string, MinigameResult>();
  private awardsStar = false;
  private resolving = false;

  constructor(io: IO, code: string, content: GameContent) {
    this.io = io;
    this.code = code;
    this.content = content;
    const activeMap =
      content.maps?.find((map) => map.id === content.activeMapId) ??
      content.maps?.[0];
    this.state = {
      code,
      phase: "lobby",
      mapId: activeMap?.id,
      board: activeMap?.board ?? content.board,
      routes: activeMap?.routes,
      artifacts: activeMap?.artifacts,
      players: [],
      turnOrder: [],
      activeIndex: 0,
      round: 0,
      boardLength: (activeMap?.board ?? content.board).length,
      lastRoll: null,
      activeMinigame: null,
      activeEvent: null,
      reveal: null,
      winnerId: null,
    };
  }

  get isEmpty(): boolean {
    return this.state.players.every((p) => !p.connected);
  }

  getState(): GameState {
    return this.state;
  }

  broadcast() {
    this.io.to(this.code).emit("state", this.state);
  }

  // --- Lobby ---------------------------------------------------------------

  /** Reclama un slot de jugador por nombre (reconexión) o el primer libre. */
  join(socketId: string, name: string): { ok: true; playerId: string } | { ok: false; error: string } {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Poné un nombre" };

    // ¿reconexión? mismo nombre, slot ya existente.
    const existing = this.state.players.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      existing.socketId = socketId;
      existing.connected = true;
      this.broadcast();
      return { ok: true, playerId: existing.id };
    }

    // Slot predefinido cuyo nombre coincide (ata rig a la persona real).
    const defByName = this.content.players.find(
      (d) => d.name.toLowerCase() === trimmed.toLowerCase() && !this.state.players.some((p) => p.id === d.id)
    );
    // Si no, primer slot predefinido libre.
    const def =
      defByName ??
      this.content.players.find((d) => !this.state.players.some((p) => p.id === d.id));

    if (!def) return { ok: false, error: "La sala está llena" };

    const player: Player = {
      id: def.id,
      name: defByName ? def.name : trimmed,
      socketId,
      connected: true,
      position: 0,
      coins: 0,
      stars: 0,
      isHost: this.state.players.length === 0,
      groom: !!def.groom,
      color: def.color ?? "#888888",
    };
    this.state.players.push(player);
    this.broadcast();
    return { ok: true, playerId: player.id };
  }

  disconnect(socketId: string) {
    const p = this.state.players.find((x) => x.socketId === socketId);
    if (!p) return;
    p.connected = false;
    p.socketId = null;
    this.broadcast();
  }

  private playerBySocket(socketId: string): Player | undefined {
    return this.state.players.find((p) => p.socketId === socketId);
  }

  private connectedPlayers(): Player[] {
    return this.state.players.filter((p) => p.connected);
  }

  // --- Inicio --------------------------------------------------------------

  startGame(socketId: string) {
    const p = this.playerBySocket(socketId);
    if (!p?.isHost) return;
    if (this.state.phase !== "lobby") return;
    const order = this.connectedPlayers().map((x) => x.id);
    if (order.length === 0) return;
    this.state.turnOrder = order;
    this.state.activeIndex = 0;
    this.state.round = 1;
    this.state.phase = "turn";
    this.broadcast();
  }

  private activePlayer(): Player | undefined {
    const id = this.state.turnOrder[this.state.activeIndex];
    return this.state.players.find((p) => p.id === id);
  }

  // --- Turno ---------------------------------------------------------------

  roll(socketId: string) {
    if (this.state.phase !== "turn") return;
    const active = this.activePlayer();
    const p = this.playerBySocket(socketId);
    if (!active || !p || p.id !== active.id) return;

    const roll = 1 + Math.floor(Math.random() * 6);
    this.state.lastRoll = roll;

    const finish = this.state.boardLength - 1;
    active.position = Math.min(active.position + roll, finish);
    this.state.phase = "moving";
    this.broadcast();

    const tile = this.state.board[active.position];

    // Llegó al final → fin del juego.
    if (tile.type === "finish") {
      this.endGame();
      return;
    }
    this.triggerTile(tile, active);
  }

  private triggerTile(tile: Tile, active: Player) {
    if (TILE_TRIGGERS_MINIGAME.has(tile.type) && tile.minigameId) {
      this.awardsStar = tile.type === "star";
      this.startMinigame(tile.minigameId);
      return;
    }
    if (tile.type === "dare" && tile.dareId) {
      const dare = this.content.dares[tile.dareId];
      this.state.activeEvent = { kind: "dare", text: dare?.text ?? "Prenda", playerId: active.id };
      this.state.phase = "event";
      this.broadcast();
      return;
    }
    if (tile.type === "fate" && tile.fateId) {
      const fate = this.content.fates[tile.fateId];
      if (fate?.delta) {
        active.position = Math.max(0, Math.min(active.position + fate.delta, this.state.boardLength - 1));
      }
      if (fate?.coins) active.coins = Math.max(0, active.coins + fate.coins);
      this.state.activeEvent = { kind: "fate", text: fate?.text ?? "Destino", playerId: active.id };
      this.state.phase = "event";
      this.broadcast();
      return;
    }
    // Casillero sin acción (start u otros): pasa el turno.
    this.advanceTurn();
  }

  // --- Minijuego -----------------------------------------------------------

  private startMinigame(minigameId: string) {
    const def = this.content.minigames[minigameId];
    if (!def) {
      console.warn(`[room] minijuego desconocido: ${minigameId}`);
      this.advanceTurn();
      return;
    }
    this.pendingResults.clear();
    const participants = this.connectedPlayers().map((p) => p.id);
    const active: ActiveMinigame = {
      id: minigameId,
      type: def.type,
      skin: def.skin,
      content: def.content,
      participants,
      submitted: [],
    };
    this.state.activeMinigame = active;
    this.state.phase = "minigame";
    this.broadcast();
    this.io.to(this.code).emit("minigame:start", {
      id: minigameId,
      type: def.type,
      skin: def.skin,
      content: def.content,
      participants,
    });
  }

  minigameAction(socketId: string, data: unknown) {
    const p = this.playerBySocket(socketId);
    if (!p || !this.state.activeMinigame) return;
    // Re-emitir acción (ej. buzzer apretado) para que las pantallas reaccionen.
    this.io.to(this.code).emit("minigame:action", { playerId: p.id, data });
  }

  async submitResult(socketId: string, result: { score: number; payload: unknown }) {
    const p = this.playerBySocket(socketId);
    const mg = this.state.activeMinigame;
    if (!p || !mg) return;
    if (!mg.participants.includes(p.id)) return;
    if (this.pendingResults.has(p.id)) return;

    this.pendingResults.set(p.id, { playerId: p.id, score: result.score, payload: result.payload });
    if (!mg.submitted.includes(p.id)) mg.submitted.push(p.id);
    this.broadcast();

    const allIn = mg.participants.every((id) => this.pendingResults.has(id));
    if (allIn) await this.resolveActiveMinigame();
  }

  /** Para no quedar trabados si alguien se cuelga: el host puede forzar el cierre. */
  async forceResolve(socketId: string) {
    const p = this.playerBySocket(socketId);
    if (!p?.isHost || !this.state.activeMinigame) return;
    await this.resolveActiveMinigame();
  }

  private async resolveActiveMinigame() {
    const mg = this.state.activeMinigame;
    if (!mg || this.resolving) return;
    this.resolving = true;
    try {
      const def = this.content.minigames[mg.id];
      const reveal = await resolveMinigame({
        minigameId: mg.id,
        def,
        results: [...this.pendingResults.values()],
        participants: mg.participants,
        players: this.state.players,
        coinPayout: this.content.coinPayout ?? [10, 7, 5, 3, 2, 1, 0],
      });

      // Aplicar monedas (y estrella si era casillero star).
      for (const [id, c] of Object.entries(reveal.coins)) {
        const pl = this.state.players.find((x) => x.id === id);
        if (pl) pl.coins = Math.max(0, pl.coins + c);
      }
      if (this.awardsStar && reveal.ranking[0]) {
        const winner = this.state.players.find((x) => x.id === reveal.ranking[0]);
        if (winner) winner.stars += 1;
      }

      this.state.reveal = reveal;
      this.state.activeMinigame = null;
      this.state.phase = "reveal";
      this.pendingResults.clear();
      this.awardsStar = false;
      this.broadcast();
      this.io.to(this.code).emit("minigame:reveal", reveal);
    } catch (err) {
      console.error("[room] error resolviendo minijuego:", err);
      this.state.activeMinigame = null;
      this.state.phase = "turn";
      this.broadcast();
    } finally {
      this.resolving = false;
    }
  }

  // --- Avance / cierre -----------------------------------------------------

  next(socketId: string) {
    // Avanza desde reveal o event. Lo dispara el host o el jugador activo.
    const p = this.playerBySocket(socketId);
    const active = this.activePlayer();
    if (!p) return;
    if (!p.isHost && p.id !== active?.id) return;
    if (this.state.phase !== "reveal" && this.state.phase !== "event") return;
    this.advanceTurn();
  }

  private advanceTurn() {
    this.state.reveal = null;
    this.state.activeEvent = null;
    this.state.lastRoll = null;

    const order = this.state.turnOrder.filter((id) => {
      const pl = this.state.players.find((p) => p.id === id);
      return pl?.connected;
    });
    if (order.length === 0) {
      this.state.phase = "lobby";
      this.broadcast();
      return;
    }
    this.state.turnOrder = order;

    let nextIndex = this.state.activeIndex + 1;
    if (nextIndex >= order.length) {
      nextIndex = 0;
      this.state.round += 1;
    }
    this.state.activeIndex = nextIndex;
    this.state.phase = "turn";
    this.broadcast();
  }

  private endGame() {
    const ranked = [...this.state.players].sort(
      (a, b) => b.stars - a.stars || b.coins - a.coins
    );
    this.state.winnerId = ranked[0]?.id ?? null;
    this.state.phase = "finished";
    this.state.activeMinigame = null;
    this.state.activeEvent = null;
    this.broadcast();
  }
}
