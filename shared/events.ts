import type {
  ActivityMediaRef,
  EventActionTarget,
  EventActivity,
  EventActivityType,
  EventStory,
  GameContent,
  GameEventDef,
  Player,
  PlayerDef,
  PlayerEventOverride,
  Tile,
} from "./types";
import { resolveTargetPlayerIds } from "./consequences";

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

export function eventTriggerScore(event: GameEventDef, player: Pick<PlayerDef, "id">): number {
  if (!event.trigger || event.trigger.type === "anyPlayer") return 1;
  if (event.trigger.type === "player" && event.trigger.playerId === player.id) return 2;
  return 0;
}

export function eventMatchesTrigger(event: GameEventDef, player: Pick<PlayerDef, "id">): boolean {
  return eventTriggerScore(event, player) > 0;
}

export function resolveTileEventForPlayer(content: GameContent, tile: Tile, player: Pick<PlayerDef, "id">): ResolvedGameEvent | null {
  if (!tile.eventId) return null;
  const event = content.events[tile.eventId];
  if (!event || !eventMatchesTrigger(event, player)) return null;
  return resolveEventForPlayer(content, tile.eventId, player);
}

export function removeEventFromContent(content: GameContent, eventId: string): GameContent {
  const { [eventId]: _deleted, ...events } = content.events;
  const removeFromTile = (tile: Tile): Tile => ({
    ...tile,
    eventId: tile.eventId === eventId ? undefined : tile.eventId,
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

export function resolveEventActionTargetIds(
  target: EventActionTarget,
  context: Parameters<typeof resolveTargetPlayerIds>[1]
): string[] {
  return resolveTargetPlayerIds(target, context);
}

/**
 * Activity-level media remains readable for older content. New authoring uses
 * one event-level list and placement decides where each image appears.
 */
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
  if (activity.type === "hostPick" || activity.type === "vote") return connectedPlayers.map((player) => player.id);
  if (activity.type === "prompt") return connectedPlayers.some((player) => player.id === activePlayer.id) ? [activePlayer.id] : [];
  return participants;
}

export function resolveEventForPlayer(content: GameContent, eventId: string, player: Pick<PlayerDef, "id">): ResolvedGameEvent | null {
  const event = content.events[eventId];
  if (!event) return null;
  const override = bestOverrideForPlayer(content, eventId, event, player.id);
  const story = mergeStory(event.story, override?.story);
  const activity = mergeActivity(event.activity, override?.activity);
  return {
    ...event,
    id: eventId,
    story,
    ...(activity ? { activity } : {}),
    actions: override?.actions ?? event.actions,
    outcomes: override?.outcomes ?? event.outcomes,
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
  return {
    ...(base ?? { type: override?.type ?? "prompt" }),
    ...override,
    content: baseContent || overrideContent ? { ...(baseContent ?? {}), ...(overrideContent ?? {}) } : override?.content ?? base?.content,
    type: toEventActivityType(override?.type ?? base?.type ?? "prompt"),
  };
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

function titleForActivity(content: unknown, type: string): string {
  const c = isRecord(content) ? content : {};
  if (typeof c.question === "string") return c.question;
  if (typeof c.label === "string") return c.label;
  if (typeof c.prompt === "string") return c.prompt;
  return type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
