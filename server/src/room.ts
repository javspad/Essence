import type { Server } from "socket.io";
import type {
  ActiveMinigame,
  AppliedEventAction,
  ClientToServerEvents,
  EventAction,
  EventActionTarget,
  EventActivity,
  EventOutcomeBranch,
  GameContent,
  GameState,
  MinigameResult,
  Player,
  ServerToClientEvents,
  Tile,
} from "@essence/shared";
import { eventTitle, legacyEventIdForTile, resolveEventForPlayer, type ResolvedGameEvent } from "@essence/shared/events";
import { resolveMinigame } from "./minigames/index.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

export class GameRoom {
  readonly code: string;
  readonly name: string;
  private io: IO;
  private content: GameContent;
  private state: GameState;
  private pendingResults = new Map<string, MinigameResult>();
  private pendingEvent: ResolvedGameEvent | null = null;
  private awardsStar = false;
  private resolving = false;
  private skippedTurns = new Set<string>();
  private extraTurnPlayerId: string | null = null;

  constructor(io: IO, code: string, name: string, content: GameContent) {
    this.io = io;
    this.code = code;
    this.name = name;
    this.content = content;
    const activeMap =
      content.maps?.find((map) => map.id === content.activeMapId) ??
      content.maps?.[0];
    this.state = {
      code,
      roomName: name,
      phase: "lobby",
      mapId: activeMap?.id,
      board: activeMap?.board ?? content.board,
      routes: activeMap?.routes,
      artifacts: activeMap?.artifacts,
      assetCatalog: content.assetCatalog,
      boardShape: activeMap?.boardShape,
      terrainZones: activeMap?.terrainZones,
      theme: activeMap?.theme,
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

  /** Resumen público para el listado de salas (/api/rooms). */
  summary(maxPlayers: number) {
    const connected = this.state.players.filter((p) => p.connected);
    const host = this.state.players.find((p) => p.isHost) ?? this.state.players[0];
    return {
      code: this.code,
      name: this.name,
      phase: this.state.phase,
      players: connected.length,
      maxPlayers,
      host: host?.name ?? null,
    };
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
    const eventId = tile.eventId ?? legacyEventIdForTile(tile);
    if (eventId) {
      const event = resolveEventForPlayer(this.content, eventId, active);
      if (!event) {
        console.warn(`[room] evento desconocido: ${eventId}`);
        this.advanceTurn();
        return;
      }
      this.awardsStar = tile.type === "star";
      this.startEvent(event, active);
      return;
    }
    // Casillero sin acción (start u otros): pasa el turno.
    this.advanceTurn();
  }

  // --- Eventos / actividades ----------------------------------------------

  private startEvent(event: ResolvedGameEvent, active: Player) {
    this.pendingEvent = event;
    const activity = event.activity;
    if (!activity) {
      const actions = this.applyActions(event.actions ?? [], {
        landingPlayerId: active.id,
        ranking: [active.id],
      });
      this.state.activeEvent = {
        id: event.id,
        kind: event.kind ?? "story",
        title: event.story.title ?? eventTitle(event),
        text: eventText(event),
        story: event.story,
        playerId: active.id,
        actions,
      };
      this.state.phase = "event";
      this.broadcast();
      return;
    }
    this.startActivity(event, active, activity);
  }

  private startActivity(event: ResolvedGameEvent, activePlayer: Player, activity: EventActivity) {
    this.pendingResults.clear();
    const participants = this.activityParticipants(activity, activePlayer);
    const subjects = this.activitySubjects(activity, activePlayer, participants);
    if (!participants.length || !subjects.length) {
      this.advanceTurn();
      return;
    }
    const active: ActiveMinigame = {
      id: event.id,
      eventId: event.id,
      protagonistId: activePlayer.id,
      type: activity.type,
      skin: activity.skin,
      content: activityContent(activity, event),
      story: event.story,
      participants,
      subjects,
      submitted: [],
    };
    this.state.activeMinigame = active;
    this.state.phase = "minigame";
    this.broadcast();
    this.io.to(this.code).emit("minigame:start", {
      id: event.id,
      type: activity.type,
      skin: activity.skin,
      content: active.content,
      participants,
    });
  }

  private activityParticipants(activity: EventActivity, active: Player): string[] {
    const connected = this.connectedPlayers();
    const mode = activity.participants ?? defaultParticipantMode(activity.type);
    if (mode === "landing") return connected.some((p) => p.id === active.id) ? [active.id] : [];
    if (mode === "host") return connected.filter((p) => p.isHost).map((p) => p.id);
    return connected.map((p) => p.id);
  }

  private activitySubjects(activity: EventActivity, active: Player, participants: string[]): string[] {
    if (activity.type === "hostPick" || activity.type === "vote") return this.connectedPlayers().map((p) => p.id);
    if (activity.type === "prompt") return [active.id];
    return participants;
  }

  minigameAction(socketId: string, data: unknown) {
    const p = this.playerBySocket(socketId);
    if (!p || !this.state.activeMinigame) return;
    // Re-emitir acción (ej. buzzer apretado) para que las pantallas reaccionen.
    this.io.to(this.code).emit("minigame:action", { playerId: p.id, data });
  }

  async submitResult(socketId: string, result: { score: number; payload: unknown; outcome?: "win" | "loss" }) {
    const p = this.playerBySocket(socketId);
    const mg = this.state.activeMinigame;
    if (!p || !mg) return;
    if (!mg.participants.includes(p.id)) return;
    if (this.pendingResults.has(p.id)) return;

    this.pendingResults.set(p.id, { playerId: p.id, score: result.score, payload: result.payload, outcome: result.outcome });
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
      const event = this.pendingEvent;
      const def = event?.activity ?? this.content.minigames[mg.id];
      if (!def) {
        this.advanceTurn();
        return;
      }
      const reveal = await resolveMinigame({
        minigameId: mg.id,
        eventId: mg.eventId,
        def,
        results: [...this.pendingResults.values()],
        participants: mg.participants,
        subjects: mg.subjects,
        players: this.state.players,
        coinPayout: mg.type === "prompt" ? [] : this.content.coinPayout ?? [10, 7, 5, 3, 2, 1, 0],
        story: mg.story,
      });

      // Aplicar monedas (y consecuencias configuradas en el evento).
      for (const [id, c] of Object.entries(reveal.coins)) {
        const pl = this.state.players.find((x) => x.id === id);
        if (pl) pl.coins = Math.max(0, pl.coins + c);
      }
      const landingPlayerId = mg.protagonistId ?? reveal.ranking[0];
      const actions = event
        ? [
            ...(mg.type === "prompt"
              ? this.applyActions(event.actions ?? [], {
                  landingPlayerId,
                  ranking: landingPlayerId ? [landingPlayerId] : reveal.ranking,
                })
              : []),
            ...this.applyOutcomeActions(event.outcomes ?? [], reveal.ranking, landingPlayerId),
          ]
        : [];
      if (this.awardsStar && reveal.ranking[0]) {
        const winner = this.state.players.find((x) => x.id === reveal.ranking[0]);
        if (winner) {
          winner.stars += 1;
          actions.push({
            type: "stars",
            targetPlayerIds: [winner.id],
            text: `${winner.name} gana una estrella`,
            value: 1,
          });
        }
      }

      this.state.reveal = { ...reveal, actions };
      this.state.activeMinigame = null;
      this.state.phase = "reveal";
      this.pendingResults.clear();
      this.pendingEvent = null;
      this.awardsStar = false;
      this.broadcast();
      this.io.to(this.code).emit("minigame:reveal", this.state.reveal);
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
    this.pendingEvent = null;
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

    if (this.extraTurnPlayerId) {
      const extraIndex = order.indexOf(this.extraTurnPlayerId);
      this.extraTurnPlayerId = null;
      if (extraIndex >= 0) {
        this.state.activeIndex = extraIndex;
        this.state.phase = "turn";
        this.broadcast();
        return;
      }
    }

    let nextIndex = this.state.activeIndex;
    let advancedRound = false;
    for (let attempts = 0; attempts < order.length; attempts += 1) {
      nextIndex += 1;
      if (nextIndex >= order.length) {
        nextIndex = 0;
        advancedRound = true;
      }
      const nextId = order[nextIndex];
      if (!this.skippedTurns.has(nextId)) break;
      this.skippedTurns.delete(nextId);
    }
    if (advancedRound) {
      this.state.round += 1;
    }
    this.state.activeIndex = nextIndex;
    this.state.phase = "turn";
    this.broadcast();
  }

  private applyOutcomeActions(branches: EventOutcomeBranch[], ranking: string[], landingPlayerId?: string): AppliedEventAction[] {
    const actions: AppliedEventAction[] = [];
    for (const branch of branches) {
      if (!this.targetPlayerIds(branch.when, { ranking, landingPlayerId }).length) continue;
      actions.push(
        ...this.applyActions(branch.actions, {
          landingPlayerId,
          ranking,
          defaultTarget: branch.when,
        })
      );
    }
    return actions;
  }

  private applyActions(
    actions: EventAction[],
    context: { landingPlayerId?: string; ranking?: string[]; defaultTarget?: EventActionTarget }
  ): AppliedEventAction[] {
    const applied: AppliedEventAction[] = [];
    for (const action of actions) {
      const target = action.target ?? context.defaultTarget ?? "landing";
      const targetPlayerIds = this.targetPlayerIds(target, context);
      if (action.type !== "text" && targetPlayerIds.length === 0) continue;
      applied.push(this.applyAction(action, targetPlayerIds));
    }
    return applied;
  }

  private applyAction(action: EventAction, targetPlayerIds: string[]): AppliedEventAction {
    if (action.type === "text") {
      return { type: action.type, targetPlayerIds, text: action.text };
    }
    if (action.type === "coins") {
      for (const id of targetPlayerIds) {
        const player = this.state.players.find((p) => p.id === id);
        if (player) player.coins = Math.max(0, player.coins + action.value);
      }
      return { type: action.type, targetPlayerIds, text: action.text ?? valueText(targetPlayerIds, this.state.players, action.value, "moneda"), value: action.value };
    }
    if (action.type === "stars") {
      for (const id of targetPlayerIds) {
        const player = this.state.players.find((p) => p.id === id);
        if (player) player.stars = Math.max(0, player.stars + action.value);
      }
      return { type: action.type, targetPlayerIds, text: action.text ?? valueText(targetPlayerIds, this.state.players, action.value, "estrella"), value: action.value };
    }
    if (action.type === "move") {
      for (const id of targetPlayerIds) {
        const player = this.state.players.find((p) => p.id === id);
        if (player) player.position = clamp(player.position + action.delta, 0, this.state.boardLength - 1);
      }
      return { type: action.type, targetPlayerIds, text: action.text ?? moveSummary(targetPlayerIds, this.state.players, action.delta), value: action.delta };
    }
    if (action.type === "moveTo") {
      for (const id of targetPlayerIds) {
        const player = this.state.players.find((p) => p.id === id);
        if (player) player.position = clamp(action.tileId, 0, this.state.boardLength - 1);
      }
      return { type: action.type, targetPlayerIds, text: action.text ?? `Mover a casillero ${action.tileId}`, tileId: action.tileId };
    }
    if (action.type === "skipTurn") {
      for (const id of targetPlayerIds) this.skippedTurns.add(id);
      return { type: action.type, targetPlayerIds, text: action.text ?? `${namesFor(targetPlayerIds, this.state.players)} pierde su próximo turno` };
    }
    for (const id of targetPlayerIds) this.extraTurnPlayerId = id;
    return { type: action.type, targetPlayerIds, text: action.text ?? `${namesFor(targetPlayerIds, this.state.players)} juega otro turno` };
  }

  private targetPlayerIds(target: EventActionTarget, context: { landingPlayerId?: string; ranking?: string[] }): string[] {
    const ranking = context.ranking ?? [];
    if (target === "landing") return context.landingPlayerId ? [context.landingPlayerId] : [];
    if (target === "winner") return ranking[0] ? [ranking[0]] : [];
    if (target === "loser") return ranking.length ? [ranking[ranking.length - 1]] : [];
    if (target === "everyone") return this.connectedPlayers().map((p) => p.id);
    if ("rank" in target) return ranking[target.rank - 1] ? [ranking[target.rank - 1]] : [];
    const from = Math.max(1, target.rankFrom);
    const to = Math.max(from, target.rankTo);
    return ranking.slice(from - 1, to);
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

function activityContent(activity: EventActivity, event: ResolvedGameEvent): unknown {
  const base = isRecord(activity.content) ? activity.content : {};
  return {
    ...base,
    story: event.story,
    title: event.story.title ?? eventTitle(event),
    prompt: event.story.prompt ?? base.prompt ?? base.question ?? event.name,
  };
}

function defaultParticipantMode(type: EventActivity["type"]): "everyone" | "landing" | "host" {
  if (type === "hostPick") return "host";
  if (type === "prompt") return "landing";
  return "everyone";
}

function eventText(event: ResolvedGameEvent): string {
  return event.story.prompt ?? event.story.setup ?? event.story.title ?? event.name;
}

function namesFor(ids: string[], players: Player[]): string {
  return ids.map((id) => players.find((p) => p.id === id)?.name ?? id).join(", ");
}

function valueText(ids: string[], players: Player[], value: number, noun: string): string {
  const verb = value >= 0 ? "gana" : "pierde";
  return `${namesFor(ids, players)} ${verb} ${Math.abs(value)} ${noun}(s)`;
}

function moveSummary(ids: string[], players: Player[], delta: number): string {
  const verb = delta >= 0 ? "avanza" : "retrocede";
  return `${namesFor(ids, players)} ${verb} ${Math.abs(delta)} casillero(s)`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
