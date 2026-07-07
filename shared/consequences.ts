import type {
  EffectCondition,
  EffectDef,
  EffectDuration,
  EffectDurationState,
  EffectLifecycleHook,
  EffectModifier,
  EventAction,
  EventActionTarget,
  OfflineActionKind,
  Player,
} from "./types";

export interface TargetResolutionContext {
  landingPlayerId?: string;
  actingPlayerId?: string;
  targetPlayerId?: string;
  ranking?: string[];
  connectedPlayerIds?: string[];
  playerIds?: string[];
  players?: Pick<Player, "id" | "position" | "connected">[];
}

export interface EffectHookContext {
  hook: EffectLifecycleHook;
  roll?: number;
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
  return resolveNearestTargetIds(target, context);
}

export function durationStateFromDef(duration: EffectDuration): EffectDurationState {
  if (duration.mode === "turns" || duration.mode === "rounds") return { mode: duration.mode, remaining: duration.value };
  return { mode: duration.mode };
}

export function effectHooksFor(effect: EffectDef): EffectLifecycleHook[] {
  const hooks = new Set<EffectLifecycleHook>(effect.hooks ?? []);
  for (const action of effectConsequencesFor(effect)) {
    hooks.add(action.hook ?? defaultHookForConsequence(action.type));
  }
  return [...hooks];
}

export function effectConsequencesFor(effect: EffectDef): EventAction[] {
  if (effect.consequences?.length) return effect.consequences;
  return [...(effect.actions ?? []), ...(effect.modifiers ?? []).flatMap(effectModifierToConsequences)];
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
  if (type === "halfMovement") return "beforeMovement";
  if (type === "applyEffect") return "onActivityResult";
  if (type === "offlineAction") return "onActivityResult";
  return "onTurnEnd";
}

export function effectRemainingLabel(remaining: EffectDurationState): string {
  if (remaining.mode === "turns") return `${remaining.remaining} turn${remaining.remaining === 1 ? "" : "s"}`;
  if (remaining.mode === "rounds") return `${remaining.remaining} round${remaining.remaining === 1 ? "" : "s"}`;
  if (remaining.mode === "untilTriggered") return "until triggered";
  return "whole game";
}

export function consequenceLabel(action: EventAction, effectNameForId?: (effectId: string) => string): string {
  if (action.type === "text") return action.text;
  if (action.type === "coins") return action.text ?? `${action.value >= 0 ? "+" : ""}${action.value} coins`;
  if (action.type === "move") return action.text ?? `${action.delta >= 0 ? "+" : ""}${action.delta} cells`;
  if (action.type === "moveTo") return action.text ?? `Move to cell ${action.tileId}`;
  if (action.type === "skipTurn") return action.text ?? "Skip next turn";
  if (action.type === "extraTurn") return action.text ?? "Play an extra turn";
  if (action.type === "offlineAction") return action.text ?? offlineActionLabel(action.action);
  if (action.type === "applyEffect") return action.text ?? `Apply ${effectNameForId?.(action.effectId) ?? action.effectId}`;
  if (action.type === "halfMovement") return action.text ?? "Move half of the die roll";
  if (action.type === "swapPositions") return action.text ?? "Swap positions";
  return action.text ?? `Move to nearest player ${action.direction}`;
}

export function offlineActionLabel(action: OfflineActionKind): string {
  if (action === "takeShot") return "Take a shot";
  return "Complete offline action";
}

export function effectConditionMatches(condition: EffectCondition | undefined, context: EffectHookContext): boolean {
  if (!condition) return true;
  if (condition.rollEquals !== undefined && context.roll !== condition.rollEquals) return false;
  if (condition.phase !== undefined && context.phase !== condition.phase) return false;
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
