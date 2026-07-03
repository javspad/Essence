import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  EventActivity,
  EventActivityType,
  EventOutcomeBranch,
  GameContent,
  GameEventDef,
  GameState,
  Player,
} from "@essence/shared";
import seedContent from "@shared/content.json";
import {
  EVENT_ACTIVITY_TYPES,
  eventTitle,
  normalizeGameContentEvents,
  resolveEventForPlayer,
  type ResolvedGameEvent,
} from "@essence/shared/events";
import { ENGINES } from "../minigames";
import MinigameHost from "./MinigameHost";

const BASE_CONTENT = normalizeGameContentEvents(seedContent as GameContent);
const PLAYER_POOL = BASE_CONTENT.players;
const INITIAL_PLAYERS = PLAYER_POOL.slice(0, Math.min(4, PLAYER_POOL.length)).map(toPlayer);

interface RunResult {
  id: number;
  playerId: string;
  score: number;
  payload: unknown;
}

export default function MinigameBuilder() {
  const [content, setContent] = useState<GameContent>(BASE_CONTENT);
  const eventIds = useMemo(() => Object.keys(content.events ?? {}), [content.events]);
  const [selectedId, setSelectedId] = useState(eventIds[0] ?? "");
  const [activityFilter, setActivityFilter] = useState<EventActivityType | "all">("all");
  const [players, setPlayers] = useState<Player[]>(INITIAL_PLAYERS);
  const [actorId, setActorId] = useState(INITIAL_PLAYERS[0]?.id ?? "");
  const [submitted, setSubmitted] = useState<string[]>([]);
  const [results, setResults] = useState<RunResult[]>([]);
  const [runKey, setRunKey] = useState(1);
  const [actionLog, setActionLog] = useState<unknown[]>([]);
  const [contentDraft, setContentDraft] = useState("{}");
  const [contentError, setContentError] = useState<string | null>(null);

  const selected = selectedId ? content.events?.[selectedId] : undefined;
  const actor = players.find((player) => player.id === actorId) ?? players[0];
  const resolved = selected && actor ? resolveEventForPlayer(content, selectedId, actor) : null;
  const activity = resolved?.activity;
  const hasEngine = activity ? Boolean(ENGINES[activity.type]) : false;
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
    resetRun();
    setContentDraft(JSON.stringify(activity?.content ?? {}, null, 2));
    setContentError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, activity?.type]);

  useEffect(() => {
    if (players.some((player) => player.id === actorId)) return;
    setActorId(players[0]?.id ?? "");
  }, [actorId, players]);

  const state = useMemo<GameState | null>(() => {
    if (!resolved || !activity || !actor || players.length === 0) return null;
    return createTestState(selectedId, resolved, players, submitted, runKey, actor.id);
  }, [activity, actor, players, resolved, runKey, selectedId, submitted]);

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

  const applyContentDraft = () => {
    try {
      const parsed = contentDraft.trim() ? JSON.parse(contentDraft) : {};
      updateActivity({ content: parsed });
      setContentError(null);
    } catch {
      setContentError("JSON inválido");
    }
  };

  const updateExactPlayerPrompt = (value: string) => {
    if (!actor || !selectedId) return;
    setContent((current) => {
      const bank = current.playerStories?.[actor.id] ?? { overrides: [] };
      const overrides = [...bank.overrides];
      const index = overrides.findIndex((override) => override.eventId === selectedId);
      const nextOverride = {
        ...(index >= 0 ? overrides[index] : { eventId: selectedId }),
        story: { ...(index >= 0 ? overrides[index].story : {}), prompt: value || undefined },
      };
      if (index >= 0) overrides[index] = nextOverride;
      else overrides.push(nextOverride);
      return {
        ...current,
        playerStories: {
          ...(current.playerStories ?? {}),
          [actor.id]: { overrides },
        },
      };
    });
  };

  const addOutcome = (branch: EventOutcomeBranch) => {
    updateEvent((event) => ({ ...event, outcomes: [...(event.outcomes ?? []), branch] }));
  };

  const removeOutcome = (index: number) => {
    updateEvent((event) => ({ ...event, outcomes: (event.outcomes ?? []).filter((_, i) => i !== index) }));
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

  const exactOverridePrompt = actor
    ? content.playerStories?.[actor.id]?.overrides.find((override) => override.eventId === selectedId)?.story?.prompt ?? ""
    : "";

  return (
    <main className="h-dvh overflow-hidden bg-[#10131a] text-slate-100">
      <header className="grid h-14 grid-cols-[13rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 bg-[#151922] px-3">
        <div className="min-w-0">
          <p className="text-[0.55rem] font-black uppercase tracking-[0.18em] text-cyan-200">Essence tools</p>
          <h1 className="truncate text-lg font-black tracking-normal text-white">Event builder</h1>
        </div>
        <div className="flex min-w-0 items-center justify-center gap-2">
          <h2 className="truncate text-base font-black text-white md:text-lg">{resolved ? eventTitle(resolved) : "No event selected"}</h2>
          {activity && <ActivityTypeSelect type={activity.type} missing={!hasEngine} onChange={changeActivityType} />}
        </div>
        <div className="flex items-center justify-end gap-2">
          <button onClick={resetRun} className="h-9 rounded-md border border-white/15 bg-white/5 px-3 text-xs font-black text-slate-100 transition hover:bg-white/10">
            Reset run
          </button>
          <a href="/" className="flex h-9 items-center rounded-md border border-white/15 bg-white/5 px-3 text-xs font-black text-slate-100 transition hover:bg-white/10">
            Home
          </a>
          <a href="/map-builder" className="flex h-9 items-center rounded-md border border-emerald-200/25 bg-emerald-300/10 px-3 text-xs font-black text-emerald-100 transition hover:bg-emerald-300/15">
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
            <SectionTitle eyebrow={`${filteredEventIds.length}/${eventIds.length} events`} title="Events" />
            <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
              {filteredEventIds.length === 0 && (
                <p className="rounded-md border border-dashed border-white/10 p-3 text-sm font-bold text-slate-400">No events match this type.</p>
              )}
              {filteredEventIds.map((id) => {
                const event = content.events?.[id];
                const active = id === selectedId;
                if (!event) return null;
                return (
                  <button
                    key={id}
                    onClick={() => setSelectedId(id)}
                    className={`rounded-md border p-3 text-left transition ${
                      active ? "border-cyan-300/70 bg-cyan-300/14" : "border-white/10 bg-white/[0.035] hover:border-white/25 hover:bg-white/[0.06]"
                    }`}
                  >
                    <p className="truncate text-sm font-black text-white">{eventTitle(event)}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {event.activity && <TypeBadge type={event.activity.type} missing={!ENGINES[event.activity.type]} />}
                      {(event.tags ?? []).slice(0, 2).map((tag) => <MetaPill key={tag}>{tag}</MetaPill>)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="min-h-0 min-w-0 overflow-hidden bg-[#181d27] p-3">
          <div className="grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-h-0 overflow-hidden rounded-md border border-white/10 bg-[#10131a]">
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
            </div>

            <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
              <Panel title="Story" eyebrow="default">
                <TextInput
                  label="Event title"
                  hint="Short name used in lists and as the event headline."
                  value={selected?.story?.title ?? selected?.name ?? ""}
                  onChange={(value) => updateStory("title", value)}
                />
                <TextArea
                  label="Intro setup"
                  hint="Optional context shown before the instruction."
                  value={selected?.story?.setup ?? ""}
                  onChange={(value) => updateStory("setup", value)}
                />
                <TextArea
                  label="Player prompt"
                  hint="The main instruction, question, or dare players see."
                  value={selected?.story?.prompt ?? ""}
                  onChange={(value) => updateStory("prompt", value)}
                />
                <TextArea
                  label="Stakes copy"
                  hint="Optional flavor about what is at stake. Actual effects live in Outcomes."
                  value={selected?.story?.reward ?? ""}
                  onChange={(value) => updateStory("reward", value)}
                />
                <TextArea
                  label="Results reveal"
                  hint="Optional text shown on the results screen after the activity resolves."
                  value={selected?.story?.reveal ?? ""}
                  onChange={(value) => updateStory("reveal", value)}
                />
              </Panel>

              <Panel title="Activity" eyebrow={activity ? activityLabel(activity.type) : "none"}>
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
          <Panel title="Protagonist" eyebrow={`${players.length} players`}>
            <SelectInput
              label="Preview as"
              value={actorId}
              options={players.map((player) => ({ value: player.id, label: player.name }))}
              onChange={setActorId}
            />
            <TextArea label="Exact prompt override" value={exactOverridePrompt} onChange={updateExactPlayerPrompt} />
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
              {players.map((player) => (
                <div key={player.id} className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-black/15 p-2">
                  <span className="truncate text-sm font-black text-white">{player.name}</span>
                  <button onClick={() => removePlayer(player.id)} disabled={players.length <= 1} className="rounded-md border border-rose-200/20 bg-rose-500/10 px-2 py-1 text-xs font-black text-rose-100 transition hover:bg-rose-500/15 disabled:opacity-40">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Outcomes" eyebrow={`${selected?.outcomes?.length ?? 0} branches`}>
            <div className="grid gap-2">
              <button
                onClick={() => addOutcome({ label: "Loser moves back", when: "loser", actions: [{ type: "move", delta: -2, target: "loser", text: "El perdedor retrocede 2 casilleros" }] })}
                className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-slate-100 transition hover:bg-white/10"
              >
                Add loser move
              </button>
              <button
                onClick={() => addOutcome({ label: "Winner coins", when: "winner", actions: [{ type: "coins", value: 5, target: "winner", text: "El ganador suma 5 monedas" }] })}
                className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-slate-100 transition hover:bg-white/10"
              >
                Add winner coins
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {(selected?.outcomes ?? []).map((outcome, index) => (
                <div key={`${outcome.label}-${index}`} className="rounded-md border border-white/10 bg-black/15 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-black text-white">{outcome.label ?? targetLabel(outcome.when)}</p>
                    <button onClick={() => removeOutcome(index)} className="rounded-md border border-rose-200/20 bg-rose-500/10 px-2 py-1 text-xs font-black text-rose-100">
                      Remove
                    </button>
                  </div>
                  <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-black/25 p-2 text-[0.65rem] text-slate-300">{JSON.stringify(outcome.actions, null, 2)}</pre>
                </div>
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
  runKey: number,
  protagonistId: string
): GameState {
  const activity = event.activity!;
  const participants = activityParticipants(activity, players, protagonistId);
  const subjects = activitySubjects(activity, players, protagonistId, participants);
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
      content: { ...(isRecord(activity.content) ? activity.content : {}), story: event.story, title: eventTitle(event), prompt: event.story.prompt },
      story: event.story,
      participants,
      subjects,
      submitted,
    },
    activeEvent: null,
    reveal: null,
    winnerId: null,
  };
}

function activityParticipants(activity: EventActivity, players: Player[], protagonistId: string): string[] {
  const mode = activity.participants ?? defaultParticipantMode(activity.type);
  if (mode === "landing") return players.some((player) => player.id === protagonistId) ? [protagonistId] : [];
  if (mode === "host") return players.filter((player) => player.isHost).map((player) => player.id);
  return players.map((player) => player.id);
}

function activitySubjects(activity: EventActivity, players: Player[], protagonistId: string, participants: string[]): string[] {
  if (activity.type === "hostPick" || activity.type === "vote") return players.map((player) => player.id);
  if (activity.type === "prompt") return players.some((player) => player.id === protagonistId) ? [protagonistId] : [];
  return participants;
}

function defaultParticipantMode(type: EventActivityType): "everyone" | "landing" | "host" {
  if (type === "hostPick") return "host";
  if (type === "prompt") return "landing";
  return "everyone";
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
    stars: 0,
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

function formatScore(score: number): string {
  if (!Number.isFinite(score)) return String(score);
  if (Math.abs(score) >= 1000) return Math.round(score).toLocaleString();
  return score.toFixed(3).replace(/\.?0+$/, "");
}

function targetLabel(target: EventOutcomeBranch["when"]): string {
  if (typeof target === "string") return target;
  if ("rank" in target) return `rank ${target.rank}`;
  return `ranks ${target.rankFrom}-${target.rankTo}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
