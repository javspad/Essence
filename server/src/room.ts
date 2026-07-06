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
  RevealPayload,
  ServerToClientEvents,
  Tile,
} from "@essence/shared";
import { characterForPlayerDef } from "@essence/shared/character";
import {
  eventTitle,
  resolveActivityParticipantIds,
  resolveActivitySubjectIds,
  resolveEventActionTargetIds,
  resolveTileEventForPlayer,
  type ResolvedGameEvent,
} from "@essence/shared/events";
import { resolveMinigame } from "./minigames/index.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

export class GameRoom {
  readonly code: string;
  readonly name: string;
  private io: IO;
  private content: GameContent;
  private state: GameState;
  private pendingResults = new Map<string, MinigameResult>();
  private pendingJudgeVotes = new Map<string, MinigameResult>();
  private pendingJudgeSubmissionOwners = new Map<string, string>();
  private pendingEvent: ResolvedGameEvent | null = null;
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
      terraces: activeMap?.terraces,
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
      isHost: this.state.players.length === 0,
      groom: !!def.groom,
      color: def.color ?? "#888888",
      character: characterForPlayerDef(def),
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
      this.endGame(active.id);
      return;
    }
    this.triggerTile(tile, active);
  }

  private triggerTile(tile: Tile, active: Player) {
    const event = resolveTileEventForPlayer(this.content, tile, active);
    if (event) {
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
    this.pendingJudgeVotes.clear();
    this.pendingJudgeSubmissionOwners.clear();
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
      content: activityContent(activity, event, activePlayer, subjects, this.state.players),
      story: event.story,
      participants,
      subjects,
      submitted: [],
      ...(activity.type === "judge" ? { judge: { phase: "writing" as const } } : {}),
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
    return resolveActivityParticipantIds(activity, this.connectedPlayers(), active);
  }

  private activitySubjects(activity: EventActivity, active: Player, participants: string[]): string[] {
    return resolveActivitySubjectIds(activity, this.connectedPlayers(), active, participants);
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

    if (mg.type === "judge" && mg.judge?.phase === "voting") {
      if (this.pendingJudgeVotes.has(p.id)) return;
      const vote = result.payload as { votedForSubmissionId?: string } | null | undefined;
      if (!vote?.votedForSubmissionId || !this.pendingJudgeSubmissionOwners.has(vote.votedForSubmissionId)) return;

      this.pendingJudgeVotes.set(p.id, { playerId: p.id, score: 0, payload: result.payload, outcome: result.outcome });
      if (!mg.submitted.includes(p.id)) mg.submitted.push(p.id);
      this.broadcast();

      const allVotesIn = mg.participants.every((id) => this.pendingJudgeVotes.has(id));
      if (allVotesIn) await this.resolveActiveMinigame();
      return;
    }

    if (this.pendingResults.has(p.id)) return;

    this.pendingResults.set(p.id, { playerId: p.id, score: result.score, payload: result.payload, outcome: result.outcome });
    if (!mg.submitted.includes(p.id)) mg.submitted.push(p.id);
    this.broadcast();

    const allIn = mg.participants.every((id) => this.pendingResults.has(id));
    if (allIn && mg.type === "judge") {
      this.startJudgeVoting(mg);
      return;
    }
    if (allIn) await this.resolveActiveMinigame();
  }

  /** Para no quedar trabados si alguien se cuelga: el host puede forzar el cierre. */
  async forceResolve(socketId: string) {
    const p = this.playerBySocket(socketId);
    if (!p?.isHost || !this.state.activeMinigame) return;
    if (this.state.activeMinigame.type === "judge" && this.state.activeMinigame.judge?.phase !== "voting") {
      this.startJudgeVoting(this.state.activeMinigame);
      return;
    }
    await this.resolveActiveMinigame();
  }

  private startJudgeVoting(mg: ActiveMinigame) {
    const submissions = mg.participants.map((playerId, index) => {
      const result = this.pendingResults.get(playerId);
      const payload = result?.payload as { message?: string } | null | undefined;
      const id = `judge-${index + 1}`;
      const text = payload?.message?.trim() || "(sin respuesta)";
      this.pendingJudgeSubmissionOwners.set(id, playerId);
      return { id, text };
    });

    mg.judge = { phase: "voting", submissions };
    mg.submitted = [];
    this.pendingJudgeVotes.clear();
    this.broadcast();
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
      const results = mg.type === "judge" && mg.judge?.phase === "voting"
        ? this.judgeVoteResults(mg)
        : [...this.pendingResults.values()];
      const reveal = await resolveMinigame({
        minigameId: mg.id,
        eventId: mg.eventId,
        def,
        results,
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
      const promptConfirmed = mg.type !== "prompt" || promptConfirmationComplete(reveal);
      const actions = event
        ? [
            ...(mg.type === "prompt" && promptConfirmed
              ? this.applyActions(event.actions ?? [], {
                  landingPlayerId,
                  ranking: landingPlayerId ? [landingPlayerId] : reveal.ranking,
                })
              : []),
            ...(promptConfirmed ? this.applyOutcomeActions(event.outcomes ?? [], reveal.ranking, landingPlayerId) : []),
          ]
        : [];
      this.state.reveal = { ...reveal, actions };
      this.state.activeMinigame = null;
      this.state.phase = "reveal";
      this.pendingResults.clear();
      this.pendingJudgeVotes.clear();
      this.pendingJudgeSubmissionOwners.clear();
      this.pendingEvent = null;
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

  private judgeVoteResults(mg: ActiveMinigame): MinigameResult[] {
    const submissions = mg.judge?.submissions ?? [];
    return submissions.map((submission) => {
      const ownerId = this.pendingJudgeSubmissionOwners.get(submission.id) ?? "";
      const voters = [...this.pendingJudgeVotes.values()]
        .filter((vote) => (vote.payload as { votedForSubmissionId?: string } | null | undefined)?.votedForSubmissionId === submission.id)
        .map((vote) => vote.playerId);
      return {
        playerId: ownerId,
        score: voters.length,
        payload: {
          message: submission.text,
          votes: voters.length,
          voters,
        },
      };
    });
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
    if (this.state.winnerId) {
      this.endGame(this.state.winnerId);
      return;
    }

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
    if (action.type === "move") {
      for (const id of targetPlayerIds) {
        const player = this.state.players.find((p) => p.id === id);
        if (player) player.position = clamp(player.position + action.delta, 0, this.state.boardLength - 1);
      }
      this.recordFinishWinner(targetPlayerIds);
      return { type: action.type, targetPlayerIds, text: action.text ?? moveSummary(targetPlayerIds, this.state.players, action.delta), value: action.delta };
    }
    if (action.type === "moveTo") {
      for (const id of targetPlayerIds) {
        const player = this.state.players.find((p) => p.id === id);
        if (player) player.position = clamp(action.tileId, 0, this.state.boardLength - 1);
      }
      this.recordFinishWinner(targetPlayerIds);
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
    return resolveEventActionTargetIds(target, {
      landingPlayerId: context.landingPlayerId,
      ranking: context.ranking,
      connectedPlayerIds: this.connectedPlayers().map((p) => p.id),
      playerIds: this.state.players.map((p) => p.id),
    });
  }

  private endGame(winnerId: string) {
    this.state.winnerId = winnerId;
    this.state.phase = "finished";
    this.state.activeMinigame = null;
    this.state.activeEvent = null;
    this.state.reveal = null;
    this.broadcast();
  }

  private recordFinishWinner(playerIds: string[]) {
    if (this.state.winnerId) return;
    const finish = this.state.boardLength - 1;
    const winner = playerIds
      .map((id) => this.state.players.find((player) => player.id === id))
      .find((player) => player && player.position >= finish);
    if (winner) this.state.winnerId = winner.id;
  }
}

function activityContent(activity: EventActivity, event: ResolvedGameEvent, active: Player, subjects: string[], players: Player[]): unknown {
  const base = isRecord(activity.content) ? activity.content : {};
  return {
    ...base,
    story: event.story,
    title: event.story.title ?? eventTitle(event),
    prompt: event.story.prompt ?? base.prompt ?? base.question ?? event.name,
    protagonistId: active.id,
    protagonistName: active.name,
    subjectPlayerIds: subjects,
    subjectPlayerNames: subjects.map((id) => playerNameFor(id, players)),
    // Semilla compartida: todos los clientes generan el mismo escenario (laberinto, caños, semáforo).
    seed: typeof base.seed === "number" ? base.seed : Math.floor(Math.random() * 0x7fffffff),
  };
}

function playerNameFor(playerId: string, players: Player[]): string {
  return players.find((player) => player.id === playerId)?.name ?? playerId;
}

function promptConfirmationComplete(reveal: RevealPayload): boolean {
  return reveal.entries.some((entry) => {
    const payload = entry.payload as { confirmed?: unknown } | null;
    return payload?.confirmed === true;
  });
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
