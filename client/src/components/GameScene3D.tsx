import { useMemo, type ReactNode } from "react";
import type { GameState, Player } from "@essence/shared";
import { Dice5 } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { Badge } from "@/components/ui/8bit/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/8bit/card";
import { cn } from "@/lib/utils";
import { supportsWebGL } from "../board3d";
import type { BoardActiveMotion, BoardDiceCue } from "../gamePresentationMachine";
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
  activeMotion?: BoardActiveMotion | null;
  diceCue?: BoardDiceCue | null;
  eventBusyLabel?: string | null;
  rollBlocked?: boolean;
  statusLabel?: string | null;
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
  activeMotion,
  diceCue,
  eventBusyLabel,
  rollBlocked = false,
  statusLabel,
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
        routes={state.routes}
        artifacts={state.artifacts}
        assetCatalog={state.assetCatalog}
        boardShape={state.boardShape}
        players={state.players}
        activeId={activeId}
        lastRoll={state.lastRoll}
        boardLength={state.boardLength}
        activeMotion={activeMotion}
        diceCue={diceCue}
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
        eventBusyLabel={eventBusyLabel}
        rollBlocked={rollBlocked}
        statusLabel={statusLabel}
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
  eventBusyLabel,
  rollBlocked,
  statusLabel,
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
  eventBusyLabel?: string | null;
  rollBlocked: boolean;
  statusLabel?: string | null;
  onRoll: () => void;
  onNext: () => void;
  onLeave: () => void;
}) {
  const active = state.players.find((player) => player.id === activeId);
  const sorted = [...state.players].sort((a, b) => b.stars - a.stars || b.coins - a.coins);
  const showTurnPanel =
    state.phase !== "reveal" &&
    state.phase !== "finished" &&
    (isMyTurn || state.phase === "moving" || Boolean(state.lastRoll));

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex min-h-0 flex-col gap-3 p-3 sm:p-5">
      <div className="flex min-h-0 flex-1 items-start gap-3">
        <div className="flex min-w-0 flex-col gap-3">
          <ScorePanel
            players={sorted}
            active={active}
            activeId={activeId}
            connected={connected}
            phase={state.phase}
            round={state.round}
          />
          {editMode && <SceneEditHint active={active} />}
        </div>
      </div>

      {showTurnPanel && (
        <div className="flex justify-end">
          <TurnPanel
            state={state}
            me={me}
            active={active}
            isMyTurn={isMyTurn}
            rollBlocked={rollBlocked}
            statusLabel={statusLabel}
            onRoll={onRoll}
          />
        </div>
      )}

      {state.phase === "event" && <EventOverlay state={state} canAdvance={canAdvance} busyLabel={eventBusyLabel} onNext={onNext} />}
      {state.phase === "reveal" && <RevealOverlay state={state} canAdvance={canAdvance} onNext={onNext} />}
      {state.phase === "finished" && <VictoryOverlay state={state} onLeave={onLeave} />}
    </div>
  );
}

function ScorePanel({
  players,
  active,
  activeId,
  connected,
  phase,
  round,
}: {
  players: Player[];
  active?: Player;
  activeId?: string;
  connected: boolean;
  phase: GameState["phase"];
  round: number;
}) {
  return (
    <Card
      font="normal"
      className="pointer-events-auto w-[min(23rem,calc(100vw-1.5rem))] max-w-full border-[#fff4bf] bg-[#171120]/90 text-[#fff8d6] shadow-[0_16px_40px_rgb(0_0_0/0.35)] backdrop-blur-md"
    >
      <aside>
        <CardHeader font="normal" className="gap-2 px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle font="normal" className="retro text-[10px] uppercase text-[#fff4bf]">
                Marcador
              </CardTitle>
              <p className="mt-1 text-[11px] font-black uppercase text-[#c7bddc]">
                Ronda {round} · {phaseLabel(phase)}
              </p>
            </div>
            <Badge className="shrink-0 border-[#a7f3d0] bg-[#34d399] px-2 py-1 text-[9px] uppercase text-[#062116]">
              Turno {active?.name ?? "..."}
            </Badge>
          </div>
          {!connected && (
            <Badge className="w-fit border-[#fecaca] bg-[#fb7185] px-2 py-1 text-[9px] uppercase text-[#2a070b]">
              Reconectando
            </Badge>
          )}
        </CardHeader>
        <CardContent font="normal" className="px-2 pb-2 pt-0">
          <ol className="max-h-[38dvh] overflow-y-auto text-sm">
            {players.map((player, index) => {
              const isActive = player.id === activeId;

              return (
                <li
                  key={player.id}
                  className={cn(
                    "grid grid-cols-[1.4rem_0.85rem_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2 font-black",
                    isActive ? "bg-[#f5d547]/16 text-[#fff8d6]" : "text-[#fff8d6]/85",
                    player.connected ? "" : "opacity-45"
                  )}
                >
                  <span className="retro text-center text-[9px] text-[#fff4bf]/60">{index + 1}</span>
                  <span
                    className="size-3 rounded-[2px] border border-black/35 shadow-[2px_2px_0_rgb(0_0_0/0.35)]"
                    style={{ backgroundColor: player.color }}
                  />
                  <span className="min-w-0 truncate text-xs sm:text-sm">
                    {isActive ? "▶ " : ""}
                    {player.name}
                    {player.groom ? " 🤵" : ""}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-[11px] text-[#fff4bf]">
                    <span>🪙{player.coins}</span>
                    {player.stars > 0 && <span>⭐{player.stars}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </aside>
    </Card>
  );
}

function TurnPanel({
  state,
  me,
  active,
  isMyTurn,
  rollBlocked,
  statusLabel,
  onRoll,
}: {
  state: GameState;
  me: Player;
  active?: Player;
  isMyTurn: boolean;
  rollBlocked: boolean;
  statusLabel?: string | null;
  onRoll: () => void;
}) {
  return (
    <Card
      font="normal"
      className="pointer-events-auto w-[min(20rem,calc(100vw-1.5rem))] border-[#f5d547] bg-[#171120]/92 text-[#fff8d6] text-left shadow-[0_16px_40px_rgb(0_0_0/0.38)] backdrop-blur-md"
    >
      <section>
        <CardContent font="normal" className="p-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="retro text-[9px] uppercase text-[#c7bddc]">Tu ficha</p>
              <p className="mt-1 text-2xl font-black text-[#fff4bf]">#{Math.max(0, me.position)}</p>
            </div>
            <div className="text-right">
              <p className="retro text-[9px] uppercase text-[#c7bddc]">Dado</p>
              <p className="mt-1 text-3xl font-black leading-none text-[#fff8d6]" aria-label={state.lastRoll ? `Dado ${state.lastRoll}` : "Sin dado"}>
                {state.lastRoll ? DICE[state.lastRoll] : "--"}
              </p>
            </div>
          </div>
          <p className="mt-3 text-sm font-black" style={{ color: active?.color ?? "#cbd5e1" }}>
            {statusLabel ?? turnTitle(state, active, isMyTurn)}
          </p>
          {state.phase === "turn" && isMyTurn && (
            <Button
              type="button"
              onClick={onRoll}
              disabled={rollBlocked}
              className="pointer-events-auto mt-4 h-12 w-full bg-[#f5d547] px-5 text-sm uppercase text-[#201507] hover:bg-[#ffe96c]"
            >
              <Dice5 data-icon="inline-start" />
              Tirar
            </Button>
          )}
        </CardContent>
      </section>
    </Card>
  );
}

function EventOverlay({
  state,
  canAdvance,
  busyLabel,
  onNext,
}: {
  state: GameState;
  canAdvance: boolean;
  busyLabel?: string | null;
  onNext: () => void;
}) {
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
        <ActionButton disabled={!canAdvance || Boolean(busyLabel)} onClick={onNext}>
          {busyLabel ?? (canAdvance ? (isDare ? "Listo →" : "Siguiente →") : "Esperando...")}
        </ActionButton>
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
    <Button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="mt-6 min-h-12 bg-[#f5d547] px-6 text-sm uppercase text-[#201507] disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/70 sm:text-base"
    >
      {children}
    </Button>
  );
}

function SceneEditHint({ active }: { active?: Player }) {
  return (
    <aside className="hidden max-w-xs rounded-3xl border border-sky-200/30 bg-sky-950/65 p-4 text-sm font-bold text-sky-100 shadow-2xl shadow-black/30 backdrop-blur-md md:block">
      <p className="font-black text-sky-200">Map builder</p>
      <p className="mt-1">Abrí /map-builder para editar casilleros, rutas, terrenos y artefactos.</p>
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
