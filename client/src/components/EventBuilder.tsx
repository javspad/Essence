import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Images, Plus, Search, Trash2 } from "lucide-react";
import type {
  ActivityMediaRef,
  AppliedEventAction,
  CoinTransaction,
  ConsequenceRule,
  ContentMediaAssetDef,
  EffectDef,
  EffectDuration,
  EffectDurationState,
  EffectLifecycleHook,
  EventAction,
  EventActionTarget,
  EventActivity,
  EventConfirmationMode,
  EventParticipantMode,
  EventActivityType,
  EventTriggerScope,
  GameContent,
  GameEventDef,
  GameState,
  ImmediateConsequenceDef,
  Player,
  RevealEntry,
  RevealPayload,
} from "@essence/shared";
import { consequenceLabel, defaultHookForConsequence, effectConsequencesFor, effectRemainingLabel } from "@essence/shared/consequences";
import seedContent from "@shared/content.json";
import { assertValidGameContent, normalizeContentSchema } from "@essence/shared/contentValidation";
import {
  EVENT_ACTIVITY_TYPES,
  eventTitle,
  pruneUnusedMediaAssets,
  removeEventFromContent,
  resolveActivityParticipantIds,
  resolveActivitySubjectIds,
  resolveEventActionTargetIds,
  resolveEventForPlayer,
  resolveEventMediaRefs,
  type ResolvedGameEvent,
} from "@essence/shared/events";
import { applyRig } from "@essence/shared/rig";
import { ENGINES } from "../minigames";
import { revealEntryDetail, revealEntryResult } from "../revealDisplay";
import { saveContentJsonToDisk } from "../lib/contentDiskSave";
import {
  addCardVoteCard,
  cardVoteEditorContent,
  moveCardVoteCard,
  removeCardVoteCard,
  updateCardVoteCard,
  type EditableCardVoteContent,
} from "../cardVoteEditor";
import {
  advanceCardVotePlaytest,
  cardVotePlaytestRanking,
  createCardVotePlaytestRun,
  forceCardVotePlaytestRound,
  submitCardVotePlaytestVote,
  type CardVotePlaytestRun,
} from "../cardVotePlaytest";
import ActivityMediaStrip, { ActivityMediaFigure } from "./ActivityMedia";
import { effectBuilderHref } from "./EffectBuilderSurface";
import { MediaAssetPickerModal, mediaAssetName } from "./MediaAssetLibrary";
import MinigameHost from "./MinigameHost";
import { RevealPanel } from "./Reveal";

const DEFAULT_EFFECT_ID = "half-roll-2-rounds";
const LEGACY_SHOT_EFFECT_ID = "half-roll-shot-on-six";
const BASE_CONTENT = consolidateContentMedia(migrateEffectDraft(normalizeContentSchema(seedContent)));
const PLAYER_POOL = BASE_CONTENT.players;
const INITIAL_PLAYERS = PLAYER_POOL.slice(0, Math.min(4, PLAYER_POOL.length)).map(toPlayer);
const STORAGE_KEY = "essence:event-builder:draft:v1";

type TargetKind =
  | "landing"
  | "acting"
  | "target"
  | "winner"
  | "loser"
  | "everyone"
  | "player"
  | "rank"
  | "rankRange"
  | "coinRichest"
  | "coinPoorest"
  | "coinRank"
  | "coinRankRange"
  | "nearestAhead"
  | "nearestBehind";

const participantModeOptions: { value: EventParticipantMode; label: string }[] = [
  { value: "everyone", label: "All players" },
  { value: "landing", label: "Landing player only" },
  { value: "host", label: "Host only" },
];

const hookOptions: { value: EffectLifecycleHook; label: string }[] = [
  { value: "onTurnEnd", label: "Turn end" },
  { value: "beforeRoll", label: "Before roll" },
  { value: "afterRoll", label: "After roll" },
  { value: "beforeMovement", label: "Before movement" },
  { value: "afterMovement", label: "After movement" },
  { value: "onCellEnter", label: "Cell enter" },
  { value: "onActivityResult", label: "Activity result" },
];

interface RunResult {
  id: number;
  playerId: string;
  score: number;
  payload: unknown;
}

interface PlaytestResolution {
  complete: boolean;
  submittedCount: number;
  requiredCount: number;
  progressLabel?: string;
  ranking: string[];
  entries: RevealEntry[];
  actions: AppliedEventAction[];
}

export default function EventBuilder() {
  const [content, setContent] = useState<GameContent>(() => loadInitialContent());
  const eventIds = useMemo(() => Object.keys(content.events), [content.events]);
  const effectIds = useMemo(() => Object.keys(content.effects ?? {}), [content.effects]);
  const [selectedId, setSelectedId] = useState(eventIds[0] ?? "");
  const [selectedEffectId, setSelectedEffectId] = useState(effectIds[0] ?? DEFAULT_EFFECT_ID);
  const [activityFilter, setActivityFilter] = useState<EventActivityType | "all">("all");
  const [eventSearch, setEventSearch] = useState("");
  const [players, setPlayers] = useState<Player[]>(INITIAL_PLAYERS);
  const [protagonistId, setProtagonistId] = useState(INITIAL_PLAYERS[0]?.id ?? "");
  const [submitted, setSubmitted] = useState<string[]>([]);
  const [results, setResults] = useState<RunResult[]>([]);
  const [cardVoteRunState, setCardVoteRunState] = useState<{ key: string; run: CardVotePlaytestRun } | null>(null);
  const [runKey, setRunKey] = useState(1);
  const [actionLog, setActionLog] = useState<unknown[]>([]);
  const [contentDraft, setContentDraft] = useState("{}");
  const [contentError, setContentError] = useState<string | null>(null);
  const [jsonModalOpen, setJsonModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);

  const selected = selectedId ? content.events[selectedId] : undefined;
  const protagonist = players.find((player) => player.id === protagonistId) ?? players[0];
  const actor = protagonist;
  const resolved = selected && protagonist ? resolveEventForPlayer(content, selectedId, protagonist) : null;
  const activity = resolved?.activity;
  const hasEngine = activity ? Boolean(ENGINES[activity.type]) : false;
  const cardVoteParticipants = activity?.type === "cardVote" && protagonist
    ? activityParticipants(activity, players, protagonist.id)
    : [];
  const cardVoteSubjects = activity?.type === "cardVote" && protagonist
    ? activitySubjects(activity, players, protagonist.id, cardVoteParticipants)
    : [];
  const cardVoteRunKey = activity?.type === "cardVote"
    ? `${selectedId}:${JSON.stringify(activity.content)}:${cardVoteParticipants.join(",")}:${cardVoteSubjects.join(",")}`
    : "";
  const cardVoteRun = activity?.type === "cardVote"
    ? cardVoteRunState?.key === cardVoteRunKey
      ? cardVoteRunState.run
      : createCardVotePlaytestRun(activity.content, cardVoteParticipants, cardVoteSubjects)
    : null;
  const exportJson = useMemo(() => JSON.stringify(normalizeContentSchema(consolidateContentMedia(content)), null, 2), [content]);
  const activityCounts = useMemo(() => {
    const counts = Object.fromEntries(EVENT_ACTIVITY_TYPES.map((type) => [type, 0])) as Record<EventActivityType, number>;
    for (const event of Object.values(content.events)) {
      if (event.activity) counts[event.activity.type] += 1;
    }
    return counts;
  }, [content.events]);
  const filteredEventIds = useMemo(
    () =>
      eventIds.filter((id) => {
        const event = content.events[id];
        if (!event || (activityFilter !== "all" && event.activity?.type !== activityFilter)) return false;
        const query = normalizeEventSearchText(eventSearch);
        if (!query) return true;
        return eventSearchText(id, event, content).includes(query);
      }),
    [activityFilter, content, eventIds, eventSearch]
  );

  useEffect(() => {
    if (selectedId && eventIds.includes(selectedId)) return;
    setSelectedId(eventIds[0] ?? "");
  }, [eventIds, selectedId]);

  useEffect(() => {
    if (selectedEffectId && effectIds.includes(selectedEffectId)) return;
    setSelectedEffectId(effectIds[0] ?? "");
  }, [effectIds, selectedEffectId]);

  useEffect(() => {
    resetRun();
    setContentDraft(JSON.stringify(activity?.content ?? {}, null, 2));
    setContentError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, activity?.type]);

  useEffect(() => {
    if (players.some((player) => player.id === protagonistId)) return;
    setProtagonistId(players[0]?.id ?? "");
  }, [players, protagonistId]);

  useEffect(() => {
    if (!saveStatus) return;
    const timeout = window.setTimeout(() => setSaveStatus(""), 1800);
    return () => window.clearTimeout(timeout);
  }, [saveStatus]);

  const state = useMemo<GameState | null>(() => {
    if (!resolved || !activity || !protagonist || players.length === 0) return null;
    return createTestState(selectedId, resolved, players, submitted, results, runKey, protagonist.id, content.mediaAssets, cardVoteRun);
  }, [activity, cardVoteRun, content.mediaAssets, players, protagonist, resolved, results, runKey, selectedId, submitted]);
  const playtestResolution = useMemo(
    () => createPlaytestResolution(resolved, state, players, results, cardVoteRun),
    [cardVoteRun, players, resolved, results, state]
  );
  const playtestReveal = useMemo<RevealPayload | null>(() => {
    if (!resolved || !playtestResolution?.complete) return null;
    return {
      eventId: selectedId,
      type: resolved.activity?.type ?? "prompt",
      ...(resolved.activity?.skin ? { skin: resolved.activity.skin } : {}),
      title: eventTitle(resolved),
      story: resolved.story,
      media: resolveEventMediaRefs(resolved, resolved.activity),
      ranking: playtestResolution.ranking,
      entries: playtestResolution.entries,
      coins: Object.fromEntries(playtestResolution.entries.map((entry) => [entry.playerId, entry.coins])),
      actions: playtestResolution.actions,
      coinTransactions: playtestResolution.actions.flatMap((action) => action.coinTransactions ?? []),
    };
  }, [playtestResolution, resolved, selectedId]);

  const updateEvent = (updater: (event: GameEventDef) => GameEventDef) => {
    if (!selectedId || !selected) return;
    setContent((current) => ({
      ...current,
      events: {
        ...current.events,
        [selectedId]: updater(current.events[selectedId] ?? selected),
      },
    }));
  };

  const updateStory = (key: keyof NonNullable<GameEventDef["story"]>, value: string) => {
    updateEvent((event) => ({
      ...event,
      story: { ...(event.story ?? {}), [key]: value || undefined },
      name: key === "title" && value ? value : event.name,
    }));
  };

  const updateActivity = (patch: Partial<EventActivity>) => {
    updateEvent((event) => ({
      ...event,
      kind: "activity",
      activity: {
        type: "prompt",
        ...(event.activity ?? {}),
        ...patch,
      },
    }));
  };

  const updateCardVoteContent = (next: EditableCardVoteContent) => {
    updateActivity({ content: next });
    setContentDraft(JSON.stringify(next, null, 2));
    setContentError(null);
    resetRun();
  };

  const addMediaFile = (file: File) => {
    if (!selectedId || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === "string" ? reader.result : "";
      if (!src) return;
      setContent((current) => addMediaToContent(current, selectedId, file, src));
      setSaveStatus("Media added");
    };
    reader.readAsDataURL(file);
  };

  const attachExistingMedia = (assetId: string) => {
    if (!selectedId) return;
    setContent((current) => {
      const event = current.events[selectedId];
      if (!event || !current.mediaAssets?.[assetId]) return current;
      const canonical = consolidateEventMedia(event);
      if (canonical.media?.some((ref) => ref.assetId === assetId)) {
        return { ...current, events: { ...current.events, [selectedId]: canonical } };
      }
      return {
        ...current,
        events: {
          ...current.events,
          [selectedId]: appendMediaRef(canonical, {
            assetId,
            placement: "both",
          }),
        },
      };
    });
    setSaveStatus("Image attached");
  };

  const updateMediaRef = (index: number, ref: ActivityMediaRef) => {
    updateEvent((event) => updateMediaRefInEvent(event, index, ref));
  };

  const removeMediaRef = (index: number) => {
    if (!selectedId) return;
    setContent((current) => {
      const event = current.events[selectedId];
      if (!event) return current;
      return pruneUnusedMediaAssets({
        ...current,
        events: {
          ...current.events,
          [selectedId]: removeMediaRefFromEvent(event, index),
        },
      });
    });
  };

  const updateTrigger = (value: string) => {
    updateEvent((event) => ({
      ...event,
      trigger: triggerForValue(value),
    }));
  };

  const changeActivityType = (type: EventActivityType) => {
    const nextContent = defaultContentForActivity(type, selected?.story);
    const typeChanged = selected?.activity?.type !== type;
    updateActivity({
      type,
      content: nextContent,
      ...(typeChanged ? { skin: undefined, rigged: undefined } : {}),
    });
    setContentDraft(JSON.stringify(nextContent, null, 2));
    setContentError(null);
    setActivityFilter((current) => (current === "all" ? current : type));
    resetRun();
  };

  const createEvent = () => {
    const type = activityFilter === "all" ? "prompt" : activityFilter;
    const id = nextEventId(content.events);
    const story = { title: "Nuevo evento", prompt: "Escribí qué pasa cuando alguien cae acá." };
    const event: GameEventDef = {
      name: story.title,
      kind: "activity",
      trigger: { type: "anyPlayer" },
      story,
      activity: {
        type,
        content: defaultContentForActivity(type, story),
      },
      consequences: [],
    };
    setContent((current) => ({
      ...current,
      events: {
        ...current.events,
        [id]: event,
      },
    }));
    setSelectedId(id);
    setContentDraft(JSON.stringify(event.activity?.content ?? {}, null, 2));
    setContentError(null);
    resetRun();
  };

  const deleteEvent = (id: string) => {
    const event = content.events[id];
    if (!event) return;
    const title = eventTitle(event);
    if (!window.confirm(`Delete "${title}"?`)) return;
    const nextSelectedId = selectedId === id ? eventIds.filter((eventId) => eventId !== id)[0] ?? "" : selectedId;
    setContent((current) => removeEventFromContent(current, id));
    setSelectedId(nextSelectedId);
    setSaveStatus("Deleted");
    resetRun();
  };

  const saveDraft = async () => {
    const stored = persistEventBuilderDraft(exportJson);
    setSaveStatus(stored ? "Saving..." : "Storage full; saving...");
    try {
      await saveContentJsonToDisk(exportJson);
      setSaveStatus("Saved to content.json");
    } catch (error) {
      console.error("Unable to save content.json", error);
      setSaveStatus(stored ? "Browser backup only" : "Save failed");
    }
  };

  const resetDraft = () => {
    const saved = loadSavedEventBuilderContent();
    const next = saved ?? loadInitialContent();
    setContent(next);
    setSelectedId(Object.keys(next.events)[0] ?? "");
    setImportText("");
    setJsonModalOpen(false);
    setSaveStatus(saved ? "Recovered browser draft" : "Loaded content.json");
    resetRun();
  };

  const copyJson = async () => {
    await navigator.clipboard?.writeText(exportJson);
    setSaveStatus("Copied");
  };

  const downloadJson = () => {
    const blob = new Blob([exportJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "content.event-builder.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importJson = () => {
    try {
      const parsed = consolidateContentMedia(migrateEffectDraft(assertValidGameContent(JSON.parse(importText), "Imported content")));
      const ids = Object.keys(parsed.events);
      setContent(parsed);
      setSelectedId(ids[0] ?? "");
      setImportText("");
      setJsonModalOpen(false);
      setSaveStatus("Imported");
      resetRun();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Invalid JSON");
    }
  };

  const applyContentDraft = () => {
    try {
      const parsed = contentDraft.trim() ? JSON.parse(contentDraft) : {};
      updateActivity({ content: parsed });
      setContentError(null);
    } catch {
      setContentError("JSON inválido");
    }
  };

  const removeConsequence = (index: number) => {
    updateEvent((event) => ({ ...event, consequences: (event.consequences ?? []).filter((_, i) => i !== index) }));
  };

  const updateConsequence = (index: number, updater: (rule: ConsequenceRule) => ConsequenceRule) => {
    updateEvent((event) => ({
      ...event,
      consequences: (event.consequences ?? []).map((rule, i) => (i === index ? updater(rule) : rule)),
    }));
  };

  const addConsequence = () => {
    updateEvent((event) => ({
      ...event,
      consequences: [
        ...(event.consequences ?? []),
        { label: "New consequence", appliesTo: "landing", actions: [{ type: "coins", value: 1 }] },
      ],
    }));
  };

  const addRankingPayout = () => {
    updateActivity({
      rankingPayout: {
        consequences: [
          ...(activity?.rankingPayout?.consequences ?? []),
          { label: "Rank payout", appliesTo: "winner", actions: [{ type: "coins", value: 3 }] },
        ],
      },
    });
  };

  const removeRankingPayout = (index: number) => {
    const next = (activity?.rankingPayout?.consequences ?? []).filter((_, ruleIndex) => ruleIndex !== index);
    updateActivity({ rankingPayout: next.length ? { consequences: next } : undefined });
  };

  const updateRankingPayout = (index: number, updater: (rule: ConsequenceRule) => ConsequenceRule) => {
    const consequences = activity?.rankingPayout?.consequences ?? [];
    updateActivity({
      rankingPayout: {
        consequences: consequences.map((rule, ruleIndex) => (ruleIndex === index ? updater(rule) : rule)),
      },
    });
  };

  const updateEffect = (effectId: string, updater: (effect: EffectDef) => EffectDef) => {
    setContent((current) => {
      const existing = current.effects?.[effectId] ?? defaultComposedEffect(effectId);
      return {
        ...current,
        effects: {
          ...(current.effects ?? {}),
          [effectId]: updater(existing),
        },
      };
    });
  };

  const createEffect = () => {
    const id = nextEffectId(content.effects ?? {});
    const effect = defaultCustomEffect(id);
    setContent((current) => ({
      ...current,
      effects: {
        ...(current.effects ?? {}),
        [id]: effect,
      },
    }));
    setSelectedEffectId(id);
    setSaveStatus("Effect created");
  };

  const deleteEffect = (effectId: string) => {
    const effect = content.effects?.[effectId];
    if (!effect) return;
    if (!window.confirm(`Delete "${effect.name}"? Consequences using it will fall back to coins.`)) return;
    setContent((current) => removeEffectFromContent(current, effectId));
    setSelectedEffectId(effectIds.filter((id) => id !== effectId)[0] ?? "");
    setSaveStatus("Effect deleted");
  };

  const addPlayer = () => {
    const nextDef = PLAYER_POOL.find((def) => !players.some((player) => player.id === def.id));
    if (!nextDef) return;
    setPlayers((current) => normalizeHosts([...current, toPlayer(nextDef, current.length)]));
  };

  const addAllPlayers = () => {
    setPlayers(normalizeHosts(PLAYER_POOL.map((def, index) => toPlayer(def, index))));
  };

  const removePlayer = (playerId: string) => {
    setPlayers((current) => normalizeHosts(current.filter((player) => player.id !== playerId)));
    setSubmitted((current) => current.filter((id) => id !== playerId));
    setResults((current) => current.filter((result) => result.playerId !== playerId));
  };

  const updatePlayerCoins = (playerId: string, coins: number) => {
    setPlayers((current) =>
      current.map((player) =>
        player.id === playerId ? { ...player, coins: Math.max(0, Math.round(Number.isFinite(coins) ? coins : 0)) } : player
      )
    );
  };

  const resetPlayers = () => {
    const next = PLAYER_POOL.slice(0, Math.min(4, PLAYER_POOL.length)).map(toPlayer);
    setPlayers(next);
    setProtagonistId(next[0]?.id ?? "");
    resetRun();
  };

  const resetRun = () => {
    setSubmitted([]);
    setResults([]);
    setCardVoteRunState(null);
    setActionLog([]);
    setRunKey((key) => key + 1);
  };

  const handleFinish = (score: number, payload: unknown) => {
    if (!actor) return;
    if (activity?.type === "cardVote" && cardVoteRun) {
      const votedFor = isRecord(payload) && typeof payload.votedFor === "string" ? payload.votedFor : "";
      if (!votedFor) return;
      setCardVoteRunState((current) => {
        const run = current?.key === cardVoteRunKey ? current.run : cardVoteRun;
        return { key: cardVoteRunKey, run: submitCardVotePlaytestVote(run, actor.id, votedFor) };
      });
      setActionLog((current) => [{ card: cardVoteRun.cardIndex + 1, voterId: actor.id, votedFor }, ...current].slice(0, 12));
      return;
    }
    setSubmitted((current) => (current.includes(actor.id) ? current : [...current, actor.id]));
    setResults((current) => [{ id: Date.now(), playerId: actor.id, score, payload }, ...current]);
  };

  const handleAction = (data: unknown) => {
    if (!actor) return;
    if (activity?.type === "cardVote" && cardVoteRun && isRecord(data) && data.type === "cardVote:next") {
      setCardVoteRunState((current) => {
        const run = current?.key === cardVoteRunKey ? current.run : cardVoteRun;
        return { key: cardVoteRunKey, run: advanceCardVotePlaytest(run) };
      });
      return;
    }
    setActionLog((current) => [{ playerId: actor.id, data }, ...current].slice(0, 6));
  };

  const forceResolve = () => {
    if (activity?.type === "cardVote" && cardVoteRun) {
      setCardVoteRunState((current) => {
        const run = current?.key === cardVoteRunKey ? current.run : cardVoteRun;
        return { key: cardVoteRunKey, run: forceCardVotePlaytestRound(run) };
      });
      return;
    }
    const participants = state?.activeMinigame?.participants ?? players.map((player) => player.id);
    setSubmitted(participants);
    setActionLog((current) => [{ force: true, submitted: participants }, ...current].slice(0, 6));
  };

  return (
    <main className="h-dvh overflow-hidden bg-[#10131a] text-slate-100">
      <header className="grid h-14 grid-cols-[12rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 bg-[#151922] px-3">
        <div className="min-w-0">
          <p className="text-[0.55rem] font-black uppercase tracking-[0.18em] text-cyan-200">Essence tools</p>
          <h1 className="truncate text-lg font-black tracking-normal text-white">Event builder</h1>
        </div>
        <div className="flex min-w-0 items-center justify-center gap-2">
          <h2 className="truncate text-base font-black text-white md:text-lg">{resolved ? eventTitle(resolved) : "No event selected"}</h2>
          {activity && <ActivityTypeSelect type={activity.type} missing={!hasEngine} onChange={changeActivityType} />}
          {selected && <EventScopeSelect value={scopeSelectValue(selected.trigger)} players={PLAYER_POOL} onChange={updateTrigger} />}
        </div>
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={saveDraft} className="h-8 rounded-md border border-cyan-200/25 bg-cyan-300/10 px-2.5 text-xs font-black text-cyan-100 transition hover:bg-cyan-300/15">
            {saveStatus || "Save"}
          </button>
          <a href="/asset-library" className="flex h-8 items-center gap-1.5 rounded-md border border-violet-200/25 bg-violet-300/10 px-2.5 text-xs font-black text-violet-100 transition hover:bg-violet-300/15">
            <Images className="h-3.5 w-3.5" />
            Assets
          </a>
          <button type="button" onClick={() => setJsonModalOpen(true)} className="h-8 rounded-md border border-white/15 bg-white/5 px-2.5 text-xs font-black text-slate-100 transition hover:bg-white/10">
            Import/export
          </button>
          <button type="button" onClick={resetRun} className="h-8 rounded-md border border-white/15 bg-white/5 px-2.5 text-xs font-black text-slate-100 transition hover:bg-white/10">
            Reset run
          </button>
          <a href="/tools" className="flex h-8 items-center rounded-md border border-amber-200/25 bg-amber-300/10 px-2.5 text-xs font-black text-amber-100 transition hover:bg-amber-300/15">
            Tools
          </a>
        </div>
      </header>

      <div className="grid h-[calc(100dvh-3.5rem)] min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[20rem_minmax(0,1fr)_21rem]">
        <aside className="flex min-h-0 flex-col overflow-hidden border-b border-white/10 bg-[#111722] p-3 lg:border-b-0 lg:border-r lg:border-white/10">
          <SectionTitle eyebrow={`${EVENT_ACTIVITY_TYPES.length} types`} title="Activity types" />
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <ActivityFilterButton active={activityFilter === "all"} count={eventIds.length} onClick={() => setActivityFilter("all")}>
              All events
            </ActivityFilterButton>
            {EVENT_ACTIVITY_TYPES.map((type) => (
              <ActivityFilterButton key={type} active={activityFilter === type} count={activityCounts[type]} onClick={() => setActivityFilter(type)}>
                {activityLabel(type)}
              </ActivityFilterButton>
            ))}
          </div>

          <div className="mt-3 flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between gap-2">
              <SectionTitle eyebrow={`${filteredEventIds.length}/${eventIds.length} events`} title="Events" />
              <button type="button" onClick={createEvent} className="rounded-md border border-cyan-200/25 bg-cyan-300/10 px-2.5 py-1 text-xs font-black text-cyan-100 transition hover:bg-cyan-300/15">
                New
              </button>
            </div>
            <label className="relative mt-2 block">
              <span className="sr-only">Search events</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={eventSearch}
                onChange={(event) => setEventSearch(event.target.value)}
                placeholder="Search all event content"
                aria-label="Search event titles, prompts, content, consequences, tags, and media"
                className="h-10 w-full rounded-md border border-white/15 bg-[#0f141d] pl-9 pr-3 text-sm font-bold text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
              />
            </label>
            <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
              {filteredEventIds.length === 0 && (
                <p className="rounded-md border border-dashed border-white/10 p-3 text-sm font-bold text-slate-400">No events match this search.</p>
              )}
              {filteredEventIds.map((id) => {
                const event = content.events[id];
                const active = id === selectedId;
                if (!event) return null;
                return (
                  <div
                    key={id}
                    className={`rounded-md border p-3 text-left transition ${
                      active ? "border-cyan-300/70 bg-cyan-300/14" : "border-white/10 bg-white/[0.035] hover:border-white/25 hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <button type="button" onClick={() => setSelectedId(id)} className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm font-black text-white">{eventTitle(event)}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {event.activity && <TypeBadge type={event.activity.type} missing={!ENGINES[event.activity.type]} />}
                          <MetaPill>{audienceLabel(event.trigger, PLAYER_POOL)}</MetaPill>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteEvent(id)}
                        className="shrink-0 rounded-md border border-rose-200/20 bg-rose-500/10 px-2 py-1 text-[0.62rem] font-black text-rose-100 transition hover:bg-rose-500/15"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="min-h-0 min-w-0 overflow-hidden bg-[#181d27] p-3">
          <div className="grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div
              role="region"
              aria-label="Event preview"
              tabIndex={0}
              className="relative min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain rounded-md border border-white/10 bg-[#10131a] outline-none focus-visible:border-cyan-300/70 focus-visible:ring-2 focus-visible:ring-cyan-300/20"
            >
              {playtestReveal ? (
                <div className="flex min-h-full items-center justify-center p-6">
                  <RevealPanel reveal={playtestReveal} mediaAssets={content.mediaAssets} players={players} canAdvance onNext={resetRun} />
                </div>
              ) : state && actor ? (
                <MinigameHost
                  key={`${selectedId}-${actor.id}-${runKey}`}
                  state={state}
                  me={actor}
                  isHost={actor.isHost}
                  onFinish={handleFinish}
                  onAction={handleAction}
                  onForce={forceResolve}
                  onLeave={() => undefined}
                />
              ) : (
                <StoryPreview resolved={resolved} assets={content.mediaAssets} />
              )}
            </div>

            <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
              <Panel title="Story" eyebrow="default">
                <TextInput
                  label="Title"
                  value={selected?.story?.title ?? selected?.name ?? ""}
                  onChange={(value) => updateStory("title", value)}
                />
                <TextArea
                  label="Prompt"
                  value={selected?.story?.prompt ?? ""}
                  onChange={(value) => updateStory("prompt", value)}
                />
                <TextArea
                  label="Result text"
                  value={selected?.story?.reveal ?? ""}
                  onChange={(value) => updateStory("reveal", value)}
                />
                <details className="mt-3 rounded-md border border-white/10 bg-black/15 p-2">
                  <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.12em] text-slate-300">More copy</summary>
                  <TextArea
                    label="Intro setup"
                    hint="Optional context shown before the instruction."
                    value={selected?.story?.setup ?? ""}
                    onChange={(value) => updateStory("setup", value)}
                  />
                  <TextArea
                    label="Stakes copy"
                    hint="Optional flavor about what is at stake. Actual effects live in Consequences."
                    value={selected?.story?.reward ?? ""}
                    onChange={(value) => updateStory("reward", value)}
                  />
                </details>
              </Panel>

              <Panel title="Activity" eyebrow={activity ? activityLabel(activity.type) : "none"}>
                {activity && activity.type === "prompt" && (
                  <SelectInput
                    label="Who confirms"
                    hint="A prompt does not run a scored game. These people must confirm before the event resolves."
                    value={activity.confirmation?.mode ?? "rest"}
                    options={[
                      { value: "rest", label: "Everyone except the landing player" },
                      { value: "everyone", label: "All players" },
                      { value: "host", label: "Host only" },
                      { value: "self", label: "Landing player only" },
                    ]}
                    onChange={(mode) =>
                      updateActivity({ confirmation: { ...(activity.confirmation ?? {}), mode: mode as EventConfirmationMode } })
                    }
                  />
                )}
                {activity && activity.type !== "prompt" && (
                  <ActivityAudienceEditor activity={activity} onUpdate={updateActivity} />
                )}
                {activity?.type === "cardVote" && (
                  <CardVoteContentEditor content={activity.content} onChange={updateCardVoteContent} />
                )}
                {activity?.type === "cardVote" ? (
                  <details className="mt-3 rounded-md border border-white/10 bg-black/15 p-2">
                    <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.12em] text-slate-400">
                      Advanced content JSON
                    </summary>
                    <ActivityContentJsonEditor
                      value={contentDraft}
                      onChange={setContentDraft}
                      onBlur={applyContentDraft}
                    />
                  </details>
                ) : (
                  <ActivityContentJsonEditor
                    value={contentDraft}
                    onChange={setContentDraft}
                    onBlur={applyContentDraft}
                  />
                )}
                {contentError && <p className="mt-2 rounded-md border border-rose-300/25 bg-rose-500/10 p-2 text-xs font-black text-rose-100">{contentError}</p>}
                {activity && activity.type !== "prompt" && (
                  <div className="mt-3 rounded-md border border-amber-200/15 bg-amber-300/10 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[0.58rem] font-black uppercase tracking-[0.14em] text-amber-200">Ranking payout</p>
                        <p className="mt-1 text-xs font-bold text-slate-400">
                          Reward a rank with coins or another immediate consequence.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={addRankingPayout}
                        className="rounded-md border border-amber-200/25 bg-amber-300/10 px-2.5 py-1 text-xs font-black text-amber-100 transition hover:bg-amber-300/15"
                      >
                        Add payout
                      </button>
                    </div>
                    <div className="mt-2 grid gap-2">
                      {(activity.rankingPayout?.consequences ?? []).map((rule, index) => (
                        <ConsequenceEditor
                          key={`${rule.id ?? rule.label ?? targetLabel(rule.appliesTo)}-payout-${index}`}
                          rule={rule}
                          players={PLAYER_POOL}
                          effects={content.effects ?? {}}
                          onChange={(updater) => updateRankingPayout(index, updater)}
                          onRemove={() => removeRankingPayout(index)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </Panel>

              <MediaEditor
                assets={content.mediaAssets}
                media={selected ? resolveEventMediaRefs(selected, selected.activity) : undefined}
                onOpenLibrary={() => setAssetPickerOpen(true)}
                onUpdateRef={updateMediaRef}
                onRemoveRef={removeMediaRef}
              />
            </div>
          </div>
        </section>

        <aside className="min-h-0 overflow-y-auto border-t border-white/10 bg-[#111722] p-3 lg:border-l lg:border-t-0">
          <Panel title="Playtest" eyebrow={`${players.length} players`}>
            <p className="text-xs font-bold leading-5 text-slate-400">Choose the player who lands on this event. The preview follows that player, including their personal story version.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={addPlayer} disabled={players.length >= PLAYER_POOL.length} className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-slate-100 transition hover:bg-white/10 disabled:opacity-40">
                Add player
              </button>
              <button type="button" onClick={addAllPlayers} className="rounded-md border border-cyan-200/25 bg-cyan-300/10 px-3 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-300/15">
                Add all
              </button>
              <button type="button" onClick={resetPlayers} className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-slate-100 transition hover:bg-white/10">
                Reset
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {players.map((player) => {
                const activePreview = player.id === protagonistId;
                return (
                  <div
                    key={player.id}
                    className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1.5 rounded-md border p-2 text-left transition ${
                      activePreview ? "border-cyan-300/70 bg-cyan-300/14" : "border-white/10 bg-black/15 hover:border-white/25 hover:bg-white/[0.06]"
                    }`}
                  >
                    <button type="button" onClick={() => setProtagonistId(player.id)} className="flex min-w-0 flex-1 items-center gap-2 px-1 text-left">
                      <span className="truncate text-sm font-black text-white">{player.name}</span>
                      <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[0.58rem] font-black uppercase ${activePreview ? "bg-cyan-200 text-cyan-950" : player.isHost ? "bg-amber-200/15 text-amber-100" : "bg-white/8 text-slate-400"}`}>
                        {activePreview ? "Playing" : player.isHost ? "Host" : "In game"}
                      </span>
                    </button>
                    <label className="col-start-1 row-start-2 flex items-center gap-2 px-1 text-[0.58rem] font-black uppercase text-amber-100">
                      Playtest coins
                      <input
                        type="number"
                        min={0}
                        value={player.coins}
                        aria-label={`${player.name} coins`}
                        onChange={(event) => updatePlayerCoins(player.id, Number(event.target.value))}
                        className="h-7 w-14 rounded border border-amber-200/25 bg-black/20 px-1.5 text-xs font-black normal-case text-white outline-none focus:border-amber-200"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        removePlayer(player.id);
                      }}
                      disabled={players.length <= 1}
                      className="col-start-2 row-span-2 row-start-1 self-start rounded-md border border-rose-200/20 bg-rose-500/10 px-2 py-1 text-xs font-black text-rose-100 transition hover:bg-rose-500/15 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="Triggered" eyebrow={playtestResolution?.complete ? `${playtestResolution.actions.length} actions` : "waiting"}>
            <ResolutionPanel resolution={playtestResolution} players={players} />
          </Panel>

          <Panel title="Consequences" eyebrow={`${selected?.consequences?.length ?? 0} rules`}>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={addConsequence}
                disabled={!selected}
                className="rounded-md border border-cyan-200/25 bg-cyan-300/10 px-3 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-300/15 disabled:opacity-40"
              >
                Add consequence
              </button>
              <a
                href={effectBuilderHref(selectedEffectId || undefined, "/event-builder")}
                className="flex items-center justify-center rounded-md border border-amber-200/25 bg-amber-300/10 px-3 py-2 text-sm font-bold text-amber-100 transition hover:bg-amber-300/15"
              >
                Effect builder
              </a>
            </div>
            <div className="mt-3 space-y-2">
              {(selected?.consequences ?? []).map((rule, index) => (
                <ConsequenceEditor
                  key={`${rule.id ?? rule.label ?? targetLabel(rule.appliesTo)}-${index}`}
                  rule={rule}
                  players={PLAYER_POOL}
                  effects={content.effects ?? {}}
                  onChange={(updater) => updateConsequence(index, updater)}
                  onRemove={() => removeConsequence(index)}
                />
              ))}
            </div>
          </Panel>

          <Panel title="Results" eyebrow={`${results.length} entries`}>
            <div className="space-y-2">
              {results.length === 0 ? (
                <p className="rounded-md border border-dashed border-white/10 p-3 text-sm text-slate-400">No results yet.</p>
              ) : (
                results.map((result) => (
                  <div key={result.id} className="rounded-md border border-white/10 bg-black/15 p-2">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-black text-white">{nameFor(players, result.playerId)}</span>
                      <span className="font-mono text-xs text-cyan-200">{formatScore(result.score)}</span>
                    </div>
                    <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-black/25 p-2 text-[0.68rem] leading-4 text-slate-300">
                      {JSON.stringify(result.payload, null, 2)}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel title="Actions" eyebrow={`${actionLog.length} events`}>
            <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-md bg-black/25 p-3 text-[0.68rem] leading-4 text-slate-300">
              {actionLog.length ? JSON.stringify(actionLog, null, 2) : "[]"}
            </pre>
          </Panel>
        </aside>
      </div>
      {assetPickerOpen && (
        <MediaAssetPickerModal
          assets={content.mediaAssets}
          onChoose={(assetId) => {
            attachExistingMedia(assetId);
            setAssetPickerOpen(false);
          }}
          onUpload={addMediaFile}
          onClose={() => setAssetPickerOpen(false)}
        />
      )}
      {jsonModalOpen && (
        <JsonModal
          exportJson={exportJson}
          importText={importText}
          setImportText={setImportText}
          onCopy={copyJson}
          onDownload={downloadJson}
          onImport={importJson}
          onReset={resetDraft}
          onClose={() => setJsonModalOpen(false)}
        />
      )}
    </main>
  );
}

function StoryPreview({ resolved, assets }: { resolved: ResolvedGameEvent | null; assets?: Record<string, ContentMediaAssetDef> }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-md border border-white/10 bg-white/[0.035] p-6 text-center">
        <p className="text-[0.65rem] font-black uppercase tracking-[0.18em] text-cyan-200">Story event</p>
        <h2 className="mt-2 text-3xl font-black text-white">{resolved ? eventTitle(resolved) : "No event"}</h2>
        {resolved?.story.setup && <p className="mt-4 text-sm font-black leading-6 text-slate-300">{resolved.story.setup}</p>}
        <p className="mt-4 text-xl font-black leading-8 text-white">{resolved?.story.prompt ?? "Select an event."}</p>
        <ActivityMediaStrip assets={assets} media={resolved?.media} placement="prompt" compact />
        {resolved?.story.reward && <p className="mt-4 text-sm font-black text-amber-200">{resolved.story.reward}</p>}
      </div>
    </div>
  );
}

function ResolutionPanel({ resolution, players }: { resolution: PlaytestResolution | null; players: Player[] }) {
  if (!resolution) {
    return <p className="rounded-md border border-dashed border-white/10 p-3 text-sm text-slate-400">Run an event to preview its consequences.</p>;
  }
  if (!resolution.complete) {
    return (
      <div className="rounded-md border border-dashed border-white/10 p-3">
        <p className="text-sm font-black text-white">Waiting for players</p>
        <p className="mt-1 text-xs font-bold text-slate-400">
          {resolution.progressLabel ?? `${resolution.submittedCount}/${resolution.requiredCount} submitted.`}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="rounded-md border border-emerald-200/20 bg-emerald-300/10 p-2">
        <p className="text-xs font-black uppercase tracking-[0.12em] text-emerald-200">Reveal entries</p>
        <div className="mt-2 space-y-1">
          {resolution.entries.map((entry) => {
            const detail = revealEntryDetail(entry);
            return (
              <div key={entry.playerId} className="rounded-md border border-white/10 bg-black/15 p-2">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-black text-white">#{entry.rank} {entry.name}</span>
                  <span className="font-mono text-xs text-emerald-100">{revealEntryResult(entry)}</span>
                </div>
                {detail && <p className="mt-1 text-xs font-bold leading-4 text-slate-300">{detail}</p>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="space-y-2">
        {resolution.actions.length ? (
          resolution.actions.map((action, index) => (
            <div key={`${action.type}-${index}`} className="rounded-md border border-white/10 bg-black/15 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full border border-cyan-200/25 bg-cyan-300/10 px-2 py-0.5 text-[0.62rem] font-black uppercase tracking-[0.08em] text-cyan-100">
                  {action.type}
                </span>
                <span className="truncate text-xs font-bold text-slate-400">{action.targetPlayerIds.map((id) => nameFor(players, id)).join(", ")}</span>
              </div>
              <p className="mt-1 text-sm font-bold leading-5 text-slate-100">{action.text}</p>
            </div>
          ))
        ) : (
          <p className="rounded-md border border-dashed border-white/10 p-3 text-sm text-slate-400">No configured consequences fired.</p>
        )}
      </div>
    </div>
  );
}

function MediaEditor({
  assets,
  media,
  onOpenLibrary,
  onUpdateRef,
  onRemoveRef,
}: {
  assets?: Record<string, ContentMediaAssetDef>;
  media?: ActivityMediaRef[];
  onOpenLibrary: () => void;
  onUpdateRef: (index: number, ref: ActivityMediaRef) => void;
  onRemoveRef: (index: number) => void;
}) {
  return (
    <Panel title="Images" eyebrow={`${media?.length ?? 0} attached`}>
      <div className="border border-cyan-200/30 bg-cyan-300/10 p-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <p className="text-sm font-black text-white">One image list for the whole event</p>
            <p className="mt-1 text-xs font-bold leading-5 text-cyan-100/80">Choose an image, then decide whether it appears with the prompt, on results, or in both places.</p>
          </div>
          <button type="button" onClick={onOpenLibrary} className="builder-button preview h-10 gap-2">
            <Images className="h-4 w-4" />
            Choose image
          </button>
        </div>
        <a href="/asset-library" className="mt-2 inline-flex text-xs font-black text-cyan-100 underline decoration-cyan-200/40 underline-offset-4 hover:text-white">
          Manage names, captions, fit, and crop in Asset library
        </a>
      </div>

      <MediaRefList
        refs={media}
        assets={assets}
        onUpdateRef={onUpdateRef}
        onRemoveRef={onRemoveRef}
      />
    </Panel>
  );
}

function MediaRefList({
  refs,
  assets,
  onUpdateRef,
  onRemoveRef,
}: {
  refs?: ActivityMediaRef[];
  assets?: Record<string, ContentMediaAssetDef>;
  onUpdateRef: (index: number, ref: ActivityMediaRef) => void;
  onRemoveRef: (index: number) => void;
}) {
  return (
    <div className="mt-3">
      <div className="mt-2 grid gap-2">
        {(refs ?? []).length === 0 && <p className="rounded-md border border-dashed border-white/10 p-3 text-sm text-slate-400">No images attached.</p>}
        {(refs ?? []).map((ref, index) => (
          <MediaAttachmentRow
            key={`${ref.assetId}-${index}`}
            refDef={ref}
            asset={assets?.[ref.assetId]}
            index={index}
            onUpdateRef={onUpdateRef}
            onRemoveRef={onRemoveRef}
          />
        ))}
      </div>
    </div>
  );
}

function MediaAttachmentRow({
  refDef,
  asset,
  index,
  onUpdateRef,
  onRemoveRef,
}: {
  refDef: ActivityMediaRef;
  asset?: ContentMediaAssetDef;
  index: number;
  onUpdateRef: (index: number, ref: ActivityMediaRef) => void;
  onRemoveRef: (index: number) => void;
}) {
  const patchRef = (patch: Partial<ActivityMediaRef>) => onUpdateRef(index, { ...refDef, ...patch });
  return (
    <div className="rounded-md border border-white/10 bg-black/18 p-2">
      <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
        <ActivityMediaFigure asset={asset} refDef={refDef} compact surface="tool" />
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 truncate text-xs font-black text-white">{mediaAssetName(asset, refDef.assetId)}</p>
            <button type="button" onClick={() => onRemoveRef(index)} className="builder-button icon danger shrink-0" aria-label={`Remove ${mediaAssetName(asset, refDef.assetId)}`} title="Remove image">
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <SelectInput
            label="Show during"
            value={refDef.placement ?? "both"}
            options={[
              { value: "prompt", label: "Prompt only" },
              { value: "reveal", label: "Results only" },
              { value: "both", label: "Prompt and results" },
            ]}
            onChange={(placement) => patchRef({ placement: placement as ActivityMediaRef["placement"] })}
          />
        </div>
      </div>
    </div>
  );
}

function ActivityAudienceEditor({
  activity,
  onUpdate,
}: {
  activity: EventActivity;
  onUpdate: (patch: Partial<EventActivity>) => void;
}) {
  const participants = activity.participants ?? defaultParticipantMode(activity.type);
  const defaultSubjects = activity.type === "hostPick" || activity.type === "vote" || activity.type === "cardVote" ? "everyone" : participants;
  const subjects = activity.subjects ?? defaultSubjects;

  return (
    <div className="mt-3 rounded-md border border-cyan-200/20 bg-cyan-300/[0.06] p-3">
      <div>
        <p className="text-sm font-black text-white">Participation and results</p>
        <p className="mt-1 text-xs font-bold leading-5 text-slate-400">
          First choose who receives the activity. Then choose whose score is ranked, which is what winner, loser, and rank consequences use.
        </p>
      </div>
      <div className="mt-1 grid gap-2 sm:grid-cols-2">
        <SelectInput
          label="Who plays"
          hint="These players receive the activity and submit or play it."
          value={participants}
          options={participantModeOptions}
          onChange={(mode) => onUpdate({ participants: mode as EventParticipantMode })}
        />
        <SelectInput
          label="Who gets a result"
          hint="These players are ranked. Consequences can target the winner, loser, or a rank."
          value={activity.subjects ?? "default"}
          options={[
            { value: "default", label: `Default: ${participantModeLabel(defaultSubjects)}` },
            ...participantModeOptions,
          ]}
          onChange={(mode) => onUpdate({ subjects: mode === "default" ? undefined : (mode as EventParticipantMode) })}
        />
      </div>
      <p className="mt-3 rounded-md border border-white/10 bg-black/15 px-3 py-2 text-xs font-bold leading-5 text-cyan-100">
        This event asks <span className="font-black text-white">{participantModeLabel(participants)}</span> to play and creates results for <span className="font-black text-white">{participantModeLabel(subjects)}</span>.
      </p>
    </div>
  );
}

function CardVoteContentEditor({
  content,
  onChange,
}: {
  content: unknown;
  onChange: (content: EditableCardVoteContent) => void;
}) {
  const editable = cardVoteEditorContent(content);
  const readyCards = editable.cards.filter((card) => card.trim()).length;

  return (
    <section className="mt-3 overflow-hidden rounded-md border border-amber-200/25 bg-[#17150f] shadow-[3px_3px_0_rgb(245_213_71/0.12)]">
      <header className="flex items-center justify-between gap-3 border-b border-amber-200/15 bg-amber-300/[0.07] px-3 py-2.5">
        <div>
          <p className="text-sm font-black text-white">Sentence cards</p>
          <p className="mt-0.5 text-[0.68rem] font-bold text-amber-100/60">
            Players vote on these in order, one card at a time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(addCardVoteCard(editable))}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-amber-200/30 bg-amber-300/12 px-2.5 text-xs font-black text-amber-100 transition hover:bg-amber-300/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
        >
          <Plus className="size-3.5" />
          Add sentence
        </button>
      </header>

      <div className="max-h-[30rem] space-y-2 overflow-y-auto p-3 pr-2">
        {editable.cards.map((card, index) => {
          const empty = !card.trim();
          return (
            <article
              key={index}
              className={`border-l-4 bg-[#201c14] p-2.5 shadow-[2px_2px_0_rgb(255_244_191/0.08)] ${empty ? "border-l-rose-400" : "border-l-[#f5d547]"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={`card-vote-sentence-${index}`} className="retro text-[9px] uppercase tracking-[0.14em] text-amber-100/70">
                  Card {String(index + 1).padStart(2, "0")}
                </label>
                <div className="flex items-center gap-1">
                  <CardOrderButton
                    label={`Move card ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => onChange(moveCardVoteCard(editable, index, -1))}
                  >
                    <ArrowUp className="size-3.5" />
                  </CardOrderButton>
                  <CardOrderButton
                    label={`Move card ${index + 1} down`}
                    disabled={index === editable.cards.length - 1}
                    onClick={() => onChange(moveCardVoteCard(editable, index, 1))}
                  >
                    <ArrowDown className="size-3.5" />
                  </CardOrderButton>
                  <button
                    type="button"
                    aria-label={`Delete card ${index + 1}`}
                    title={editable.cards.length === 1 ? "A Card vote needs at least one sentence" : `Delete card ${index + 1}`}
                    disabled={editable.cards.length === 1}
                    onClick={() => onChange(removeCardVoteCard(editable, index))}
                    className="inline-flex size-8 items-center justify-center rounded-sm border border-rose-200/20 bg-rose-500/10 text-rose-100 transition hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
              <textarea
                id={`card-vote-sentence-${index}`}
                aria-invalid={empty}
                value={card}
                rows={3}
                placeholder="Write the sentence players will vote on..."
                onChange={(event) => onChange(updateCardVoteCard(editable, index, event.target.value))}
                className={`mt-2 min-h-20 w-full resize-y rounded-sm border bg-[#100f0c] px-3 py-2 text-sm font-bold leading-5 text-white outline-none transition focus:border-amber-200 ${empty ? "border-rose-300/55" : "border-amber-100/15"}`}
              />
              {empty && <p className="mt-1 text-[0.68rem] font-bold text-rose-200">Write a sentence before saving.</p>}
            </article>
          );
        })}
      </div>

      <div className="grid gap-2 border-t border-amber-200/15 bg-black/15 p-3">
        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-white/10 bg-black/15 p-3 transition hover:border-amber-100/25">
          <input
            type="checkbox"
            checked={editable.allowSelfVote !== false}
            onChange={(event) => onChange({ ...editable, allowSelfVote: event.target.checked })}
            className="mt-0.5 size-4 shrink-0 accent-amber-300"
          />
          <span>
            <span className="block text-xs font-black text-white">Allow self-votes</span>
            <span className="mt-1 block text-[0.68rem] font-bold leading-4 text-slate-400">Players may choose themselves for a card.</span>
          </span>
        </label>
        <SelectInput
          label="When votes tie"
          value={editable.tieMode ?? "shared"}
          options={[
            { value: "shared", label: "Every leader gets the card" },
            { value: "noCard", label: "Nobody gets the card" },
          ]}
          onChange={(tieMode) => onChange({ ...editable, tieMode: tieMode as EditableCardVoteContent["tieMode"] })}
        />
      </div>

      <footer className="border-t border-amber-200/15 px-3 py-2 text-center text-[0.65rem] font-black uppercase tracking-[0.1em] text-amber-100/55">
        {readyCards}/{editable.cards.length} ready · self-votes {editable.allowSelfVote === false ? "off" : "on"} · {editable.tieMode === "noCard" ? "ties award no card" : "ties share the card"}
      </footer>
    </section>
  );
}

function CardOrderButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-sm border border-white/10 bg-white/5 text-slate-200 transition hover:border-amber-100/25 hover:bg-amber-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 disabled:cursor-not-allowed disabled:opacity-25"
    >
      {children}
    </button>
  );
}

function ActivityContentJsonEditor({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  return (
    <label className="mt-3 block text-xs font-black uppercase tracking-[0.12em] text-slate-400">
      Content JSON
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className="mt-2 h-36 w-full resize-none rounded-md border border-white/15 bg-[#151922] p-3 font-mono text-[0.68rem] leading-4 text-white outline-none focus:border-cyan-300"
      />
    </label>
  );
}

function participantModeLabel(mode: EventParticipantMode): string {
  if (mode === "landing") return "the landing player";
  if (mode === "host") return "the host";
  return "all players";
}

function Panel({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
      <SectionTitle eyebrow={eyebrow} title={title} />
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <h2 className="truncate text-base font-black text-white">{title}</h2>
      <p className="shrink-0 text-[0.58rem] font-black uppercase tracking-[0.16em] text-slate-400">{eyebrow}</p>
    </div>
  );
}

function ActivityFilterButton({ active, count, children, onClick }: { active: boolean; count: number; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${String(children)}, ${count} ${count === 1 ? "event" : "events"}`}
      className={`flex min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-left text-sm font-black transition ${
        active ? "border-cyan-300/70 bg-cyan-300/14 text-cyan-100" : "border-white/10 bg-white/[0.035] text-slate-200 hover:border-white/25"
      }`}
    >
      <span className="min-w-0 leading-tight">{children}</span>
      <span
        className={`inline-flex min-w-6 shrink-0 items-center justify-center rounded-sm border px-1.5 py-0.5 font-mono text-[0.62rem] leading-none ${
          active ? "border-cyan-200/35 bg-cyan-200/15 text-cyan-50" : count === 0 ? "border-white/5 bg-black/10 text-slate-600" : "border-white/10 bg-black/20 text-slate-300"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function ActivityTypeSelect({
  type,
  missing,
  onChange,
}: {
  type: EventActivityType;
  missing: boolean;
  onChange: (type: EventActivityType) => void;
}) {
  return (
    <label className="relative shrink-0">
      <span className="sr-only">Activity type</span>
      <select
        value={type}
        onChange={(event) => onChange(event.target.value as EventActivityType)}
        style={{ colorScheme: "dark" }}
        className={`h-7 cursor-pointer appearance-none rounded-full border py-1 pl-2.5 pr-6 text-[0.62rem] font-black uppercase tracking-[0.08em] outline-none transition focus:border-white/70 ${
          missing ? "border-rose-200/45 bg-[#2a1118] text-rose-100" : "border-cyan-200/45 bg-[#132a33] text-cyan-50"
        }`}
      >
        {EVENT_ACTIVITY_TYPES.map((activityType) => (
          <option key={activityType} value={activityType} className="bg-[#111722] text-slate-100">
            {activityLabel(activityType)}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[0.55rem] font-black text-current">v</span>
    </label>
  );
}

function EventScopeSelect({
  value,
  players,
  onChange,
}: {
  value: string;
  players: GameContent["players"];
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative shrink-0">
      <span className="sr-only">Event audience</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ colorScheme: "dark" }}
        className="h-7 cursor-pointer appearance-none rounded-full border border-amber-200/35 bg-[#2b2415] py-1 pl-2.5 pr-6 text-[0.62rem] font-black uppercase tracking-[0.08em] text-amber-100 outline-none transition focus:border-white/70"
      >
        <option value="all" className="bg-[#111722] text-slate-100">
          Event for all players
        </option>
        {players.map((player) => (
          <option key={player.id} value={player.id} className="bg-[#111722] text-slate-100">
            Event for {player.name}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[0.55rem] font-black text-current">v</span>
    </label>
  );
}

function EffectBuilderPanel({
  effects,
  selectedEffect,
  selectedEffectId,
  players,
  onSelect,
  onCreate,
  onDelete,
  onUpdate,
}: {
  effects: Record<string, EffectDef>;
  selectedEffect?: EffectDef;
  selectedEffectId: string;
  players: GameContent["players"];
  onSelect: (effectId: string) => void;
  onCreate: () => void;
  onDelete: (effectId: string) => void;
  onUpdate: (effectId: string, updater: (effect: EffectDef) => EffectDef) => void;
}) {
  const effectOptions = Object.values(effects).map((effect) => ({ value: effect.id, label: effect.name }));
  return (
    <Panel title="Effect builder" eyebrow={`${effectOptions.length} types`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
        <SelectInput
          label="Effect type"
          value={selectedEffectId}
          disabled={!effectOptions.length}
          options={effectOptions.length ? effectOptions : [{ value: "", label: "No effects yet" }]}
          onChange={onSelect}
        />
        <button
          type="button"
          onClick={onCreate}
          className="mb-0.5 h-9 rounded-md border border-cyan-200/25 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100 transition hover:bg-cyan-300/15"
        >
          New
        </button>
      </div>
      {selectedEffect ? (
        <>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => onDelete(selectedEffect.id)}
              className="rounded-md border border-rose-200/20 bg-rose-500/10 px-2.5 py-1.5 text-xs font-black text-rose-100 transition hover:bg-rose-500/15"
            >
              Delete effect
            </button>
          </div>
          <EffectCompositionEditor
            effect={selectedEffect}
            players={players}
            onChange={(updater) => onUpdate(selectedEffect.id, updater)}
          />
        </>
      ) : (
        <p className="mt-3 rounded-md border border-dashed border-white/10 p-3 text-sm text-slate-400">Create an effect type to use it from consequence actions.</p>
      )}
    </Panel>
  );
}

function ConsequenceEditor({
  rule,
  players,
  effects,
  onChange,
  onRemove,
}: {
  rule: ConsequenceRule;
  players: GameContent["players"];
  effects: Record<string, EffectDef>;
  onChange: (updater: (rule: ConsequenceRule) => ConsequenceRule) => void;
  onRemove: () => void;
}) {
  const kind = targetKind(rule.appliesTo);
  const actions = consequenceActions(rule);
  const updateAction = (actionIndex: number, action: ImmediateConsequenceDef) => {
    onChange((current) => ({
      ...current,
      actions: consequenceActions(current).map((item, index) => (index === actionIndex ? action : item)),
    }));
  };
  const removeAction = (actionIndex: number) => {
    onChange((current) => {
      const next = consequenceActions(current).filter((_, index) => index !== actionIndex);
      return { ...current, actions: next.length ? next : [{ type: "coins", value: 1 }] };
    });
  };
  const addAction = () => {
    onChange((current) => ({
      ...current,
      actions: [...consequenceActions(current), { type: "coins", value: 1 }],
    }));
  };
  return (
    <details className="rounded-md border border-white/10 bg-black/15 p-2" open>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-black text-white">{consequenceSummary(rule, players)}</span>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            onRemove();
          }}
          className="shrink-0 rounded-md border border-rose-200/20 bg-rose-500/10 px-2 py-1 text-xs font-black text-rose-100 transition hover:bg-rose-500/15"
        >
          Remove
        </button>
      </summary>
      <SelectInput
        label="Applies to"
        value={kind}
        options={[
          { value: "winner", label: "Winner" },
          { value: "loser", label: "Loser" },
          { value: "landing", label: "Triggering player" },
          { value: "acting", label: "Acting player" },
          { value: "target", label: "Selected target" },
          { value: "nearestAhead", label: "Nearest ahead" },
          { value: "nearestBehind", label: "Nearest behind" },
          { value: "everyone", label: "Everyone" },
          { value: "player", label: "Specific player" },
          { value: "rank", label: "Rank" },
          { value: "rankRange", label: "Rank range" },
          { value: "coinRichest", label: "Most coins" },
          { value: "coinPoorest", label: "Least coins" },
          { value: "coinRank", label: "Coin rank" },
          { value: "coinRankRange", label: "Coin rank range" },
        ]}
        onChange={(value) =>
          onChange((current) => ({
            ...current,
            appliesTo: targetForKind(value as TargetKind, players, current.appliesTo),
          }))
        }
      />

      {kind === "player" && (
        <SelectInput
          label="Player"
          value={playerIdForTarget(rule.appliesTo, players)}
          options={players.map((player) => ({ value: player.id, label: player.name }))}
          onChange={(playerId) => onChange((current) => ({ ...current, appliesTo: { playerId } }))}
        />
      )}
      {kind === "rank" && (
        <NumberInput
          label="Rank"
          value={rankFromFor(rule.appliesTo)}
          onChange={(rank) => onChange((current) => ({ ...current, appliesTo: { rank: Math.max(1, rank) } }))}
        />
      )}
      {kind === "rankRange" && (
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label="From rank"
            value={rankFromFor(rule.appliesTo)}
            onChange={(rankFrom) => onChange((current) => ({ ...current, appliesTo: { rankFrom: Math.max(1, rankFrom), rankTo: rankToFor(current.appliesTo) } }))}
          />
          <NumberInput
            label="To rank"
            value={rankToFor(rule.appliesTo)}
            onChange={(rankTo) => onChange((current) => ({ ...current, appliesTo: { rankFrom: rankFromFor(current.appliesTo), rankTo: Math.max(1, rankTo) } }))}
          />
        </div>
      )}
      {kind === "coinRank" && (
        <NumberInput
          label="Coin rank"
          value={rankFromFor(rule.appliesTo)}
          onChange={(coinRank) => onChange((current) => ({ ...current, appliesTo: { coinRank: Math.max(1, Math.round(coinRank)) } }))}
        />
      )}
      {kind === "coinRankRange" && (
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label="From coin rank"
            value={rankFromFor(rule.appliesTo)}
            onChange={(coinRankFrom) => onChange((current) => ({ ...current, appliesTo: { coinRankFrom: Math.max(1, Math.round(coinRankFrom)), coinRankTo: rankToFor(current.appliesTo) } }))}
          />
          <NumberInput
            label="To coin rank"
            value={rankToFor(rule.appliesTo)}
            onChange={(coinRankTo) => onChange((current) => ({ ...current, appliesTo: { coinRankFrom: rankFromFor(current.appliesTo), coinRankTo: Math.max(1, Math.round(coinRankTo)) } }))}
          />
        </div>
      )}
      <ConsequenceActionEditor
        action={actions[0]}
        effects={effects}
        players={players}
        actionIndex={0}
        canRemove={actions.length > 1}
        onChange={(action) => updateAction(0, action)}
        onRemove={() => removeAction(0)}
      />
      {actions.slice(1).map((action, index) => (
        <ConsequenceActionEditor
          key={`${action.type}-${index + 1}`}
          action={action}
          effects={effects}
          players={players}
          actionIndex={index + 1}
          canRemove
          onChange={(next) => updateAction(index + 1, next)}
          onRemove={() => removeAction(index + 1)}
        />
      ))}
      <button
        type="button"
        onClick={addAction}
        className="mt-3 w-full rounded-md border border-cyan-200/25 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100 transition hover:bg-cyan-300/15"
      >
        Add consequence
      </button>
    </details>
  );
}

function ConsequenceActionEditor({
  action,
  effects,
  players,
  actionIndex,
  canRemove,
  onChange,
  onRemove,
}: {
  action: ImmediateConsequenceDef;
  effects: Record<string, EffectDef>;
  players: GameContent["players"];
  actionIndex: number;
  canRemove: boolean;
  onChange: (action: ImmediateConsequenceDef) => void;
  onRemove: () => void;
}) {
  const text = action.text ?? "";
  const selectedEffect = action.type === "applyEffect" ? effects[action.effectId] : undefined;
  const typeOptions = consequenceTypeOptions(effects, action);
  return (
    <div className="mt-3 rounded-md border border-white/10 bg-black/20 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-300">Action {actionIndex + 1}</p>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="rounded-md border border-rose-200/20 bg-rose-500/10 px-2 py-1 text-[0.62rem] font-black text-rose-100 transition hover:bg-rose-500/15 disabled:opacity-40"
        >
          Remove
        </button>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
        <SelectInput
          label="Type"
          value={actionTypeSelectValue(action)}
          options={typeOptions}
          onChange={(type) => {
            if (isEffectTypeOption(type)) {
              onChange(convertActionToEffect(action, effectIdFromTypeOption(type)));
              return;
            }
            onChange(convertActionType(action, type as Exclude<ImmediateConsequenceDef["type"], "text" | "offlineAction" | "applyEffect">) as ImmediateConsequenceDef);
          }}
        />
        {(action.type === "coins" || action.type === "move") && (
          <NumberInput
            label={action.type === "coins" ? "Coins" : "Cells"}
            value={action.type === "coins" ? action.value : action.delta}
            onChange={(value) => onChange(updateActionAmount(action, value))}
          />
        )}
        {(action.type === "coinTransfer" || action.type === "coinRedistribute") && (
          <NumberInput
            label="Coins"
            value={action.amount}
            onChange={(amount) => onChange({ ...action, amount: Math.max(0, Math.round(amount)) })}
          />
        )}
        {action.type === "moveTo" && <NumberInput label="Cell" value={action.tileId} onChange={(tileId) => onChange({ ...action, tileId })} />}
        {action.type === "skipTurn" && <NumberInput label="Turns" value={action.turns ?? 1} onChange={(turns) => onChange({ ...action, turns: Math.max(1, Math.round(turns)) })} />}
        {action.type !== "coins" && action.type !== "coinTransfer" && action.type !== "coinRedistribute" && action.type !== "move" && action.type !== "moveTo" && <div />}
      </div>
      {(action.type === "coinTransfer" || action.type === "coinRedistribute") && (
        <TargetPicker
          label={action.type === "coinRedistribute" ? "Collect from" : "Take from"}
          target={action.from}
          players={players}
          onChange={(from) => onChange({ ...action, from })}
        />
      )}
      {action.type === "swapPositions" && (
        <TargetPicker
          label="Swap with"
          target={action.withTarget}
          players={players}
          onChange={(withTarget) => onChange({ ...action, withTarget })}
        />
      )}
      {action.type === "moveToNearest" && (
        <SelectInput
          label="Direction"
          value={action.direction}
          options={[
            { value: "ahead", label: "Ahead" },
            { value: "behind", label: "Behind" },
          ]}
          onChange={(direction) => onChange({ ...action, direction: direction as "ahead" | "behind" })}
        />
      )}
      {action.type === "moveToPlayerPosition" && (
        <TargetPicker
          label="Move to player"
          target={action.withTarget}
          players={players}
          onChange={(withTarget) => onChange({ ...action, withTarget })}
        />
      )}
      {action.type === "applyEffect" && (
        <EffectTypeSummary effect={selectedEffect} effectId={action.effectId} />
      )}
      <TextInput label="Display text" value={text} onChange={(value) => onChange(updateActionText(action, value))} />
      <details className="mt-3 rounded-md border border-white/10 bg-black/20 p-2">
        <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.12em] text-slate-300">Advanced JSON</summary>
        <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-black/25 p-2 text-[0.65rem] text-slate-300">{JSON.stringify(action, null, 2)}</pre>
      </details>
    </div>
  );
}

function EffectTypeSummary({ effect, effectId }: { effect?: EffectDef; effectId: string }) {
  const consequences = effect ? effectConsequencesFor(effect) : [];
  return (
    <div className="mt-3 rounded-md border border-cyan-200/20 bg-cyan-300/10 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-black uppercase tracking-[0.12em] text-cyan-100">{effect?.name ?? effectId}</p>
          <p className="mt-1 text-[0.68rem] font-bold leading-4 text-slate-400">{effect?.description ?? "Missing effect type."}</p>
        </div>
        {effect && (
          <span className="shrink-0 rounded-sm border border-cyan-200/25 bg-cyan-300/10 px-2 py-1 text-[0.62rem] font-black uppercase text-cyan-100">
            {effectRemainingLabel(durationPreview(effect.duration))}
          </span>
        )}
      </div>
      {consequences.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {consequences.slice(0, 4).map((consequence, index) => (
            <span key={`${consequence.type}-${index}`} className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[0.62rem] font-bold text-slate-200">
              {actionSummary(consequence)}
            </span>
          ))}
          {consequences.length > 4 && <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[0.62rem] font-bold text-slate-400">+{consequences.length - 4}</span>}
        </div>
      )}
    </div>
  );
}

function EffectCompositionEditor({
  effect,
  players,
  onChange,
}: {
  effect: EffectDef;
  players: GameContent["players"];
  onChange: (updater: (effect: EffectDef) => EffectDef) => void;
}) {
  const consequences = effectConsequencesFor(effect);
  return (
    <div className="mt-3 rounded-md border border-cyan-200/20 bg-cyan-300/10 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-black uppercase tracking-[0.12em] text-cyan-100">Timed consequences</p>
          <p className="mt-1 text-[0.68rem] font-bold leading-4 text-slate-400">{effect.description ?? "Compose the effect from the same consequence actions."}</p>
        </div>
        <span className="shrink-0 rounded-sm border border-cyan-200/25 bg-cyan-300/10 px-2 py-1 text-[0.62rem] font-black uppercase text-cyan-100">
          {effectRemainingLabel(durationPreview(effect.duration))}
        </span>
      </div>
      <TextInput label="Effect name" value={effect.name} onChange={(name) => onChange((current) => ({ ...current, name: name || current.name }))} />
      <TextInput
        label="Icon"
        value={effect.icon ?? ""}
        onChange={(icon) => onChange((current) => ({ ...current, icon: icon || undefined }))}
      />
      <TextInput
        label="Description"
        value={effect.description ?? ""}
        onChange={(description) => onChange((current) => ({ ...current, description: description || undefined }))}
      />
      <DurationEditor duration={effect.duration} onChange={(duration) => onChange((current) => ({ ...current, duration }))} />
      <div className="mt-3 space-y-2">
        {consequences.map((consequence, index) => (
          <EffectConsequenceRow
            key={`${consequence.type}-${index}`}
            action={consequence}
            players={players}
            onChange={(next) =>
              onChange((current) => ({
                ...current,
                consequences: consequences.map((item, i) => (i === index ? next : item)),
                actions: undefined,
                modifiers: undefined,
              }))
            }
            onRemove={() =>
              onChange((current) => ({
                ...current,
                consequences: consequences.filter((_, i) => i !== index),
                actions: undefined,
                modifiers: undefined,
              }))
            }
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          onChange((current) => ({
            ...current,
            consequences: [...(current.consequences ?? current.actions ?? []), { type: "movementMultiplier", hook: "beforeMovement", multiplier: 0.5, rounding: "ceil" }],
            actions: undefined,
            modifiers: undefined,
          }));
        }}
        className="mt-3 w-full rounded-md border border-cyan-200/25 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100 transition hover:bg-cyan-300/15"
      >
        Add effect consequence
      </button>
    </div>
  );
}

function EffectConsequenceRow({
  action,
  players,
  onChange,
  onRemove,
}: {
  action: EventAction;
  players: GameContent["players"];
  onChange: (action: EventAction) => void;
  onRemove: () => void;
}) {
  const editable = effectEditableAction(action);
  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-2">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-black text-white">{actionSummary(editable)}</p>
        <button type="button" onClick={onRemove} className="shrink-0 rounded-md border border-rose-200/20 bg-rose-500/10 px-2 py-1 text-[0.62rem] font-black text-rose-100 transition hover:bg-rose-500/15">
          Remove
        </button>
      </div>
      <TextInput label="Icon" value={editable.icon ?? ""} onChange={(icon) => onChange({ ...editable, icon: icon || undefined })} />
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
        <SelectInput
          label="Type"
          value={editable.type}
          options={[
            { value: "movementMultiplier", label: "Movement multiplier" },
            { value: "halfMovement", label: "Half movement" },
            { value: "diceBias", label: "Dice bias" },
            { value: "skipTurn", label: "Skip turn" },
            { value: "extraTurn", label: "Extra turn" },
            { value: "coins", label: "Coins" },
            { value: "move", label: "Move" },
            { value: "moveTo", label: "Move to cell" },
            { value: "swapPositions", label: "Swap positions" },
            { value: "moveToNearest", label: "Move to nearest" },
            { value: "moveToPlayerPosition", label: "Move to player position" },
          ]}
          onChange={(type) => onChange(convertEffectActionType(editable, type as Exclude<EventAction["type"], "text" | "offlineAction" | "applyEffect">))}
        />
        {(editable.type === "coins" || editable.type === "move") && (
          <NumberInput
            label={editable.type === "coins" ? "Coins" : "Cells"}
            value={editable.type === "coins" ? editable.value : editable.delta}
            onChange={(value) => onChange(updateActionAmount(editable, value))}
          />
        )}
        {editable.type === "moveTo" && <NumberInput label="Cell" value={editable.tileId} onChange={(tileId) => onChange({ ...editable, tileId })} />}
        {editable.type === "movementMultiplier" && (
          <NumberInput label="x" value={editable.multiplier} onChange={(multiplier) => onChange({ ...editable, multiplier: Math.max(0, multiplier) })} />
        )}
        {editable.type === "diceBias" && (
          <NumberInput label="Face" value={editable.face} onChange={(face) => onChange({ ...editable, face: clampInt(face, 1, 6) })} />
        )}
        {editable.type !== "coins" && editable.type !== "move" && editable.type !== "moveTo" && editable.type !== "movementMultiplier" && editable.type !== "diceBias" && <div />}
      </div>
      {editable.type === "movementMultiplier" && (
        <SelectInput
          label="Rounding"
          value={editable.rounding ?? "round"}
          options={[
            { value: "round", label: "Round" },
            { value: "ceil", label: "Ceil" },
            { value: "floor", label: "Floor" },
          ]}
          onChange={(rounding) => onChange({ ...editable, rounding: rounding as "floor" | "ceil" | "round" })}
        />
      )}
      {editable.type === "diceBias" && (
        <NumberInput
          label="Chance change percent"
          value={editable.chanceDeltaPercent}
          onChange={(chanceDeltaPercent) => onChange({ ...editable, chanceDeltaPercent })}
        />
      )}
      {editable.type === "swapPositions" && (
        <TargetPicker
          label="Swap with"
          target={editable.withTarget}
          players={players}
          onChange={(withTarget) => onChange({ ...editable, withTarget })}
        />
      )}
      {editable.type === "moveToNearest" && (
        <SelectInput
          label="Direction"
          value={editable.direction}
          options={[
            { value: "ahead", label: "Ahead" },
            { value: "behind", label: "Behind" },
          ]}
          onChange={(direction) => onChange({ ...editable, direction: direction as "ahead" | "behind" })}
        />
      )}
      <SelectInput
        label="Runs"
        value={hookValueForAction(editable)}
        disabled={isModifierEffectAction(editable)}
        options={hookOptionsForAction(editable)}
        onChange={(hook) => onChange({ ...editable, hook: hook as EventAction["hook"] })}
      />
      {"target" in editable && editable.target && typeof editable.target !== "string" && "playerId" in editable.target && (
        <SelectInput
          label="Player"
          value={editable.target.playerId}
          options={players.map((player) => ({ value: player.id, label: player.name }))}
          onChange={(playerId) => onChange({ ...editable, target: { playerId } } as EventAction)}
        />
      )}
    </div>
  );
}

function JsonModal({
  exportJson,
  importText,
  setImportText,
  onCopy,
  onDownload,
  onImport,
  onReset,
  onClose,
}: {
  exportJson: string;
  importText: string;
  setImportText: (value: string) => void;
  onCopy: () => void;
  onDownload: () => void;
  onImport: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
      <section className="w-[min(58rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-white/15 bg-[#151922] text-slate-100 shadow-2xl shadow-black/45">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-black uppercase tracking-[0.16em] text-slate-300">Import / export events</h2>
          <button type="button" onClick={onClose} className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-black text-slate-100 transition hover:bg-white/10">
            Close
          </button>
        </header>
        <div className="grid max-h-[calc(100dvh-8rem)] gap-3 overflow-auto p-4 lg:grid-cols-2">
          <div>
            <label className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">
              Import JSON
              <textarea
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                placeholder="Paste content JSON"
                className="mt-2 h-72 w-full resize-none rounded-md border border-white/15 bg-[#10131a] p-3 font-mono text-xs text-slate-100 outline-none focus:border-cyan-300"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={onImport} disabled={!importText.trim()} className="rounded-md border border-cyan-200/25 bg-cyan-300/10 px-3 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-300/15 disabled:opacity-40">
                Import
              </button>
              <button type="button" onClick={onReset} className="rounded-md border border-rose-200/20 bg-rose-500/10 px-3 py-2 text-sm font-bold text-rose-100 transition hover:bg-rose-500/15">
                Recover browser draft
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">
              Current export
              <textarea
                readOnly
                value={exportJson}
                className="mt-2 h-72 w-full resize-none rounded-md border border-white/15 bg-black/30 p-3 font-mono text-[0.65rem] text-slate-200"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={onCopy} className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-slate-100 transition hover:bg-white/10">
                Copy
              </button>
              <button type="button" onClick={onDownload} className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-slate-100 transition hover:bg-white/10">
                Download
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function TypeBadge({ type, missing }: { type: EventActivityType; missing: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-1 text-[0.62rem] font-black uppercase tracking-[0.08em] ${
        missing ? "border-rose-200/35 bg-rose-500/12 text-rose-100" : "border-cyan-200/35 bg-cyan-300/12 text-cyan-100"
      }`}
    >
      {missing ? `${activityLabel(type)} missing` : activityLabel(type)}
    </span>
  );
}

function activityLabel(type: EventActivityType): string {
  if (type === "prompt") return "Prompt";
  if (type === "hostPick") return "Host pick";
  if (type === "selfTap") return "Self tap";
  if (type === "vote") return "Vote";
  if (type === "cardVote") return "Card vote";
  if (type === "judge") return "Judge";
  if (type === "timing") return "Timing";
  if (type === "reaction") return "Reaction";
  if (type === "buzzer") return "Buzzer";
  if (type === "estimate") return "Estimate";
  if (type === "whack") return "Whack";
  if (type === "maze") return "Laberinto";
  if (type === "flappy") return "Flappy bird";
  if (type === "snake") return "Snake";
  if (type === "horserace") return "Carrera de caballos";
  if (type === "redlight") return "Luz roja, luz verde";
  return type;
}

function eventSearchText(id: string, event: GameEventDef, content: GameContent): string {
  const eventJson = JSON.stringify(event);
  const mediaText = [...(event.media ?? []), ...(event.activity?.media ?? [])]
    .map((ref) => {
      const asset = content.mediaAssets?.[ref.assetId];
      return `${ref.assetId} ${ref.caption ?? ""} ${asset?.caption ?? ""} ${asset?.alt ?? ""} ${asset?.src ?? ""}`;
    })
    .join(" ");
  const effectText = Object.entries(content.effects ?? {})
    .filter(([effectId]) => eventJson.includes(`"effectId":"${effectId}"`))
    .map(([effectId, effect]) => `${effectId} ${effect.name} ${effect.description ?? ""}`)
    .join(" ");
  return normalizeEventSearchText(
    `${id} ${eventTitle(event)} ${event.activity ? activityLabel(event.activity.type) : ""} ${eventJson} ${mediaText} ${effectText}`
  );
}

function normalizeEventSearchText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("es-AR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function MetaPill({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-white/10 bg-black/15 px-2 py-0.5 text-[0.65rem] font-bold text-slate-300">{children}</span>;
}

function addMediaToContent(
  content: GameContent,
  eventId: string,
  file: File,
  src: string
): GameContent {
  const event = content.events[eventId];
  if (!event) return content;
  const id = nextMediaAssetId(content.mediaAssets ?? {}, file.name);
  const asset: ContentMediaAssetDef = {
    id,
    type: "image",
    src,
    alt: file.name.replace(/\.[^.]+$/, ""),
    fit: "cover",
    crop: { x: 0, y: 0, width: 1, height: 1 },
  };
  const ref: ActivityMediaRef = {
    assetId: id,
    caption: asset.alt,
    placement: "both",
  };
  return {
    ...content,
    mediaAssets: {
      ...(content.mediaAssets ?? {}),
      [id]: asset,
    },
    events: {
      ...content.events,
      [eventId]: appendMediaRef(event, ref),
    },
  };
}

function appendMediaRef(event: GameEventDef, ref: ActivityMediaRef): GameEventDef {
  const canonical = consolidateEventMedia(event);
  return { ...canonical, media: [...(canonical.media ?? []), ref] };
}

function updateMediaRefInEvent(
  event: GameEventDef,
  index: number,
  ref: ActivityMediaRef
): GameEventDef {
  const canonical = consolidateEventMedia(event);
  return { ...canonical, media: compactMediaRefs((canonical.media ?? []).map((item, itemIndex) => (itemIndex === index ? ref : item))) };
}

function removeMediaRefFromEvent(event: GameEventDef, index: number): GameEventDef {
  const canonical = consolidateEventMedia(event);
  return { ...canonical, media: compactMediaRefs((canonical.media ?? []).filter((_, itemIndex) => itemIndex !== index)) };
}

function compactMediaRefs(media: ActivityMediaRef[]): ActivityMediaRef[] | undefined {
  return media.length ? media : undefined;
}

function consolidateContentMedia(content: GameContent): GameContent {
  return {
    ...content,
    events: Object.fromEntries(Object.entries(content.events).map(([id, event]) => [id, consolidateEventMedia(event)])),
  };
}

function consolidateEventMedia(event: GameEventDef): GameEventDef {
  const media = resolveEventMediaRefs(event, event.activity);
  if (!event.activity?.media?.length) return { ...event, media };
  return {
    ...event,
    media,
    activity: {
      ...event.activity,
      media: undefined,
    },
  };
}

function nextMediaAssetId(existing: Record<string, ContentMediaAssetDef>, fileName: string): string {
  const base = slugifyMediaId(fileName.replace(/\.[^.]+$/, "")) || "media";
  let id = base;
  let index = 2;
  while (existing[id]) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
}

function slugifyMediaId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function createPlaytestResolution(
  event: ResolvedGameEvent | null,
  state: GameState | null,
  players: Player[],
  results: RunResult[],
  cardVoteRun?: CardVotePlaytestRun | null
): PlaytestResolution | null {
  if (!event) return null;
  const minigame = state?.activeMinigame;
  if (!minigame) {
    const landingPlayerId = players[0]?.id;
    return {
      complete: true,
      submittedCount: 0,
      requiredCount: 0,
      ranking: landingPlayerId ? [landingPlayerId] : [],
      entries: landingPlayerId ? [playtestEntry(players, landingPlayerId, 1, 0, null, "Story event")] : [],
      actions: previewConsequenceRules(event.consequences ?? [], players, landingPlayerId ? [landingPlayerId] : [], landingPlayerId),
    };
  }

  const participants = minigame.participants;
  const requiredCount = participants.length;
  const submittedCount = participants.filter((id) => minigame.submitted.includes(id)).length;
  const subjects = minigame.subjects?.length ? minigame.subjects : participants;
  if (minigame.type === "cardVote" && cardVoteRun) {
    return createCardVotePlaytestResolution(event, minigame, players, cardVoteRun);
  }
  const complete = requiredCount > 0 && participants.every((id) => minigame.submitted.includes(id));
  const ranking = playtestRanking(minigame.type, subjects, participants, results, event.activity?.rigged, minigame.judge?.submissions);
  const entries = playtestRevealEntries(minigame.type, event.activity?.content, ranking, subjects, participants, players, results, minigame.judge?.submissions);
  const landingPlayerId = minigame.protagonistId ?? ranking[0];
  const payoutActions = minigame.type === "prompt"
    ? []
    : previewConsequenceRules(event.activity?.rankingPayout?.consequences ?? [], players, ranking, landingPlayerId);
  const payoutCoins = previewCoinTotals(payoutActions.flatMap((action) => action.coinTransactions ?? []));
  const entriesWithCoins = entries.map((entry) => ({ ...entry, coins: payoutCoins[entry.playerId] ?? 0 }));
  const actions = complete
    ? [
        ...payoutActions,
        ...previewConsequenceRules(event.consequences ?? [], players, ranking, landingPlayerId),
      ]
    : [];
  return { complete, submittedCount, requiredCount, ranking, entries: entriesWithCoins, actions };
}

function createCardVotePlaytestResolution(
  event: ResolvedGameEvent,
  minigame: NonNullable<GameState["activeMinigame"]>,
  players: Player[],
  run: CardVotePlaytestRun
): PlaytestResolution {
  const complete = run.phase === "complete";
  const ranking = applyRig(cardVotePlaytestRanking(run), event.activity?.rigged);
  const landingPlayerId = minigame.protagonistId ?? ranking[0];
  const payoutActions = complete
    ? previewConsequenceRules(event.activity?.rankingPayout?.consequences ?? [], players, ranking, landingPlayerId)
    : [];
  const payoutCoins = previewCoinTotals(payoutActions.flatMap((action) => action.coinTransactions ?? []));
  const entries = ranking.map((playerId, index) => {
    const cards = run.cardCounts[playerId] ?? 0;
    const wonCards = run.cardsWonByPlayer[playerId] ?? [];
    const visibleCards = wonCards.slice(0, 2).map((card) => `“${card}”`);
    const remaining = wonCards.length - visibleCards.length;
    return playtestEntry(
      players,
      playerId,
      index + 1,
      cards,
      { cards, wonCards },
      `${cards} ${cards === 1 ? "carta" : "cartas"}`,
      wonCards.length ? `Recibió ${visibleCards.join(" · ")}${remaining > 0 ? ` · +${remaining} más` : ""}` : "Sin cartas",
      payoutCoins[playerId] ?? 0
    );
  });
  const actions = complete
    ? [
        ...payoutActions,
        ...previewConsequenceRules(event.consequences ?? [], players, ranking, landingPlayerId),
      ]
    : [];
  const progressLabel = run.phase === "result"
    ? `Card ${run.cardIndex + 1}/${run.cards.length} resolved. Review the votes, then advance.`
    : `Card ${run.cardIndex + 1}/${run.cards.length}: ${run.submitted.length}/${run.participants.length} votes submitted.`;
  return {
    complete,
    submittedCount: run.submitted.length,
    requiredCount: run.participants.length,
    progressLabel,
    ranking,
    entries,
    actions,
  };
}

function playtestRanking(
  type: EventActivityType,
  subjects: string[],
  participants: string[],
  results: RunResult[],
  rigged: EventActivity["rigged"],
  judgeSubmissions?: { id: string; text: string }[]
): string[] {
  const resultByPlayer = new Map<string, RunResult>();
  for (const result of results) {
    if (!resultByPlayer.has(result.playerId)) resultByPlayer.set(result.playerId, result);
  }
  const voteScores = type === "vote" ? voteScoresFor(subjects, participants, resultByPlayer) : null;
  const judgeScores = type === "judge" ? judgeVoteScoresFor(subjects, participants, results, judgeSubmissions) : null;
  const promptScore = type === "prompt" ? participants.filter((id) => resultByPlayer.has(id)).length : null;
  const order = new Map(subjects.map((id, index) => [id, index]));
  const ranked = [...subjects]
    .sort((a, b) => {
      const aScore = judgeScores?.get(a) ?? voteScores?.get(a) ?? promptScore ?? resultByPlayer.get(a)?.score ?? Number.NEGATIVE_INFINITY;
      const bScore = judgeScores?.get(b) ?? voteScores?.get(b) ?? promptScore ?? resultByPlayer.get(b)?.score ?? Number.NEGATIVE_INFINITY;
      return bScore - aScore || (order.get(a) ?? 0) - (order.get(b) ?? 0);
    });
  return applyRig(ranked, rigged);
}

function voteScoresFor(subjects: string[], participants: string[], resultByPlayer: Map<string, RunResult>): Map<string, number> {
  const scores = new Map<string, number>(subjects.map((id) => [id, 0]));
  for (const participantId of participants) {
    const votedFor = (resultByPlayer.get(participantId)?.payload as { votedFor?: string } | undefined)?.votedFor;
    if (votedFor && scores.has(votedFor)) scores.set(votedFor, (scores.get(votedFor) ?? 0) + 1);
  }
  return scores;
}

function judgeVoteScoresFor(
  subjects: string[],
  participants: string[],
  results: RunResult[],
  submissions?: { id: string; text: string }[]
): Map<string, number> {
  const scores = new Map<string, number>(subjects.map((id) => [id, 0]));
  if (!submissions?.length) return scores;
  const ownerBySubmission = new Map(submissions.map((submission, index) => [submission.id, participants[index]]));
  for (const result of results) {
    const votedForSubmissionId = (result.payload as { votedForSubmissionId?: string } | undefined)?.votedForSubmissionId;
    const ownerId = votedForSubmissionId ? ownerBySubmission.get(votedForSubmissionId) : undefined;
    if (ownerId && scores.has(ownerId)) scores.set(ownerId, (scores.get(ownerId) ?? 0) + 1);
  }
  return scores;
}

function playtestRevealEntries(
  type: EventActivityType,
  content: unknown,
  ranking: string[],
  subjects: string[],
  participants: string[],
  players: Player[],
  results: RunResult[],
  judgeSubmissions?: { id: string; text: string }[]
): RevealEntry[] {
  const resultByPlayer = new Map<string, RunResult>();
  for (const result of results) {
    if (!resultByPlayer.has(result.playerId)) resultByPlayer.set(result.playerId, result);
  }
  const votersBySubject = type === "vote" ? votersBySubjectFor(subjects, participants, resultByPlayer) : null;
  const confirmedBy = type === "prompt" ? participants.filter((id) => resultByPlayer.has(id)) : [];
  const missingConfirmers = type === "prompt" ? participants.filter((id) => !resultByPlayer.has(id)) : [];
  const judgeVotesByOwner = type === "judge" ? judgeVotesByOwnerFor(participants, results, judgeSubmissions) : null;

  return ranking.map((playerId, index) => {
    const result = resultByPlayer.get(playerId);
    if (type === "prompt") {
      return playtestEntry(
        players,
        playerId,
        index + 1,
        confirmedBy.length,
        { confirmed: missingConfirmers.length === 0, confirmedBy, missingConfirmers, requiredConfirmers: participants },
        `${confirmedBy.length}/${participants.length} confirmaciones`,
        missingConfirmers.length
          ? `Confirmaron ${namesFor(confirmedBy, players) || "nadie"} - Faltan ${namesFor(missingConfirmers, players)}`
          : `Confirmaron ${namesFor(confirmedBy, players) || "nadie"}`
      );
    }
    if (type === "vote") {
      const voters = votersBySubject?.get(playerId) ?? [];
      return playtestEntry(
        players,
        playerId,
        index + 1,
        voters.length,
        { votes: voters.length, voters, votedFor: (resultByPlayer.get(playerId)?.payload as { votedFor?: string } | undefined)?.votedFor },
        `${voters.length} ${voters.length === 1 ? "voto" : "votos"}`,
        voters.length ? `Votos de ${namesFor(voters, players)}` : "Sin votos"
      );
    }
    if (type === "judge") {
      const votes = judgeVotesByOwner?.get(playerId) ?? [];
      const submission = judgeSubmissions?.[participants.indexOf(playerId)];
      return playtestEntry(
        players,
        playerId,
        index + 1,
        votes.length,
        { message: submission?.text ?? "", votes: votes.length, voters: votes },
        `${votes.length} ${votes.length === 1 ? "voto" : "votos"}`,
        `Texto: ${submission?.text ?? "(sin respuesta)"} - ${votes.length ? `Votos de ${namesFor(votes, players)}` : "Sin votos"}`
      );
    }
    const score = result?.score ?? Number.NEGATIVE_INFINITY;
    const payload = result?.payload ?? null;
    const display = playtestResultDisplay(type, content, score, payload);
    return playtestEntry(players, playerId, index + 1, Number.isFinite(score) ? score : 0, payload, display.resultLabel, display.detailLabel);
  });
}

function judgeVotesByOwnerFor(
  participants: string[],
  results: RunResult[],
  submissions?: { id: string; text: string }[]
): Map<string, string[]> {
  const votesByOwner = new Map(participants.map((id) => [id, [] as string[]]));
  if (!submissions?.length) return votesByOwner;
  const ownerBySubmission = new Map(submissions.map((submission, index) => [submission.id, participants[index]]));
  for (const result of results) {
    const votedForSubmissionId = (result.payload as { votedForSubmissionId?: string } | undefined)?.votedForSubmissionId;
    const ownerId = votedForSubmissionId ? ownerBySubmission.get(votedForSubmissionId) : undefined;
    if (ownerId) votesByOwner.get(ownerId)?.push(result.playerId);
  }
  return votesByOwner;
}

function votersBySubjectFor(subjects: string[], participants: string[], resultByPlayer: Map<string, RunResult>): Map<string, string[]> {
  const voters = new Map(subjects.map((id) => [id, [] as string[]]));
  for (const participantId of participants) {
    const votedFor = (resultByPlayer.get(participantId)?.payload as { votedFor?: string } | undefined)?.votedFor;
    if (votedFor && voters.has(votedFor)) voters.get(votedFor)!.push(participantId);
  }
  return voters;
}

function playtestEntry(
  players: Player[],
  playerId: string,
  rank: number,
  score: number,
  payload: unknown,
  resultLabel?: string,
  detailLabel?: string,
  coins = 0
): RevealEntry {
  return {
    playerId,
    name: nameFor(players, playerId),
    rank,
    score,
    coins,
    payload,
    resultLabel,
    detailLabel,
  };
}

function playtestResultDisplay(
  type: EventActivityType,
  content: unknown,
  score: number,
  payload: unknown
): Pick<RevealEntry, "resultLabel" | "detailLabel"> {
  if (!Number.isFinite(score)) return { resultLabel: "Sin resultado" };
  const data = (payload ?? {}) as Record<string, unknown>;
  if (type === "buzzer") {
    const body = isRecord(content) ? content : {};
    const options = Array.isArray(body.options) ? body.options.map((option) => String(option)) : [];
    const answerIndex = typeof body.answer === "number" ? body.answer : 0;
    const pickedIndex = typeof data.answerIndex === "number" ? data.answerIndex : -1;
    const time = typeof data.timeMs === "number" ? `${Math.round(data.timeMs)}ms` : undefined;
    return {
      resultLabel: data.correct ? "Correcto" : "Incorrecto",
      detailLabel: [`Eligió ${optionLabel(options, pickedIndex)}`, `Correcta: ${optionLabel(options, answerIndex)}`, time].filter(Boolean).join(" - "),
    };
  }
  if (type === "whack" && typeof data.hits === "number") return { resultLabel: `${data.hits} aciertos` };
  return { resultLabel: `Puntaje ${formatScore(score)}`, detailLabel: payloadSummary(payload) };
}

function previewConsequenceRules(
  rules: ConsequenceRule[],
  players: Player[],
  ranking: string[],
  landingPlayerId?: string
): AppliedEventAction[] {
  return rules.flatMap((rule) => {
    if (!resolvePreviewTargetIds(rule.appliesTo, players, { landingPlayerId, ranking }).length) return [];
    return previewActions(rule.actions, players, { landingPlayerId, ranking, defaultTarget: rule.appliesTo });
  });
}

function previewActions(
  actions: EventAction[],
  players: Player[],
  context: { landingPlayerId?: string; actingPlayerId?: string; targetPlayerId?: string; ranking?: string[]; defaultTarget?: EventActionTarget }
): AppliedEventAction[] {
  return actions.flatMap((action) => {
    const target = action.target ?? context.defaultTarget ?? "landing";
    const targetPlayerIds = resolvePreviewTargetIds(target, players, context);
    if (action.type !== "text" && targetPlayerIds.length === 0) return [];
    return [previewAction(action, targetPlayerIds, players, context)];
  });
}

function previewAction(
  action: EventAction,
  targetPlayerIds: string[],
  players: Player[],
  context: { landingPlayerId?: string; actingPlayerId?: string; targetPlayerId?: string; ranking?: string[]; defaultTarget?: EventActionTarget }
): AppliedEventAction {
  if (action.type === "text") return { type: action.type, targetPlayerIds, text: action.text };
  if (action.type !== "applyEffect" && (action.duration || isModifierEffectAction(action))) {
    return {
      type: action.type,
      targetPlayerIds,
      text: action.text ?? `${namesFor(targetPlayerIds, players)} receives ${consequenceLabel(action)}`,
    };
  }
  if (action.type === "coins") {
    const coinTransactions = previewCoinDeltas(targetPlayerIds, action.value, action.text ?? consequenceLabel(action), players);
    return { type: action.type, targetPlayerIds, text: action.text ?? coinTransactionsText(coinTransactions, players), value: action.value, coinTransactions };
  }
  if (action.type === "coinTransfer") {
    const fromPlayerId = resolvePreviewTargetIds(action.from, players, context)[0];
    const toPlayerId = targetPlayerIds[0];
    const coinTransactions = fromPlayerId && toPlayerId ? previewCoinTransfer(fromPlayerId, toPlayerId, action.amount, action.text ?? consequenceLabel(action), players) : [];
    return { type: action.type, targetPlayerIds: toPlayerId ? [toPlayerId] : [], text: action.text ?? coinTransactionsText(coinTransactions, players), value: action.amount, coinTransactions };
  }
  if (action.type === "coinRedistribute") {
    const toPlayerId = targetPlayerIds[0];
    const sourceIds = toPlayerId ? resolvePreviewTargetIds(action.from, players, context).filter((id) => id !== toPlayerId) : [];
    const balances = new Map(players.map((player) => [player.id, player.coins]));
    const coinTransactions = toPlayerId
      ? sourceIds.flatMap((fromPlayerId, index) => previewCoinTransfer(fromPlayerId, toPlayerId, action.amount, action.text ?? consequenceLabel(action), players, balances, index * 2))
      : [];
    return { type: action.type, targetPlayerIds: toPlayerId ? [toPlayerId] : [], text: action.text ?? coinTransactionsText(coinTransactions, players), value: action.amount, coinTransactions };
  }
  if (action.type === "move") {
    return { type: action.type, targetPlayerIds, text: action.text ?? moveSummary(targetPlayerIds, players, action.delta), value: action.delta };
  }
  if (action.type === "moveTo") {
    return { type: action.type, targetPlayerIds, text: action.text ?? `Mover a casillero ${action.tileId}`, tileId: action.tileId };
  }
  if (action.type === "skipTurn") {
    return { type: action.type, targetPlayerIds, text: action.text ?? `${namesFor(targetPlayerIds, players)} pierde su próximo turno` };
  }
  if (action.type === "extraTurn") {
    return { type: action.type, targetPlayerIds, text: action.text ?? `${namesFor(targetPlayerIds, players)} juega otro turno` };
  }
  if (action.type === "offlineAction") {
    return {
      type: action.type,
      targetPlayerIds,
      text: action.text ?? `${namesFor(targetPlayerIds, players)}: ${consequenceLabel(action)}`,
      offlineAction: action.action,
      requiresConfirmation: true,
    };
  }
  if (action.type === "halfMovement" || action.type === "movementMultiplier" || action.type === "diceBias" || action.type === "swapPositions" || action.type === "moveToNearest" || action.type === "moveToPlayerPosition") {
    return {
      type: action.type,
      targetPlayerIds,
      text: action.text ?? consequenceLabel(action),
    };
  }
  return {
    type: action.type,
    targetPlayerIds,
    text: action.text ?? `Apply ${action.effectId}`,
    effectId: action.effectId,
  };
}

function resolvePreviewTargetIds(
  target: EventActionTarget,
  players: Player[],
  context: { landingPlayerId?: string; actingPlayerId?: string; targetPlayerId?: string; ranking?: string[] }
): string[] {
  return resolveEventActionTargetIds(target, {
    landingPlayerId: context.landingPlayerId,
    actingPlayerId: context.actingPlayerId ?? context.landingPlayerId,
    targetPlayerId: context.targetPlayerId ?? context.landingPlayerId,
    ranking: context.ranking,
    connectedPlayerIds: players.map((player) => player.id),
    playerIds: players.map((player) => player.id),
    turnOrder: players.map((player) => player.id),
    players,
  });
}

function previewCoinDeltas(playerIds: string[], delta: number, label: string, players: Player[]): CoinTransaction[] {
  const balances = new Map(players.map((player) => [player.id, player.coins]));
  return playerIds.map((playerId, index) => previewCoinDelta(playerId, delta, label, balances, index));
}

function previewCoinTransfer(
  fromPlayerId: string,
  toPlayerId: string,
  amount: number,
  label: string,
  players: Player[],
  balances = new Map(players.map((player) => [player.id, player.coins])),
  startIndex = 0
): CoinTransaction[] {
  if (fromPlayerId === toPlayerId) return [];
  const debit = previewCoinDelta(fromPlayerId, -Math.abs(amount), label, balances, startIndex, toPlayerId);
  const transferred = Math.abs(debit.delta);
  if (transferred <= 0) return [debit];
  const credit = previewCoinDelta(toPlayerId, transferred, label, balances, startIndex + 1, fromPlayerId);
  return [debit, credit];
}

function previewCoinDelta(
  playerId: string,
  delta: number,
  label: string,
  balances: Map<string, number>,
  index: number,
  counterpartyPlayerId?: string
): CoinTransaction {
  const requestedDelta = Math.round(Number.isFinite(delta) ? delta : 0);
  const before = Math.max(0, Math.round(balances.get(playerId) ?? 0));
  const actualDelta = requestedDelta < 0 ? -Math.min(before, Math.abs(requestedDelta)) : requestedDelta;
  const after = Math.max(0, before + actualDelta);
  balances.set(playerId, after);
  return {
    id: `preview-coin-${playerId}-${index}`,
    playerId,
    delta: actualDelta,
    requestedDelta,
    before,
    after,
    source: { kind: "consequence", label },
    text: label,
    ...(counterpartyPlayerId ? { counterpartyPlayerId } : {}),
    ...(actualDelta !== requestedDelta ? { clamped: true } : {}),
  };
}

function previewCoinTotals(transactions: CoinTransaction[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const transaction of transactions) {
    totals[transaction.playerId] = (totals[transaction.playerId] ?? 0) + transaction.delta;
  }
  return totals;
}

function coinTransactionsText(transactions: CoinTransaction[], players: Player[]): string {
  if (!transactions.length) return "No coins changed.";
  return transactions.map((transaction) => {
    const name = nameFor(players, transaction.playerId);
    const verb = transaction.delta >= 0 ? "gana" : "pierde";
    const amount = Math.abs(transaction.delta);
    const clamp = transaction.clamped ? ` (max ${Math.abs(transaction.requestedDelta)})` : "";
    return `${name} ${verb} ${amount} moneda(s)${clamp}`;
  }).join(". ");
}

function loadInitialContent(): GameContent {
  return BASE_CONTENT;
}

function loadSavedEventBuilderContent(): GameContent | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    return consolidateContentMedia(migrateEffectDraft(normalizeContentSchema(JSON.parse(saved))));
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function persistEventBuilderDraft(exportJson: string): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, exportJson);
    return true;
  } catch (error) {
    console.warn("Unable to persist event builder browser draft", error);
    return false;
  }
}

function migrateEffectDraft(content: GameContent): GameContent {
  if (!content.effects?.[LEGACY_SHOT_EFFECT_ID]) return content;
  const { [LEGACY_SHOT_EFFECT_ID]: _legacy, ...restEffects } = content.effects;
  return {
    ...content,
    effects: {
      ...restEffects,
      [DEFAULT_EFFECT_ID]: restEffects[DEFAULT_EFFECT_ID] ?? defaultComposedEffect(),
    },
    events: mapEvents(content.events, rewriteLegacyEffectAction),
    artifacts: content.artifacts
      ? Object.fromEntries(
          Object.entries(content.artifacts).map(([id, artifact]) => [
            id,
            {
              ...artifact,
              consequences: artifact.consequences?.map(rewriteLegacyEffectAction),
              effects: artifact.effects?.map((effectId) => (effectId === LEGACY_SHOT_EFFECT_ID ? DEFAULT_EFFECT_ID : effectId)),
            },
          ])
        )
      : content.artifacts,
  };
}

function mapEvents(
  events: GameContent["events"],
  mapAction: (action: ImmediateConsequenceDef) => ImmediateConsequenceDef
): GameContent["events"] {
  return Object.fromEntries(
    Object.entries(events).map(([id, event]) => [
      id,
      {
        ...event,
        consequences: event.consequences?.map((rule) => ({
          ...rule,
          actions: rule.actions.map(mapAction),
        })),
        activity: event.activity
          ? {
              ...event.activity,
              rankingPayout: event.activity.rankingPayout
                ? {
                    ...event.activity.rankingPayout,
                    consequences: event.activity.rankingPayout.consequences?.map((rule) => ({
                      ...rule,
                      actions: rule.actions.map(mapAction),
                    })),
                  }
                : undefined,
            }
          : undefined,
      },
    ])
  );
}

function rewriteLegacyEffectAction<T extends EventAction>(action: T): T {
  if (action.type !== "applyEffect" || action.effectId !== LEGACY_SHOT_EFFECT_ID) return action;
  return { ...action, effectId: DEFAULT_EFFECT_ID } as T;
}

function nextEffectId(effects: Record<string, EffectDef>): string {
  let index = Object.keys(effects).length + 1;
  let id = `effect-custom-${index}`;
  while (effects[id]) {
    index += 1;
    id = `effect-custom-${index}`;
  }
  return id;
}

function removeEffectFromContent(content: GameContent, effectId: string): GameContent {
  const { [effectId]: _deleted, ...effects } = content.effects ?? {};
  return {
    ...content,
    effects,
    events: mapEvents(content.events, (action) => rewriteDeletedEffectAction(action, effectId)),
    artifacts: content.artifacts
      ? Object.fromEntries(
          Object.entries(content.artifacts).map(([id, artifact]) => [
            id,
            {
              ...artifact,
              consequences: artifact.consequences?.map((action) => rewriteDeletedEffectAction(action, effectId)),
              effects: artifact.effects?.filter((id) => id !== effectId),
            },
          ])
        )
      : content.artifacts,
  };
}

function rewriteDeletedEffectAction<T extends EventAction>(action: T, deletedEffectId: string): T {
  if (action.type !== "applyEffect" || action.effectId !== deletedEffectId) return action;
  return { type: "coins", value: 1, text: action.text, ...("target" in action && action.target ? { target: action.target } : {}) } as T;
}

function nextEventId(events: Record<string, GameEventDef>): string {
  let index = Object.keys(events).length + 1;
  let id = `event-custom-${index}`;
  while (events[id]) {
    index += 1;
    id = `event-custom-${index}`;
  }
  return id;
}

function scopeSelectValue(trigger?: EventTriggerScope): string {
  return trigger?.type === "player" ? trigger.playerId : "all";
}

function triggerForValue(value: string): EventTriggerScope {
  return value === "all" ? { type: "anyPlayer" } : { type: "player", playerId: value };
}

function audienceLabel(trigger: EventTriggerScope | undefined, players: GameContent["players"]): string {
  if (trigger?.type === "player") return playerName(players, trigger.playerId);
  return "All players";
}

function playerName(players: GameContent["players"], playerId: string): string {
  return players.find((player) => player.id === playerId)?.name ?? playerId;
}

function targetKind(target: EventActionTarget): TargetKind {
  if (target === "landing" || target === "acting" || target === "target" || target === "winner" || target === "loser" || target === "everyone") return target;
  if ("playerId" in target) return "player";
  if ("rank" in target) return "rank";
  if ("coinSelector" in target) return target.coinSelector === "richest" ? "coinRichest" : "coinPoorest";
  if ("coinRank" in target) return "coinRank";
  if ("coinRankFrom" in target) return "coinRankRange";
  if ("nearest" in target) return target.nearest === "ahead" ? "nearestAhead" : "nearestBehind";
  return "rankRange";
}

function targetForKind(kind: TargetKind, players: GameContent["players"], previous: EventActionTarget): EventActionTarget {
  if (kind === "landing" || kind === "acting" || kind === "target" || kind === "winner" || kind === "loser" || kind === "everyone") return kind;
  if (kind === "nearestAhead") return { nearest: "ahead", from: "acting" };
  if (kind === "nearestBehind") return { nearest: "behind", from: "acting" };
  if (kind === "player") return { playerId: playerIdForTarget(previous, players) };
  if (kind === "rank") return { rank: rankFromFor(previous) };
  if (kind === "coinRichest") return { coinSelector: "richest" };
  if (kind === "coinPoorest") return { coinSelector: "poorest" };
  if (kind === "coinRank") return { coinRank: rankFromFor(previous) };
  if (kind === "coinRankRange") return { coinRankFrom: rankFromFor(previous), coinRankTo: rankToFor(previous) };
  return {
    rankFrom: rankFromFor(previous),
    rankTo: rankToFor(previous),
  };
}

function playerIdForTarget(target: EventActionTarget, players: GameContent["players"]): string {
  return typeof target !== "string" && "playerId" in target ? target.playerId : players[0]?.id ?? "";
}

function rankFromFor(target: EventActionTarget): number {
  if (typeof target !== "string" && "rankFrom" in target) return target.rankFrom;
  if (typeof target !== "string" && "rank" in target) return target.rank;
  if (typeof target !== "string" && "coinRankFrom" in target) return target.coinRankFrom;
  if (typeof target !== "string" && "coinRank" in target) return target.coinRank;
  return 1;
}

function rankToFor(target: EventActionTarget): number {
  if (typeof target !== "string" && "rankFrom" in target) return target.rankTo;
  if (typeof target !== "string" && "rank" in target) return target.rank;
  if (typeof target !== "string" && "coinRankFrom" in target) return target.coinRankTo;
  if (typeof target !== "string" && "coinRank" in target) return target.coinRank;
  return 2;
}

function consequenceTypeOptions(effects: Record<string, EffectDef>, action: EventAction): { value: string; label: string }[] {
  const base = [
    { value: "coins", label: "Coins" },
    { value: "coinTransfer", label: "Coin transfer" },
    { value: "coinRedistribute", label: "Coin redistribution" },
    { value: "move", label: "Move" },
    { value: "moveTo", label: "Move to cell" },
    { value: "skipTurn", label: "Skip turn" },
    { value: "extraTurn", label: "Extra turn" },
    { value: "swapPositions", label: "Swap positions" },
    { value: "moveToNearest", label: "Move to nearest" },
    { value: "moveToPlayerPosition", label: "Move to player position" },
  ];
  const effectOptions = Object.values(effects).map((effect) => ({ value: effectTypeOptionValue(effect.id), label: `Effect: ${effect.name}` }));
  if (action.type === "applyEffect" && !effects[action.effectId]) {
    effectOptions.push({ value: effectTypeOptionValue(action.effectId), label: `Missing effect: ${action.effectId}` });
  }
  return [...base, ...effectOptions];
}

function actionTypeSelectValue(action: EventAction): string {
  return action.type === "applyEffect" ? effectTypeOptionValue(action.effectId) : action.type;
}

function effectTypeOptionValue(effectId: string): string {
  return `effect:${effectId}`;
}

function isEffectTypeOption(value: string): boolean {
  return value.startsWith("effect:");
}

function effectIdFromTypeOption(value: string): string {
  return value.slice("effect:".length);
}

function convertActionToEffect(action: ImmediateConsequenceDef, effectId: string): ImmediateConsequenceDef {
  const text = "text" in action ? action.text : undefined;
  const target = "target" in action ? action.target : undefined;
  const icon = action.icon;
  return {
    type: "applyEffect",
    effectId,
    ...(target ? { target } : {}),
    ...(text ? { text } : {}),
    ...(icon ? { icon } : {}),
  };
}

function convertActionType(action: EventAction, type: Exclude<EventAction["type"], "text">, fallbackEffectId?: string): EventAction {
  const text = "text" in action ? action.text : undefined;
  const target = "target" in action ? action.target : undefined;
  const icon = action.icon;
  const amount = action.type === "coins" ? action.value : action.type === "move" ? action.delta : action.type === "coinTransfer" || action.type === "coinRedistribute" ? action.amount : 1;
  const base = { ...(target ? { target } : {}), ...(text ? { text } : {}), ...(icon ? { icon } : {}) };
  if (type === "coins") return { type, value: amount, ...base };
  if (type === "coinTransfer") return { type, amount: Math.abs(amount), from: "target", ...base };
  if (type === "coinRedistribute") return { type, amount: Math.abs(amount), from: "everyone", ...base };
  if (type === "move") return { type, delta: amount, ...base };
  if (type === "moveTo") return { type, tileId: 1, ...base };
  if (type === "skipTurn") return { type, ...base };
  if (type === "extraTurn") return { type, ...base };
  if (type === "offlineAction") return { type, action: "custom", ...base };
  if (type === "halfMovement") return ensureModifierTiming({ type, hook: "beforeMovement", rounding: "ceil", ...base });
  if (type === "movementMultiplier") return ensureModifierTiming({ type, hook: "beforeMovement", multiplier: 0.5, rounding: "ceil", ...base });
  if (type === "diceBias") return ensureModifierTiming({ type, hook: "beforeRoll", face: 5, chanceDeltaPercent: 10, ...base });
  if (type === "swapPositions") return { type, withTarget: "winner", ...base };
  if (type === "moveToNearest") return { type, direction: "ahead", ...base };
  if (type === "moveToPlayerPosition") return { type, withTarget: "winner", ...base };
  return { type, effectId: fallbackEffectId ?? DEFAULT_EFFECT_ID, ...(target ? { target } : {}), ...(text ? { text } : {}), ...(icon ? { icon } : {}) };
}

function editableConsequenceAction(action: ImmediateConsequenceDef | undefined): ImmediateConsequenceDef {
  if (!action) return { type: "coins", value: 1 };
  return action;
}

function consequenceSummary(rule: ConsequenceRule, players: GameContent["players"]): string {
  const actions = consequenceActions(rule);
  const suffix = actions.length > 1 ? ` + ${actions.length - 1} more` : "";
  return `${targetLabel(rule.appliesTo, players)} - ${actionSummary(editableConsequenceAction(actions[0]))}${suffix}`;
}

function actionSummary(action: EventAction): string {
  if (action.type === "coins") return `${action.value >= 0 ? "+" : ""}${action.value} coins`;
  if (action.type === "coinTransfer") return `transfer ${action.amount} coins`;
  if (action.type === "coinRedistribute") return `redistribute ${action.amount} coins`;
  if (action.type === "move") return `${action.delta >= 0 ? "+" : ""}${action.delta} cells`;
  if (action.type === "moveTo") return `move to ${action.tileId}`;
  return consequenceLabel(action);
}

function durationPreview(duration: EffectDef["duration"]): EffectDurationState {
  if (duration.mode === "turns" || duration.mode === "rounds" || duration.mode === "uses") return { mode: duration.mode, remaining: duration.value };
  return { mode: duration.mode };
}

function durationValue(duration: EffectDef["duration"]): number {
  return duration.mode === "turns" || duration.mode === "rounds" || duration.mode === "uses" ? duration.value : 1;
}

function defaultComposedEffect(id = DEFAULT_EFFECT_ID): EffectDef {
  return {
    id,
    name: "Half movement",
    description: "For 2 rounds, move half of the die roll.",
    icon: "½",
    duration: { mode: "rounds", value: 2 },
    consequences: [{ type: "movementMultiplier", hook: "beforeMovement", multiplier: 0.5, rounding: "ceil", text: "Move half of the die roll.", icon: "½" }],
  };
}

function defaultCustomEffect(id: string): EffectDef {
  return {
    id,
    name: "New effect",
    description: "Custom reusable effect.",
    icon: "✦",
    duration: { mode: "uses", value: 1 },
    consequences: [{ type: "coins", hook: "onTurnEnd", value: 1, text: "Gain 1 coin.", icon: "🪙" }],
  };
}

function effectEditableAction(action: EventAction): EventAction {
  if (action.type === "applyEffect" || action.type === "offlineAction" || action.type === "text") {
    return { type: "movementMultiplier", hook: "beforeMovement", multiplier: 0.5, rounding: "ceil" };
  }
  return isModifierEffectAction(action) ? ensureModifierTiming(action) : action;
}

function convertEffectActionType(
  action: EventAction,
  type: Exclude<EventAction["type"], "text" | "offlineAction" | "applyEffect">
): EventAction {
  return {
    ...convertActionType(action, type),
    ...effectLifecyclePatch(action),
  } as EventAction;
}

function defaultHookForEffectAction(action: EventAction): NonNullable<EventAction["hook"]> {
  return defaultHookForConsequence(action.type);
}

function hookValueForAction(action: EventAction): NonNullable<EventAction["hook"]> {
  return isModifierEffectAction(action) ? defaultHookForConsequence(action.type) : action.hook ?? defaultHookForEffectAction(action);
}

function hookOptionsForAction(action: EventAction): { value: EffectLifecycleHook; label: string }[] {
  if (!isModifierEffectAction(action)) return hookOptions;
  const hook = defaultHookForConsequence(action.type);
  return hookOptions.filter((option) => option.value === hook);
}

function updateActionAmount(
  action: Extract<ImmediateConsequenceDef, { type: "coins" | "move" }>,
  amount: number
): ImmediateConsequenceDef;
function updateActionAmount(action: Extract<EventAction, { type: "coins" | "move" }>, amount: number): EventAction;
function updateActionAmount(action: Extract<EventAction, { type: "coins" | "move" }>, amount: number): EventAction {
  if (action.type === "coins") return { ...action, value: amount };
  return { ...action, delta: amount };
}

function updateActionText(action: ImmediateConsequenceDef, text: string): ImmediateConsequenceDef {
  if (action.type === "text") return { ...action, text };
  return { ...action, text: text || undefined };
}

function consequenceActions(rule: ConsequenceRule): ImmediateConsequenceDef[] {
  return rule.actions.length ? rule.actions : [{ type: "coins", value: 1 }];
}

function isModifierEffectAction(action: EventAction): boolean {
  return action.type === "halfMovement" || action.type === "movementMultiplier" || action.type === "diceBias";
}

function ensureModifierTiming(action: EventAction): EventAction {
  if (!isModifierEffectAction(action)) return action;
  return {
    ...action,
    hook: defaultHookForConsequence(action.type),
  } as EventAction;
}

function effectLifecyclePatch(action: EventAction): {
  hook?: EventAction["hook"];
  when?: EventAction["when"];
  expiresOnTrigger?: boolean;
} {
  return {
    ...(action.hook ? { hook: action.hook } : {}),
    ...(action.when ? { when: action.when } : {}),
    ...(action.expiresOnTrigger !== undefined ? { expiresOnTrigger: action.expiresOnTrigger } : {}),
  };
}

function DurationEditor({ duration, onChange }: { duration: EffectDuration; onChange: (duration: EffectDuration) => void }) {
  const needsCount = duration.mode === "turns" || duration.mode === "rounds" || duration.mode === "uses";
  return (
    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
      <SelectInput
        label="Duration"
        value={duration.mode}
        options={[
          { value: "uses", label: "Uses" },
          { value: "rounds", label: "Rounds" },
          { value: "turns", label: "Turns" },
          { value: "game", label: "Whole game" },
        ]}
        onChange={(mode) => onChange(durationForMode(mode as EffectDuration["mode"], duration))}
      />
      {needsCount ? <NumberInput label="Count" value={duration.value} onChange={(value) => onChange({ ...duration, value: Math.max(1, Math.round(value)) } as EffectDuration)} /> : <div />}
    </div>
  );
}

function durationForMode(mode: EffectDuration["mode"], previous: EffectDuration): EffectDuration {
  if (mode === "turns" || mode === "rounds" || mode === "uses") return { mode, value: durationValue(previous) };
  return { mode };
}

function TargetPicker({
  label,
  target,
  players,
  onChange,
}: {
  label: string;
  target: EventActionTarget;
  players: GameContent["players"];
  onChange: (target: EventActionTarget) => void;
}) {
  const kind = targetKind(target);
  return (
    <div className="rounded-md border border-white/10 bg-black/15 p-2">
      <SelectInput
        label={label}
        value={kind}
        options={[
          { value: "winner", label: "Winner" },
          { value: "loser", label: "Loser" },
          { value: "landing", label: "Triggering player" },
          { value: "acting", label: "Acting player" },
          { value: "target", label: "Selected target" },
          { value: "nearestAhead", label: "Nearest ahead" },
          { value: "nearestBehind", label: "Nearest behind" },
          { value: "everyone", label: "Everyone" },
          { value: "player", label: "Specific player" },
          { value: "rank", label: "Rank" },
          { value: "rankRange", label: "Rank range" },
          { value: "coinRichest", label: "Most coins" },
          { value: "coinPoorest", label: "Least coins" },
          { value: "coinRank", label: "Coin rank" },
          { value: "coinRankRange", label: "Coin rank range" },
        ]}
        onChange={(value) => onChange(targetForKind(value as TargetKind, players, target))}
      />
      {kind === "player" && (
        <SelectInput
          label="Player"
          value={playerIdForTarget(target, players)}
          options={players.map((player) => ({ value: player.id, label: player.name }))}
          onChange={(playerId) => onChange({ playerId })}
        />
      )}
      {kind === "rank" && <NumberInput label="Rank" value={rankFromFor(target)} onChange={(rank) => onChange({ rank: Math.max(1, Math.round(rank)) })} />}
      {kind === "rankRange" && (
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="From rank" value={rankFromFor(target)} onChange={(rankFrom) => onChange({ rankFrom: Math.max(1, Math.round(rankFrom)), rankTo: rankToFor(target) })} />
          <NumberInput label="To rank" value={rankToFor(target)} onChange={(rankTo) => onChange({ rankFrom: rankFromFor(target), rankTo: Math.max(1, Math.round(rankTo)) })} />
        </div>
      )}
      {kind === "coinRank" && (
        <NumberInput label="Coin rank" value={rankFromFor(target)} onChange={(coinRank) => onChange({ coinRank: Math.max(1, Math.round(coinRank)) })} />
      )}
      {kind === "coinRankRange" && (
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="From coin rank" value={rankFromFor(target)} onChange={(coinRankFrom) => onChange({ coinRankFrom: Math.max(1, Math.round(coinRankFrom)), coinRankTo: rankToFor(target) })} />
          <NumberInput label="To coin rank" value={rankToFor(target)} onChange={(coinRankTo) => onChange({ coinRankFrom: rankFromFor(target), coinRankTo: Math.max(1, Math.round(coinRankTo)) })} />
        </div>
      )}
    </div>
  );
}

function TextInput({ label, hint, value, onChange }: { label: string; hint?: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mt-3 block text-xs font-black uppercase tracking-[0.12em] text-slate-400">
      {label}
      {hint && <span className="mt-1 block text-[0.68rem] normal-case leading-4 tracking-normal text-slate-500">{hint}</span>}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-md border border-white/15 bg-[#151922] px-3 py-2 text-sm font-bold text-white outline-none focus:border-cyan-300"
      />
    </label>
  );
}

function TextArea({ label, hint, value, onChange }: { label: string; hint?: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mt-3 block text-xs font-black uppercase tracking-[0.12em] text-slate-400">
      {label}
      {hint && <span className="mt-1 block text-[0.68rem] normal-case leading-4 tracking-normal text-slate-500">{hint}</span>}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 min-h-20 w-full resize-y rounded-md border border-white/15 bg-[#151922] px-3 py-2 text-sm font-bold leading-6 text-white outline-none focus:border-cyan-300"
      />
    </label>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="mt-3 block text-xs font-black uppercase tracking-[0.12em] text-slate-400">
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full rounded-md border border-white/15 bg-[#151922] px-3 py-2 text-sm font-bold text-white outline-none focus:border-cyan-300"
      />
    </label>
  );
}

function SelectInput({
  label,
  hint,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mt-3 block text-xs font-black uppercase tracking-[0.12em] text-slate-400">
      {label}
      {hint && <span className="mt-1 block text-[0.68rem] normal-case leading-4 tracking-normal text-slate-500">{hint}</span>}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-md border border-white/15 bg-[#151922] px-3 py-2 text-sm font-bold text-white outline-none focus:border-cyan-300 disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function createTestState(
  eventId: string,
  event: ResolvedGameEvent,
  players: Player[],
  submitted: string[],
  results: RunResult[],
  runKey: number,
  protagonistId: string,
  mediaAssets?: Record<string, ContentMediaAssetDef>,
  cardVoteRun?: CardVotePlaytestRun | null
): GameState {
  const activity = event.activity!;
  const participants = activityParticipants(activity, players, protagonistId);
  const subjects = activitySubjects(activity, players, protagonistId, participants);
  const judgePlaytest = activity.type === "judge" ? judgePlaytestState(participants, results) : null;
  const effectiveCardVoteRun = activity.type === "cardVote"
    ? cardVoteRun ?? createCardVotePlaytestRun(activity.content, participants, subjects)
    : null;
  const cardVote = effectiveCardVoteRun ? cardVotePlaytestState(effectiveCardVoteRun) : null;
  return {
    code: "TEST",
    roomName: "Event builder",
    phase: "minigame",
    board: [],
    mediaAssets,
    players,
    turnOrder: players.map((player) => player.id),
    activeIndex: 0,
    round: runKey,
    boardLength: 0,
    lastBaseRoll: null,
    lastRoll: null,
    activeMinigame: {
      eventId,
      protagonistId,
      type: activity.type,
      skin: activity.skin,
      content: {
        ...(isRecord(activity.content) ? activity.content : {}),
        story: event.story,
        title: eventTitle(event),
        prompt: event.story.prompt,
        protagonistId,
        protagonistName: nameFor(players, protagonistId),
        subjectPlayerIds: subjects,
        subjectPlayerNames: subjects.map((id) => nameFor(players, id)),
      },
      story: event.story,
      media: resolveEventMediaRefs(event, activity),
      participants,
      subjects,
      submitted: effectiveCardVoteRun?.submitted ?? judgePlaytest?.submitted ?? submitted,
      ...(judgePlaytest ? { judge: judgePlaytest.judge } : {}),
      ...(cardVote ? { cardVote } : {}),
    },
    activeEvent: null,
    reveal: null,
    winnerId: null,
    artifactShop: null,
    pendingArtifactUse: null,
    activeEffects: [],
  };
}

function judgePlaytestState(participants: string[], results: RunResult[]): { submitted: string[]; judge: NonNullable<GameState["activeMinigame"]>["judge"] } {
  const messagesByPlayer = new Map<string, string>();
  const votesByPlayer = new Map<string, string>();
  for (const result of results) {
    const payload = result.payload as { message?: string; votedForSubmissionId?: string } | undefined;
    if (typeof payload?.message === "string" && !messagesByPlayer.has(result.playerId)) {
      messagesByPlayer.set(result.playerId, payload.message.trim() || "(sin respuesta)");
    }
    if (typeof payload?.votedForSubmissionId === "string" && !votesByPlayer.has(result.playerId)) {
      votesByPlayer.set(result.playerId, payload.votedForSubmissionId);
    }
  }

  const allMessagesIn = participants.every((id) => messagesByPlayer.has(id));
  if (!allMessagesIn) {
    return {
      submitted: participants.filter((id) => messagesByPlayer.has(id)),
      judge: { phase: "writing" },
    };
  }

  return {
    submitted: participants.filter((id) => votesByPlayer.has(id)),
    judge: {
      phase: "voting",
      submissions: participants.map((id, index) => ({
        id: `judge-${index + 1}`,
        text: messagesByPlayer.get(id) ?? "(sin respuesta)",
      })),
    },
  };
}

function cardVotePlaytestState(run: CardVotePlaytestRun): NonNullable<GameState["activeMinigame"]>["cardVote"] {
  return {
    phase: run.phase === "voting" ? "voting" : "result",
    cardIndex: run.cardIndex,
    totalCards: run.cards.length,
    card: run.cards[run.cardIndex],
    allowSelfVote: run.allowSelfVote,
    tieMode: run.tieMode,
    cardCounts: run.cardCounts,
    cardsWonByPlayer: run.cardsWonByPlayer,
    roundResult: run.roundResult,
  };
}

function activityParticipants(activity: EventActivity, players: Player[], protagonistId: string): string[] {
  const active = playerFor(protagonistId, players);
  if (!active) return [];
  return resolveActivityParticipantIds(activity, players, active);
}

function activitySubjects(activity: EventActivity, players: Player[], protagonistId: string, participants: string[]): string[] {
  const active = playerFor(protagonistId, players);
  if (!active) return [];
  return resolveActivitySubjectIds(activity, players, active, participants);
}

function defaultParticipantMode(type: EventActivityType): EventParticipantMode {
  if (type === "hostPick") return "host";
  if (type === "prompt") return "everyone";
  return "everyone";
}

function playerFor(playerId: string, players: Player[]): Player | undefined {
  return players.find((player) => player.id === playerId);
}

function defaultContentForActivity(type: EventActivityType, story?: GameEventDef["story"]): Record<string, unknown> {
  const prompt = story?.prompt || story?.title || "Completá la acción.";
  switch (type) {
    case "buzzer":
      return { question: prompt || "Elegí la respuesta correcta", options: ["Opción A", "Opción B", "Opción C"], answer: 0 };
    case "vote":
      return { question: prompt || "¿Quién gana esta ronda?" };
    case "cardVote":
      return {
        cards: [prompt || "¿Quién encaja mejor con esta carta?"],
        allowSelfVote: true,
        tieMode: "shared",
      };
    case "hostPick":
      return { prompt, label: story?.title ?? "Elección del host" };
    case "selfTap":
      return { prompt, label: story?.title ?? "Acción rápida" };
    case "judge":
      return { prompt: prompt || "Escribí tu respuesta.", placeholder: "Escribí acá..." };
    case "timing":
      return { label: prompt || "Tocá en el momento justo", windowMs: 350 };
    case "reaction":
      return { label: prompt || "Esperá el verde.", minDelayMs: 1500, maxDelayMs: 5000 };
    case "estimate":
      return { question: prompt || "Estimá el valor", unit: "valor", answer: 0 };
    case "whack":
      return { label: prompt || "Golpeá el objetivo correcto", durationMs: 20000 };
    case "maze":
      return { label: prompt || "Llevá el cursor hasta la salida sin tocar las paredes", cols: 13, rows: 13 };
    case "flappy":
      return { label: prompt || "Tocá o apretá ESPACIO para volar", maxDurationMs: 90000 };
    case "snake":
      return { label: prompt || "Sobreviví: el último vivo gana", gridSize: 100, durationMs: 120000 };
    case "horserace":
      return { label: prompt || "Apretá la flecha indicada lo más rápido posible", trackLength: 40, durationMs: 45000 };
    case "redlight":
      return { label: prompt || "Avanzá con ESPACIO, solo en verde", trackLength: 45, durationMs: 60000 };
    case "prompt":
    default:
      return { prompt, label: story?.title ?? "Evento" };
  }
}

function toPlayer(def: GameContent["players"][number], index = 0): Player {
  return {
    id: def.id,
    name: def.name,
    socketId: `test-${def.id}`,
    connected: true,
    position: 0,
    coins: 0,
    isHost: index === 0,
    groom: Boolean(def.groom),
    color: def.color ?? "#94a3b8",
  };
}

function normalizeHosts(players: Player[]): Player[] {
  return players.map((player, index) => ({ ...player, isHost: index === 0 }));
}

function nameFor(players: Player[], playerId: string): string {
  return players.find((player) => player.id === playerId)?.name ?? playerId;
}

function namesFor(ids: string[], players: Player[]): string {
  return ids.map((id) => nameFor(players, id)).join(", ");
}

function valueText(ids: string[], players: Player[], value: number, noun: string): string {
  const verb = value >= 0 ? "gana" : "pierde";
  return `${namesFor(ids, players)} ${verb} ${Math.abs(value)} ${noun}(s)`;
}

function moveSummary(ids: string[], players: Player[], delta: number): string {
  const verb = delta >= 0 ? "avanza" : "retrocede";
  return `${namesFor(ids, players)} ${verb} ${Math.abs(delta)} casillero(s)`;
}

function formatScore(score: number): string {
  if (!Number.isFinite(score)) return String(score);
  if (Math.abs(score) >= 1000) return Math.round(score).toLocaleString();
  return score.toFixed(3).replace(/\.?0+$/, "");
}

function optionLabel(options: string[], index: number): string {
  if (index >= 0 && index < options.length) return options[index];
  return index >= 0 ? `option ${index + 1}` : "no answer";
}

function payloadSummary(payload: unknown): string | undefined {
  if (payload == null) return undefined;
  if (typeof payload === "string" || typeof payload === "number" || typeof payload === "boolean") return String(payload);
  if (!Array.isArray(payload) && typeof payload === "object") {
    const entries = Object.entries(payload as Record<string, unknown>)
      .filter(([, value]) => value !== undefined && value !== null)
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${String(value)}`);
    return entries.length ? entries.join(" - ") : undefined;
  }
  return undefined;
}

function targetLabel(target: EventActionTarget, players: GameContent["players"] = PLAYER_POOL): string {
  if (target === "landing") return "Triggering player";
  if (target === "acting") return "Acting player";
  if (target === "target") return "Selected target";
  if (target === "winner") return "Winner";
  if (target === "loser") return "Loser";
  if (target === "everyone") return "Everyone";
  if ("playerId" in target) return playerName(players, target.playerId);
  if ("rank" in target) return `Rank ${target.rank}`;
  if ("coinSelector" in target) return target.coinSelector === "richest" ? "Most coins" : "Least coins";
  if ("coinRank" in target) return `Coin rank ${target.coinRank}`;
  if ("coinRankFrom" in target) return `Coin ranks ${target.coinRankFrom}-${target.coinRankTo}`;
  if ("nearest" in target) return target.nearest === "ahead" ? "Nearest ahead" : "Nearest behind";
  return `Ranks ${target.rankFrom}-${target.rankTo}`;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
