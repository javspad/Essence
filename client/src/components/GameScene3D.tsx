import { useMemo, type ReactNode } from "react";
import type { GameState, Player } from "@essence/shared";
import { supportsWebGL } from "../board3d";
import Board3DShell from "./Board3DShell";
import EventCard from "./EventCard";
import Reveal from "./Reveal";
import Scoreboard from "./Scoreboard";
import TurnControls from "./TurnControls";
import Victory from "./Victory";

interface GameScene3DProps {
  connected: boolean;
  state: GameState;
  me: Player;
  activeId?: string;
  isMyTurn: boolean;
  isHost: boolean;
  onRoll: () => void;
  onNext: () => void;
  onLeave: () => void;
}

const DICE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

export default function GameScene3D({
  connected,
  state,
  me,
  activeId,
  isMyTurn,
  isHost,
  onRoll,
  onNext,
  onLeave,
}: GameScene3DProps) {
  const canLoad3D = useMemo(() => supportsWebGL(), []);
  const canAdvance = isHost || isMyTurn;
  const editMode = useMemo(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("sceneEdit"),
    []
  );

  if (!canLoad3D) {
    return (
      <LegacyGameScreen
        state={state}
        me={me}
        activeId={activeId}
        isMyTurn={isMyTurn}
        canAdvance={canAdvance}
        onRoll={onRoll}
        onNext={onNext}
        onLeave={onLeave}
      />
    );
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#1b1309]">
      <Board3DShell
        tiles={state.board}
        players={state.players}
        activeId={activeId}
        lastRoll={state.lastRoll}
        boardLength={state.boardLength}
        interactive
        className="absolute inset-0 z-0 overflow-hidden bg-[radial-gradient(circle_at_50%_0%,#f9d88a_0%,#936326_34%,#201208_78%)]"
      />

      <SceneChrome
        connected={connected}
        state={state}
        me={me}
        activeId={activeId}
        isMyTurn={isMyTurn}
        canAdvance={canAdvance}
        editMode={editMode}
        onRoll={onRoll}
        onNext={onNext}
        onLeave={onLeave}
      />

      <div className="sr-only" aria-live="polite">
        {sceneStatus(state, activeId)}
      </div>
    </main>
  );
}

function SceneChrome({
  connected,
  state,
  me,
  activeId,
  isMyTurn,
  canAdvance,
  editMode,
  onRoll,
  onNext,
  onLeave,
}: {
  connected: boolean;
  state: GameState;
  me: Player;
  activeId?: string;
  isMyTurn: boolean;
  canAdvance: boolean;
  editMode: boolean;
  onRoll: () => void;
  onNext: () => void;
  onLeave: () => void;
}) {
  const active = state.players.find((player) => player.id === activeId);
  const sorted = [...state.players].sort((a, b) => b.stars - a.stars || b.coins - a.coins);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex min-h-0 flex-col gap-3 p-3 sm:p-5">
      <header className="mx-auto w-full max-w-xl rounded-3xl border border-white/20 bg-slate-950/55 px-4 py-3 text-center shadow-2xl shadow-black/30 backdrop-blur-md">
        <div className="flex items-center justify-center gap-2 text-sm font-black uppercase tracking-[0.22em] text-amber-100">
          Sala {state.code}
          <span className={connected ? "text-emerald-300" : "text-red-300"}>{connected ? "● en línea" : "● reconectando"}</span>
        </div>
        <div className="mt-1 text-xs font-bold uppercase tracking-[0.18em] text-violet-100/80">
          {phaseLabel(state.phase)} · Ronda {state.round}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 items-start justify-between gap-3">
        <ScorePanel players={sorted} activeId={activeId} />
        {editMode && <SceneEditHint active={active} />}
      </div>

      {state.phase !== "reveal" && state.phase !== "finished" && (
        <div className="flex justify-end">
          <TurnPanel state={state} me={me} active={active} isMyTurn={isMyTurn} onRoll={onRoll} />
        </div>
      )}

      {state.phase === "event" && <EventOverlay state={state} canAdvance={canAdvance} onNext={onNext} />}
      {state.phase === "reveal" && <RevealOverlay state={state} canAdvance={canAdvance} onNext={onNext} />}
      {state.phase === "finished" && <VictoryOverlay state={state} onLeave={onLeave} />}
    </div>
  );
}

function ScorePanel({ players, activeId }: { players: Player[]; activeId?: string }) {
  return (
    <aside className="pointer-events-auto w-[min(18rem,48vw)] max-w-full overflow-hidden rounded-3xl border border-amber-200/25 bg-slate-950/55 shadow-2xl shadow-black/30 backdrop-blur-md">
      <h2 className="border-b border-white/10 px-4 py-3 text-xs font-black uppercase tracking-[0.24em] text-amber-200">Marcador</h2>
      <ol className="max-h-[38dvh] overflow-y-auto p-2 text-sm">
        {players.map((player, index) => (
          <li
            key={player.id}
            className={`flex items-center gap-2 rounded-2xl px-2 py-2 font-bold ${player.id === activeId ? "bg-white/12" : ""}`}
          >
            <span className="w-5 text-center text-white/45">{index + 1}</span>
            <span className="h-3 w-3 shrink-0 rounded-full shadow" style={{ backgroundColor: player.color }} />
            <span className="min-w-0 flex-1 truncate" style={{ color: player.connected ? player.color : "#94a3b8" }}>
              {player.id === activeId ? "▶ " : ""}{player.name}
            </span>
            <span className="shrink-0 text-amber-100">🪙{player.coins}</span>
            {player.stars > 0 && <span className="shrink-0 text-yellow-200">⭐{player.stars}</span>}
          </li>
        ))}
      </ol>
    </aside>
  );
}

function TurnPanel({
  state,
  me,
  active,
  isMyTurn,
  onRoll,
}: {
  state: GameState;
  me: Player;
  active?: Player;
  isMyTurn: boolean;
  onRoll: () => void;
}) {
  return (
    <section className="pointer-events-auto w-[min(24rem,calc(100vw-1.5rem))] rounded-3xl border border-violet-200/25 bg-indigo-950/65 p-4 text-right shadow-2xl shadow-black/30 backdrop-blur-md">
      <p className="text-lg font-black text-amber-100 sm:text-2xl">{turnTitle(state, active, isMyTurn)}</p>
      <p className="mt-1 text-sm font-bold text-violet-100/80">
        {state.lastRoll ? `Dado ${DICE[state.lastRoll]} (${state.lastRoll})` : `Estás en ${me.position}`}
      </p>
      <p className="mt-1 truncate text-sm font-bold" style={{ color: active?.color ?? "#cbd5e1" }}>
        {active ? `Activo: ${active.name}` : "Esperando turno"}
      </p>
      {state.phase === "turn" && isMyTurn && (
        <button
          type="button"
          onClick={onRoll}
          className="pointer-events-auto mt-4 rounded-2xl bg-amber-300 px-6 py-3 text-base font-black uppercase tracking-[0.18em] text-amber-950 shadow-lg shadow-amber-950/30 transition active:scale-95"
        >
          Tirar 🎲
        </button>
      )}
    </section>
  );
}

function EventOverlay({ state, canAdvance, onNext }: { state: GameState; canAdvance: boolean; onNext: () => void }) {
  const event = state.activeEvent;
  if (!event) return null;
  const player = state.players.find((p) => p.id === event.playerId);
  const isDare = event.kind === "dare";

  return (
    <CenterOverlay>
      <div className={`modal-card ${isDare ? "from-rose-900/95 to-pink-950/95" : "from-fuchsia-900/95 to-indigo-950/95"}`}>
        <p className="text-center text-sm font-black uppercase tracking-[0.35em] text-white/70">{isDare ? "🍻 Prenda" : "🃏 Destino"}</p>
        <h2 className="mt-3 text-center text-3xl font-black text-white sm:text-5xl" style={{ color: player?.color ?? "#fff" }}>
          {player?.name ?? "Jugador"}
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-center text-xl font-black leading-tight text-white sm:text-3xl">{event.text}</p>
        <ActionButton disabled={!canAdvance} onClick={onNext}>{canAdvance ? (isDare ? "Listo →" : "Siguiente →") : "Esperando..."}</ActionButton>
      </div>
    </CenterOverlay>
  );
}

function RevealOverlay({ state, canAdvance, onNext }: { state: GameState; canAdvance: boolean; onNext: () => void }) {
  const reveal = state.reveal;
  if (!reveal) return null;
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <CenterOverlay>
      <div className="modal-card from-slate-950/95 to-indigo-950/95">
        <p className="text-center text-sm font-black uppercase tracking-[0.35em] text-violet-200">Resultados</p>
        <h2 className="mt-3 text-center text-3xl font-black text-amber-100 sm:text-5xl">{reveal.title}</h2>
        <ol className="mx-auto mt-5 grid max-w-2xl gap-2 text-left">
          {reveal.entries.map((entry, index) => (
            <li key={entry.playerId} className="rounded-2xl bg-white/10 px-4 py-3 text-lg font-black text-white sm:text-2xl">
              {medals[index] ?? `${entry.rank}.`} {entry.name} <span className="text-amber-200">+🪙{entry.coins}</span>
            </li>
          ))}
        </ol>
        <ActionButton disabled={!canAdvance} onClick={onNext}>{canAdvance ? "Siguiente turno →" : "Esperando..."}</ActionButton>
      </div>
    </CenterOverlay>
  );
}

function VictoryOverlay({ state, onLeave }: { state: GameState; onLeave: () => void }) {
  const ranked = [...state.players].sort((a, b) => b.stars - a.stars || b.coins - a.coins);
  const winner = state.players.find((p) => p.id === state.winnerId) ?? ranked[0];

  return (
    <CenterOverlay>
      <div className="modal-card from-amber-950/95 to-orange-950/95">
        <p className="text-center text-sm font-black uppercase tracking-[0.35em] text-amber-200">🏆 Ganador</p>
        <h2 className="mt-3 text-center text-5xl font-black sm:text-7xl" style={{ color: winner?.color ?? "#fff" }}>
          {winner?.name ?? ""}
        </h2>
        <ol className="mx-auto mt-5 grid max-w-xl gap-2 text-left">
          {ranked.map((player, index) => (
            <li key={player.id} className="rounded-2xl bg-white/10 px-4 py-3 text-lg font-black text-white">
              {index + 1}. {player.name} <span className="text-yellow-200">⭐{player.stars}</span> <span className="text-amber-200">🪙{player.coins}</span>
            </li>
          ))}
        </ol>
        <ActionButton onClick={onLeave}>Salir</ActionButton>
      </div>
    </CenterOverlay>
  );
}

function CenterOverlay({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center overflow-hidden bg-black/35 p-3 backdrop-blur-sm sm:p-6">
      {children}
    </div>
  );
}

function ActionButton({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="mt-6 rounded-2xl bg-white px-6 py-3 text-base font-black uppercase tracking-[0.18em] text-slate-950 shadow-lg transition active:scale-95 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/70 sm:text-lg"
    >
      {children}
    </button>
  );
}

function SceneEditHint({ active }: { active?: Player }) {
  return (
    <aside className="hidden max-w-xs rounded-3xl border border-sky-200/30 bg-sky-950/65 p-4 text-sm font-bold text-sky-100 shadow-2xl shadow-black/30 backdrop-blur-md md:block">
      <p className="font-black text-sky-200">sceneEdit=1</p>
      <p className="mt-1">Editá casilleros en shared/content.json → board.layout.</p>
      <p className="mt-1 text-sky-200/80">{active ? `Cámara siguiendo a ${active.name}` : "Mapa tipo Game of Life"}</p>
    </aside>
  );
}

function turnTitle(state: GameState, active: Player | undefined, isMyTurn: boolean): string {
  if (state.phase === "moving") return "Moviendo ficha...";
  if (state.phase === "event") return "Casillero especial";
  if (state.phase === "turn") return isMyTurn ? "¡Es tu turno!" : `Turno de ${active?.name ?? "..."}`;
  return active ? `Turno de ${active.name}` : "Tablero";
}

function phaseLabel(phase: GameState["phase"]): string {
  const labels: Record<GameState["phase"], string> = {
    lobby: "Lobby",
    turn: "Turno",
    moving: "Movimiento",
    event: "Evento",
    minigame: "Minijuego",
    reveal: "Resultados",
    finished: "Final",
  };
  return labels[phase];
}

function sceneStatus(state: GameState, activeId?: string): string {
  const active = state.players.find((player) => player.id === activeId);
  return `${phaseLabel(state.phase)}. ${active ? `Turno de ${active.name}.` : ""} Ronda ${state.round}.`;
}

function LegacyGameScreen({
  state,
  me,
  activeId,
  isMyTurn,
  canAdvance,
  onRoll,
  onNext,
  onLeave,
}: {
  state: GameState;
  me: Player;
  activeId?: string;
  isMyTurn: boolean;
  canAdvance: boolean;
  onRoll: () => void;
  onNext: () => void;
  onLeave: () => void;
}) {
  if (state.phase === "reveal") return <Reveal state={state} canAdvance={canAdvance} onNext={onNext} />;
  if (state.phase === "finished") return <Victory state={state} onLeave={onLeave} />;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-5 p-4">
      <Scoreboard state={state} activeId={activeId} />
      <TurnControls state={state} me={me} isMyTurn={isMyTurn} onRoll={onRoll} />
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center text-sm text-violet-200">
        3D no disponible en este navegador.
      </div>
      {state.phase === "event" && <EventCard state={state} canAdvance={canAdvance} onNext={onNext} />}
    </div>
  );
}
