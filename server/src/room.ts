import type { Server } from "socket.io";
import type {
  ActiveMinigame,
  AppliedEventAction,
  CharacterDef,
  ClientToServerEvents,
  EffectDef,
  EffectDuration,
  EffectInstance,
  EffectLifecycleHook,
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
import { characterDisplayName, characterSlotsForContent } from "@essence/shared/characters";
import {
  consequenceMatchesHook,
  consequenceLabel,
  durationStateFromDef,
  effectConsequencesFor,
  effectHooksFor,
  shouldAttachConsequence,
  timedConsequenceEffectDef,
} from "@essence/shared/consequences";
import {
  eventTitle,
  resolveActivityParticipantIds,
  resolveActivitySubjectIds,
  resolveEventActionTargetIds,
  resolveTileEventForPlayer,
  type ResolvedGameEvent,
} from "@essence/shared/events";
import {
  cosmeticPrice,
  isCosmeticCompatibleWithCharacter,
  uniqueCosmeticIds,
} from "@essence/shared/cosmetics";
import { resolveMinigame } from "./minigames/index.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

interface JoinOptions {
  characterId?: string;
}

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
  private nextEffectInstanceId = 1;
  private pendingActivityPreludeActions: AppliedEventAction[] = [];

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
      characterSlots: characterSlotsForContent(content),
      mapId: activeMap?.id,
      board: activeMap?.board ?? content.board,
      routes: activeMap?.routes,
      artifacts: activeMap?.artifacts,
      assetCatalog: content.assetCatalog,
      cosmetics: content.cosmetics,
      boardShape: activeMap?.boardShape,
      terraces: activeMap?.terraces,
      players: [],
      turnOrder: [],
      activeIndex: 0,
      round: 0,
      boardLength: (activeMap?.board ?? content.board).length,
      lastBaseRoll: null,
      lastRoll: null,
      activeMinigame: null,
      activeEvent: null,
      reveal: null,
      winnerId: null,
      effects: content.effects,
      activeEffects: [],
    };
  }

  get isEmpty(): boolean {
    return this.state.players.every((p) => !p.connected);
  }

  getState(): GameState {
    this.refreshCharacterSlots();
    return this.state;
  }

  /** Resumen público para el listado de salas (/api/rooms). */
  summary() {
    this.refreshCharacterSlots();
    const connected = this.state.players.filter((p) => p.connected);
    const host = this.state.players.find((p) => p.isHost) ?? this.state.players[0];
    return {
      code: this.code,
      name: this.name,
      phase: this.state.phase,
      characterSlots: this.state.characterSlots,
      players: connected.length,
      maxPlayers: this.state.characterSlots?.length ?? this.content.players.length,
      host: host?.name ?? null,
    };
  }

  broadcast() {
    this.refreshCharacterSlots();
    this.io.to(this.code).emit("state", this.state);
  }

  // --- Lobby ---------------------------------------------------------------

  /** Reclama un personaje de la sala, con compatibilidad de reconexión por nombre. */
  join(socketId: string, name = "", options: JoinOptions = {}): { ok: true; playerId: string } | { ok: false; error: string } {
    const trimmed = name.trim();
    const requestedCharacterId = options.characterId?.trim();
    if (!trimmed && !requestedCharacterId) return { ok: false, error: "Elegí un personaje" };

    const character = this.claimableCharacter(trimmed, requestedCharacterId);
    if (!character.ok) return character;

    const existing = this.state.players.find((p) => p.id === character.def.id);
    if (existing) {
      existing.socketId = socketId;
      existing.connected = true;
      this.broadcast();
      return { ok: true, playerId: existing.id };
    }

    this.state.players.push(this.playerFromCharacter(character.def, socketId));
    this.broadcast();
    return { ok: true, playerId: character.def.id };
  }

  disconnect(socketId: string) {
    const p = this.state.players.find((x) => x.socketId === socketId);
    if (!p) return;
    p.connected = false;
    p.socketId = null;
    this.broadcast();
  }

  leave(socketId: string): { closed: boolean } {
    const player = this.playerBySocket(socketId);
    if (!player) return { closed: false };
    if (player.isHost) {
      for (const p of this.state.players) {
        p.connected = false;
        p.socketId = null;
      }
      this.io.to(this.code).emit("room:closed", { message: "El host cerró la sala." });
      return { closed: true };
    }

    this.disconnect(socketId);
    return { closed: false };
  }

  private playerBySocket(socketId: string): Player | undefined {
    return this.state.players.find((p) => p.socketId === socketId);
  }

  private connectedPlayers(): Player[] {
    return this.state.players.filter((p) => p.connected);
  }

  private refreshCharacterSlots() {
    this.state.characterSlots = characterSlotsForContent(this.content, this.state.players);
  }

  private claimableCharacter(
    trimmedName: string,
    requestedCharacterId?: string
  ): { ok: true; def: CharacterDef } | { ok: false; error: string } {
    const slots = characterSlotsForContent(this.content, this.state.players);
    const slotIds = new Set(slots.map((slot) => slot.id));
    const characters = Object.fromEntries(
      slots.map((slot) => [
        slot.id,
        {
          id: slot.id,
          displayName: slot.displayName,
          color: slot.color,
          groom: slot.groom,
          facePhoto: slot.facePhoto,
          facePhotoAlignment: slot.facePhotoAlignment,
          faceAnchors: slot.faceAnchors,
          bodyAnchors: slot.bodyAnchors,
          defaultLoadout: slot.defaultLoadout
            ? {
                ...slot.defaultLoadout,
                cosmeticIds: slot.defaultLoadout.cosmeticIds ? [...slot.defaultLoadout.cosmeticIds] : undefined,
              }
            : undefined,
        } satisfies CharacterDef,
      ])
    );

    if (requestedCharacterId) {
      if (!slotIds.has(requestedCharacterId)) return { ok: false, error: "Ese personaje no existe en esta sala" };
      const existing = this.state.players.find((player) => player.id === requestedCharacterId);
      if (existing?.connected) return { ok: false, error: "Ese personaje ya está ocupado" };
      return { ok: true, def: characters[requestedCharacterId] };
    }

    const existingByName = this.state.players.find((player) => player.name.toLowerCase() === trimmedName.toLowerCase());
    if (existingByName) {
      if (existingByName.connected) return { ok: false, error: "Ese personaje ya está ocupado" };
      return { ok: true, def: characters[existingByName.id] };
    }

    const byDisplayName = slots.find(
      (slot) => slot.displayName.toLowerCase() === trimmedName.toLowerCase() && !this.state.players.some((player) => player.id === slot.id)
    );
    const firstFree = slots.find((slot) => !this.state.players.some((player) => player.id === slot.id));
    const slot = byDisplayName ?? firstFree;
    if (!slot) return { ok: false, error: "La sala está llena" };
    return { ok: true, def: characters[slot.id] };
  }

  private playerFromCharacter(character: CharacterDef, socketId: string): Player {
    const defaultCosmeticIds = uniqueCosmeticIds(character.defaultLoadout?.cosmeticIds);
    const player: Player = {
      id: character.id,
      characterId: character.id,
      name: characterDisplayName(character),
      socketId,
      connected: true,
      position: 0,
      coins: 0,
      isHost: this.state.players.length === 0,
      groom: Boolean(character.groom),
      color: character.color ?? "#888888",
      ownedCosmeticIds: defaultCosmeticIds,
      cosmeticIds: defaultCosmeticIds,
    };
    if (character.facePhoto) player.facePhoto = character.facePhoto;
    if (character.facePhotoAlignment) player.facePhotoAlignment = { ...character.facePhotoAlignment };
    if (character.faceAnchors) player.faceAnchors = { ...character.faceAnchors };
    if (character.bodyAnchors) player.bodyAnchors = { ...character.bodyAnchors };
    return player;
  }

  buyCosmetic(socketId: string, cosmeticId: string): { ok: true } | { ok: false; error: string } {
    const player = this.playerBySocket(socketId);
    if (!player) return { ok: false, error: "No estás en esta sala" };
    const cosmetic = this.content.cosmetics?.[cosmeticId];
    if (!cosmetic) return { ok: false, error: "Ese cosmetic no existe" };
    if (!isCosmeticCompatibleWithCharacter(cosmetic, player.characterId ?? player.id)) {
      return { ok: false, error: "Ese cosmetic no es compatible con tu personaje" };
    }
    const owned = new Set(player.ownedCosmeticIds ?? []);
    if (owned.has(cosmeticId)) return { ok: true };
    const price = cosmeticPrice(cosmetic);
    if (player.coins < price) return { ok: false, error: "No te alcanzan las monedas" };
    player.coins -= price;
    player.ownedCosmeticIds = uniqueCosmeticIds([...(player.ownedCosmeticIds ?? []), cosmeticId]);
    this.broadcast();
    return { ok: true };
  }

  equipCosmetic(socketId: string, cosmeticId: string, equipped: boolean): { ok: true } | { ok: false; error: string } {
    const player = this.playerBySocket(socketId);
    if (!player) return { ok: false, error: "No estás en esta sala" };
    const cosmetic = this.content.cosmetics?.[cosmeticId];
    if (!cosmetic) return { ok: false, error: "Ese cosmetic no existe" };
    if (!isCosmeticCompatibleWithCharacter(cosmetic, player.characterId ?? player.id)) {
      return { ok: false, error: "Ese cosmetic no es compatible con tu personaje" };
    }
    const owned = new Set(player.ownedCosmeticIds ?? []);
    if (!owned.has(cosmeticId)) return { ok: false, error: "Primero comprá ese cosmetic" };
    const equippedIds = new Set(player.cosmeticIds ?? []);
    if (equipped) equippedIds.add(cosmeticId);
    else equippedIds.delete(cosmeticId);
    player.cosmeticIds = uniqueCosmeticIds([...equippedIds]);
    this.broadcast();
    return { ok: true };
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

    const rollResult = this.rollForPlayer(active);
    const roll = rollResult.effectiveRoll;
    this.state.lastBaseRoll = rollResult.baseRoll;
    this.state.lastRoll = roll;
    const beforeRollActions = this.applyEffectHook("beforeRoll", {
      actingPlayerId: active.id,
      landingPlayerId: active.id,
      targetPlayerId: active.id,
      roll,
    });
    const afterRollActions = this.applyEffectHook("afterRoll", {
      actingPlayerId: active.id,
      landingPlayerId: active.id,
      targetPlayerId: active.id,
      roll,
    });

    const finish = this.state.boardLength - 1;
    const movement = Math.max(0, roll);
    const beforeMovementActions = this.applyEffectHook("beforeMovement", {
      actingPlayerId: active.id,
      landingPlayerId: active.id,
      targetPlayerId: active.id,
      roll: rollResult.baseRoll,
    });
    active.position = Math.min(active.position + movement, finish);
    this.state.phase = "moving";
    this.broadcast();

    const tile = this.state.board[active.position];
    const afterMovementActions = this.applyEffectHook("afterMovement", {
      actingPlayerId: active.id,
      landingPlayerId: active.id,
      targetPlayerId: active.id,
      roll,
    });
    const cellEnterActions = this.applyEffectHook("onCellEnter", {
      actingPlayerId: active.id,
      landingPlayerId: active.id,
      targetPlayerId: active.id,
      roll,
    });
    const lifecycleActions = [...beforeRollActions, ...afterRollActions, ...beforeMovementActions, ...afterMovementActions, ...cellEnterActions];

    // Llegó al final → fin del juego.
    if (tile.type === "finish") {
      this.endGame(active.id);
      return;
    }
    this.triggerTile(tile, active, lifecycleActions);
  }

  private triggerTile(tile: Tile, active: Player, preludeActions: AppliedEventAction[] = []) {
    const event = resolveTileEventForPlayer(this.content, tile, active);
    if (event) {
      this.startEvent(event, active, preludeActions);
      return;
    }
    if (preludeActions.length) {
      this.state.activeEvent = {
        kind: "story",
        title: "Active effects",
        text: "Active effects triggered.",
        story: { title: "Active effects", prompt: "Active effects triggered." },
        playerId: active.id,
        actions: preludeActions,
      };
      this.state.phase = "event";
      this.broadcast();
      return;
    }
    // Casillero sin acción (start u otros): pasa el turno.
    this.advanceTurn();
  }

  // --- Eventos / actividades ----------------------------------------------

  private startEvent(event: ResolvedGameEvent, active: Player, preludeActions: AppliedEventAction[] = []) {
    this.pendingEvent = event;
    const activity = event.activity;
    if (!activity) {
      const actions = this.applyActions(event.actions ?? [], {
        landingPlayerId: active.id,
        actingPlayerId: active.id,
        targetPlayerId: active.id,
        ranking: [active.id],
      });
      this.state.activeEvent = {
        id: event.id,
        kind: event.kind ?? "story",
        title: event.story.title ?? eventTitle(event),
        text: eventText(event),
        story: event.story,
        playerId: active.id,
        actions: [...preludeActions, ...actions],
      };
      this.state.phase = "event";
      this.broadcast();
      return;
    }
    this.pendingActivityPreludeActions = preludeActions;
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
    if (data !== null && typeof data === "object") {
      try {
        if (JSON.stringify(data).length > 2048) return;
      } catch {
        return;
      }
    }
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
    if (typeof result.score !== "number" || !Number.isFinite(result.score)) return;

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

  debugApplyEffect(socketId: string, payload: { playerId?: unknown; effectId?: unknown; effect?: unknown }) {
    const host = this.playerBySocket(socketId);
    if (!host?.isHost) return;
    const playerId = typeof payload.playerId === "string" ? payload.playerId : "";
    const effectId = typeof payload.effectId === "string" ? payload.effectId : "";
    if (!this.state.players.some((player) => player.id === playerId)) return;
    const effect = debugEffectFromPayload(payload.effect, effectId) ?? this.content.effects?.[effectId];
    if (!effect) return;
    this.attachEffectToTargets(effect, [playerId], { sourcePlayerId: host.id });
    this.broadcast();
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
      const activityResultActions = this.applyEffectHook("onActivityResult", {
        actingPlayerId: landingPlayerId,
        landingPlayerId,
        targetPlayerId: landingPlayerId,
        ranking: reveal.ranking,
      });
      const actions = event
        ? [
            ...this.pendingActivityPreludeActions,
            ...activityResultActions,
            ...(mg.type === "prompt" && promptConfirmed
              ? this.applyActions(event.actions ?? [], {
                  landingPlayerId,
                  actingPlayerId: landingPlayerId,
                  targetPlayerId: landingPlayerId,
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
      this.pendingActivityPreludeActions = [];
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
    const endingPlayerId = this.activePlayer()?.id;
    const turnEndActions = endingPlayerId
      ? this.applyEffectHook("onTurnEnd", {
          actingPlayerId: endingPlayerId,
          landingPlayerId: endingPlayerId,
          targetPlayerId: endingPlayerId,
        })
      : [];

    this.state.reveal = null;
    this.state.activeEvent = turnEndActions.length
      ? {
          kind: "story",
          title: "Active effects",
          text: "Active effects triggered.",
          story: { title: "Active effects", prompt: "Active effects triggered." },
          playerId: endingPlayerId ?? this.state.players[0]?.id ?? "",
          actions: turnEndActions,
        }
      : null;
    this.pendingEvent = null;
    this.state.lastBaseRoll = null;
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
        if (endingPlayerId) this.tickEffectDurations(endingPlayerId, false);
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
    if (endingPlayerId) this.tickEffectDurations(endingPlayerId, advancedRound);
    this.state.activeIndex = nextIndex;
    this.state.phase = turnEndActions.length ? "event" : "turn";
    this.broadcast();
  }

  private applyOutcomeActions(branches: EventOutcomeBranch[], ranking: string[], landingPlayerId?: string): AppliedEventAction[] {
    const actions: AppliedEventAction[] = [];
    for (const branch of branches) {
      if (!this.targetPlayerIds(branch.when, { ranking, landingPlayerId }).length) continue;
      actions.push(
        ...this.applyActions(branch.actions, {
          landingPlayerId,
          actingPlayerId: landingPlayerId,
          targetPlayerId: landingPlayerId,
          ranking,
          defaultTarget: branch.when,
        })
      );
    }
    return actions;
  }

  private applyActions(
    actions: EventAction[],
    context: {
      landingPlayerId?: string;
      actingPlayerId?: string;
      targetPlayerId?: string;
      ranking?: string[];
      defaultTarget?: EventActionTarget;
    },
    options: { fromEffect?: boolean } = {}
  ): AppliedEventAction[] {
    const applied: AppliedEventAction[] = [];
    for (const action of actions) {
      const target = action.target ?? context.defaultTarget ?? "landing";
      const targetPlayerIds = this.targetPlayerIds(target, context);
      if (action.type !== "text" && targetPlayerIds.length === 0) continue;
      applied.push(this.applyAction(action, targetPlayerIds, context, options));
    }
    return applied;
  }

  private applyAction(
    action: EventAction,
    targetPlayerIds: string[],
    context: { landingPlayerId?: string; actingPlayerId?: string; targetPlayerId?: string } = {},
    options: { fromEffect?: boolean } = {}
  ): AppliedEventAction {
    if (!options.fromEffect && shouldAttachConsequence(action)) {
      const effectInstanceIds = this.applyTimedConsequenceToTargets(action, targetPlayerIds, {
        sourcePlayerId: context.actingPlayerId ?? context.landingPlayerId,
      });
      return {
        type: action.type,
        targetPlayerIds,
        text: action.text ?? `${namesFor(targetPlayerIds, this.state.players)} receives ${consequenceLabel(action)}`,
        effectInstanceIds,
      };
    }
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
    if (action.type === "extraTurn") {
      this.extraTurnPlayerId = targetPlayerIds[0] ?? this.extraTurnPlayerId;
      return { type: action.type, targetPlayerIds, text: action.text ?? `${namesFor(targetPlayerIds, this.state.players)} juega otro turno` };
    }
    if (action.type === "offlineAction") {
      return {
        type: action.type,
        targetPlayerIds,
        text: action.text ?? `${namesFor(targetPlayerIds, this.state.players)}: ${consequenceLabel(action)}`,
        offlineAction: action.action,
        requiresConfirmation: true,
      };
    }
    if (action.type === "halfMovement") {
      return {
        type: action.type,
        targetPlayerIds,
        text: action.text ?? `${namesFor(targetPlayerIds, this.state.players)} moves half of the die roll`,
      };
    }
    if (action.type === "movementMultiplier") {
      return {
        type: action.type,
        targetPlayerIds,
        text: action.text ?? `${namesFor(targetPlayerIds, this.state.players)} movement x${formatNumber(action.multiplier)}`,
      };
    }
    if (action.type === "diceBias") {
      return {
        type: action.type,
        targetPlayerIds,
        text: action.text ?? `${namesFor(targetPlayerIds, this.state.players)} has ${formatSigned(action.chanceDeltaPercent)}% chance for ${action.face}`,
      };
    }
    if (action.type === "swapPositions") {
      return this.applySwapPositions(action, targetPlayerIds, context);
    }
    if (action.type === "moveToNearest") {
      return this.applyMoveToNearest(action, targetPlayerIds, context);
    }
    const effectInstanceIds = this.applyEffectToTargets(action.effectId, targetPlayerIds, {
      sourcePlayerId: context.actingPlayerId ?? context.landingPlayerId,
      duration: action.duration,
    });
    return {
      type: action.type,
      targetPlayerIds,
      text: action.text ?? `${namesFor(targetPlayerIds, this.state.players)} receives ${this.content.effects?.[action.effectId]?.name ?? action.effectId}`,
      effectId: action.effectId,
      effectInstanceIds,
    };
  }

  private targetPlayerIds(
    target: EventActionTarget,
    context: { landingPlayerId?: string; actingPlayerId?: string; targetPlayerId?: string; ranking?: string[] }
  ): string[] {
    return resolveEventActionTargetIds(target, {
      landingPlayerId: context.landingPlayerId,
      actingPlayerId: context.actingPlayerId,
      targetPlayerId: context.targetPlayerId,
      ranking: context.ranking,
      connectedPlayerIds: this.connectedPlayers().map((p) => p.id),
      playerIds: this.state.players.map((p) => p.id),
      players: this.state.players,
    });
  }

  private applySwapPositions(
    action: Extract<EventAction, { type: "swapPositions" }>,
    targetPlayerIds: string[],
    context: { landingPlayerId?: string; actingPlayerId?: string; targetPlayerId?: string; ranking?: string[] }
  ): AppliedEventAction {
    const swapped: string[] = [];
    for (const id of targetPlayerIds) {
      const target = this.state.players.find((player) => player.id === id);
      const otherId = this.targetPlayerIds(action.withTarget, { ...context, targetPlayerId: id }).find((candidate) => candidate !== id);
      const other = otherId ? this.state.players.find((player) => player.id === otherId) : undefined;
      if (!target || !other) continue;
      const targetPosition = target.position;
      target.position = other.position;
      other.position = targetPosition;
      swapped.push(target.id, other.id);
    }
    this.recordFinishWinner(swapped);
    return {
      type: action.type,
      targetPlayerIds: swapped,
      text: action.text ?? `${namesFor(swapped, this.state.players)} intercambian posiciones`,
    };
  }

  private applyMoveToNearest(
    action: Extract<EventAction, { type: "moveToNearest" }>,
    targetPlayerIds: string[],
    context: { landingPlayerId?: string; actingPlayerId?: string; targetPlayerId?: string; ranking?: string[] }
  ): AppliedEventAction {
    const moved: string[] = [];
    let tileId: number | undefined;
    for (const id of targetPlayerIds) {
      const player = this.state.players.find((candidate) => candidate.id === id);
      const nearestId = this.targetPlayerIds({ nearest: action.direction, from: "target" }, { ...context, targetPlayerId: id })[0];
      const nearest = nearestId ? this.state.players.find((candidate) => candidate.id === nearestId) : undefined;
      if (!player || !nearest) continue;
      player.position = nearest.position;
      tileId = player.position;
      moved.push(player.id);
    }
    this.recordFinishWinner(moved);
    return {
      type: action.type,
      targetPlayerIds: moved,
      text: action.text ?? `${namesFor(moved, this.state.players)} se mueve al jugador más cercano ${action.direction === "ahead" ? "adelante" : "atrás"}`,
      ...(tileId !== undefined ? { tileId } : {}),
    };
  }

  private applyEffectToTargets(
    effectId: string,
    targetPlayerIds: string[],
    options: { sourcePlayerId?: string; duration?: EffectDuration } = {}
  ): string[] {
    const effect = this.content.effects?.[effectId];
    if (!effect) return [];
    return this.attachEffectToTargets(effect, targetPlayerIds, options);
  }

  private applyTimedConsequenceToTargets(
    action: EventAction,
    targetPlayerIds: string[],
    options: { sourcePlayerId?: string } = {}
  ): string[] {
    const effect = timedConsequenceEffectDef(action, `action-${action.type}`);
    return this.attachEffectToTargets(effect, targetPlayerIds, options);
  }

  private attachEffectToTargets(
    effect: NonNullable<GameContent["effects"]>[string],
    targetPlayerIds: string[],
    options: { sourcePlayerId?: string; duration?: EffectDuration } = {}
  ): string[] {
    const instanceIds: string[] = [];
    for (const targetPlayerId of targetPlayerIds) {
      const instance: EffectInstance = {
        id: `${effect.id}-${this.nextEffectInstanceId++}`,
        effectId: effect.id,
        name: effect.name,
        description: effect.description,
        sourcePlayerId: options.sourcePlayerId,
        targetPlayerId,
        remaining: durationStateFromDef(options.duration ?? effect.duration),
        hooks: effectHooksFor(effect),
        consequences: effectConsequencesFor(effect),
        icon: effect.icon,
        visualAssetId: effect.visualAssetId,
        startedRound: this.state.round,
        startedTurnId: this.activePlayer()?.id,
      };
      this.state.activeEffects.push(instance);
      instanceIds.push(instance.id);
    }
    return instanceIds;
  }

  private rollForPlayer(active: Player): { baseRoll: number; effectiveRoll: number } {
    const weights = [1, 1, 1, 1, 1, 1];
    for (const instance of this.state.activeEffects) {
      if (instance.targetPlayerId !== active.id) continue;
      for (const action of instance.consequences) {
        if (action.type !== "diceBias") continue;
        if (!consequenceMatchesHook(action, { hook: "beforeRoll", phase: this.state.phase })) continue;
        applyDiceBias(weights, action.face, action.chanceDeltaPercent);
      }
    }
    const baseRoll = rollWeightedDie(weights);
    return { baseRoll, effectiveRoll: this.applyRollMovementModifiers(active, baseRoll) };
  }

  private applyRollMovementModifiers(active: Player, roll: number): number {
    let modifiedRoll = roll;
    for (const instance of this.state.activeEffects) {
      if (instance.targetPlayerId !== active.id) continue;
      for (const action of instance.consequences) {
        if (!consequenceMatchesHook(action, { hook: "beforeMovement", roll, phase: this.state.phase })) continue;
        if (action.type === "halfMovement") modifiedRoll = halfMovement(modifiedRoll, action.rounding);
        if (action.type === "movementMultiplier") modifiedRoll = applyMovementMultiplier(modifiedRoll, action.multiplier, action.rounding);
      }
    }
    return Math.max(0, modifiedRoll);
  }

  private applyEffectHook(
    hook: EffectLifecycleHook,
    context: {
      landingPlayerId?: string;
      actingPlayerId?: string;
      targetPlayerId?: string;
      ranking?: string[];
      roll?: number;
    }
  ): AppliedEventAction[] {
    const applied: AppliedEventAction[] = [];
    const expired = new Map<string, "expired" | "triggered">();
    for (const instance of [...this.state.activeEffects]) {
      if (!instance.hooks.includes(hook)) continue;
      const targetPlayer = this.state.players.find((player) => player.id === instance.targetPlayerId);
      if (!targetPlayer) continue;
      let triggered = false;
      const hookContext = {
        ...context,
        targetPlayerId: instance.targetPlayerId,
      };
      for (const action of instance.consequences) {
        if (!consequenceMatchesHook(action, { hook, roll: context.roll, phase: this.state.phase })) continue;
        triggered = true;
        applied.push(
          ...this.applyActions([action], {
            ...hookContext,
            defaultTarget: "target",
          }, { fromEffect: true })
        );
        if (action.expiresOnTrigger || instance.remaining.mode === "untilTriggered") expired.set(instance.id, "triggered");
      }
      if (triggered && instance.remaining.mode === "uses") {
        instance.remaining = { ...instance.remaining, remaining: instance.remaining.remaining - 1 };
        if (instance.remaining.remaining <= 0) expired.set(instance.id, "triggered");
      }
    }
    for (const [id, reason] of expired) this.expireEffect(id, reason);
    return applied;
  }

  private tickEffectDurations(endingPlayerId: string, advancedRound: boolean) {
    for (const instance of [...this.state.activeEffects]) {
      if (instance.remaining.mode === "game" || instance.remaining.mode === "untilTriggered") continue;
      if (instance.remaining.mode === "turns") {
        if (instance.targetPlayerId !== endingPlayerId) continue;
        if (instance.startedRound === this.state.round && instance.startedTurnId === endingPlayerId) continue;
        instance.remaining = { ...instance.remaining, remaining: instance.remaining.remaining - 1 };
      }
      if (instance.remaining.mode === "rounds") {
        if (!advancedRound) continue;
        if (instance.startedRound === this.state.round) continue;
        instance.remaining = { ...instance.remaining, remaining: instance.remaining.remaining - 1 };
      }
      if ("remaining" in instance.remaining && instance.remaining.remaining <= 0) {
        this.expireEffect(instance.id, "expired");
      }
    }
  }

  private expireEffect(instanceId: string, reason: "expired" | "triggered") {
    const instance = this.state.activeEffects.find((effect) => effect.id === instanceId);
    if (!instance) return;
    this.state.activeEffects = this.state.activeEffects.filter((effect) => effect.id !== instanceId);
    this.io.to(this.code).emit("effect:ended", { effectInstance: instance, reason });
  }

  private effectTargetName(instance: EffectInstance): string {
    return this.state.players.find((player) => player.id === instance.targetPlayerId)?.name ?? instance.targetPlayerId;
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

function halfMovement(value: number, rounding: "floor" | "ceil" | "round" = "ceil"): number {
  const half = value / 2;
  if (rounding === "floor") return Math.floor(half);
  if (rounding === "round") return Math.round(half);
  return Math.ceil(half);
}

function applyMovementMultiplier(value: number, multiplier: number, rounding: "floor" | "ceil" | "round" = "round"): number {
  const next = value * multiplier;
  if (rounding === "floor") return Math.floor(next);
  if (rounding === "ceil") return Math.ceil(next);
  return Math.round(next);
}

function applyDiceBias(weights: number[], face: number, chanceDeltaPercent: number) {
  const index = clamp(Math.round(face), 1, weights.length) - 1;
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return;
  const delta = clamp(chanceDeltaPercent / 100, -1, 1);
  const currentProbability = weights[index] / total;
  const nextProbability = clamp(currentProbability + delta, 0, 1);
  const otherTotal = total - weights[index];
  weights[index] = nextProbability;
  if (otherTotal <= 0) return;
  const remainingProbability = 1 - nextProbability;
  for (let i = 0; i < weights.length; i += 1) {
    if (i === index) continue;
    weights[i] = (weights[i] / otherTotal) * remainingProbability;
  }
}

function rollWeightedDie(weights: number[]): number {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total <= 0) return 1 + Math.floor(Math.random() * 6);
  const value = Math.random() * total;
  let cursor = 0;
  for (let index = 0; index < weights.length; index += 1) {
    cursor += Math.max(0, weights[index]);
    if (value < cursor) return index + 1;
  }
  return weights.length;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatNumber(value)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function debugEffectFromPayload(value: unknown, effectId: string): EffectDef | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : effectId;
  if (!id || id !== effectId) return null;
  const duration = debugDurationFromPayload(value.duration);
  if (!duration) return null;

  const effect: EffectDef = {
    id,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : id,
    duration,
  };
  if (typeof value.description === "string" && value.description.trim()) effect.description = value.description.trim();
  if (typeof value.icon === "string" && value.icon.trim()) effect.icon = value.icon.trim();
  if (typeof value.visualAssetId === "string" && value.visualAssetId.trim()) effect.visualAssetId = value.visualAssetId.trim();
  if (Array.isArray(value.consequences)) effect.consequences = value.consequences.filter(isRecord) as EventAction[];
  if (Array.isArray(value.actions)) effect.actions = value.actions.filter(isRecord) as EventAction[];
  if (Array.isArray(value.modifiers)) effect.modifiers = value.modifiers.filter(isRecord) as EffectDef["modifiers"];
  if (!effect.consequences?.length && !effect.actions?.length && !effect.modifiers?.length) return null;
  return effect;
}

function debugDurationFromPayload(value: unknown): EffectDuration | null {
  if (!isRecord(value) || typeof value.mode !== "string") return null;
  if (value.mode === "game" || value.mode === "untilTriggered") return { mode: value.mode };
  if (value.mode !== "turns" && value.mode !== "rounds" && value.mode !== "uses") return null;
  const count = typeof value.value === "number" ? value.value : 1;
  if (!Number.isFinite(count)) return null;
  return { mode: value.mode, value: Math.max(1, Math.round(count)) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
