import type {
  EffectCondition,
  EffectConsequenceDef,
  EffectDef,
  EffectDuration,
  EffectDurationState,
  EffectLifecycleHook,
  EffectModifier,
  EventActivityType,
  EventAction,
  EventActionTarget,
  OfflineActionKind,
  Player,
  Tile,
} from "./types";

export interface TargetResolutionContext {
  landingPlayerId?: string;
  actingPlayerId?: string;
  targetPlayerId?: string;
  ranking?: string[];
  connectedPlayerIds?: string[];
  playerIds?: string[];
  turnOrder?: string[];
  players?: (Pick<Player, "id" | "position" | "connected"> & Partial<Pick<Player, "coins">>)[];
}

export interface EffectHookContext {
  hook: EffectLifecycleHook;
  targetPlayerId?: string;
  roll?: number;
  movement?: number;
  rollHistory?: number[];
  movementHistory?: number[];
  ranking?: string[];
  activityType?: EventActivityType;
  cell?: Tile;
  phase?: string;
}

export function resolveTargetPlayerIds(target: EventActionTarget, context: TargetResolutionContext): string[] {
  const ranking = context.ranking ?? [];
  const playerIds = context.playerIds ?? context.players?.map((player) => player.id);
  if (target === "landing") return context.landingPlayerId ? [context.landingPlayerId] : [];
  if (target === "acting") {
    const actingPlayerId = context.actingPlayerId ?? context.landingPlayerId;
    return actingPlayerId ? [actingPlayerId] : [];
  }
  if (target === "target") return context.targetPlayerId ? [context.targetPlayerId] : [];
  if (target === "winner") return ranking[0] ? [ranking[0]] : [];
  if (target === "loser") return ranking.length ? [ranking[ranking.length - 1]] : [];
  if (target === "everyone") return context.connectedPlayerIds ?? context.players?.filter((player) => player.connected).map((player) => player.id) ?? [];
  if ("playerId" in target) return !playerIds || playerIds.includes(target.playerId) ? [target.playerId] : [];
  if ("rank" in target) return ranking[target.rank - 1] ? [ranking[target.rank - 1]] : [];
  if ("rankFrom" in target) {
    const from = Math.max(1, target.rankFrom);
    const to = Math.max(from, target.rankTo);
    return ranking.slice(from - 1, to);
  }
  if ("coinSelector" in target) return resolveCoinSelectorTargetIds(target.coinSelector, context);
  if ("coinRank" in target) {
    const sorted = coinRankedPlayers(context);
    return sorted[target.coinRank - 1] ? [sorted[target.coinRank - 1].id] : [];
  }
  if ("coinRankFrom" in target) {
    const from = Math.max(1, target.coinRankFrom);
    const to = Math.max(from, target.coinRankTo);
    return coinRankedPlayers(context).slice(from - 1, to).map((player) => player.id);
  }
  return resolveNearestTargetIds(target, context);
}

export function durationStateFromDef(duration: EffectDuration): EffectDurationState {
  if (duration.mode === "turns" || duration.mode === "rounds" || duration.mode === "uses") return { mode: duration.mode, remaining: duration.value };
  return { mode: duration.mode };
}

export function effectHooksFor(effect: EffectDef): EffectLifecycleHook[] {
  const hooks = new Set<EffectLifecycleHook>(effect.hooks ?? []);
  for (const action of effectConsequencesFor(effect)) {
    hooks.add(action.hook ?? defaultHookForConsequence(action.type));
  }
  return [...hooks];
}

export function effectConsequencesFor(effect: EffectDef): EffectConsequenceDef[] {
  if (effect.consequences?.length) return effect.consequences.map(effectBodyAction);
  return [...(effect.actions ?? []), ...(effect.modifiers ?? []).flatMap(effectModifierToConsequences)].map(effectBodyAction);
}

export function timedConsequenceEffectDef(action: EventAction, id: string): EffectDef {
  const body = attachedEffectBodyAction(action);
  return {
    id,
    name: action.text || consequenceLabel(body),
    description: action.text || consequenceLabel(body),
    duration: action.duration ?? defaultDurationForConsequence(action),
    consequences: [body],
  };
}

export function shouldAttachConsequence(action: EventAction): boolean {
  return action.type !== "applyEffect" && (Boolean(action.duration) || isPersistentModifier(action));
}

export function defaultDurationForConsequence(_action: EventAction): EffectDuration {
  return { mode: "uses", value: 1 };
}

export function effectBodyAction(action: EventAction): EffectConsequenceDef {
  const { duration: _duration, ...body } = action;
  return withCanonicalModifierHook(body as EventAction) as EffectConsequenceDef;
}

function attachedEffectBodyAction(action: EventAction): EffectConsequenceDef {
  const { target: _target, ...body } = effectBodyAction(action);
  return body as EffectConsequenceDef;
}

export function isPersistentModifier(action: EventAction): boolean {
  return action.type === "halfMovement" || action.type === "movementMultiplier" || action.type === "diceBias";
}

export function consequenceMatchesHook(action: EventAction, context: EffectHookContext): boolean {
  const hook = action.hook ?? defaultHookForConsequence(action.type);
  if (hook !== context.hook) return false;
  return effectConditionMatches(action.when, context);
}

export function defaultHookForModifier(type: EffectModifier["type"]): EffectLifecycleHook {
  if (type === "conditionalConsequences") return "afterRoll";
  return defaultHookForConsequence(type);
}

export function defaultHookForConsequence(type: EventAction["type"]): EffectLifecycleHook {
  if (type === "halfMovement" || type === "movementMultiplier") return "beforeMovement";
  if (type === "diceBias") return "beforeRoll";
  if (type === "applyEffect") return "onActivityResult";
  if (type === "offlineAction") return "onActivityResult";
  return "onTurnEnd";
}

export function withCanonicalModifierHook(action: EventAction): EventAction {
  if (action.type === "halfMovement" || action.type === "movementMultiplier" || action.type === "diceBias") {
    return { ...action, hook: defaultHookForConsequence(action.type) } as EventAction;
  }
  return action;
}

export function effectRemainingLabel(remaining: EffectDurationState): string {
  if (remaining.mode === "turns") return `${remaining.remaining} turn${remaining.remaining === 1 ? "" : "s"}`;
  if (remaining.mode === "rounds") return `${remaining.remaining} round${remaining.remaining === 1 ? "" : "s"}`;
  if (remaining.mode === "uses") return `${remaining.remaining} use${remaining.remaining === 1 ? "" : "s"}`;
  return "whole game";
}

export function consequenceLabel(action: EventAction, effectNameForId?: (effectId: string) => string): string {
  if (action.type === "text") return action.text;
  if (action.type === "coins") return action.text ?? `${action.value >= 0 ? "+" : ""}${action.value} coins`;
  if (action.type === "coinTransfer") return action.text ?? `Transfer ${action.amount} coins`;
  if (action.type === "coinRedistribute") return action.text ?? `Redistribute ${action.amount} coins`;
  if (action.type === "move") return action.text ?? `${action.delta >= 0 ? "+" : ""}${action.delta} cells`;
  if (action.type === "moveTo") return action.text ?? `Move to cell ${action.tileId}`;
  if (action.type === "skipTurn") return action.text ?? `Skip next ${action.turns ?? 1} turn${(action.turns ?? 1) === 1 ? "" : "s"}`;
  if (action.type === "extraTurn") return action.text ?? "Play an extra turn";
  if (action.type === "offlineAction") return action.text ?? offlineActionLabel(action.action);
  if (action.type === "applyEffect") return action.text ?? `Apply ${effectNameForId?.(action.effectId) ?? action.effectId}`;
  if (action.type === "halfMovement") return action.text ?? "Move half of the die roll";
  if (action.type === "movementMultiplier") return action.text ?? `Movement x${formatNumber(action.multiplier)}`;
  if (action.type === "diceBias") return action.text ?? `${action.chanceDeltaPercent >= 0 ? "+" : ""}${formatNumber(action.chanceDeltaPercent)}% chance for ${action.face}`;
  if (action.type === "swapPositions") return action.text ?? "Swap positions";
  if (action.type === "moveToPlayerPosition") return action.text ?? "Move to another player's position";
  return action.text ?? `Move to nearest player ${action.direction}`;
}

export function offlineActionLabel(action: OfflineActionKind): string {
  if (action === "takeShot") return "Take a shot";
  return "Complete offline action";
}

export function effectConditionMatches(condition: EffectCondition | undefined, context: EffectHookContext): boolean {
  if (!condition) return true;
  if (condition.rollEquals !== undefined && context.roll !== condition.rollEquals) return false;
  if (condition.rollGte !== undefined && (context.roll === undefined || context.roll < condition.rollGte)) return false;
  if (condition.rollLte !== undefined && (context.roll === undefined || context.roll > condition.rollLte)) return false;
  if (condition.movementGte !== undefined && (context.movement === undefined || context.movement < condition.movementGte)) return false;
  if (condition.movementLte !== undefined && (context.movement === undefined || context.movement > condition.movementLte)) return false;
  if (condition.consecutiveRolls && !consecutiveRollsMatch(condition.consecutiveRolls, context.rollHistory)) return false;
  if (condition.movementTotal && !movementTotalMatches(condition.movementTotal, context.movementHistory)) return false;
  if (condition.rollTotal && !rollTotalMatches(condition.rollTotal, context.rollHistory)) return false;
  if (condition.cellTagsAny?.length && !condition.cellTagsAny.some((tag) => context.cell?.tags?.includes(tag))) return false;
  if (condition.activityTypesAny?.length && (!context.activityType || !condition.activityTypesAny.includes(context.activityType))) return false;
  if (condition.activityTypesNone?.length && context.activityType && condition.activityTypesNone.includes(context.activityType)) return false;
  if (condition.rankingPositionGte !== undefined || condition.rankingPositionLte !== undefined) {
    const position = context.targetPlayerId && context.ranking ? context.ranking.indexOf(context.targetPlayerId) + 1 : 0;
    if (position < 1) return false;
    if (condition.rankingPositionGte !== undefined && position < condition.rankingPositionGte) return false;
    if (condition.rankingPositionLte !== undefined && position > condition.rankingPositionLte) return false;
  }
  if (condition.phase !== undefined && context.phase !== condition.phase) return false;
  return true;
}

function rollTotalMatches(
  condition: NonNullable<EffectCondition["rollTotal"]>,
  rollHistory: number[] | undefined
): boolean {
  if (!Number.isInteger(condition.turns) || condition.turns < 1) return false;
  const recent = rollHistory?.slice(-condition.turns) ?? [];
  if (recent.length < condition.turns) return false;
  const total = recent.reduce((sum, roll) => sum + roll, 0);
  if (condition.lte !== undefined && total > condition.lte) return false;
  if (condition.gte !== undefined && total < condition.gte) return false;
  return true;
}

function consecutiveRollsMatch(
  condition: NonNullable<EffectCondition["consecutiveRolls"]>,
  rollHistory: number[] | undefined
): boolean {
  if (!Number.isInteger(condition.count) || condition.count < 1) return false;
  const recent = rollHistory?.slice(-condition.count) ?? [];
  if (recent.length < condition.count) return false;
  const atLeast = condition.atLeast;
  const atMost = condition.atMost;
  if (atLeast !== undefined && !recent.every((roll) => roll >= atLeast)) return false;
  if (atMost !== undefined && !recent.every((roll) => roll <= atMost)) return false;
  return true;
}

function movementTotalMatches(
  condition: NonNullable<EffectCondition["movementTotal"]>,
  movementHistory: number[] | undefined
): boolean {
  if (!Number.isInteger(condition.turns) || condition.turns < 1) return false;
  const recent = movementHistory?.slice(-condition.turns) ?? [];
  if (recent.length < condition.turns) return false;
  const total = recent.reduce((sum, movement) => sum + movement, 0);
  if (condition.lte !== undefined && total > condition.lte) return false;
  if (condition.gte !== undefined && total < condition.gte) return false;
  return true;
}

function resolveNearestTargetIds(target: Extract<EventActionTarget, { nearest: "ahead" | "behind" }>, context: TargetResolutionContext): string[] {
  const players = context.players ?? [];
  if (!players.length) return [];
  const fromId = sourcePlayerId(target.from, context);
  const source = fromId ? players.find((player) => player.id === fromId) : undefined;
  if (!source) return [];
  const candidates = players.filter((player) => player.id !== source.id);
  const sorted = candidates
    .map((player) => ({ player, delta: player.position - source.position }))
    .filter((entry) => (target.nearest === "ahead" ? entry.delta > 0 : entry.delta < 0))
    .sort((a, b) => (target.nearest === "ahead" ? a.delta - b.delta : b.delta - a.delta));
  return sorted[0] ? [sorted[0].player.id] : [];
}

function sourcePlayerId(
  from: Extract<EventActionTarget, { nearest: "ahead" | "behind" }>["from"],
  context: TargetResolutionContext
): string | undefined {
  if (!from || from === "landing") return context.landingPlayerId;
  if (from === "acting") return context.actingPlayerId ?? context.landingPlayerId;
  if (from === "target") return context.targetPlayerId;
  return from.playerId;
}

function effectModifierToConsequences(modifier: EffectModifier): EventAction[] {
  if (modifier.type === "conditionalConsequences") {
    return modifier.consequences.map((action) => ({
      ...action,
      hook: modifier.hook ?? defaultHookForModifier(modifier.type),
      when: modifier.when,
      expiresOnTrigger: modifier.expiresOnTrigger,
    }));
  }
  if (modifier.type === "halfMovement") {
    return [{ type: "halfMovement", hook: modifier.hook, rounding: modifier.rounding }];
  }
  if (modifier.type === "movementMultiplier") {
    return [{ type: "movementMultiplier", hook: modifier.hook, multiplier: modifier.multiplier, rounding: modifier.rounding }];
  }
  if (modifier.type === "diceBias") {
    return [{ type: "diceBias", hook: modifier.hook, face: modifier.face, chanceDeltaPercent: modifier.chanceDeltaPercent }];
  }
  if (modifier.type === "skipTurn") return [{ type: "skipTurn", hook: modifier.hook, text: modifier.text }];
  if (modifier.type === "extraTurn") return [{ type: "extraTurn", hook: modifier.hook, text: modifier.text }];
  if (modifier.type === "coins") return [{ type: "coins", hook: modifier.hook, value: modifier.value, text: modifier.text }];
  if (modifier.type === "move") return [{ type: "move", hook: modifier.hook, delta: modifier.delta, text: modifier.text }];
  if (modifier.type === "moveTo") return [{ type: "moveTo", hook: modifier.hook, tileId: modifier.tileId, text: modifier.text }];
  if (modifier.type === "swapPositions") {
    return [{ type: "swapPositions", hook: modifier.hook, target: "target", withTarget: modifier.target, text: modifier.text }];
  }
  return [{ type: "moveToNearest", hook: modifier.hook, target: "target", direction: modifier.direction, text: modifier.text }];
}

function resolveCoinSelectorTargetIds(
  selector: Extract<EventActionTarget, { coinSelector: "richest" | "poorest" }>["coinSelector"],
  context: TargetResolutionContext
): string[] {
  const sorted = coinRankedPlayers(context);
  if (!sorted.length) return [];
  if (selector === "poorest") return [sorted[sorted.length - 1].id];
  return [sorted[0].id];
}

function coinRankedPlayers(context: TargetResolutionContext): Pick<Player, "id" | "coins">[] {
  const allPlayers = context.players ?? [];
  const candidateIds = context.connectedPlayerIds ?? context.playerIds ?? allPlayers.map((player) => player.id);
  const allowed = new Set(candidateIds);
  const rankingOrder = new Map((context.ranking ?? []).map((id, index) => [id, index]));
  const turnOrder = new Map((context.turnOrder ?? context.playerIds ?? []).map((id, index) => [id, index]));
  return allPlayers
    .filter((player) => allowed.has(player.id))
    .map((player) => ({ id: player.id, coins: typeof player.coins === "number" && Number.isFinite(player.coins) ? player.coins : 0 }))
    .sort((a, b) => {
      const coinDelta = b.coins - a.coins;
      if (coinDelta !== 0) return coinDelta;
      const rankingDelta = orderValue(rankingOrder, a.id) - orderValue(rankingOrder, b.id);
      if (rankingDelta !== 0) return rankingDelta;
      const turnDelta = orderValue(turnOrder, a.id) - orderValue(turnOrder, b.id);
      if (turnDelta !== 0) return turnDelta;
      return a.id.localeCompare(b.id);
    });
}

function orderValue(order: Map<string, number>, playerId: string): number {
  return order.get(playerId) ?? Number.MAX_SAFE_INTEGER;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}
