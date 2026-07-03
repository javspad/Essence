import type {
  EventActivity,
  EventActivityType,
  EventStory,
  GameContent,
  GameEventDef,
  PlayerDef,
  PlayerEventOverride,
  Tile,
} from "./types";

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
];

const LEGACY_MINIGAME_TILE_TYPES = new Set(["minigame", "trivia", "vote", "judge", "groom", "star", "reaction", "estimate"]);

export function normalizeGameContentEvents(content: GameContent): GameContent {
  const events: Record<string, GameEventDef> = Object.fromEntries(
    Object.entries(content.events ?? {}).map(([id, event]) => [id, normalizeEventDef(event)])
  );

  for (const [id, def] of Object.entries(content.minigames ?? {})) {
    const eventId = eventIdForLegacyMinigame(id);
    if (events[eventId]) continue;
    const title = titleForActivity(def.content, def.type);
    events[eventId] = {
      name: title,
      kind: "activity",
      tags: [def.type, ...(def.skin ? [def.skin] : [])],
      story: {
        title,
        prompt: promptForActivity(def.content),
      },
      activity: {
        type: toEventActivityType(def.type),
        skin: def.skin,
        content: def.content,
        rigged: def.rigged,
      },
    };
  }

  for (const [id, def] of Object.entries(content.dares ?? {})) {
    const eventId = eventIdForLegacyDare(id);
    if (events[eventId]) continue;
    events[eventId] = {
      name: def.text,
      kind: "story",
      tags: ["dare"],
      story: {
        title: "Prenda",
        prompt: def.text,
      },
      activity: {
        type: "prompt",
        content: { prompt: def.text, label: "Prenda" },
      },
    };
  }

  for (const [id, def] of Object.entries(content.fates ?? {})) {
    const eventId = eventIdForLegacyFate(id);
    if (events[eventId]) continue;
    events[eventId] = {
      name: def.text,
      kind: "story",
      tags: ["fate"],
      story: {
        title: "Destino",
        prompt: def.text,
      },
      activity: {
        type: "prompt",
        content: { prompt: def.text, label: "Destino" },
      },
      actions: [
        ...(def.delta ? [{ type: "move" as const, delta: def.delta, target: "landing" as const, text: moveText(def.delta) }] : []),
        ...(def.coins ? [{ type: "coins" as const, value: def.coins, target: "landing" as const, text: coinsText(def.coins) }] : []),
      ],
    };
  }

  const normalizeTile = (tile: Tile): Tile => {
    if (tile.eventId) return { ...tile };
    const eventId = legacyEventIdForTile(tile);
    return eventId ? { ...tile, eventId } : { ...tile };
  };

  return {
    ...content,
    events,
    board: content.board.map(normalizeTile),
    maps: content.maps?.map((map) => ({
      ...map,
      board: map.board.map(normalizeTile),
    })),
  };
}

export function legacyEventIdForTile(tile: Tile): string | undefined {
  if (tile.minigameId && LEGACY_MINIGAME_TILE_TYPES.has(tile.type)) return eventIdForLegacyMinigame(tile.minigameId);
  if (tile.dareId && tile.type === "dare") return eventIdForLegacyDare(tile.dareId);
  if (tile.fateId && tile.type === "fate") return eventIdForLegacyFate(tile.fateId);
  return undefined;
}

export function resolveEventForPlayer(content: GameContent, eventId: string, player: Pick<PlayerDef, "id">): ResolvedGameEvent | null {
  const normalized = content.events ? content : normalizeGameContentEvents(content);
  const event = normalized.events?.[eventId];
  if (!event) return null;
  const override = bestOverrideForPlayer(normalized, eventId, event, player.id);
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

export function eventIdForLegacyMinigame(id: string): string {
  return `event-${safeId(id)}`;
}

export function eventIdForLegacyDare(id: string): string {
  return `event-dare-${safeId(id)}`;
}

export function eventIdForLegacyFate(id: string): string {
  return `event-fate-${safeId(id)}`;
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
  return normalizeActivity({
    ...(base ?? { type: override?.type ?? "prompt" }),
    ...override,
    content: baseContent || overrideContent ? { ...(baseContent ?? {}), ...(overrideContent ?? {}) } : override?.content ?? base?.content,
    type: toEventActivityType(override?.type ?? base?.type ?? "prompt"),
  });
}

function normalizeEventDef(event: GameEventDef): GameEventDef {
  return {
    ...event,
    ...(event.activity ? { activity: normalizeActivity(event.activity) } : {}),
  };
}

function normalizeActivity(activity: EventActivity): EventActivity {
  if (activity.type !== "prompt") {
    return withoutResolutionMode(activity);
  }

  const mode = activity.resolutionMode ?? "none";
  const rest = withoutResolutionMode(activity);
  if (mode === "hostPick") return { ...rest, type: "hostPick" };
  if (mode === "selfTap") return { ...rest, type: "selfTap" };
  if (mode === "vote") {
    const content = isRecord(rest.content) ? rest.content : {};
    const prompt = promptForActivity(content);
    return {
      ...rest,
      type: "vote",
      content: prompt ? { ...content, question: typeof content.question === "string" ? content.question : prompt } : rest.content,
    };
  }
  return rest;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function moveText(delta: number): string {
  return delta > 0 ? `Avanza ${delta} casillero(s)` : `Retrocede ${Math.abs(delta)} casillero(s)`;
}

function coinsText(coins: number): string {
  return coins > 0 ? `Gana ${coins} moneda(s)` : `Pierde ${Math.abs(coins)} moneda(s)`;
}
