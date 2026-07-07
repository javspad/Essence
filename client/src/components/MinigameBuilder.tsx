import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  AppliedEventAction,
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
  EventOutcomeBranch,
  EventTriggerScope,
  GameContent,
  GameEventDef,
  GameState,
  Player,
  RevealEntry,
} from "@essence/shared";
import { consequenceLabel, defaultHookForConsequence, effectConsequencesFor, effectRemainingLabel } from "@essence/shared/consequences";
import seedContent from "@shared/content.json";
import { normalizeContentSchema } from "@essence/shared/contentValidation";
import {
  EVENT_ACTIVITY_TYPES,
  eventTitle,
  resolveActivityParticipantIds,
  resolveActivitySubjectIds,
  resolveEventActionTargetIds,
  resolveEventForPlayer,
  type ResolvedGameEvent,
} from "@essence/shared/events";
import { applyRig } from "@essence/shared/rig";
import { ENGINES } from "../minigames";
import { revealEntryDetail, revealEntryResult } from "../revealDisplay";
import MinigameHost from "./MinigameHost";

const DEFAULT_EFFECT_ID = "half-roll-2-rounds";
const LEGACY_SHOT_EFFECT_ID = "half-roll-shot-on-six";
const BASE_CONTENT = migrateEffectDraft(normalizeContentSchema(seedContent));
const PLAYER_POOL = BASE_CONTENT.players;
const INITIAL_PLAYERS = PLAYER_POOL.slice(0, Math.min(4, PLAYER_POOL.length)).map(toPlayer);
const STORAGE_KEY = "essence:event-builder:draft:v1";

type TargetKind = "landing" | "acting" | "target" | "winner" | "loser" | "everyone" | "player" | "rank" | "rankRange" | "nearestAhead" | "nearestBehind";
type ConsequenceTimingMode = "now" | "attached";

const participantModeOptions: { value: EventParticipantMode; label: string }[] = [
  { value: "everyone", label: "Everyone" },
  { value: "landing", label: "Acting player" },
  { value: "host", label: "Host" },
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
  ranking: string[];
  entries: RevealEntry[];
  actions: AppliedEventAction[];
}

export default function MinigameBuilder() {
  const [content, setContent] = useState<GameContent>(() => loadInitialContent());
  const eventIds = useMemo(() => Object.keys(content.events ?? {}), [content.events]);
  const effectIds = useMemo(() => Object.keys(content.effects ?? {}), [content.effects]);
  const [selectedId, setSelectedId] = useState(eventIds[0] ?? "");
  const [selectedEffectId, setSelectedEffectId] = useState(effectIds[0] ?? DEFAULT_EFFECT_ID);
  const [activityFilter, setActivityFilter] = useState<EventActivityType | "all">("all");
  const [players, setPlayers] = useState<Player[]>(INITIAL_PLAYERS);
  const [protagonistId, setProtagonistId] = useState(INITIAL_PLAYERS[0]?.id ?? "");
  const [actorId, setActorId] = useState(INITIAL_PLAYERS[0]?.id ?? "");
  const [submitted, setSubmitted] = useState<string[]>([]);
  const [results, setResults] = useState<RunResult[]>([]);
  const [runKey, setRunKey] = useState(1);
  const [actionLog, setActionLog] = useState<unknown[]>([]);
  const [contentDraft, setContentDraft] = useState("{}");
  const [contentError, setContentError] = useState<string | null>(null);
  const [jsonModalOpen, setJsonModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [saveStatus, setSaveStatus] = useState("");

  const selected = selectedId ? content.events?.[selectedId] : undefined;
  const selectedEffect = selectedEffectId ? content.effects?.[selectedEffectId] : undefined;
  const protagonist = players.find((player) => player.id === protagonistId) ?? players[0];
  const actor = players.find((player) => player.id === actorId) ?? players[0];
  const resolved = selected && protagonist ? resolveEventForPlayer(content, selectedId, protagonist) : null;
  const activity = resolved?.activity;
  const hasEngine = activity ? Boolean(ENGINES[activity.type]) : false;
  const exportJson = useMemo(() => JSON.stringify(normalizeContentSchema(content), null, 2), [content]);
  const filteredEventIds = useMemo(
    () =>
      activityFilter === "all"
        ? eventIds
        : eventIds.filter((id) => content.events?.[id]?.activity?.type === activityFilter),
    [activityFilter, content.events, eventIds]
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
    if (players.some((player) => player.id === actorId)) return;
    setActorId(players[0]?.id ?? "");
  }, [actorId, players]);

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
    return createTestState(selectedId, resolved, players, submitted, results, runKey, protagonist.id);
  }, [activity, players, protagonist, resolved, results, runKey, selectedId, submitted]);
  const playtestResolution = useMemo(
    () => createPlaytestResolution(resolved, state, players, results),
    [players, resolved, results, state]
  );

  const updateEvent = (updater: (event: GameEventDef) => GameEventDef) => {
    if (!selectedId || !selected) return;
    setContent((current) => ({
      ...current,
      events: {
        ...(current.events ?? {}),
        [selectedId]: updater(current.events?.[selectedId] ?? selected),
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
      activity: stripLegacyResolution({
        type: "prompt",
        ...(event.activity ?? {}),
        ...patch,
      }),
    }));
  };

  const updateTrigger = (value: string) => {
    updateEvent((event) => ({
      ...event,
      trigger: triggerForValue(value),
    }));
  };

  const changeActivityType = (type: EventActivityType) => {
    const nextContent = defaultContentForActivity(type, selected?.story);
    updateActivity({
      type,
      content: nextContent,
    });
    setContentDraft(JSON.stringify(nextContent, null, 2));
    setContentError(null);
    setActivityFilter((current) => (current === "all" ? current : type));
    resetRun();
  };

  const createEvent = () => {
    const type = activityFilter === "all" ? "prompt" : activityFilter;
    const id = nextEventId(content.events ?? {});
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
      outcomes: [],
    };
    setContent((current) => ({
      ...current,
      events: {
        ...(current.events ?? {}),
        [id]: event,
      },
    }));
    setSelectedId(id);
    setContentDraft(JSON.stringify(event.activity?.content ?? {}, null, 2));
    setContentError(null);
    resetRun();
  };

  const deleteEvent = (id: string) => {
    const event = content.events?.[id];
    if (!event) return;
    const title = eventTitle(event);
    if (!window.confirm(`Delete "${title}"?`)) return;
    const nextSelectedId = selectedId === id ? eventIds.filter((eventId) => eventId !== id)[0] ?? "" : selectedId;
    setContent((current) => removeEventFromContent(current, id));
    setSelectedId(nextSelectedId);
    setSaveStatus("Deleted");
    resetRun();
  };

  const saveDraft = () => {
    localStorage.setItem(STORAGE_KEY, exportJson);
    setSaveStatus("Saved");
  };

  const resetDraft = () => {
    localStorage.removeItem(STORAGE_KEY);
    setContent(BASE_CONTENT);
    setSelectedId(Object.keys(BASE_CONTENT.events ?? {})[0] ?? "");
    setImportText("");
    setJsonModalOpen(false);
    setSaveStatus("Reset");
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
      const parsed = migrateEffectDraft(normalizeContentSchema(JSON.parse(importText)));
      const ids = Object.keys(parsed.events ?? {});
      setContent(parsed);
      setSelectedId(ids[0] ?? "");
      setImportText("");
      setJsonModalOpen(false);
      setSaveStatus("Imported");
      resetRun();
    } catch {
      window.alert("Invalid JSON");
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

  const addOutcome = (branch: EventOutcomeBranch) => {
    updateEvent((event) => ({ ...event, outcomes: [...(event.outcomes ?? []), branch] }));
  };

  const removeOutcome = (index: number) => {
    updateEvent((event) => ({ ...event, outcomes: (event.outcomes ?? []).filter((_, i) => i !== index) }));
  };

  const updateOutcome = (index: number, updater: (outcome: EventOutcomeBranch) => EventOutcomeBranch) => {
    updateEvent((event) => ({
      ...event,
      outcomes: (event.outcomes ?? []).map((outcome, i) => (i === index ? updater(outcome) : outcome)),
    }));
  };

  const addConsequence = () => {
    addOutcome({ label: "New consequence", when: "winner", actions: [{ type: "coins", value: 1 }] });
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

  const resetPlayers = () => {
    const next = PLAYER_POOL.slice(0, Math.min(4, PLAYER_POOL.length)).map(toPlayer);
    setPlayers(next);
    setActorId(next[0]?.id ?? "");
    setProtagonistId(next[0]?.id ?? "");
    resetRun();
  };

  const resetRun = () => {
    setSubmitted([]);
    setResults([]);
    setActionLog([]);
    setRunKey((key) => key + 1);
  };

  const handleFinish = (score: number, payload: unknown) => {
    if (!actor) return;
    setSubmitted((current) => (current.includes(actor.id) ? current : [...current, actor.id]));
    setResults((current) => [{ id: Date.now(), playerId: actor.id, score, payload }, ...current]);
  };

  const handleAction = (data: unknown) => {
    if (!actor) return;
    setActionLog((current) => [{ playerId: actor.id, data }, ...current].slice(0, 6));
  };

  const forceResolve = () => {
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
          <button onClick={saveDraft} className="h-8 rounded-md border border-cyan-200/25 bg-cyan-300/10 px-2.5 text-xs font-black text-cyan-100 transition hover:bg-cyan-300/15">
            {saveStatus || "Save"}
          </button>
          <button onClick={() => setJsonModalOpen(true)} className="h-8 rounded-md border border-white/15 bg-white/5 px-2.5 text-xs font-black text-slate-100 transition hover:bg-white/10">
            Import/export
          </button>
          <button onClick={resetRun} className="h-8 rounded-md border border-white/15 bg-white/5 px-2.5 text-xs font-black text-slate-100 transition hover:bg-white/10">
            Reset run
          </button>
          <a href="/tools" className="flex h-8 items-center rounded-md border border-amber-200/25 bg-amber-300/10 px-2.5 text-xs font-black text-amber-100 transition hover:bg-amber-300/15">
            Tools
          </a>
          <a href="/" className="flex h-8 items-center rounded-md border border-white/15 bg-white/5 px-2.5 text-xs font-black text-slate-100 transition hover:bg-white/10">
            Home
          </a>
          <a href="/map-builder" className="flex h-8 items-center rounded-md border border-emerald-200/25 bg-emerald-300/10 px-2.5 text-xs font-black text-emerald-100 transition hover:bg-emerald-300/15">
            Map builder
          </a>
        </div>
      </header>

      <div className="grid h-[calc(100dvh-3.5rem)] min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[20rem_minmax(0,1fr)_21rem]">
        <aside className="flex min-h-0 flex-col overflow-hidden border-b border-white/10 bg-[#111722] p-3 lg:border-b-0 lg:border-r lg:border-white/10">
          <SectionTitle eyebrow={`${EVENT_ACTIVITY_TYPES.length} types`} title="Activity types" />
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <ActivityFilterButton active={activityFilter === "all"} onClick={() => setActivityFilter("all")}>
              All events
            </ActivityFilterButton>
            {EVENT_ACTIVITY_TYPES.map((type) => (
              <ActivityFilterButton key={type} active={activityFilter === type} onClick={() => setActivityFilter(type)}>
                {activityLabel(type)}
              </ActivityFilterButton>
            ))}
          </div>

          <div className="mt-3 flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between gap-2">
              <SectionTitle eyebrow={`${filteredEventIds.length}/${eventIds.length} events`} title="Events" />
              <button onClick={createEvent} className="rounded-md border border-cyan-200/25 bg-cyan-300/10 px-2.5 py-1 text-xs font-black text-cyan-100 transition hover:bg-cyan-300/15">
                New
              </button>
            </div>
            <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
              {filteredEventIds.length === 0 && (
                <p className="rounded-md border border-dashed border-white/10 p-3 text-sm font-bold text-slate-400">No events match this type.</p>
              )}
              {filteredEventIds.map((id) => {
                const event = content.events?.[id];
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
            <div className="relative min-h-0 overflow-hidden rounded-md border border-white/10 bg-[#10131a]">
              {state && actor ? (
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
                <StoryPreview resolved={resolved} />
              )}
              {playtestResolution?.complete && <ResolutionOverlay resolution={playtestResolution} />}
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
                    label="Prompt confirmation"
                    value={activity.confirmation?.mode ?? "rest"}
                    options={[
                      { value: "rest", label: "Rest of group" },
                      { value: "everyone", label: "Everyone" },
                      { value: "host", label: "Host" },
                      { value: "self", label: "Acting player" },
                    ]}
                    onChange={(mode) =>
                      updateActivity({ confirmation: { ...(activity.confirmation ?? {}), mode: mode as EventConfirmationMode } })
                    }
                  />
                )}
                {activity && activity.type !== "prompt" && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <SelectInput
                      label="Participants"
                      value={activity.participants ?? defaultParticipantMode(activity.type)}
                      options={participantModeOptions}
                      onChange={(mode) => updateActivity({ participants: mode as EventParticipantMode })}
                    />
                    <SelectInput
                      label="Ranked subjects"
                      value={activity.subjects ?? "default"}
                      options={[{ value: "default", label: "Default" }, ...participantModeOptions]}
                      onChange={(mode) => updateActivity({ subjects: mode === "default" ? undefined : (mode as EventParticipantMode) })}
                    />
                  </div>
                )}
                <label className="mt-3 block text-xs font-black uppercase tracking-[0.12em] text-slate-400">
                  Content JSON
                  <textarea
                    value={contentDraft}
                    onChange={(event) => setContentDraft(event.target.value)}
                    onBlur={applyContentDraft}
                    className="mt-2 h-36 w-full resize-none rounded-md border border-white/15 bg-[#151922] p-3 font-mono text-[0.68rem] leading-4 text-white outline-none focus:border-cyan-300"
                  />
                </label>
                {contentError && <p className="mt-2 rounded-md border border-rose-300/25 bg-rose-500/10 p-2 text-xs font-black text-rose-100">{contentError}</p>}
              </Panel>
            </div>
          </div>
        </section>

        <aside className="min-h-0 overflow-y-auto border-t border-white/10 bg-[#111722] p-3 lg:border-l lg:border-t-0">
          <Panel title="Playtest" eyebrow={`${players.length} players`}>
            <SelectInput
              label="Acting player"
              value={protagonistId}
              options={players.map((player) => ({ value: player.id, label: player.name }))}
              onChange={setProtagonistId}
            />
            <SelectInput
              label="Preview as"
              value={actorId}
              options={players.map((player) => ({ value: player.id, label: player.name }))}
              onChange={setActorId}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={addPlayer} disabled={players.length >= PLAYER_POOL.length} className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-slate-100 transition hover:bg-white/10 disabled:opacity-40">
                Add player
              </button>
              <button onClick={addAllPlayers} className="rounded-md border border-cyan-200/25 bg-cyan-300/10 px-3 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-300/15">
                Add all
              </button>
              <button onClick={resetPlayers} className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-slate-100 transition hover:bg-white/10">
                Reset
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {players.map((player) => {
                const activePreview = player.id === actorId;
                return (
                  <div
                    key={player.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={activePreview}
                    onClick={() => setActorId(player.id)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      setActorId(player.id);
                    }}
                    className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border p-2 text-left transition ${
                      activePreview ? "border-cyan-300/70 bg-cyan-300/14" : "border-white/10 bg-black/15 hover:border-white/25 hover:bg-white/[0.06]"
                    }`}
                  >
                    <span className="truncate text-sm font-black text-white">{player.name}</span>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        removePlayer(player.id);
                      }}
                      disabled={players.length <= 1}
                      className="rounded-md border border-rose-200/20 bg-rose-500/10 px-2 py-1 text-xs font-black text-rose-100 transition hover:bg-rose-500/15 disabled:opacity-40"
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

          <EffectBuilderPanel
            effects={content.effects ?? {}}
            selectedEffect={selectedEffect}
            selectedEffectId={selectedEffectId}
            players={PLAYER_POOL}
            onSelect={setSelectedEffectId}
            onCreate={createEffect}
            onDelete={deleteEffect}
            onUpdate={updateEffect}
          />

          <Panel title="Consequences" eyebrow={`${selected?.outcomes?.length ?? 0} branches`}>
            <button
              onClick={addConsequence}
              disabled={!selected}
              className="w-full rounded-md border border-cyan-200/25 bg-cyan-300/10 px-3 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-300/15 disabled:opacity-40"
            >
              Add consequence
            </button>
            <div className="mt-3 space-y-2">
              {(selected?.outcomes ?? []).map((outcome, index) => (
                <ConsequenceEditor
                  key={`${outcome.id ?? outcome.label ?? targetLabel(outcome.when)}-${index}`}
                  outcome={outcome}
                  players={PLAYER_POOL}
                  effects={content.effects ?? {}}
                  onChange={(updater) => updateOutcome(index, updater)}
                  onRemove={() => removeOutcome(index)}
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

function StoryPreview({ resolved }: { resolved: ResolvedGameEvent | null }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-md border border-white/10 bg-white/[0.035] p-6 text-center">
        <p className="text-[0.65rem] font-black uppercase tracking-[0.18em] text-cyan-200">Story event</p>
        <h2 className="mt-2 text-3xl font-black text-white">{resolved ? eventTitle(resolved) : "No event"}</h2>
        {resolved?.story.setup && <p className="mt-4 text-sm font-black leading-6 text-slate-300">{resolved.story.setup}</p>}
        <p className="mt-4 text-xl font-black leading-8 text-white">{resolved?.story.prompt ?? "Select an event."}</p>
        {resolved?.story.reward && <p className="mt-4 text-sm font-black text-amber-200">{resolved.story.reward}</p>}
      </div>
    </div>
  );
}

function ResolutionOverlay({ resolution }: { resolution: PlaytestResolution }) {
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 rounded-md border border-emerald-200/30 bg-[#10131a]/94 p-3 shadow-2xl shadow-black/45 backdrop-blur">
      <p className="text-[0.58rem] font-black uppercase tracking-[0.16em] text-emerald-200">Playtest resolved</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {resolution.entries.slice(0, 3).map((entry) => (
          <span key={entry.playerId} className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-1 text-xs font-black text-white">
            #{entry.rank} {entry.name}: {revealEntryResult(entry)}
          </span>
        ))}
      </div>
      <div className="mt-2 space-y-1">
        {resolution.actions.length ? (
          resolution.actions.slice(0, 3).map((action, index) => (
            <p key={`${action.type}-${index}`} className="text-sm font-bold leading-5 text-slate-100">
              {action.text}
            </p>
          ))
        ) : (
          <p className="text-sm font-bold text-slate-300">No configured consequences fired.</p>
        )}
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
          {resolution.submittedCount}/{resolution.requiredCount} submitted.
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

function ActivityFilterButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-left text-sm font-black transition ${
        active ? "border-cyan-300/70 bg-cyan-300/14 text-cyan-100" : "border-white/10 bg-white/[0.035] text-slate-200 hover:border-white/25"
      }`}
    >
      {children}
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
  outcome,
  players,
  effects,
  onChange,
  onRemove,
}: {
  outcome: EventOutcomeBranch;
  players: GameContent["players"];
  effects: Record<string, EffectDef>;
  onChange: (updater: (outcome: EventOutcomeBranch) => EventOutcomeBranch) => void;
  onRemove: () => void;
}) {
  const kind = targetKind(outcome.when);
  const actions = outcomeActions(outcome);
  const updateAction = (actionIndex: number, action: EventAction) => {
    onChange((current) => ({
      ...current,
      actions: outcomeActions(current).map((item, index) => (index === actionIndex ? action : item)),
    }));
  };
  const removeAction = (actionIndex: number) => {
    onChange((current) => {
      const next = outcomeActions(current).filter((_, index) => index !== actionIndex);
      return { ...current, actions: next.length ? next : [{ type: "coins", value: 1 }] };
    });
  };
  const addAction = () => {
    onChange((current) => ({
      ...current,
      actions: [...outcomeActions(current), { type: "coins", value: 1 }],
    }));
  };
  return (
    <details className="rounded-md border border-white/10 bg-black/15 p-2" open>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-black text-white">{consequenceSummary(outcome, players)}</span>
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
        ]}
        onChange={(value) =>
          onChange((current) => ({
            ...current,
            when: targetForKind(value as TargetKind, players, current.when),
          }))
        }
      />

      {kind === "player" && (
        <SelectInput
          label="Player"
          value={playerIdForTarget(outcome.when, players)}
          options={players.map((player) => ({ value: player.id, label: player.name }))}
          onChange={(playerId) => onChange((current) => ({ ...current, when: { playerId } }))}
        />
      )}
      {kind === "rank" && (
        <NumberInput
          label="Rank"
          value={rankFromFor(outcome.when)}
          onChange={(rank) => onChange((current) => ({ ...current, when: { rank: Math.max(1, rank) } }))}
        />
      )}
      {kind === "rankRange" && (
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label="From rank"
            value={rankFromFor(outcome.when)}
            onChange={(rankFrom) => onChange((current) => ({ ...current, when: { rankFrom: Math.max(1, rankFrom), rankTo: rankToFor(current.when) } }))}
          />
          <NumberInput
            label="To rank"
            value={rankToFor(outcome.when)}
            onChange={(rankTo) => onChange((current) => ({ ...current, when: { rankFrom: rankFromFor(current.when), rankTo: Math.max(1, rankTo) } }))}
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
        Add action or effect
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
  action: EventAction;
  effects: Record<string, EffectDef>;
  players: GameContent["players"];
  actionIndex: number;
  canRemove: boolean;
  onChange: (action: EventAction) => void;
  onRemove: () => void;
}) {
  const text = action.text ?? "";
  const selectedEffect = action.type === "applyEffect" ? effects[action.effectId] : undefined;
  const timingMode = consequenceTimingMode(action);
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
            onChange(convertActionType(action, type as Exclude<EventAction["type"], "text" | "offlineAction" | "applyEffect">));
          }}
        />
        {(action.type === "coins" || action.type === "move") && (
          <NumberInput
            label={action.type === "coins" ? "Coins" : "Cells"}
            value={action.type === "coins" ? action.value : action.delta}
            onChange={(value) => onChange(updateActionAmount(action, value))}
          />
        )}
        {action.type === "moveTo" && <NumberInput label="Cell" value={action.tileId} onChange={(tileId) => onChange({ ...action, tileId })} />}
        {action.type === "movementMultiplier" && (
          <NumberInput label="x" value={action.multiplier} onChange={(multiplier) => onChange({ ...action, multiplier: Math.max(0, multiplier) })} />
        )}
        {action.type === "diceBias" && (
          <NumberInput label="Face" value={action.face} onChange={(face) => onChange({ ...action, face: clampInt(face, 1, 6) })} />
        )}
        {action.type !== "coins" && action.type !== "move" && action.type !== "moveTo" && action.type !== "movementMultiplier" && action.type !== "diceBias" && <div />}
      </div>
      {action.type === "movementMultiplier" && (
        <SelectInput
          label="Rounding"
          value={action.rounding ?? "round"}
          options={[
            { value: "round", label: "Round" },
            { value: "ceil", label: "Ceil" },
            { value: "floor", label: "Floor" },
          ]}
          onChange={(rounding) => onChange({ ...action, rounding: rounding as "floor" | "ceil" | "round" })}
        />
      )}
      {action.type === "halfMovement" && (
        <SelectInput
          label="Rounding"
          value={action.rounding ?? "ceil"}
          options={[
            { value: "ceil", label: "Ceil" },
            { value: "round", label: "Round" },
            { value: "floor", label: "Floor" },
          ]}
          onChange={(rounding) => onChange({ ...action, rounding: rounding as "floor" | "ceil" | "round" })}
        />
      )}
      {action.type === "diceBias" && (
        <NumberInput
          label="Chance change percent"
          value={action.chanceDeltaPercent}
          onChange={(chanceDeltaPercent) => onChange({ ...action, chanceDeltaPercent })}
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
      {action.type === "applyEffect" && (
        <EffectTypeSummary effect={selectedEffect} effectId={action.effectId} />
      )}
      {action.type !== "applyEffect" && (
        <>
          <SelectInput
            label="Timing"
            value={timingMode}
            disabled={isModifierEffectAction(action)}
            options={[
              { value: "now", label: "Resolve now" },
              { value: "attached", label: "Attach to user" },
            ]}
            onChange={(mode) => onChange(setConsequenceTimingMode(action, mode as ConsequenceTimingMode))}
          />
          {timingMode === "attached" && (
            <div className="rounded-md border border-cyan-200/15 bg-cyan-300/10 p-2">
              <SelectInput
                label="Runs"
                value={action.hook ?? defaultHookForConsequence(action.type)}
                options={hookOptions}
                onChange={(hook) => onChange({ ...action, hook: hook as EffectLifecycleHook })}
              />
              <DurationEditor duration={action.duration ?? defaultInlineDuration(action)} onChange={(duration) => onChange({ ...action, duration })} />
            </div>
          )}
        </>
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
          ]}
          onChange={(type) => onChange(convertActionType(editable, type as Exclude<EventAction["type"], "text" | "offlineAction" | "applyEffect">))}
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
        value={editable.hook ?? defaultHookForEffectAction(editable)}
        options={hookOptions}
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
                Reset draft
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

function MetaPill({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-white/10 bg-black/15 px-2 py-0.5 text-[0.65rem] font-bold text-slate-300">{children}</span>;
}

function stripLegacyResolution(activity: EventActivity): EventActivity {
  const next = { ...activity };
  delete next.resolutionMode;
  return next;
}

function createPlaytestResolution(
  event: ResolvedGameEvent | null,
  state: GameState | null,
  players: Player[],
  results: RunResult[]
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
      actions: previewActions(event.actions ?? [], players, { landingPlayerId, ranking: landingPlayerId ? [landingPlayerId] : [] }),
    };
  }

  const participants = minigame.participants;
  const requiredCount = participants.length;
  const submittedCount = participants.filter((id) => minigame.submitted.includes(id)).length;
  const complete = requiredCount > 0 && participants.every((id) => minigame.submitted.includes(id));
  const subjects = minigame.subjects?.length ? minigame.subjects : participants;
  const ranking = playtestRanking(minigame.type, subjects, participants, results, event.activity?.rigged, minigame.judge?.submissions);
  const entries = playtestRevealEntries(minigame.type, event.activity?.content, ranking, subjects, participants, players, results, minigame.judge?.submissions);
  const landingPlayerId = minigame.protagonistId ?? ranking[0];
  const actions = complete
    ? [
        ...(minigame.type === "prompt"
          ? previewActions(event.actions ?? [], players, {
              landingPlayerId,
              ranking: landingPlayerId ? [landingPlayerId] : ranking,
            })
          : []),
        ...previewOutcomeActions(event.outcomes ?? [], players, ranking, landingPlayerId),
      ]
    : [];
  return { complete, submittedCount, requiredCount, ranking, entries, actions };
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
  detailLabel?: string
): RevealEntry {
  return {
    playerId,
    name: nameFor(players, playerId),
    rank,
    score,
    coins: 0,
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

function previewOutcomeActions(
  branches: EventOutcomeBranch[],
  players: Player[],
  ranking: string[],
  landingPlayerId?: string
): AppliedEventAction[] {
  return branches.flatMap((branch) => {
    if (!resolvePreviewTargetIds(branch.when, players, { landingPlayerId, ranking }).length) return [];
    return previewActions(branch.actions, players, { landingPlayerId, ranking, defaultTarget: branch.when });
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
    return [previewAction(action, targetPlayerIds, players)];
  });
}

function previewAction(action: EventAction, targetPlayerIds: string[], players: Player[]): AppliedEventAction {
  if (action.type === "text") return { type: action.type, targetPlayerIds, text: action.text };
  if (action.type !== "applyEffect" && (action.duration || isModifierEffectAction(action))) {
    return {
      type: action.type,
      targetPlayerIds,
      text: action.text ?? `${namesFor(targetPlayerIds, players)} receives ${consequenceLabel(action)}`,
    };
  }
  if (action.type === "coins") {
    return { type: action.type, targetPlayerIds, text: action.text ?? valueText(targetPlayerIds, players, action.value, "moneda"), value: action.value };
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
  if (action.type === "halfMovement" || action.type === "movementMultiplier" || action.type === "diceBias" || action.type === "swapPositions" || action.type === "moveToNearest") {
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
  context: { landingPlayerId?: string; ranking?: string[] }
): string[] {
  return resolveEventActionTargetIds(target, {
    landingPlayerId: context.landingPlayerId,
    actingPlayerId: context.landingPlayerId,
    targetPlayerId: context.landingPlayerId,
    ranking: context.ranking,
    connectedPlayerIds: players.map((player) => player.id),
    playerIds: players.map((player) => player.id),
    players,
  });
}

function loadInitialContent(): GameContent {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return BASE_CONTENT;
    return migrateEffectDraft(normalizeContentSchema(JSON.parse(saved)));
  } catch {
    return BASE_CONTENT;
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
  mapAction: (action: EventAction) => EventAction
): GameContent["events"] {
  if (!events) return events;
  return Object.fromEntries(
    Object.entries(events).map(([id, event]) => [
      id,
      {
        ...event,
        actions: event.actions?.map(mapAction),
        outcomes: event.outcomes?.map((outcome) => ({
          ...outcome,
          actions: outcome.actions.map(mapAction),
        })),
      },
    ])
  );
}

function rewriteLegacyEffectAction(action: EventAction): EventAction {
  if (action.type !== "applyEffect" || action.effectId !== LEGACY_SHOT_EFFECT_ID) return action;
  return { ...action, effectId: DEFAULT_EFFECT_ID };
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

function rewriteDeletedEffectAction(action: EventAction, deletedEffectId: string): EventAction {
  if (action.type !== "applyEffect" || action.effectId !== deletedEffectId) return action;
  return { type: "coins", value: 1, text: action.text, ...("target" in action && action.target ? { target: action.target } : {}) };
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

function removeEventFromContent(content: GameContent, eventId: string): GameContent {
  const { [eventId]: _deleted, ...events } = content.events ?? {};
  return {
    ...content,
    events,
    board: content.board.map((tile) => removeEventFromTile(tile, eventId)),
    maps: content.maps?.map((map) => ({
      ...map,
      board: map.board.map((tile) => removeEventFromTile(tile, eventId)),
    })),
  };
}

function removeEventFromTile(tile: GameContent["board"][number], eventId: string): GameContent["board"][number] {
  const eventIds = tile.eventIds?.filter((id) => id !== eventId);
  return {
    ...tile,
    eventId: tile.eventId === eventId ? undefined : tile.eventId,
    eventIds: eventIds?.length ? eventIds : undefined,
  };
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
  if ("nearest" in target) return target.nearest === "ahead" ? "nearestAhead" : "nearestBehind";
  return "rankRange";
}

function targetForKind(kind: TargetKind, players: GameContent["players"], previous: EventActionTarget): EventActionTarget {
  if (kind === "landing" || kind === "acting" || kind === "target" || kind === "winner" || kind === "loser" || kind === "everyone") return kind;
  if (kind === "nearestAhead") return { nearest: "ahead", from: "acting" };
  if (kind === "nearestBehind") return { nearest: "behind", from: "acting" };
  if (kind === "player") return { playerId: playerIdForTarget(previous, players) };
  if (kind === "rank") return { rank: rankFromFor(previous) };
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
  return 1;
}

function rankToFor(target: EventActionTarget): number {
  if (typeof target !== "string" && "rankFrom" in target) return target.rankTo;
  if (typeof target !== "string" && "rank" in target) return target.rank;
  return 2;
}

function consequenceTypeOptions(effects: Record<string, EffectDef>, action: EventAction): { value: string; label: string }[] {
  const base = [
    { value: "coins", label: "Coins" },
    { value: "move", label: "Move" },
    { value: "moveTo", label: "Move to cell" },
    { value: "skipTurn", label: "Skip turn" },
    { value: "extraTurn", label: "Extra turn" },
    { value: "halfMovement", label: "Half movement" },
    { value: "movementMultiplier", label: "Movement multiplier" },
    { value: "diceBias", label: "Dice bias" },
    { value: "swapPositions", label: "Swap positions" },
    { value: "moveToNearest", label: "Move to nearest" },
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

function convertActionToEffect(action: EventAction, effectId: string): EventAction {
  const text = "text" in action ? action.text : undefined;
  const target = "target" in action ? action.target : undefined;
  return {
    type: "applyEffect",
    effectId,
    ...(target ? { target } : {}),
    ...(text ? { text } : {}),
  };
}

function convertActionType(action: EventAction, type: Exclude<EventAction["type"], "text">, fallbackEffectId?: string): EventAction {
  const text = "text" in action ? action.text : undefined;
  const target = "target" in action ? action.target : undefined;
  const amount = action.type === "coins" ? action.value : action.type === "move" ? action.delta : 1;
  const base = { ...(target ? { target } : {}), ...(text ? { text } : {}) };
  if (type === "coins") return withPreservedTiming({ type, value: amount, ...base }, action);
  if (type === "move") return withPreservedTiming({ type, delta: amount, ...base }, action);
  if (type === "moveTo") return withPreservedTiming({ type, tileId: 1, ...base }, action);
  if (type === "skipTurn") return withPreservedTiming({ type, ...base }, action);
  if (type === "extraTurn") return withPreservedTiming({ type, ...base }, action);
  if (type === "offlineAction") return withPreservedTiming({ type, action: "custom", ...base }, action);
  if (type === "halfMovement") return ensureModifierTiming({ type, hook: "beforeMovement", rounding: "ceil", ...base });
  if (type === "movementMultiplier") return ensureModifierTiming({ type, hook: "beforeMovement", multiplier: 0.5, rounding: "ceil", ...base });
  if (type === "diceBias") return ensureModifierTiming({ type, hook: "beforeRoll", face: 5, chanceDeltaPercent: 10, ...base });
  if (type === "swapPositions") return withPreservedTiming({ type, withTarget: "winner", ...base }, action);
  if (type === "moveToNearest") return withPreservedTiming({ type, direction: "ahead", ...base }, action);
  return { type, effectId: fallbackEffectId ?? DEFAULT_EFFECT_ID, ...(target ? { target } : {}), ...(text ? { text } : {}) };
}

function editableConsequenceAction(action: EventAction | undefined): EventAction {
  if (!action) return { type: "coins", value: 1 };
  return action;
}

function consequenceSummary(outcome: EventOutcomeBranch, players: GameContent["players"]): string {
  const actions = outcomeActions(outcome);
  const suffix = actions.length > 1 ? ` + ${actions.length - 1} more` : "";
  return `${targetLabel(outcome.when, players)} - ${actionSummary(editableConsequenceAction(actions[0]))}${suffix}`;
}

function actionSummary(action: EventAction): string {
  if (action.type === "coins") return `${action.value >= 0 ? "+" : ""}${action.value} coins`;
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
    duration: { mode: "rounds", value: 2 },
    consequences: [{ type: "movementMultiplier", hook: "beforeMovement", multiplier: 0.5, rounding: "ceil", text: "Move half of the die roll." }],
  };
}

function defaultCustomEffect(id: string): EffectDef {
  return {
    id,
    name: "New effect",
    description: "Custom reusable effect.",
    duration: { mode: "uses", value: 1 },
    consequences: [{ type: "coins", hook: "onTurnEnd", value: 1, text: "Gain 1 coin." }],
  };
}

function effectEditableAction(action: EventAction): EventAction {
  if (action.type === "applyEffect" || action.type === "offlineAction" || action.type === "text") {
    return { type: "movementMultiplier", hook: "beforeMovement", multiplier: 0.5, rounding: "ceil" };
  }
  return action;
}

function defaultHookForEffectAction(action: EventAction): NonNullable<EventAction["hook"]> {
  return defaultHookForConsequence(action.type);
}

function updateActionAmount(action: Extract<EventAction, { type: "coins" | "move" }>, amount: number): EventAction {
  if (action.type === "coins") return { ...action, value: amount };
  return { ...action, delta: amount };
}

function updateActionText(action: EventAction, text: string): EventAction {
  if (action.type === "text") return { ...action, text };
  return { ...action, text: text || undefined };
}

function outcomeActions(outcome: EventOutcomeBranch): EventAction[] {
  return outcome.actions.length ? outcome.actions : [{ type: "coins", value: 1 }];
}

function consequenceTimingMode(action: EventAction): ConsequenceTimingMode {
  if (action.duration || isModifierEffectAction(action)) return "attached";
  return "now";
}

function setConsequenceTimingMode(action: EventAction, mode: ConsequenceTimingMode): EventAction {
  if (mode === "attached") {
    return {
      ...action,
      hook: action.hook ?? defaultHookForConsequence(action.type),
      duration: action.duration ?? defaultInlineDuration(action),
    } as EventAction;
  }
  if (isModifierEffectAction(action)) return ensureModifierTiming(action);
  const { duration: _duration, hook: _hook, ...rest } = action;
  return rest as EventAction;
}

function defaultInlineDuration(_action: EventAction): EffectDuration {
  return { mode: "uses", value: 1 };
}

function isModifierEffectAction(action: EventAction): boolean {
  return action.type === "halfMovement" || action.type === "movementMultiplier" || action.type === "diceBias";
}

function withPreservedTiming(next: EventAction, previous: EventAction): EventAction {
  const merged = {
    ...next,
    ...timingPatch(previous),
  } as EventAction;
  return isModifierEffectAction(merged) ? ensureModifierTiming(merged) : merged;
}

function ensureModifierTiming(action: EventAction): EventAction {
  if (!isModifierEffectAction(action)) return action;
  return {
    ...action,
    hook: action.hook ?? defaultHookForConsequence(action.type),
    duration: action.duration ?? defaultInlineDuration(action),
  } as EventAction;
}

function timingPatch(action: EventAction): {
  hook?: EventAction["hook"];
  when?: EventAction["when"];
  duration?: EffectDuration;
  expiresOnTrigger?: boolean;
} {
  return {
    ...(action.hook ? { hook: action.hook } : {}),
    ...(action.when ? { when: action.when } : {}),
    ...(action.duration ? { duration: action.duration } : {}),
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
          { value: "untilTriggered", label: "Until triggered" },
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
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mt-3 block text-xs font-black uppercase tracking-[0.12em] text-slate-400">
      {label}
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
  protagonistId: string
): GameState {
  const activity = event.activity!;
  const participants = activityParticipants(activity, players, protagonistId);
  const subjects = activitySubjects(activity, players, protagonistId, participants);
  const judgePlaytest = activity.type === "judge" ? judgePlaytestState(participants, results) : null;
  return {
    code: "TEST",
    roomName: "Event builder",
    phase: "minigame",
    board: [],
    players,
    turnOrder: players.map((player) => player.id),
    activeIndex: 0,
    round: runKey,
    boardLength: 0,
    lastRoll: null,
    activeMinigame: {
      id: eventId,
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
      participants,
      subjects,
      submitted: judgePlaytest?.submitted ?? submitted,
      ...(judgePlaytest ? { judge: judgePlaytest.judge } : {}),
    },
    activeEvent: null,
    reveal: null,
    winnerId: null,
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

function targetLabel(target: EventOutcomeBranch["when"], players: GameContent["players"] = PLAYER_POOL): string {
  if (target === "landing") return "Triggering player";
  if (target === "acting") return "Acting player";
  if (target === "target") return "Selected target";
  if (target === "winner") return "Winner";
  if (target === "loser") return "Loser";
  if (target === "everyone") return "Everyone";
  if ("playerId" in target) return playerName(players, target.playerId);
  if ("rank" in target) return `Rank ${target.rank}`;
  if ("nearest" in target) return target.nearest === "ahead" ? "Nearest ahead" : "Nearest behind";
  return `Ranks ${target.rankFrom}-${target.rankTo}`;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
