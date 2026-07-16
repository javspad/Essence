import type {
  ActivityMediaRef,
  ArtifactDef,
  ConsequenceRule,
  EffectConsequenceDef,
  EffectDef,
  EventAction,
  EventActionTarget,
  EventActivity,
  EventActivityType,
  EventOutcomeBranch,
  EventStory,
  GameContent,
  GameEventDef,
  ImmediateConsequenceDef,
  Player,
  PlayerDef,
  PlayerEventOverride,
  RankingPayoutPolicy,
  Tile,
} from "./types";
import {
  defaultDurationForConsequence,
  effectBodyAction,
  effectConsequencesFor,
  isPersistentModifier,
  resolveTargetPlayerIds,
} from "./consequences";

export interface ResolvedGameEvent extends GameEventDef {
  id: string;
  story: EventStory;
  activity?: EventActivity;
}

export const EVENT_ACTIVITY_TYPES: EventActivityType[] = [
  "prompt",
  "hostPick",
  "selfTap",
  "vote",
  "cardVote",
  "judge",
  "timing",
  "reaction",
  "buzzer",
  "estimate",
  "whack",
  "maze",
  "flappy",
  "snake",
  "horserace",
  "redlight",
];

const FALLBACK_ACTIVITY_TYPES_BY_TILE: Partial<Record<Tile["type"], readonly EventActivityType[]>> = {
  minigame: ["hostPick", "selfTap", "cardVote", "timing", "whack", "maze", "flappy", "snake", "horserace", "redlight"],
  trivia: ["buzzer"],
  vote: ["vote"],
  judge: ["judge"],
  dare: ["prompt"],
  fate: ["prompt"],
  groom: ["prompt"],
  reaction: ["reaction"],
  estimate: ["estimate", "prompt"],
};

export function normalizeGameContentEvents(content: GameContent): GameContent {
  const effects = normalizeEffectCatalog(content.effects);
  const effectIds = new Set(Object.keys(effects));
  const normalizeActions = (actions: EventAction[], scope: string): ImmediateConsequenceDef[] =>
    actions.map((action, index) => normalizeAuthoredConsequence(action, `${scope}-action-${index + 1}`, effects, effectIds));
  const events: Record<string, GameEventDef> = Object.fromEntries(
    Object.entries(content.events).map(([id, event]) => [id, normalizeEventDef(event, normalizeActions, `event-${id}`)])
  );

  return {
    ...content,
    events,
    effects: Object.keys(effects).length ? effects : content.effects,
    artifacts: content.artifacts
      ? Object.fromEntries(
          Object.entries(content.artifacts).map(([id, artifact]) => [
            id,
            normalizeArtifactDef(artifact, normalizeActions, `artifact-${id}`),
          ])
        )
      : content.artifacts,
    playerStories: content.playerStories
      ? Object.fromEntries(
          Object.entries(content.playerStories).map(([playerId, bank]) => [
            playerId,
            {
              overrides: bank.overrides.map((override, index) =>
                normalizePlayerEventOverride(override, normalizeActions, `player-${playerId}-override-${index + 1}`)
              ),
            },
          ])
        )
      : content.playerStories,
    board: content.board.map((tile) => ({ ...tile })),
    maps: content.maps?.map((map) => ({
      ...map,
      board: map.board.map((tile) => ({ ...tile })),
    })),
  };
}

export function eventIdsForTile(tile: Tile): string[] {
  const ids = [...(tile.eventIds ?? []), ...(tile.eventId ? [tile.eventId] : [])];
  return [...new Set(ids.filter(Boolean))];
}

export function sharedEventIdsForTile(content: GameContent, tile: Tile): string[] {
  const activityTypes = tile.eventQueue?.activityTypes;
  if (!activityTypes?.length) return [];
  const anchoredIds = new Set(content.board.flatMap(eventIdsForTile));
  return Object.entries(content.events).flatMap(([id, event]) => {
    const activityType = event.activity?.type ?? "prompt";
    return !anchoredIds.has(id) && activityTypes.includes(activityType) ? [id] : [];
  });
}

export function eventTriggerScore(event: GameEventDef, player: Pick<PlayerDef, "id">): number {
  if (!event.trigger || event.trigger.type === "anyPlayer") return 1;
  if (event.trigger.type === "player" && event.trigger.playerId === player.id) return 2;
  return 0;
}

export function eventMatchesTrigger(event: GameEventDef, player: Pick<PlayerDef, "id">): boolean {
  return eventTriggerScore(event, player) > 0;
}

export function resolveTileEventForPlayer(
  content: GameContent,
  tile: Tile,
  player: Pick<PlayerDef, "id">,
  random: () => number = Math.random,
  excludedEventIds: ReadonlySet<string> = new Set()
): ResolvedGameEvent | null {
  const assignedIds = eventIdsForTile(tile);
  const sharedIds = sharedEventIdsForTile(content, tile);
  const eventIds = assignedIds.length ? assignedIds : sharedIds.length ? sharedIds : fallbackEventIdsForTile(content, tile);
  let bestScore = 0;
  const candidates: string[] = [];
  for (const id of eventIds) {
    if (excludedEventIds.has(id)) continue;
    const event = content.events[id];
    if (!event) continue;
    const score = eventTriggerScore(event, player);
    if (score <= 0) continue;
    if (score > bestScore) {
      bestScore = score;
      candidates.length = 0;
      candidates.push(id);
    } else if (score === bestScore) {
      candidates.push(id);
    }
  }
  if (!candidates.length) return null;
  const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)));
  return resolveEventForPlayer(content, candidates[index], player);
}

/**
 * Per-room shuffle bags for local and shared event pools. Local candidates run
 * first; shared activity queues then avoid every event already seen anywhere
 * in the room until that activity catalog is exhausted.
 */
export class TileEventQueue {
  private readonly stateByTile = new Map<number, { signature: string; used: Set<string>; lastEventId?: string }>();
  private readonly seenEventIds = new Set<string>();
  private readonly lastSharedEventByQueue = new Map<string, string>();
  private readonly sharedEventIdsByQueue = new Map<string, string[]>();

  resolve(
    content: GameContent,
    tile: Tile,
    player: Pick<PlayerDef, "id">,
    random: () => number = Math.random
  ): ResolvedGameEvent | null {
    const assignedIds = eventIdsForTile(tile);
    const sharedKey = [...(tile.eventQueue?.activityTypes ?? [])].sort().join("\u0000");
    let sharedIds = this.sharedEventIdsByQueue.get(sharedKey) ?? [];
    if (sharedKey && !this.sharedEventIdsByQueue.has(sharedKey)) {
      sharedIds = sharedEventIdsForTile(content, tile);
      this.sharedEventIdsByQueue.set(sharedKey, sharedIds);
    }
    const signature = `${tile.type}:${assignedIds.join("\u0000")}:${tile.eventQueue?.activityTypes.join("\u0000") ?? ""}`;
    let state = this.stateByTile.get(tile.id);
    if (!state || state.signature !== signature) {
      state = { signature, used: new Set() };
      this.stateByTile.set(tile.id, state);
    }

    let event = assignedIds.length
      ? resolveEventFromIds(content, assignedIds, player, random, new Set([...state.used, ...this.seenEventIds]))
      : null;
    if (!event && assignedIds.length && state.used.size && !sharedIds.length) {
      const previousEventId = state.lastEventId;
      state.used.clear();
      for (const id of assignedIds) this.seenEventIds.delete(id);
      event = resolveEventFromIds(content, assignedIds, player, random, previousEventId ? new Set([previousEventId]) : new Set());
    }
    if (!event && sharedIds.length) event = this.resolveShared(content, tile, sharedIds, player, random);
    // A singleton cell without a shared fallback is allowed to repeat.
    if (!event && assignedIds.length && !sharedIds.length) event = resolveEventFromIds(content, assignedIds, player, random);
    if (!event && !assignedIds.length && !sharedIds.length) event = resolveTileEventForPlayer(content, tile, player, random);
    if (!event) return null;

    state.used.add(event.id);
    state.lastEventId = event.id;
    this.seenEventIds.add(event.id);
    return event;
  }

  private resolveShared(
    content: GameContent,
    tile: Tile,
    eventIds: string[],
    player: Pick<PlayerDef, "id">,
    random: () => number
  ): ResolvedGameEvent | null {
    const key = [...(tile.eventQueue?.activityTypes ?? [])].sort().join("\u0000");
    let event = resolveEventFromIds(content, eventIds, player, random, this.seenEventIds);
    if (!event) {
      for (const id of eventIds) this.seenEventIds.delete(id);
      const previousEventId = this.lastSharedEventByQueue.get(key);
      event = resolveEventFromIds(content, eventIds, player, random, previousEventId ? new Set([previousEventId]) : new Set());
    }
    if (event) this.lastSharedEventByQueue.set(key, event.id);
    return event;
  }

  reset(): void {
    this.stateByTile.clear();
    this.seenEventIds.clear();
    this.lastSharedEventByQueue.clear();
    this.sharedEventIdsByQueue.clear();
  }
}

function resolveEventFromIds(
  content: GameContent,
  eventIds: readonly string[],
  player: Pick<PlayerDef, "id">,
  random: () => number,
  excludedEventIds: ReadonlySet<string> = new Set()
): ResolvedGameEvent | null {
  let bestScore = 0;
  const candidates: string[] = [];
  for (const id of eventIds) {
    if (excludedEventIds.has(id)) continue;
    const event = content.events[id];
    if (!event) continue;
    const score = eventTriggerScore(event, player);
    if (score <= 0) continue;
    if (score > bestScore) {
      bestScore = score;
      candidates.length = 0;
      candidates.push(id);
    } else if (score === bestScore) {
      candidates.push(id);
    }
  }
  if (!candidates.length) return null;
  const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)));
  return resolveEventForPlayer(content, candidates[index], player);
}

function fallbackEventIdsForTile(content: GameContent, tile: Tile): string[] {
  const activityTypes = FALLBACK_ACTIVITY_TYPES_BY_TILE[tile.type];
  if (!activityTypes?.length) return [];
  return Object.entries(content.events).flatMap(([id, event]) => {
    if (event.trigger && event.trigger.type !== "anyPlayer") return [];
    return event.activity && activityTypes.includes(event.activity.type) ? [id] : [];
  });
}

export function resolveEventActionTargetIds(
  target: EventActionTarget,
  context: Parameters<typeof resolveTargetPlayerIds>[1]
): string[] {
  return resolveTargetPlayerIds(target, context);
}

export function removeEventFromContent(content: GameContent, eventId: string): GameContent {
  const { [eventId]: _deleted, ...events } = content.events;
  const removeFromTile = (tile: Tile): Tile => ({
    ...tile,
    eventId: tile.eventId === eventId ? undefined : tile.eventId,
    eventIds: tile.eventIds?.filter((id) => id !== eventId),
  });
  return pruneUnusedMediaAssets({
    ...content,
    events,
    board: content.board.map(removeFromTile),
    maps: content.maps?.map((map) => ({
      ...map,
      board: map.board.map(removeFromTile),
    })),
    playerStories: content.playerStories
      ? Object.fromEntries(
          Object.entries(content.playerStories).map(([playerId, bank]) => [
            playerId,
            { overrides: bank.overrides.filter((override) => override.eventId !== eventId) },
          ])
        )
      : undefined,
  });
}

export function pruneUnusedMediaAssets(content: GameContent): GameContent {
  if (!content.mediaAssets) return content;
  const usedIds = new Set<string>();
  for (const event of Object.values(content.events)) {
    event.media?.forEach((ref) => usedIds.add(ref.assetId));
    event.activity?.media?.forEach((ref) => usedIds.add(ref.assetId));
  }
  for (const bank of Object.values(content.playerStories ?? {})) {
    bank.overrides.forEach((override) => override.activity?.media?.forEach((ref) => usedIds.add(ref.assetId)));
  }
  const mediaAssets = Object.fromEntries(Object.entries(content.mediaAssets).filter(([id]) => usedIds.has(id)));
  return Object.keys(mediaAssets).length === Object.keys(content.mediaAssets).length ? content : { ...content, mediaAssets };
}

export function resolveEventMediaRefs(
  event: Pick<GameEventDef, "media">,
  activity?: Pick<EventActivity, "media">
): ActivityMediaRef[] | undefined {
  const refs = [...(event.media ?? []), ...(activity?.media ?? [])];
  if (!refs.length) return undefined;

  const merged = new Map<string, ActivityMediaRef>();
  for (const ref of refs) {
    const existing = merged.get(ref.assetId);
    if (!existing) {
      merged.set(ref.assetId, { ...ref });
      continue;
    }
    merged.set(ref.assetId, {
      ...existing,
      caption: existing.caption ?? ref.caption,
      placement: mergeMediaPlacement(existing.placement, ref.placement),
    });
  }
  return [...merged.values()];
}

function mergeMediaPlacement(
  first: ActivityMediaRef["placement"],
  second: ActivityMediaRef["placement"]
): ActivityMediaRef["placement"] {
  const a = first ?? "both";
  const b = second ?? "both";
  return a === b ? a : "both";
}

type ConsequenceRuleSource = Pick<GameEventDef, "consequences" | "actions" | "outcomes">;

export function consequenceRulesFor(source: ConsequenceRuleSource): ConsequenceRule[] {
  if (source.consequences !== undefined) return source.consequences;
  return [
    ...(source.actions ?? []).map(ruleForLegacyAction),
    ...(source.outcomes ?? []).map(ruleForLegacyOutcome),
  ];
}

export function rankingPayoutConsequencesFor(policy: RankingPayoutPolicy | undefined): ConsequenceRule[] {
  if (!policy) return [];
  if (policy.consequences !== undefined) return policy.consequences;
  return (policy.outcomes ?? []).map(ruleForLegacyOutcome);
}

type ActivityPlayer = Pick<Player, "id" | "isHost">;

export function resolveActivityParticipantIds(
  activity: EventActivity,
  connectedPlayers: ActivityPlayer[],
  activePlayer: Pick<Player, "id">
): string[] {
  if (activity.type === "prompt") return resolvePromptConfirmerIds(activity, connectedPlayers, activePlayer);
  return playerIdsForMode(activity.participants ?? defaultParticipantMode(activity.type), connectedPlayers, activePlayer);
}

export function resolveActivitySubjectIds(
  activity: EventActivity,
  connectedPlayers: ActivityPlayer[],
  activePlayer: Pick<Player, "id">,
  participants: string[]
): string[] {
  if (activity.subjects) return playerIdsForMode(activity.subjects, connectedPlayers, activePlayer);
  if (activity.type === "hostPick" || activity.type === "vote" || activity.type === "cardVote") {
    return connectedPlayers.map((player) => player.id);
  }
  if (activity.type === "prompt") return connectedPlayers.some((player) => player.id === activePlayer.id) ? [activePlayer.id] : [];
  return participants;
}

export function resolveEventForPlayer(content: GameContent, eventId: string, player: Pick<PlayerDef, "id">): ResolvedGameEvent | null {
  const event = content.events[eventId];
  if (!event) return null;
  const override = bestOverrideForPlayer(content, eventId, event, player.id);
  const story = mergeStory(event.story, override?.story);
  const activity = mergeActivity(event.activity, override?.activity);
  const consequences = override && hasConsequenceConfig(override) ? consequenceRulesFor(override) : consequenceRulesFor(event);
  return {
    ...event,
    id: eventId,
    story,
    ...(activity ? { activity } : {}),
    ...(consequences.length || hasConsequenceConfig(event) ? { consequences } : {}),
  };
}

export function eventTitle(event: Pick<GameEventDef, "name" | "story" | "activity">): string {
  return event.story?.title || event.name || titleForActivity(event.activity?.content, event.activity?.type ?? "prompt");
}

export function toEventActivityType(type: string): EventActivityType {
  return EVENT_ACTIVITY_TYPES.includes(type as EventActivityType) ? (type as EventActivityType) : "prompt";
}

function bestOverrideForPlayer(
  content: GameContent,
  eventId: string,
  event: GameEventDef,
  playerId: string
): PlayerEventOverride | undefined {
  const overrides = content.playerStories?.[playerId]?.overrides ?? [];
  let best: { score: number; override: PlayerEventOverride } | null = null;
  for (const override of overrides) {
    const score = overrideScore(override, eventId, event);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { score, override };
  }
  return best?.override;
}

function overrideScore(override: PlayerEventOverride, eventId: string, event: GameEventDef): number {
  if (override.eventId === eventId) return 100;
  let score = 0;
  if (override.tags?.length) {
    const tags = new Set(event.tags ?? []);
    if (override.tags.every((tag) => tags.has(tag))) score = Math.max(score, 40 + override.tags.length);
  }
  if (override.activityType && override.activityType === event.activity?.type) score = Math.max(score, 30);
  if (override.kind && override.kind === (event.kind ?? (event.activity ? "activity" : "story"))) score = Math.max(score, 10);
  return score;
}

function mergeStory(base?: EventStory, override?: EventStory): EventStory {
  return { ...(base ?? {}), ...(override ?? {}) };
}

function mergeActivity(base?: EventActivity, override?: Partial<EventActivity>): EventActivity | undefined {
  if (!base && !override?.type) return undefined;
  const baseContent = isRecord(base?.content) ? base.content : undefined;
  const overrideContent = isRecord(override?.content) ? override.content : undefined;
  return normalizeActivity(
    {
      ...(base ?? { type: override?.type ?? "prompt" }),
      ...override,
      content: baseContent || overrideContent ? { ...(baseContent ?? {}), ...(overrideContent ?? {}) } : override?.content ?? base?.content,
      type: toEventActivityType(override?.type ?? base?.type ?? "prompt"),
    },
    keepImmediateActions,
    "resolved-activity"
  );
}

type NormalizeActions = (actions: EventAction[], scope: string) => ImmediateConsequenceDef[];

function keepImmediateActions(actions: EventAction[]): ImmediateConsequenceDef[] {
  return actions as ImmediateConsequenceDef[];
}

function normalizeConsequenceRules(
  rules: ConsequenceRule[],
  normalizeActions: NormalizeActions,
  scope: string
): ConsequenceRule[] {
  return rules.map((rule, index) => ({
    ...rule,
    actions: normalizeActions(rule.actions, `${scope}-${index + 1}`),
  }));
}

function normalizeEffectCatalog(catalog: Record<string, EffectDef> | undefined): Record<string, EffectDef> {
  return Object.fromEntries(
    Object.entries(catalog ?? {}).map(([id, effect]) => {
      const { actions: _legacyActions, modifiers: _legacyModifiers, ...canonical } = effect;
      const hadConsequences = effect.consequences !== undefined || effect.actions !== undefined || effect.modifiers !== undefined;
      const consequences = effectConsequencesFor(effect).map((action) => effectBodyAction(action) as EffectConsequenceDef);
      return [
        id,
        {
          ...canonical,
          ...(hadConsequences ? { consequences } : {}),
        },
      ];
    })
  );
}

function normalizeArtifactDef(
  artifact: ArtifactDef,
  normalizeActions: NormalizeActions,
  scope: string
): ArtifactDef {
  const { effects: legacyEffects, ...canonical } = artifact;
  const legacyEffectActions: EventAction[] = (legacyEffects ?? []).map((effectId) => ({
    type: "applyEffect",
    effectId,
    target: "target",
  }));
  const actions: EventAction[] = [...(artifact.consequences ?? []), ...legacyEffectActions];
  return {
    ...canonical,
    ...(actions.length || artifact.consequences !== undefined || legacyEffects !== undefined
      ? { consequences: normalizeActions(actions, `${scope}-consequence`) }
      : {}),
  };
}

function normalizeAuthoredConsequence(
  action: EventAction,
  scope: string,
  effects: Record<string, EffectDef>,
  effectIds: Set<string>
): ImmediateConsequenceDef {
  if (action.type === "applyEffect") {
    const effect = effects[action.effectId];
    if (action.duration && effect) {
      const effectId = availableEffectId(`legacy-${scope}-${action.effectId}`, effectIds);
      effects[effectId] = {
        ...effect,
        id: effectId,
        name: `${effect.name} (imported duration)`,
        duration: { ...action.duration },
      };
      effectIds.add(effectId);
      return immediateEffectReference(action, effectId);
    }
    return immediateEffectReference(action, action.effectId);
  }

  if (!requiresReusableEffect(action)) return withoutLifecycle(action);

  const effectId = availableEffectId(`legacy-${scope}`, effectIds);
  const body = withoutActionTarget(effectBodyAction(action)) as EffectConsequenceDef;
  const label = action.text || titleFromId(effectId);
  effects[effectId] = {
    id: effectId,
    name: label,
    description: action.text || `Imported ${action.type} effect.`,
    duration: action.duration ? { ...action.duration } : defaultDurationForConsequence(action),
    consequences: [body],
  };
  effectIds.add(effectId);
  return immediateEffectReference(action, effectId);
}

function requiresReusableEffect(action: EventAction): boolean {
  return Boolean(action.duration || action.hook || action.when || action.expiresOnTrigger !== undefined || isPersistentModifier(action));
}

function immediateEffectReference(action: EventAction, effectId: string): ImmediateConsequenceDef {
  return {
    type: "applyEffect",
    effectId,
    ...(action.target ? { target: action.target } : {}),
    ...(action.text ? { text: action.text } : {}),
    ...(action.icon ? { icon: action.icon } : {}),
  };
}

function withoutLifecycle(action: EventAction): ImmediateConsequenceDef {
  const {
    hook: _hook,
    when: _when,
    duration: _duration,
    expiresOnTrigger: _expiresOnTrigger,
    ...immediate
  } = action;
  return immediate as ImmediateConsequenceDef;
}

function availableEffectId(requested: string, used: Set<string>): string {
  const base = safeId(requested) || "legacy-inline-effect";
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function normalizeEventDef(event: GameEventDef, normalizeActions: NormalizeActions, scope: string): GameEventDef {
  const { actions: _legacyActions, outcomes: _legacyOutcomes, ...canonical } = event;
  const consequences = normalizeConsequenceRules(consequenceRulesFor(event), normalizeActions, `${scope}-consequence`);
  return {
    ...canonical,
    ...(event.activity ? { activity: normalizeActivity(event.activity, normalizeActions, `${scope}-activity`) } : {}),
    ...(consequences.length || event.consequences !== undefined ? { consequences } : {}),
  };
}

function normalizePlayerEventOverride(
  override: PlayerEventOverride,
  normalizeActions: NormalizeActions,
  scope: string
): PlayerEventOverride {
  const { actions: _legacyActions, outcomes: _legacyOutcomes, ...canonical } = override;
  const consequences = normalizeConsequenceRules(consequenceRulesFor(override), normalizeActions, `${scope}-consequence`);
  return {
    ...canonical,
    ...(override.activity ? { activity: normalizePartialActivity(override.activity, normalizeActions, `${scope}-activity`) } : {}),
    ...(consequences.length || override.consequences !== undefined ? { consequences } : {}),
  };
}

function hasConsequenceConfig(source: ConsequenceRuleSource): boolean {
  return source.consequences !== undefined || source.actions !== undefined || source.outcomes !== undefined;
}

function ruleForLegacyAction(action: EventAction): ConsequenceRule {
  const appliesTo = action.target ?? "landing";
  return {
    appliesTo,
    actions: [withoutActionTarget(action) as ImmediateConsequenceDef],
  };
}

function ruleForLegacyOutcome(outcome: EventOutcomeBranch): ConsequenceRule {
  return {
    ...(outcome.id !== undefined ? { id: outcome.id } : {}),
    ...(outcome.label !== undefined ? { label: outcome.label } : {}),
    appliesTo: outcome.when,
    actions: outcome.actions.map((action) =>
      (sameTarget(action.target, outcome.when) ? withoutActionTarget(action) : action) as ImmediateConsequenceDef
    ),
  };
}

function withoutActionTarget(action: EventAction): EventAction {
  const { target: _target, ...body } = action;
  return body as EventAction;
}

function sameTarget(left: EventActionTarget | undefined, right: EventActionTarget): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}

function defaultParticipantMode(type: EventActivityType): "everyone" | "landing" | "host" {
  if (type === "hostPick") return "host";
  if (type === "prompt") return "everyone";
  return "everyone";
}

function resolvePromptConfirmerIds(
  activity: EventActivity,
  connectedPlayers: ActivityPlayer[],
  activePlayer: Pick<Player, "id">
): string[] {
  const configured = activity.confirmation?.playerIds?.length
    ? connectedPlayers.filter((player) => activity.confirmation?.playerIds?.includes(player.id)).map((player) => player.id)
    : [];
  if (configured.length) return configured;

  const mode = activity.confirmation?.mode ?? activity.participants ?? "rest";
  const confirmers =
    mode === "rest"
      ? connectedPlayers.filter((player) => player.id !== activePlayer.id).map((player) => player.id)
      : mode === "self"
        ? playerIdsForMode("landing", connectedPlayers, activePlayer)
        : playerIdsForMode(mode, connectedPlayers, activePlayer);
  return confirmers.length ? confirmers : [activePlayer.id];
}

function playerIdsForMode(
  mode: "everyone" | "landing" | "host",
  connectedPlayers: ActivityPlayer[],
  activePlayer: Pick<Player, "id">
): string[] {
  if (mode === "landing") return connectedPlayers.some((player) => player.id === activePlayer.id) ? [activePlayer.id] : [];
  if (mode === "host") return connectedPlayers.filter((player) => player.isHost).map((player) => player.id);
  return connectedPlayers.map((player) => player.id);
}

function normalizeActivity(activity: EventActivity, normalizeActions: NormalizeActions, scope: string): EventActivity {
  let normalized: EventActivity;
  if (activity.type !== "prompt") {
    normalized = withoutResolutionMode(activity);
  } else {
    const mode = activity.resolutionMode ?? "none";
    const rest = withoutResolutionMode(activity);
    if (mode === "hostPick") normalized = { ...rest, type: "hostPick" };
    else if (mode === "selfTap") normalized = { ...rest, type: "selfTap" };
    else if (mode === "vote") {
      const content = isRecord(rest.content) ? rest.content : {};
      const prompt = promptForActivity(content);
      normalized = {
        ...rest,
        type: "vote",
        content: prompt ? { ...content, question: typeof content.question === "string" ? content.question : prompt } : rest.content,
      };
    } else normalized = rest;
  }
  return normalizeActivityRankingPayout(normalized, normalizeActions, scope);
}

function normalizePartialActivity(
  activity: Partial<EventActivity>,
  normalizeActions: NormalizeActions,
  scope: string
): Partial<EventActivity> {
  if (!activity.rankingPayout) return { ...activity };
  return { ...activity, rankingPayout: normalizeRankingPayout(activity.rankingPayout, normalizeActions, `${scope}-payout`) };
}

function normalizeActivityRankingPayout(
  activity: EventActivity,
  normalizeActions: NormalizeActions,
  scope: string
): EventActivity {
  if (!activity.rankingPayout) return activity;
  return { ...activity, rankingPayout: normalizeRankingPayout(activity.rankingPayout, normalizeActions, `${scope}-payout`) };
}

function normalizeRankingPayout(
  policy: RankingPayoutPolicy,
  normalizeActions: NormalizeActions,
  scope: string
): RankingPayoutPolicy {
  const { outcomes: _legacyOutcomes, ...canonical } = policy;
  return {
    ...canonical,
    consequences: normalizeConsequenceRules(rankingPayoutConsequencesFor(policy), normalizeActions, scope),
  };
}

function withoutResolutionMode(activity: EventActivity): EventActivity {
  const next = { ...activity };
  delete next.resolutionMode;
  return next;
}

function titleForActivity(content: unknown, type: string): string {
  const c = isRecord(content) ? content : {};
  if (typeof c.question === "string") return c.question;
  if (typeof c.label === "string") return c.label;
  if (typeof c.prompt === "string") return c.prompt;
  return type;
}

function promptForActivity(content: unknown): string | undefined {
  const c = isRecord(content) ? content : {};
  if (typeof c.prompt === "string") return c.prompt;
  if (typeof c.question === "string") return c.question;
  if (typeof c.label === "string") return c.label;
  return undefined;
}

function safeId(id: string): string {
  return id.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function titleFromId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
