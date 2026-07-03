import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { GameContent, GameState, MinigameDef, MinigameType, Player } from "@essence/shared";
import seedContent from "@shared/content.json";
import { ENGINES } from "../minigames";
import MinigameHost from "./MinigameHost";

const BASE_CONTENT = seedContent as GameContent;
const PLAYER_POOL = BASE_CONTENT.players;
const MINIGAME_IDS = Object.keys(BASE_CONTENT.minigames);
const INITIAL_PLAYERS = PLAYER_POOL.slice(0, Math.min(4, PLAYER_POOL.length)).map(toPlayer);

interface RunResult {
  id: number;
  playerId: string;
  score: number;
  payload: unknown;
}

export default function MinigameBuilder() {
  const [selectedId, setSelectedId] = useState(MINIGAME_IDS[0] ?? "");
  const [players, setPlayers] = useState<Player[]>(INITIAL_PLAYERS);
  const [actorId, setActorId] = useState(INITIAL_PLAYERS[0]?.id ?? "");
  const [submitted, setSubmitted] = useState<string[]>([]);
  const [results, setResults] = useState<RunResult[]>([]);
  const [runKey, setRunKey] = useState(1);
  const [actionLog, setActionLog] = useState<unknown[]>([]);

  const selected = BASE_CONTENT.minigames[selectedId];
  const actor = players.find((player) => player.id === actorId) ?? players[0];
  const hasEngine = selected ? Boolean(ENGINES[selected.type]) : false;

  const state = useMemo<GameState | null>(() => {
    if (!selected || !actor || players.length === 0) return null;
    return createTestState(selectedId, selected, players, submitted, runKey);
  }, [actor, players, runKey, selected, selectedId, submitted]);

  useEffect(() => {
    resetRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (players.some((player) => player.id === actorId)) return;
    setActorId(players[0]?.id ?? "");
  }, [actorId, players]);

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
    setResults((current) => [
      {
        id: Date.now(),
        playerId: actor.id,
        score,
        payload,
      },
      ...current,
    ]);
  };

  const handleAction = (data: unknown) => {
    if (!actor) return;
    setActionLog((current) => [{ playerId: actor.id, data }, ...current].slice(0, 6));
  };

  const forceResolve = () => {
    setSubmitted(players.map((player) => player.id));
    setActionLog((current) => [{ force: true, submitted: players.map((player) => player.id) }, ...current].slice(0, 6));
  };

  return (
    <main className="min-h-dvh bg-[#10131a] text-slate-100">
      <header className="flex flex-col gap-3 border-b border-white/10 bg-[#151922] px-4 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[0.6rem] font-black uppercase tracking-[0.18em] text-cyan-200">Essence tools</p>
          <h1 className="text-2xl font-black tracking-normal text-white">Minigame builder</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/"
            className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-slate-100 transition hover:bg-white/10"
          >
            Home
          </a>
          <a
            href="/map-builder"
            className="rounded-md border border-emerald-200/25 bg-emerald-300/10 px-3 py-2 text-sm font-bold text-emerald-100 transition hover:bg-emerald-300/15"
          >
            Map builder
          </a>
        </div>
      </header>

      <div className="grid min-h-[calc(100dvh-5.25rem)] grid-cols-1 lg:grid-cols-[19rem_minmax(0,1fr)_20rem]">
        <aside className="border-b border-white/10 bg-[#111722] p-3 lg:border-b-0 lg:border-r">
          <SectionTitle eyebrow={`${MINIGAME_IDS.length} total`} title="Minigames" />
          <div className="mt-3 flex flex-col gap-2">
            {MINIGAME_IDS.map((id) => {
              const def = BASE_CONTENT.minigames[id];
              const active = id === selectedId;
              return (
                <button
                  key={id}
                  onClick={() => setSelectedId(id)}
                  className={`rounded-md border p-3 text-left transition ${
                    active
                      ? "border-cyan-300/70 bg-cyan-300/14"
                      : "border-white/10 bg-white/[0.035] hover:border-white/25 hover:bg-white/[0.06]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white">{id}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-300">{titleFor(def)}</p>
                    </div>
                    <TypeBadge type={def.type} missing={!ENGINES[def.type]} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {def.skin && <MetaPill>{def.skin}</MetaPill>}
                    <MetaPill>{boardUseCount(id)} tiles</MetaPill>
                    {def.rigged && <MetaPill>rigged</MetaPill>}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="min-w-0 bg-[#181d27] p-3 md:p-4">
          <div className="mb-3 flex flex-col gap-3 rounded-md border border-white/10 bg-white/[0.035] p-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-black text-white">{selectedId}</h2>
                {selected && <TypeBadge type={selected.type} missing={!hasEngine} />}
              </div>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">{selected ? titleFor(selected) : "No minigame selected"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={resetRun}
                className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-slate-100 transition hover:bg-white/10"
              >
                Reset run
              </button>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-h-[32rem] rounded-md border border-white/10 bg-[#10131a]">
              {state && actor ? (
                <MinigameHost
                  key={`${selectedId}-${actor.id}-${runKey}`}
                  state={state}
                  me={actor}
                  isHost={actor.isHost}
                  onFinish={handleFinish}
                  onAction={handleAction}
                  onForce={forceResolve}
                />
              ) : (
                <div className="flex min-h-[32rem] items-center justify-center p-6 text-center text-sm font-bold text-slate-400">
                  Add a player to start a run.
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="rounded-md border border-white/10 bg-white/[0.035] p-3">
                <SectionTitle eyebrow={`${submitted.length}/${players.length} submitted`} title="Run" />
                <label className="mt-3 block text-xs font-black uppercase tracking-[0.12em] text-slate-400" htmlFor="actor">
                  Acting as
                </label>
                <select
                  id="actor"
                  value={actorId}
                  onChange={(event) => setActorId(event.target.value)}
                  className="mt-2 w-full rounded-md border border-white/15 bg-[#151922] px-3 py-2 text-sm font-bold text-white outline-none focus:border-cyan-300"
                >
                  {players.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
                </select>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {players.map((player) => (
                    <span
                      key={player.id}
                      className={`rounded-full border px-2 py-1 text-xs font-black ${
                        submitted.includes(player.id)
                          ? "border-emerald-300/45 bg-emerald-300/12 text-emerald-100"
                          : "border-white/10 bg-white/5 text-slate-300"
                      }`}
                    >
                      {player.name}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-white/10 bg-white/[0.035] p-3">
                <SectionTitle eyebrow={`${results.length} entries`} title="Results" />
                <div className="mt-3 space-y-2">
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
              </div>
            </div>
          </div>
        </section>

        <aside className="border-t border-white/10 bg-[#111722] p-3 lg:border-l lg:border-t-0">
          <SectionTitle eyebrow={`${players.length} active`} title="Players" />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={addPlayer}
              disabled={players.length >= PLAYER_POOL.length}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-slate-100 transition hover:bg-white/10 disabled:opacity-40"
            >
              Add player
            </button>
            <button
              onClick={addAllPlayers}
              className="rounded-md border border-cyan-200/25 bg-cyan-300/10 px-3 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-300/15"
            >
              Add all
            </button>
            <button
              onClick={resetPlayers}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-slate-100 transition hover:bg-white/10"
            >
              Reset
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {players.map((player) => (
              <div key={player.id} className="rounded-md border border-white/10 bg-white/[0.035] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: player.color }} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white">{player.name}</p>
                      <p className="text-xs text-slate-400">{player.groom ? "groom" : player.id}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => removePlayer(player.id)}
                    disabled={players.length <= 1}
                    className="rounded-md border border-rose-200/20 bg-rose-500/10 px-2 py-1 text-xs font-black text-rose-100 transition hover:bg-rose-500/15 disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-md border border-white/10 bg-white/[0.035] p-3">
            <SectionTitle eyebrow={selected?.skin ?? selected?.type ?? "content"} title="Content" />
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-black/25 p-3 text-[0.68rem] leading-4 text-slate-300">
              {selected ? JSON.stringify(selected.content, null, 2) : "{}"}
            </pre>
          </div>

          <div className="mt-3 rounded-md border border-white/10 bg-white/[0.035] p-3">
            <SectionTitle eyebrow={`${actionLog.length} events`} title="Actions" />
            <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap rounded-md bg-black/25 p-3 text-[0.68rem] leading-4 text-slate-300">
              {actionLog.length ? JSON.stringify(actionLog, null, 2) : "[]"}
            </pre>
          </div>
        </aside>
      </div>
    </main>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="text-[0.58rem] font-black uppercase tracking-[0.16em] text-slate-400">{eyebrow}</p>
      <h2 className="text-base font-black text-white">{title}</h2>
    </div>
  );
}

function TypeBadge({ type, missing }: { type: MinigameType; missing: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-1 text-[0.62rem] font-black uppercase tracking-[0.08em] ${
        missing
          ? "border-rose-200/35 bg-rose-500/12 text-rose-100"
          : "border-cyan-200/35 bg-cyan-300/12 text-cyan-100"
      }`}
    >
      {missing ? `${type} missing` : type}
    </span>
  );
}

function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-black/15 px-2 py-0.5 text-[0.65rem] font-bold text-slate-300">
      {children}
    </span>
  );
}

function createTestState(
  selectedId: string,
  selected: MinigameDef,
  players: Player[],
  submitted: string[],
  runKey: number
): GameState {
  return {
    code: "TEST",
    roomName: "Minigame builder",
    phase: "minigame",
    board: [],
    players,
    turnOrder: players.map((player) => player.id),
    activeIndex: 0,
    round: runKey,
    boardLength: 0,
    lastRoll: null,
    activeMinigame: {
      id: selectedId,
      type: selected.type,
      skin: selected.skin,
      content: selected.content,
      participants: players.map((player) => player.id),
      submitted,
    },
    activeEvent: null,
    reveal: null,
    winnerId: null,
  };
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

function titleFor(def: MinigameDef): string {
  const content = (def.content ?? {}) as Record<string, unknown>;
  if (typeof content.question === "string") return content.question;
  if (typeof content.label === "string") return content.label;
  if (typeof content.prompt === "string") return content.prompt;
  return def.type;
}

function boardUseCount(minigameId: string): number {
  const maps = BASE_CONTENT.maps?.length ? BASE_CONTENT.maps : [];
  const boards = maps.map((map) => map.board);
  if (!boards.length) boards.push(BASE_CONTENT.board);
  return boards.flat().filter((tile) => tile.minigameId === minigameId).length;
}

function nameFor(players: Player[], playerId: string): string {
  return players.find((player) => player.id === playerId)?.name ?? playerId;
}

function formatScore(score: number): string {
  if (!Number.isFinite(score)) return String(score);
  if (Math.abs(score) >= 1000) return Math.round(score).toLocaleString();
  return score.toFixed(3).replace(/\.?0+$/, "");
}
