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
  for (const modifier of effect.modifiers ?? []) {
    hooks.add(modifier.hook ?? defaultHookForModifier(modifier.type));
  }
  if (effect.actions?.length) hooks.add("onActivityResult");
  return [...hooks];
}

export function defaultHookForModifier(type: EffectModifier["type"]): EffectLifecycleHook {
  if (type === "halfMovement") return "beforeMovement";
  if (type === "conditionalConsequences") return "afterRoll";
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
  return action.text ?? `Apply ${effectNameForId?.(action.effectId) ?? action.effectId}`;
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
