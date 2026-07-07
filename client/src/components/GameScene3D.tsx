import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { EffectInstance, GameState, Player } from "@essence/shared";
import { effectRemainingLabel } from "@essence/shared/consequences";
import { rankPlayersByProgress, rankPlayersForFinishedGame } from "@essence/shared/ranking";
import {
  Dice5,
  LogOut,
  Map as MapIcon,
} from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { Badge } from "@/components/ui/8bit/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/8bit/card";
import { cn } from "@/lib/utils";
import { applyCameraIntent, supportsWebGL, type BoardCameraState, type CameraIntent } from "../board3d";
import type { BoardActiveMotion, BoardDiceCue } from "../gamePresentationMachine";
import { revealEntryDetail, revealEntryResult } from "../revealDisplay";
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
const DEFAULT_CAMERA_STATE: BoardCameraState = { mode: "followActivePlayer", focusedPlayerId: null };

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
  const [cameraState, setCameraState] = useState<BoardCameraState>(DEFAULT_CAMERA_STATE);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const canAdvance = isHost || isMyTurn;
  const editMode = useMemo(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("sceneEdit"),
    []
  );
  const focusedPlayer = cameraState.focusedPlayerId
    ? state.players.find((player) => player.id === cameraState.focusedPlayerId)
    : undefined;
  const dispatchCameraIntent = useCallback((intent: CameraIntent) => {
    setCameraState((current) => applyCameraIntent(current, intent));
  }, []);
  const focusPlayer = useCallback(
    (playerId: string) => dispatchCameraIntent({ kind: "focusPlayer", playerId }),
    [dispatchCameraIntent]
  );
  const requestLeave = useCallback(() => setLeaveConfirmOpen(true), []);
  const confirmLeave = useCallback(() => {
    setLeaveConfirmOpen(false);
    onLeave();
  }, [onLeave]);

  useEffect(() => {
    if (!cameraState.focusedPlayerId) return;
    if (state.players.some((player) => player.id === cameraState.focusedPlayerId)) return;
    setCameraState((current) => ({ ...current, focusedPlayerId: null }));
  }, [cameraState.focusedPlayerId, state.players]);

  if (!canLoad3D) {
    return (
      <div className="relative min-h-full">
        <LegacyGameScreen
          state={state}
          me={me}
          activeId={activeId}
          isMyTurn={isMyTurn}
          canAdvance={canAdvance}
          onRoll={onRoll}
          onNext={onNext}
          onLeave={requestLeave}
        />
        {leaveConfirmOpen && (
          <LeaveConfirmationOverlay
            isHost={isHost}
            playerName={me.name}
            onCancel={() => setLeaveConfirmOpen(false)}
            onConfirm={confirmLeave}
          />
        )}
      </div>
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
        terraces={state.terraces}
        players={state.players}
        activeId={activeId}
        lastRoll={state.lastRoll}
        boardLength={state.boardLength}
        activeMotion={activeMotion}
        diceCue={diceCue}
        interactive
        cameraMode={cameraState.mode}
        focusedPlayerId={cameraState.focusedPlayerId}
        onPlayerFocus={focusPlayer}
        className="absolute inset-0 z-0 overflow-hidden bg-[radial-gradient(ellipse_at_45%_-5%,#f2d8a7_0%,#dfa96b_30%,#96602c_62%,#2c1808_100%)]"
      />

      <SceneChrome
        connected={connected}
        state={state}
        me={me}
        activeId={activeId}
        isMyTurn={isMyTurn}
        canAdvance={canAdvance}
        editMode={editMode}
        cameraState={cameraState}
        eventBusyLabel={eventBusyLabel}
        rollBlocked={rollBlocked}
        statusLabel={statusLabel}
        onCameraIntent={dispatchCameraIntent}
        onFocusPlayer={focusPlayer}
        onRoll={onRoll}
        onNext={onNext}
        onLeave={requestLeave}
      />

      {leaveConfirmOpen && (
        <LeaveConfirmationOverlay
          isHost={isHost}
          playerName={me.name}
          onCancel={() => setLeaveConfirmOpen(false)}
          onConfirm={confirmLeave}
        />
      )}

      <div className="sr-only" aria-live="polite">
        {sceneStatus(state, activeId, cameraState, focusedPlayer)}
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
  cameraState,
  eventBusyLabel,
  rollBlocked,
  statusLabel,
  onCameraIntent,
  onFocusPlayer,
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
  cameraState: BoardCameraState;
  eventBusyLabel?: string | null;
  rollBlocked: boolean;
  statusLabel?: string | null;
  onCameraIntent: (intent: CameraIntent) => void;
  onFocusPlayer: (playerId: string) => void;
  onRoll: () => void;
  onNext: () => void;
  onLeave: () => void;
}) {
  const active = state.players.find((player) => player.id === activeId);
  const sorted = rankPlayersByProgress(state.players);
  const showTurnPanel =
    state.phase !== "reveal" &&
    state.phase !== "finished" &&
    (isMyTurn || state.phase === "moving" || Boolean(state.lastRoll));

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex min-h-0 flex-col gap-3 p-3 sm:p-5">
      <div className="flex min-h-0 flex-1 flex-col items-start gap-3 sm:flex-row">
        <div className="flex min-w-0 flex-col gap-3">
          <ScorePanel
            players={sorted}
            active={active}
            activeId={activeId}
            focusedPlayerId={cameraState.focusedPlayerId}
            connected={connected}
            phase={state.phase}
            round={state.round}
            activeEffects={state.activeEffects}
            onFocusPlayer={onFocusPlayer}
          />
          {editMode && <SceneEditHint active={active} />}
        </div>
        {state.phase !== "finished" && (
          <div className="relative z-30 ml-0 flex w-full items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
            <MapToggleButton cameraMode={cameraState.mode} onCameraIntent={onCameraIntent} />
            <LeaveButton onLeave={onLeave} />
          </div>
        )}
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
  focusedPlayerId,
  connected,
  phase,
  round,
  activeEffects,
  onFocusPlayer,
}: {
  players: Player[];
  active?: Player;
  activeId?: string;
  focusedPlayerId?: string | null;
  connected: boolean;
  phase: GameState["phase"];
  round: number;
  activeEffects: EffectInstance[];
  onFocusPlayer: (playerId: string) => void;
}) {
  return (
    <Card
      font="normal"
      className="pointer-events-auto w-[min(22rem,calc(100vw-1.5rem))] max-w-full border-[#fff4bf]/40 bg-[#0e0a1a]/94 text-[#fff8d6] shadow-[0_0_0_1px_rgba(255,244,191,0.08),0_20px_50px_rgb(0_0_0/0.5)] backdrop-blur-xl"
    >
      <aside>
        <CardHeader font="normal" className="gap-2 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle font="normal" className="retro text-[9px] uppercase tracking-widest text-[#a89fc5]">
                Marcador
              </CardTitle>
              <p className="mt-0.5 text-[10px] font-black uppercase tracking-wide text-[#d4cfea]">
                Ronda {round} · {phaseLabel(phase)}
              </p>
            </div>
            <Badge className="shrink-0 border-[#6ee7b7]/50 bg-[#10b981]/20 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-[#6ee7b7]">
              Turno {active?.name ?? "..."}
            </Badge>
          </div>
          {!connected && (
            <Badge className="w-fit border-[#fecaca]/50 bg-[#ef4444]/20 px-2 py-1 text-[8px] uppercase text-[#fca5a5]">
              Reconectando
            </Badge>
          )}
        </CardHeader>
        <div className="mx-2 h-px bg-white/8" />
        <CardContent font="normal" className="px-1.5 pb-2 pt-1">
          <ol className="max-h-[38dvh] overflow-y-auto text-sm">
            {players.map((player, index) => {
              const isActive = player.id === activeId;
              const isFocused = player.id === focusedPlayerId;
              const effects = activeEffects.filter((effect) => effect.targetPlayerId === player.id);

              return (
                <li key={player.id}>
                  <button
                    type="button"
                    aria-pressed={isFocused}
                    aria-label={`Enfocar a ${player.name} en el mapa`}
                    title={`Enfocar a ${player.name}`}
                    onClick={() => onFocusPlayer(player.id)}
                    className={cn(
                      "grid w-full grid-cols-[1.2rem_0.8rem_minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-2 py-1.5 text-left font-black transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#67e8f9]",
                      isFocused
                        ? "bg-[#67e8f9]/18 text-[#ecfeff] ring-1 ring-[#67e8f9]/60"
                        : isActive
                          ? "bg-[#f5d547]/14 text-[#fff8d6]"
                          : "text-[#d4cfea]/80 hover:bg-white/8",
                      player.connected ? "" : "opacity-40"
                    )}
                  >
                    <span className="retro text-center text-[8px] text-[#a89fc5]">{index + 1}</span>
                    <span
                      className="size-3 rounded-[2px] shadow-[1px_1px_0_rgb(0_0_0/0.4),0_0_6px_var(--player-glow)]"
                      style={{ backgroundColor: player.color, ["--player-glow" as string]: `${player.color}66` }}
                    />
                    <span className="min-w-0 text-[11px] sm:text-xs">
                      <span className="block min-w-0 truncate">
                        {isActive ? <span className="text-[#f5d547]">▶ </span> : ""}
                        {player.name}
                        {player.groom ? " 🤵" : ""}
                      </span>
                      {effects.length > 0 && (
                        <span className="mt-1 flex max-w-full flex-wrap gap-1">
                          {effects.map((effect) => (
                            <span
                              key={effect.id}
                              title={`${effect.name}: ${effect.description ?? "Active effect"} (${effectRemainingLabel(effect.remaining)})`}
                              className="max-w-[9rem] truncate rounded-sm border border-cyan-200/30 bg-cyan-300/12 px-1.5 py-0.5 text-[8px] uppercase tracking-wide text-cyan-100"
                            >
                              {effect.name} · {effectRemainingLabel(effect.remaining)}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-[10px]">
                      <span className="text-[#d4cfea]">#{player.position}</span>
                      <span className="text-[#fbbf24]">🪙{player.coins}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </aside>
    </Card>
  );
}

function MapToggleButton({ cameraMode, onCameraIntent }: { cameraMode: BoardCameraState["mode"]; onCameraIntent: (intent: CameraIntent) => void }) {
  const showingMap = cameraMode === "overview";
  const label = showingMap ? "Volver al jugador actual" : "Ver mapa completo";

  return (
    <Button
      type="button"
      aria-label={label}
      aria-pressed={showingMap || undefined}
      title={label}
      data-testid="camera-map-toggle"
      data-camera-mode={cameraMode}
      onClick={() => onCameraIntent(showingMap ? { kind: "resetToActivePlayer" } : { kind: "frameOverview" })}
      className={cn(
        "pointer-events-auto flex h-9 w-10 items-center justify-center border border-[#fff4bf]/35 p-0 text-[#fff8d6] shadow-[0_0_0_1px_rgba(255,244,191,0.08),0_8px_24px_rgb(0_0_0/0.4)] backdrop-blur-xl transition-colors hover:bg-[#67e8f9]/18 hover:text-[#ecfeff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#67e8f9]",
        showingMap ? "bg-[#67e8f9]/22 text-[#ecfeff] ring-1 ring-[#67e8f9]/70" : "bg-[#0e0a1a]/88"
      )}
    >
      <MapIcon className="size-4" />
    </Button>
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
      className="pointer-events-auto w-[min(21rem,calc(100vw-1.5rem))] border-[#f5d547]/70 bg-[#0e0a1a]/94 text-[#fff8d6] text-left shadow-[0_0_0_1px_rgba(245,213,71,0.12),0_20px_50px_rgb(0_0_0/0.5)] backdrop-blur-xl"
    >
      <section>
        <CardContent font="normal" className="p-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="retro text-[8px] uppercase tracking-widest text-[#a89fc5]">Tu ficha</p>
              <p className="mt-1.5 text-2xl font-black text-[#fff4bf] tabular-nums">#{Math.max(0, me.position)}</p>
            </div>
            <div className="text-right">
              <p className="retro text-[8px] uppercase tracking-widest text-[#a89fc5]">Dado</p>
              <p
                className="mt-1.5 text-3xl font-black leading-none text-[#fde68a]"
                aria-label={state.lastRoll ? `Dado ${state.lastRoll}` : "Sin dado"}
                style={{ textShadow: state.lastRoll ? "0 0 20px rgba(253,212,95,0.6)" : "none" }}
              >
                {state.lastRoll ? DICE[state.lastRoll] : "--"}
              </p>
            </div>
          </div>

          {/* Thin separator */}
          <div className="my-3 h-px bg-white/10" />

          <p className="text-sm font-black" style={{ color: active?.color ?? "#94a3b8" }}>
            {statusLabel ?? turnTitle(state, active, isMyTurn)}
          </p>

          {state.phase === "turn" && isMyTurn && (
            <Button
              type="button"
              onClick={onRoll}
              disabled={rollBlocked}
              className="pointer-events-auto mt-4 h-12 w-full bg-[#f5d547] px-5 text-sm font-black uppercase tracking-wider text-[#201507] shadow-[0_4px_0_#b9991a] transition-all hover:bg-[#ffe96c] hover:shadow-[0_2px_0_#b9991a] hover:translate-y-px active:translate-y-[3px] active:shadow-none disabled:translate-y-0 disabled:shadow-none"
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
  const isDare = event.kind === "dare" || event.story?.title?.toLowerCase().includes("prenda");
  const title = event.title ?? event.story?.title ?? (isDare ? "Prenda" : "Evento");

  return (
    <CenterOverlay>
      <div className={`modal-card ${isDare ? "from-rose-950/96 to-pink-950/96" : "from-violet-950/96 to-indigo-950/96"}`}>
        {/* Category badge */}
        <div className="inline-flex items-center gap-2 rounded-sm border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.3em] text-white/80">
          <span className="text-base">{isDare ? "🍻" : "🃏"}</span>
          {title}
        </div>
        {/* Player name */}
        <h2
          className="mt-4 text-center text-4xl font-black drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)] sm:text-6xl"
          style={{ color: player?.color ?? "#fff", textShadow: `0 0 40px ${player?.color ?? "#fff"}55` }}
        >
          {player?.name ?? "Jugador"}
        </h2>
        {/* Divider */}
        <div className="mx-auto my-5 h-px w-24 rounded-full bg-white/20" />
        {/* Event text */}
        {event.story?.setup && <p className="mx-auto max-w-2xl text-center text-base font-black leading-7 text-white/70 sm:text-xl">{event.story.setup}</p>}
        <p className="mx-auto mt-3 max-w-2xl text-center text-xl font-black leading-snug text-white/95 sm:text-3xl">
          {event.story?.prompt ?? event.text}
        </p>
        {event.story?.reward && <p className="mx-auto mt-4 max-w-xl text-center text-base font-black text-amber-200 sm:text-xl">{event.story.reward}</p>}
        <AppliedActions actions={event.actions} />
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
  const isPrompt = reveal.type === "prompt";

  return (
    <CenterOverlay>
      <div className="modal-card from-slate-950/96 to-indigo-950/96">
        <div className="inline-flex items-center gap-2 rounded-sm border border-violet-400/30 bg-violet-500/15 px-3 py-1.5 text-xs font-black uppercase tracking-[0.3em] text-violet-200">
          {isPrompt ? "Evento" : "🏅 Resultados"}
        </div>
        <h2 className="mt-4 text-center text-3xl font-black text-amber-100 sm:text-5xl">{reveal.title}</h2>
        {reveal.story?.reveal && <p className="mx-auto mt-3 max-w-2xl text-center text-base font-black text-violet-100">{reveal.story.reveal}</p>}
        <div className="mx-auto my-5 h-px w-24 rounded-full bg-white/20" />
        <ol className="mx-auto grid max-w-2xl gap-2 text-left">
          {reveal.entries.map((entry, index) => {
            const detail = revealEntryDetail(entry);
            return (
              <li
                key={entry.playerId}
                className="rounded-sm border border-white/10 bg-white/8 px-4 py-3 text-white"
              >
                <div className="flex items-center justify-between gap-3 text-lg font-black sm:text-2xl">
                  <span className="min-w-0 truncate">{medals[index] ?? `${entry.rank}.`} {entry.name}</span>
                  <span className="shrink-0 text-right text-base text-sky-100 sm:text-xl">{revealEntryResult(entry)}</span>
                </div>
                <div className="mt-1 flex items-start justify-between gap-3">
                  {detail && <p className="min-w-0 text-sm font-black leading-5 text-violet-100 sm:text-base">{detail}</p>}
                  {entry.coins > 0 && <span className="shrink-0 text-sm font-black text-amber-200 sm:text-base">+🪙{entry.coins}</span>}
                </div>
              </li>
            );
          })}
        </ol>
        <AppliedActions actions={reveal.actions} />
        <ActionButton disabled={!canAdvance} onClick={onNext}>{canAdvance ? "Siguiente turno →" : "Esperando..."}</ActionButton>
      </div>
    </CenterOverlay>
  );
}

function AppliedActions({ actions }: { actions?: { text: string; targetPlayerIds: string[] }[] }) {
  if (!actions?.length) return null;
  return (
    <div className="mx-auto mt-5 grid max-w-xl gap-2">
      {actions.map((action, index) => (
        <p key={`${action.text}-${index}`} className="rounded-sm border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-center text-sm font-black text-amber-100">
          {action.text}
        </p>
      ))}
    </div>
  );
}

function VictoryOverlay({ state, onLeave }: { state: GameState; onLeave: () => void }) {
  const ranked = rankPlayersForFinishedGame(state.players, state.winnerId);
  const winner = state.players.find((p) => p.id === state.winnerId) ?? ranked[0];

  return (
    <CenterOverlay>
      <div className="modal-card from-amber-950/96 to-orange-950/96">
        <div className="inline-flex items-center gap-2 rounded-sm border border-amber-400/30 bg-amber-500/15 px-3 py-1.5 text-xs font-black uppercase tracking-[0.3em] text-amber-200">
          🏆 Ganador
        </div>
        <h2
          className="mt-4 text-center text-5xl font-black drop-shadow-[0_2px_16px_rgba(0,0,0,0.9)] sm:text-7xl"
          style={{ color: winner?.color ?? "#fff", textShadow: `0 0 50px ${winner?.color ?? "#fff"}44` }}
        >
          {winner?.name ?? ""}
        </h2>
        <div className="mx-auto my-5 h-px w-24 rounded-full bg-white/20" />
        <ol className="mx-auto grid max-w-xl gap-2 text-left">
          {ranked.map((player, index) => (
            <li
              key={player.id}
              className="flex items-center justify-between gap-3 rounded-sm border border-white/10 bg-white/8 px-4 py-3 text-lg font-black text-white"
            >
              <span>{index + 1}. {player.name}</span>
              <span className="shrink-0 text-sm">
                <span className="text-yellow-200">Casillero {player.position}</span>
                {" "}
                <span className="text-amber-200">🪙{player.coins}</span>
              </span>
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

function LeaveConfirmationOverlay({
  isHost,
  playerName,
  onCancel,
  onConfirm,
}: {
  isHost: boolean;
  playerName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-6">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-confirm-title"
        aria-describedby="leave-confirm-body"
        className="w-[min(28rem,calc(100vw-1.5rem))] rounded-sm border border-[#fff4bf]/35 bg-[#0e0a1a]/96 p-5 text-[#fff8d6] shadow-[0_0_0_1px_rgba(255,244,191,0.08),0_24px_70px_rgb(0_0_0/0.6)]"
      >
        <p id="leave-confirm-title" className="text-xl font-black text-[#fff4bf]">
          {isHost ? "¿Cerrar la sala?" : "¿Salir de la sala?"}
        </p>
        <p id="leave-confirm-body" className="mt-3 text-sm font-bold leading-6 text-[#d4cfea]">
          {isHost
            ? `${playerName}, si salís como host se cierra la sala y todos vuelven al inicio.`
            : `${playerName}, vas a salir de la sala. El host verá que ya no estás conectado.`}
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            className="min-h-11 px-4 text-xs font-black uppercase tracking-wider text-[#d4cfea] hover:bg-white/10"
          >
            Seguir jugando
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            className="min-h-11 bg-[#fb7185] px-4 text-xs font-black uppercase tracking-wider text-[#2a070b] hover:bg-[#fda4af]"
          >
            {isHost ? "Cerrar sala" : "Salir"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function LeaveButton({ onLeave }: { onLeave: () => void }) {
  return (
    <Button
      type="button"
      aria-label="Salir de la sala"
      title="Salir de la sala"
      onClick={onLeave}
      className="pointer-events-auto flex h-9 items-center gap-1.5 border border-[#fb7185]/40 bg-[#2a070b]/80 px-3 text-[10px] font-black uppercase tracking-wider text-[#fda4af] shadow-[0_0_0_1px_rgba(251,113,133,0.1),0_8px_24px_rgb(0_0_0/0.4)] backdrop-blur-xl transition-colors hover:bg-[#fb7185]/25 hover:text-white"
    >
      <LogOut data-icon="inline-start" className="size-3.5" />
      Salir
    </Button>
  );
}

function SceneEditHint({ active }: { active?: Player }) {
  return (
    <aside className="hidden max-w-xs rounded-3xl border border-sky-200/30 bg-sky-950/65 p-4 text-sm font-bold text-sky-100 shadow-2xl shadow-black/30 backdrop-blur-md md:block">
      <p className="font-black text-sky-200">Map builder</p>
      <p className="mt-1">Abrí /map-builder para editar casilleros, rutas, terrenos y map props.</p>
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

function sceneStatus(state: GameState, activeId?: string, cameraState?: BoardCameraState, focusedPlayer?: Player): string {
  const active = state.players.find((player) => player.id === activeId);
  const camera =
    cameraState?.mode === "overview"
      ? "Vista general del mapa."
      : focusedPlayer
        ? `Cámara enfocada en ${focusedPlayer.name}.`
        : "Cámara siguiendo al jugador activo.";
  return `${phaseLabel(state.phase)}. ${active ? `Turno de ${active.name}.` : ""} Ronda ${state.round}. ${camera}`;
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
      <div className="flex justify-end">
        <LeaveButton onLeave={onLeave} />
      </div>
      <Scoreboard state={state} activeId={activeId} />
      <TurnControls state={state} me={me} isMyTurn={isMyTurn} onRoll={onRoll} />
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center text-sm text-violet-200">
        3D no disponible en este navegador.
      </div>
      {state.phase === "event" && <EventCard state={state} canAdvance={canAdvance} onNext={onNext} />}
    </div>
  );
}
