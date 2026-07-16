import type {
  ConsequenceRule,
  EffectConsequenceDef,
  EffectDurationState,
  EffectLifecycleHook,
  EventAction,
  EventActionTarget,
  EventActivityType,
  GameContent,
  MapDefinition,
  Tile,
} from "@essence/shared";
import {
  consequenceMatchesHook,
  durationStateFromDef,
  effectConsequencesFor,
  effectHooksFor,
  resolveTargetPlayerIds,
} from "@essence/shared/consequences";
import {
  eventIdsForTile,
  sharedEventIdsForTile,
  eventTitle,
  normalizeGameContentEvents,
  rankingPayoutConsequencesFor,
  resolveActivityParticipantIds,
  resolveActivitySubjectIds,
  TileEventQueue,
  type ResolvedGameEvent,
} from "@essence/shared/events";

export interface MapSimulationConfig {
  playerCount: number;
  games: number;
  seed: number;
  includeTraits: boolean;
  maxTurnsPerGame?: number;
  traceLimit?: number;
}

export interface SimulationPlayerLanding {
  playerId: string;
  playerName: string;
  landings: number;
}

export interface SimulationCellStats {
  boardIndex: number;
  tileId: number;
  label: string;
  type: Tile["type"];
  landings: number;
  landingsPerGame: number;
  landingRate: number;
  gamesReached: number;
  gameReachRate: number;
  passThroughs: number;
  shopStops: number;
  eventTriggers: number;
  consequenceArrivals: number;
  eventCount: number;
  byPlayer: SimulationPlayerLanding[];
}

export interface SimulationTraceEntry {
  turn: number;
  round: number;
  playerId: string;
  playerName: string;
  fromIndex: number;
  baseRoll: number;
  effectiveRoll: number;
  intendedIndex: number;
  landedIndex: number;
  finalIndex: number;
  tileId: number;
  tileType: Tile["type"];
  shopInterrupted: boolean;
  eventId?: string;
  activityType?: EventActivityType;
  effects: string[];
}

export interface MapSimulationResult {
  config: Required<MapSimulationConfig>;
  map: { id: string; name: string; cellCount: number };
  roster: { id: string; name: string }[];
  summary: {
    games: number;
    completedGames: number;
    cappedGames: number;
    players: number;
    totalTurns: number;
    totalRolls: number;
    totalLandings: number;
    finishedGames: number;
    completionRate: number;
    averageTurnsPerGame: number;
    averageRoundsPerGame: number;
    runtimeMs: number;
  };
  cells: SimulationCellStats[];
  activityTypes: { activityType: EventActivityType; triggers: number }[];
  events: { eventId: string; name: string; activityType: EventActivityType; triggers: number }[];
  dice: { baseRolls: Record<string, number>; effectiveRolls: Record<string, number> };
  winners: { playerId: string; playerName: string; wins: number }[];
  sampleTrace: SimulationTraceEntry[];
  diagnostics: string[];
  assumptions: string[];
}

interface SimulationPlayer {
  id: string;
  name: string;
  position: number;
  coins: number;
  connected: true;
  isHost: boolean;
  rollHistory: number[];
  movementHistory: number[];
}

interface SimulationEffect {
  id: string;
  effectId: string;
  name: string;
  targetPlayerId: string;
  remaining: EffectDurationState;
  hooks: EffectLifecycleHook[];
  consequences: EffectConsequenceDef[];
  startedRound: number;
  startedTurnId?: string;
}

interface MutableCellStats {
  boardIndex: number;
  tile: Tile;
  landings: number;
  reachedGames: Set<number>;
  passThroughs: number;
  shopStops: number;
  eventTriggers: number;
  consequenceArrivals: number;
  eventCount: number;
  byPlayer: Map<string, number>;
}

interface ActionContext {
  landingPlayerId?: string;
  actingPlayerId?: string;
  targetPlayerId?: string;
  ranking?: string[];
  defaultTarget?: EventActionTarget;
}

interface HookContext extends ActionContext {
  activityType?: EventActivityType;
  roll?: number;
  movement?: number;
  cell?: Tile;
  phase?: string;
}

interface RunState {
  content: GameContent;
  map: MapDefinition;
  gameIndex: number;
  players: SimulationPlayer[];
  turnOrder: string[];
  activeIndex: number;
  round: number;
  turns: number;
  winnerId?: string;
  extraTurnPlayerId?: string;
  skippedTurns: Map<string, number>;
  effects: SimulationEffect[];
  nextEffectId: number;
  queue: TileEventQueue;
  random: () => number;
  cells: MutableCellStats[];
  activityCounts: Map<EventActivityType, number>;
  eventCounts: Map<string, { name: string; activityType: EventActivityType; triggers: number }>;
  baseRolls: Record<string, number>;
  effectiveRolls: Record<string, number>;
  trace?: SimulationTraceEntry[];
  traceLimit: number;
  missingEffects: Set<string>;
  unresolvedEventLandings: number;
  offlineActions: number;
}

const MAX_PLAYERS = 12;
const MAX_GAMES = 100_000;

export function simulateMapGames(content: GameContent, map: MapDefinition, requested: MapSimulationConfig): MapSimulationResult {
  if (!map.board.length) throw new Error("The selected map has no cells to simulate.");
  const startedAt = now();
  const config = normalizeConfig(requested, map.board.length);
  const normalizedContent = normalizeGameContentEvents({ ...content, board: map.board, activeMapId: map.id });
  const roster = buildRoster(normalizedContent, config.playerCount);
  const cells = map.board.map<MutableCellStats>((tile, boardIndex) => ({
    boardIndex,
    tile,
    landings: 0,
    reachedGames: new Set(),
    passThroughs: 0,
    shopStops: 0,
    eventTriggers: 0,
    consequenceArrivals: 0,
    eventCount: new Set([...eventIdsForTile(tile), ...sharedEventIdsForTile(normalizedContent, tile)]).size,
    byPlayer: new Map(),
  }));
  const activityCounts = new Map<EventActivityType, number>();
  const eventCounts = new Map<string, { name: string; activityType: EventActivityType; triggers: number }>();
  const baseRolls = emptyDieHistogram();
  const effectiveRolls = emptyDieHistogram();
  const winners = new Map<string, number>();
  const missingEffects = new Set<string>();
  const sampleTrace: SimulationTraceEntry[] = [];
  let totalTurns = 0;
  let totalLandings = 0;
  let totalRounds = 0;
  let finishedGames = 0;
  let cappedGames = 0;
  let unresolvedEventLandings = 0;
  let offlineActions = 0;

  for (let gameIndex = 0; gameIndex < config.games; gameIndex += 1) {
    const state = createRunState({
      content: normalizedContent,
      map,
      gameIndex,
      roster,
      cells,
      activityCounts,
      eventCounts,
      baseRolls,
      effectiveRolls,
      missingEffects,
      random: mulberry32(mixSeed(config.seed, gameIndex)),
      trace: gameIndex === 0 ? sampleTrace : undefined,
      traceLimit: config.traceLimit,
    });
    if (config.includeTraits) attachCharacterTraits(state);

    while (!state.winnerId && state.turns < config.maxTurnsPerGame) runTurn(state);

    totalTurns += state.turns;
    totalLandings += state.turns;
    totalRounds += state.round;
    unresolvedEventLandings += state.unresolvedEventLandings;
    offlineActions += state.offlineActions;
    if (state.winnerId) {
      finishedGames += 1;
      winners.set(state.winnerId, (winners.get(state.winnerId) ?? 0) + 1);
    } else {
      cappedGames += 1;
    }
  }

  const diagnostics = buildDiagnostics({
    content: normalizedContent,
    map,
    cappedGames,
    unresolvedEventLandings,
    missingEffects,
  });
  const totalRolls = Object.values(baseRolls).reduce((sum, count) => sum + count, 0);
  return {
    config,
    map: { id: map.id, name: map.name, cellCount: map.board.length },
    roster,
    summary: {
      games: config.games,
      completedGames: finishedGames,
      cappedGames,
      players: roster.length,
      totalTurns,
      totalRolls,
      totalLandings,
      finishedGames,
      completionRate: config.games ? finishedGames / config.games : 0,
      averageTurnsPerGame: config.games ? totalTurns / config.games : 0,
      averageRoundsPerGame: config.games ? totalRounds / config.games : 0,
      runtimeMs: now() - startedAt,
    },
    cells: cells.map((cell) => ({
      boardIndex: cell.boardIndex,
      tileId: cell.tile.id,
      label: cell.tile.label ?? "",
      type: cell.tile.type,
      landings: cell.landings,
      landingsPerGame: config.games ? cell.landings / config.games : 0,
      landingRate: totalLandings ? cell.landings / totalLandings : 0,
      gamesReached: cell.reachedGames.size,
      gameReachRate: config.games ? cell.reachedGames.size / config.games : 0,
      passThroughs: cell.passThroughs,
      shopStops: cell.shopStops,
      eventTriggers: cell.eventTriggers,
      consequenceArrivals: cell.consequenceArrivals,
      eventCount: cell.eventCount,
      byPlayer: roster.map((player) => ({
        playerId: player.id,
        playerName: player.name,
        landings: cell.byPlayer.get(player.id) ?? 0,
      })),
    })),
    activityTypes: [...activityCounts].map(([activityType, triggers]) => ({ activityType, triggers })),
    events: [...eventCounts].map(([eventId, event]) => ({ eventId, ...event })),
    dice: { baseRolls, effectiveRolls },
    winners: roster.map((player) => ({ playerId: player.id, playerName: player.name, wins: winners.get(player.id) ?? 0 })),
    sampleTrace,
    diagnostics,
    assumptions: [
      "The runtime path is the board array order. Visual routes and forks do not change movement.",
      "Minigames are skipped and their result is modeled as a seeded, uniformly shuffled ranking of eligible subjects.",
      "Shops stop movement and are counted, but simulated players do not buy artifacts.",
      "Local and shared activity queues use the same room-wide no-repeat resolver as a real game.",
      "Immediate movement, coin, skip-turn, extra-turn, player-position and active-effect consequences are applied.",
      "Consequence movement changes occupancy but does not trigger the destination cell, matching the current runtime.",
      `Character traits are ${config.includeTraits ? "enabled for roster characters" : "disabled"}.`,
      ...(config.playerCount > normalizedContent.players.length
        ? [`${config.playerCount - normalizedContent.players.length} players use generic simulation profiles because the content roster is smaller.`]
        : []),
      ...(offlineActions ? [`${offlineActions} offline/drinking actions were logged but have no numerical simulation effect.`] : []),
    ],
  };
}

function normalizeConfig(config: MapSimulationConfig, boardLength: number): Required<MapSimulationConfig> {
  const playerCount = clampInteger(config.playerCount, 1, MAX_PLAYERS);
  const games = clampInteger(config.games, 1, MAX_GAMES);
  return {
    playerCount,
    games,
    seed: Number.isFinite(config.seed) ? Math.round(config.seed) : 1,
    includeTraits: Boolean(config.includeTraits),
    maxTurnsPerGame: clampInteger(config.maxTurnsPerGame ?? Math.max(100, boardLength * playerCount * 8), 1, 1_000_000),
    traceLimit: clampInteger(config.traceLimit ?? 80, 0, 1_000),
  };
}

function buildRoster(content: GameContent, playerCount: number): { id: string; name: string }[] {
  const authored = content.players.slice(0, playerCount).map((player) => ({ id: player.id, name: player.name }));
  for (let index = authored.length; index < playerCount; index += 1) {
    authored.push({ id: `simulation-player-${index + 1}`, name: `Player ${index + 1}` });
  }
  return authored;
}

function createRunState(options: {
  content: GameContent;
  map: MapDefinition;
  gameIndex: number;
  roster: { id: string; name: string }[];
  cells: MutableCellStats[];
  activityCounts: Map<EventActivityType, number>;
  eventCounts: Map<string, { name: string; activityType: EventActivityType; triggers: number }>;
  baseRolls: Record<string, number>;
  effectiveRolls: Record<string, number>;
  missingEffects: Set<string>;
  random: () => number;
  trace?: SimulationTraceEntry[];
  traceLimit: number;
}): RunState {
  const players = options.roster.map<SimulationPlayer>((player, index) => ({
    ...player,
    position: 0,
    coins: 0,
    connected: true,
    isHost: index === 0,
    rollHistory: [],
    movementHistory: [],
  }));
  return {
    ...options,
    players,
    turnOrder: players.map((player) => player.id),
    activeIndex: 0,
    round: 1,
    turns: 0,
    skippedTurns: new Map(),
    effects: [],
    nextEffectId: 1,
    queue: new TileEventQueue(),
    unresolvedEventLandings: 0,
    offlineActions: 0,
  };
}

function runTurn(state: RunState) {
  const active = state.players.find((player) => player.id === state.turnOrder[state.activeIndex]);
  if (!active) return;
  const traceEffects: string[] | undefined = state.trace && state.trace.length < state.traceLimit ? [] : undefined;
  applyEffectHook(state, "onTurnStart", { actingPlayerId: active.id, landingPlayerId: active.id, targetPlayerId: active.id, phase: "turn" }, traceEffects);

  const weights = [1, 1, 1, 1, 1, 1];
  for (const effect of state.effects) {
    if (effect.targetPlayerId !== active.id) continue;
    for (const action of effect.consequences) {
      if (action.type !== "diceBias") continue;
      if (!consequenceMatchesHook(action, { hook: "beforeRoll", phase: "turn" })) continue;
      applyDiceBias(weights, action.face, action.chanceDeltaPercent);
    }
  }
  const baseRoll = rollWeightedDie(weights, state.random);
  const effectiveRoll = applyMovementModifiers(state, active, baseRoll);
  incrementHistogram(state.baseRolls, baseRoll);
  incrementHistogram(state.effectiveRolls, effectiveRoll);

  applyEffectHook(state, "beforeRoll", {
    actingPlayerId: active.id,
    landingPlayerId: active.id,
    targetPlayerId: active.id,
    roll: effectiveRoll,
    phase: "turn",
  }, traceEffects);
  recordHistory(active.rollHistory, baseRoll);
  applyEffectHook(state, "afterRoll", {
    actingPlayerId: active.id,
    landingPlayerId: active.id,
    targetPlayerId: active.id,
    roll: baseRoll,
    phase: "turn",
  }, traceEffects);
  applyEffectHook(state, "beforeMovement", {
    actingPlayerId: active.id,
    landingPlayerId: active.id,
    targetPlayerId: active.id,
    roll: baseRoll,
    phase: "turn",
  }, traceEffects);

  const finish = state.map.board.length - 1;
  const fromIndex = clampInteger(active.position, 0, finish);
  const intendedIndex = Math.min(fromIndex + Math.max(0, effectiveRoll), finish);
  const shopIndex = firstShopIndex(state.map.board, fromIndex, intendedIndex);
  const landedIndex = shopIndex ?? intendedIndex;
  for (let index = fromIndex + 1; index < landedIndex; index += 1) state.cells[index].passThroughs += 1;
  active.position = landedIndex;
  const movement = Math.max(0, landedIndex - fromIndex);
  recordHistory(active.movementHistory, movement);
  state.turns += 1;
  const landedCell = state.cells[landedIndex];
  landedCell.landings += 1;
  landedCell.reachedGames.add(state.gameIndex);
  landedCell.byPlayer.set(active.id, (landedCell.byPlayer.get(active.id) ?? 0) + 1);
  if (shopIndex !== null) landedCell.shopStops += 1;
  const tile = landedCell.tile;

  applyEffectHook(state, "afterMovement", {
    actingPlayerId: active.id,
    landingPlayerId: active.id,
    targetPlayerId: active.id,
    roll: effectiveRoll,
    movement,
    cell: tile,
    phase: "moving",
  }, traceEffects);
  applyEffectHook(state, "onCellEnter", {
    actingPlayerId: active.id,
    landingPlayerId: active.id,
    targetPlayerId: active.id,
    roll: effectiveRoll,
    movement,
    cell: tile,
    phase: "moving",
  }, traceEffects);

  let eventId: string | undefined;
  let activityType: EventActivityType | undefined;
  if (tile.type === "finish") {
    state.winnerId = active.id;
  } else if (tile.type !== "shop") {
    const event = state.queue.resolve(state.content, tile, { id: active.id }, state.random);
    if (event) {
      eventId = event.id;
      activityType = event.activity?.type ?? "prompt";
      resolveSimulatedEvent(state, event, active, activityType, landedIndex, traceEffects);
    } else if (eventIdsForTile(tile).length) {
      state.unresolvedEventLandings += 1;
    }
  }

  if (!state.winnerId) {
    applyEffectHook(state, "onTurnEnd", {
      actingPlayerId: active.id,
      landingPlayerId: active.id,
      targetPlayerId: active.id,
      roll: baseRoll,
      movement,
      phase: "event",
    }, traceEffects);
  }

  if (state.trace && state.trace.length < state.traceLimit) {
    state.trace.push({
      turn: state.turns,
      round: state.round,
      playerId: active.id,
      playerName: active.name,
      fromIndex,
      baseRoll,
      effectiveRoll,
      intendedIndex,
      landedIndex,
      finalIndex: active.position,
      tileId: tile.id,
      tileType: tile.type,
      shopInterrupted: shopIndex !== null,
      eventId,
      activityType,
      effects: traceEffects ?? [],
    });
  }

  if (!state.winnerId) advanceTurn(state, active.id);
}

function resolveSimulatedEvent(
  state: RunState,
  event: ResolvedGameEvent,
  active: SimulationPlayer,
  activityType: EventActivityType,
  landedIndex: number,
  trace?: string[]
) {
  const cell = state.cells[landedIndex];
  cell.eventTriggers += 1;
  state.activityCounts.set(activityType, (state.activityCounts.get(activityType) ?? 0) + 1);
  const eventStats = state.eventCounts.get(event.id) ?? { name: eventTitle(event), activityType, triggers: 0 };
  eventStats.triggers += 1;
  state.eventCounts.set(event.id, eventStats);

  const ranking = simulatedRanking(state, event, active);
  if (activityType !== "prompt") {
    const authored = rankingPayoutConsequencesFor(event.activity?.rankingPayout);
    const payout = authored.length ? authored : legacyRankingPayout(state.content, ranking.length);
    applyRules(state, payout, ranking, active.id, trace);
  }
  applyEffectHook(state, "onActivityResult", {
    actingPlayerId: active.id,
    landingPlayerId: active.id,
    ranking,
    activityType,
    phase: "minigame",
  }, trace);
  applyRules(state, event.consequences ?? [], ranking, active.id, trace);
}

function simulatedRanking(state: RunState, event: ResolvedGameEvent, active: SimulationPlayer): string[] {
  if (!event.activity || event.activity.type === "prompt") return [active.id];
  const activityPlayers = state.players.map((player) => ({ id: player.id, isHost: player.isHost }));
  const participants = resolveActivityParticipantIds(event.activity, activityPlayers, active);
  const subjects = resolveActivitySubjectIds(event.activity, activityPlayers, active, participants);
  const ranking = shuffle(subjects.length ? subjects : [active.id], state.random);
  const winners = new Set(event.activity.rigged?.winners ?? []);
  const losers = new Set(event.activity.rigged?.losers ?? []);
  return [
    ...ranking.filter((id) => winners.has(id) && !losers.has(id)),
    ...ranking.filter((id) => !winners.has(id) && !losers.has(id)),
    ...ranking.filter((id) => losers.has(id)),
  ];
}

function legacyRankingPayout(content: GameContent, rankingLength: number): ConsequenceRule[] {
  const payouts = content.coinPayout ?? [10, 7, 5, 3, 2, 1, 0];
  return payouts.slice(0, rankingLength).flatMap((value, index) =>
    value ? [{ appliesTo: { rank: index + 1 }, actions: [{ type: "coins", value }] }] : []
  );
}

function applyRules(state: RunState, rules: ConsequenceRule[], ranking: string[], landingPlayerId: string, trace?: string[]) {
  for (const rule of rules) {
    const context: ActionContext = {
      ranking,
      landingPlayerId,
      actingPlayerId: landingPlayerId,
      targetPlayerId: landingPlayerId,
      defaultTarget: rule.appliesTo,
    };
    if (!resolveTargets(state, rule.appliesTo, context).length) continue;
    for (const action of rule.actions) applyAction(state, action, context, false, trace);
  }
}

function applyEffectHook(state: RunState, hook: EffectLifecycleHook, context: HookContext, trace?: string[]) {
  const expired = new Set<string>();
  for (const effect of [...state.effects]) {
    if (context.targetPlayerId && effect.targetPlayerId !== context.targetPlayerId) continue;
    if (!effect.hooks.includes(hook)) continue;
    const player = state.players.find((candidate) => candidate.id === effect.targetPlayerId);
    if (!player) continue;
    let triggered = false;
    for (const action of effect.consequences) {
      if (!consequenceMatchesHook(action, {
        hook,
        roll: context.roll,
        movement: context.movement,
        rollHistory: player.rollHistory,
        movementHistory: player.movementHistory,
        targetPlayerId: effect.targetPlayerId,
        ranking: context.ranking,
        activityType: context.activityType,
        cell: context.cell,
        phase: context.phase,
      })) continue;
      triggered = true;
      applyAction(state, action, { ...context, targetPlayerId: effect.targetPlayerId, defaultTarget: "target" }, true, trace, effect.name);
      if (action.expiresOnTrigger) expired.add(effect.id);
    }
    if (triggered && effect.remaining.mode === "uses") {
      effect.remaining = { ...effect.remaining, remaining: effect.remaining.remaining - 1 };
      if (effect.remaining.remaining <= 0) expired.add(effect.id);
    }
  }
  if (expired.size) state.effects = state.effects.filter((effect) => !expired.has(effect.id));
}

function applyAction(
  state: RunState,
  action: EventAction,
  context: ActionContext,
  fromEffect: boolean,
  trace?: string[],
  sourceName?: string
) {
  const target = action.target ?? context.defaultTarget ?? "landing";
  const targetIds = resolveTargets(state, target, context);
  if (action.type !== "text" && !targetIds.length) return;
  const note = action.text ?? `${sourceName ? `${sourceName}: ` : ""}${action.type}`;
  if (trace && !trace.includes(note)) trace.push(note);

  if (action.type === "text") return;
  if (action.type === "coins") {
    for (const id of targetIds) {
      const player = playerById(state, id);
      if (player) player.coins = Math.max(0, player.coins + action.value);
    }
    return;
  }
  if (action.type === "coinTransfer") {
    const from = playerById(state, resolveTargets(state, action.from, context)[0]);
    const to = playerById(state, targetIds[0]);
    if (from && to) transferCoins(from, to, action.amount, action.clamp !== false);
    return;
  }
  if (action.type === "coinRedistribute") {
    const to = playerById(state, targetIds[0]);
    if (to) {
      for (const fromId of resolveTargets(state, action.from, context).filter((id) => id !== to.id)) {
        const from = playerById(state, fromId);
        if (from) transferCoins(from, to, action.amount, action.clamp !== false);
      }
    }
    return;
  }
  if (action.type === "move") {
    for (const id of targetIds) movePlayer(state, id, (playerById(state, id)?.position ?? 0) + action.delta);
    return;
  }
  if (action.type === "moveTo") {
    for (const id of targetIds) movePlayer(state, id, action.tileId);
    return;
  }
  if (action.type === "skipTurn") {
    for (const id of targetIds) state.skippedTurns.set(id, (state.skippedTurns.get(id) ?? 0) + (action.turns ?? 1));
    return;
  }
  if (action.type === "extraTurn") {
    state.extraTurnPlayerId = targetIds[0] ?? state.extraTurnPlayerId;
    return;
  }
  if (action.type === "offlineAction") {
    state.offlineActions += targetIds.length;
    return;
  }
  if (action.type === "halfMovement" || action.type === "movementMultiplier" || action.type === "diceBias") {
    // Persistent modifiers change the roll before this lifecycle hook is presented.
    return;
  }
  if (action.type === "swapPositions") {
    for (const id of targetIds) {
      const first = playerById(state, id);
      const otherId = resolveTargets(state, action.withTarget, { ...context, targetPlayerId: id }).find((candidate) => candidate !== id);
      const second = playerById(state, otherId);
      if (!first || !second) continue;
      const firstPosition = first.position;
      first.position = second.position;
      second.position = firstPosition;
      recordConsequenceArrival(state, first);
      recordConsequenceArrival(state, second);
    }
    return;
  }
  if (action.type === "moveToNearest") {
    for (const id of targetIds) {
      const nearestId = resolveTargets(state, { nearest: action.direction, from: "target" }, { ...context, targetPlayerId: id })[0];
      const nearest = playerById(state, nearestId);
      if (nearest) movePlayer(state, id, nearest.position);
    }
    return;
  }
  if (action.type === "moveToPlayerPosition") {
    const destination = playerById(state, resolveTargets(state, action.withTarget, context)[0]);
    if (destination) for (const id of targetIds.filter((candidate) => candidate !== destination.id)) movePlayer(state, id, destination.position);
    return;
  }
  if (action.type === "applyEffect") {
    const effect = state.content.effects?.[action.effectId];
    if (!effect) {
      state.missingEffects.add(action.effectId);
      return;
    }
    for (const id of targetIds) attachEffect(state, effect, id, false);
    return;
  }

  // This only exists for legacy timed content that was not normalized before simulation.
  if (!fromEffect) return;
}

function resolveTargets(state: RunState, target: EventActionTarget, context: ActionContext): string[] {
  return resolveTargetPlayerIds(target, {
    landingPlayerId: context.landingPlayerId,
    actingPlayerId: context.actingPlayerId,
    targetPlayerId: context.targetPlayerId,
    ranking: context.ranking,
    connectedPlayerIds: state.players.map((player) => player.id),
    playerIds: state.players.map((player) => player.id),
    turnOrder: state.turnOrder,
    players: state.players,
  });
}

function attachCharacterTraits(state: RunState) {
  for (const player of state.players) {
    const character = state.content.characters?.[player.id];
    for (const traitId of character?.defaultTraits ?? []) {
      const trait = state.content.characterTraits?.[traitId];
      const effect = trait ? state.content.effects?.[trait.effectId] : undefined;
      if (effect) attachEffect(state, effect, player.id, true, trait?.name);
      else if (trait) state.missingEffects.add(trait.effectId);
    }
  }
}

function attachEffect(
  state: RunState,
  effect: NonNullable<GameContent["effects"]>[string],
  targetPlayerId: string,
  countCurrentTurn: boolean,
  displayName?: string
) {
  state.effects.push({
    id: `${effect.id}-${state.nextEffectId++}`,
    effectId: effect.id,
    name: displayName ?? effect.name,
    targetPlayerId,
    remaining: durationStateFromDef(effect.duration),
    hooks: effectHooksFor(effect),
    consequences: effectConsequencesFor(effect),
    startedRound: countCurrentTurn ? state.round - 1 : state.round,
    startedTurnId: countCurrentTurn ? undefined : state.turnOrder[state.activeIndex],
  });
}

function applyMovementModifiers(state: RunState, active: SimulationPlayer, roll: number): number {
  let movement = roll;
  for (const effect of state.effects) {
    if (effect.targetPlayerId !== active.id) continue;
    for (const action of effect.consequences) {
      if (!consequenceMatchesHook(action, { hook: "beforeMovement", roll, phase: "turn" })) continue;
      if (action.type === "halfMovement") movement = roundMovement(movement / 2, action.rounding ?? "ceil");
      if (action.type === "movementMultiplier") movement = roundMovement(movement * action.multiplier, action.rounding ?? "round");
    }
  }
  return Math.max(0, movement);
}

function advanceTurn(state: RunState, endingPlayerId: string) {
  if (state.extraTurnPlayerId) {
    const extraIndex = state.turnOrder.indexOf(state.extraTurnPlayerId);
    state.extraTurnPlayerId = undefined;
    if (extraIndex >= 0) {
      tickEffectDurations(state, endingPlayerId, false);
      state.activeIndex = extraIndex;
      return;
    }
  }

  let nextIndex = state.activeIndex;
  let advancedRound = false;
  for (let attempts = 0; attempts < state.turnOrder.length; attempts += 1) {
    nextIndex += 1;
    if (nextIndex >= state.turnOrder.length) {
      nextIndex = 0;
      advancedRound = true;
    }
    const nextId = state.turnOrder[nextIndex];
    const skipped = state.skippedTurns.get(nextId) ?? 0;
    if (skipped <= 0) break;
    if (skipped === 1) state.skippedTurns.delete(nextId);
    else state.skippedTurns.set(nextId, skipped - 1);
  }
  if (advancedRound) state.round += 1;
  tickEffectDurations(state, endingPlayerId, advancedRound);
  state.activeIndex = nextIndex;
}

function tickEffectDurations(state: RunState, endingPlayerId: string, advancedRound: boolean) {
  for (const effect of [...state.effects]) {
    if (effect.remaining.mode === "game" || effect.remaining.mode === "uses") continue;
    if (effect.remaining.mode === "turns") {
      if (effect.targetPlayerId !== endingPlayerId) continue;
      if (effect.startedRound === state.round && effect.startedTurnId === endingPlayerId) continue;
      effect.remaining = { ...effect.remaining, remaining: effect.remaining.remaining - 1 };
    } else if (effect.remaining.mode === "rounds") {
      if (!advancedRound || effect.startedRound === state.round) continue;
      effect.remaining = { ...effect.remaining, remaining: effect.remaining.remaining - 1 };
    }
  }
  state.effects = state.effects.filter((effect) => effect.remaining.mode === "game" || effect.remaining.remaining > 0);
}

function movePlayer(state: RunState, playerId: string, position: number) {
  const player = playerById(state, playerId);
  if (!player) return;
  const next = clampInteger(position, 0, state.map.board.length - 1);
  if (next === player.position) return;
  player.position = next;
  recordConsequenceArrival(state, player);
}

function recordConsequenceArrival(state: RunState, player: SimulationPlayer) {
  const cell = state.cells[player.position];
  if (cell) cell.consequenceArrivals += 1;
  if (player.position >= state.map.board.length - 1 && !state.winnerId) state.winnerId = player.id;
}

function transferCoins(from: SimulationPlayer, to: SimulationPlayer, amount: number, clamp: boolean) {
  const requested = Math.max(0, amount);
  const transferred = clamp ? Math.min(from.coins, requested) : from.coins >= requested ? requested : 0;
  from.coins -= transferred;
  to.coins += transferred;
}

function playerById(state: RunState, id: string | undefined): SimulationPlayer | undefined {
  return id ? state.players.find((player) => player.id === id) : undefined;
}

function firstShopIndex(board: Tile[], start: number, finish: number): number | null {
  for (let index = start + 1; index <= finish; index += 1) if (board[index]?.type === "shop") return index;
  return null;
}

function buildDiagnostics(options: {
  content: GameContent;
  map: MapDefinition;
  cappedGames: number;
  unresolvedEventLandings: number;
  missingEffects: Set<string>;
}): string[] {
  const diagnostics: string[] = [];
  if (options.map.board[options.map.board.length - 1]?.type !== "finish") diagnostics.push("The final board-array cell is not a finish cell; the runtime still treats that index as the movement limit.");
  const nonSequential = options.map.board.some((tile, index) => tile.id !== index);
  if (nonSequential) diagnostics.push("Cell IDs do not match board indices. Movement follows array indices, while reports retain authored IDs.");
  const missingEvents = new Set<string>();
  for (const tile of options.map.board) for (const id of eventIdsForTile(tile)) if (!options.content.events[id]) missingEvents.add(id);
  if (missingEvents.size) diagnostics.push(`Missing event references: ${[...missingEvents].join(", ")}.`);
  if (options.missingEffects.size) diagnostics.push(`Missing effect references: ${[...options.missingEffects].join(", ")}.`);
  if (options.unresolvedEventLandings) diagnostics.push(`${options.unresolvedEventLandings} landings had assigned events but none matched the simulated character trigger.`);
  if (options.cappedGames) diagnostics.push(`${options.cappedGames} games reached the turn cap without a winner. Inspect strong backward movement or skip-turn loops.`);
  return diagnostics;
}

function applyDiceBias(weights: number[], face: number, chanceDeltaPercent: number) {
  const index = clampInteger(face, 1, weights.length) - 1;
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return;
  const delta = clamp(chanceDeltaPercent / 100, -1, 1);
  const currentProbability = weights[index] / total;
  const nextProbability = clamp(currentProbability + delta, 0, 1);
  const otherTotal = total - weights[index];
  weights[index] = nextProbability;
  if (otherTotal <= 0) return;
  const remaining = 1 - nextProbability;
  for (let cursor = 0; cursor < weights.length; cursor += 1) {
    if (cursor !== index) weights[cursor] = (weights[cursor] / otherTotal) * remaining;
  }
}

function rollWeightedDie(weights: number[], random: () => number): number {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total <= 0) return 1 + Math.floor(random() * 6);
  const value = random() * total;
  let cursor = 0;
  for (let index = 0; index < weights.length; index += 1) {
    cursor += Math.max(0, weights[index]);
    if (value < cursor) return index + 1;
  }
  return weights.length;
}

function roundMovement(value: number, rounding: "floor" | "ceil" | "round"): number {
  if (rounding === "floor") return Math.floor(value);
  if (rounding === "ceil") return Math.ceil(value);
  return Math.round(value);
}

function emptyDieHistogram(): Record<string, number> {
  return Object.fromEntries(Array.from({ length: 6 }, (_, index) => [String(index + 1), 0]));
}

function incrementHistogram(histogram: Record<string, number>, value: number) {
  const key = String(value);
  histogram[key] = (histogram[key] ?? 0) + 1;
}

function recordHistory(history: number[], value: number) {
  history.push(value);
  if (history.length > 8) history.splice(0, history.length - 8);
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function mixSeed(seed: number, gameIndex: number): number {
  let value = (seed ^ Math.imul(gameIndex + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13;
  return value >>> 0;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
