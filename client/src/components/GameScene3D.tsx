import { useMemo, type ReactNode } from "react";
import type { GameState, Player } from "@essence/shared";
import { Dice5, LogOut } from "lucide-react";
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
  onShopSkip: () => void;
  onShopBuy: (itemId: string) => void;
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
  onShopSkip,
  onShopBuy,
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
        onShopSkip={onShopSkip}
        onShopBuy={onShopBuy}
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
        terraces={state.terraces}
        players={state.players}
        activeId={activeId}
        lastRoll={state.lastRoll}
        boardLength={state.boardLength}
        activeMotion={activeMotion}
        diceCue={diceCue}
        interactive
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
  onShopSkip,
  onShopBuy,
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
  onShopSkip: () => void;
  onShopBuy: (itemId: string) => void;
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
        {state.phase !== "finished" && (
          <div className="ml-auto flex flex-col items-end gap-2">
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

      {state.phase === "shop" && <ShopOverlay state={state} canBuy={isMyTurn} onSkip={onShopSkip} onBuy={onShopBuy} />}
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

              return (
                <li
                  key={player.id}
                  className={cn(
                    "grid grid-cols-[1.2rem_0.8rem_minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-2 py-1.5 font-black transition-colors",
                    isActive ? "bg-[#f5d547]/14 text-[#fff8d6]" : "text-[#d4cfea]/80",
                    player.connected ? "" : "opacity-40"
                  )}
                >
                  <span className="retro text-center text-[8px] text-[#a89fc5]">{index + 1}</span>
                  <span
                    className="size-3 rounded-[2px] shadow-[1px_1px_0_rgb(0_0_0/0.4),0_0_6px_var(--player-glow)]"
                    style={{ backgroundColor: player.color, ["--player-glow" as string]: `${player.color}66` }}
                  />
                  <span className="min-w-0 truncate text-[11px] sm:text-xs">
                    {isActive ? <span className="text-[#f5d547]">▶ </span> : ""}
                    {player.name}
                    {player.groom ? " 🤵" : ""}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[10px]">
                    <span className="text-[#fbbf24]">🪙{player.coins}</span>
                    {player.stars > 0 && <span className="text-[#fde68a]">⭐{player.stars}</span>}
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

function ShopOverlay({
  state,
  canBuy,
  onSkip,
  onBuy,
}: {
  state: GameState;
  canBuy: boolean;
  onSkip: () => void;
  onBuy: (itemId: string) => void;
}) {
  const shop = state.activeShop;
  if (!shop) return null;
  const player = state.players.find((candidate) => candidate.id === shop.playerId);
  const unlocked = new Set(player?.character.unlockedCosmeticIds ?? []);
  const equipped = player?.character.equippedCosmeticIds ?? {};

  return (
    <CenterOverlay>
      <div className="modal-card from-sky-950/96 to-indigo-950/96">
        <div className="inline-flex items-center gap-2 rounded-sm border border-cyan-300/35 bg-cyan-300/12 px-3 py-1.5 text-xs font-black uppercase tracking-[0.3em] text-cyan-100">
          Kiosco 24hs
        </div>
        <h2 className="mt-4 text-center text-3xl font-black text-white sm:text-5xl">{shop.name}</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm font-black text-cyan-100/80 sm:text-base">
          {player?.name ?? "Jugador"} pasó por el kiosco. Puede frenar a comprar o seguir de largo.
          {shop.remainingSteps > 0 ? ` Quedan ${shop.remainingSteps} paso(s).` : " No quedan pasos después de esta parada."}
        </p>

        <div className="mt-5 grid gap-2 text-left sm:grid-cols-2">
          {shop.items.map((item) => {
            const cosmeticId = item.effect.type === "unlockCosmetic" ? item.effect.cosmeticId : null;
            const isUnlocked = Boolean(cosmeticId && unlocked.has(cosmeticId));
            const isEquipped = Boolean(cosmeticId && Object.values(equipped).includes(cosmeticId));
            const affordable = Boolean(player && player.coins >= item.cost);
            const disabled = !canBuy || isEquipped || (!isUnlocked && !affordable);
            const cta = isEquipped ? "Equipado" : isUnlocked ? "Equipar" : `${categoryAction(item.category)} · ${item.cost}`;
            return (
              <button
                key={item.id}
                type="button"
                disabled={disabled}
                onClick={() => onBuy(item.id)}
                className="rounded-sm border border-white/12 bg-white/8 px-3 py-3 text-left transition hover:border-cyan-200/45 hover:bg-cyan-200/10 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-sm font-black text-white">{item.name}</span>
                  <span className="rounded bg-[#facc15] px-1.5 py-0.5 text-[10px] font-black text-[#2a1a02]">
                    {categoryLabel(item.category)}
                  </span>
                </span>
                {item.description && <span className="mt-1 block text-xs font-bold text-cyan-100/70">{item.description}</span>}
                <span className="mt-2 block text-xs font-black uppercase tracking-[0.12em] text-amber-100">{cta}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <Button
            type="button"
            disabled={!canBuy}
            onClick={onSkip}
            className="min-h-12 bg-white/12 px-6 text-sm uppercase text-white hover:bg-white/18 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/55"
          >
            Seguir de largo
          </Button>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/65">
            {canBuy ? `Monedas: ${player?.coins ?? 0}` : "Esperando al jugador"}
          </p>
        </div>
      </div>
    </CenterOverlay>
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

function categoryLabel(category: string): string {
  if (category === "cosmetic") return "Cosmético";
  if (category === "steroid") return "Esteroide";
  if (category === "weapon") return "Arma";
  return category;
}

function categoryAction(category: string): string {
  if (category === "cosmetic") return "Comprar";
  if (category === "steroid") return "Tomar";
  if (category === "weapon") return "Guardar";
  return "Comprar";
}

function RevealOverlay({ state, canAdvance, onNext }: { state: GameState; canAdvance: boolean; onNext: () => void }) {
  const reveal = state.reveal;
  if (!reveal) return null;
  const medals = ["🥇", "🥈", "🥉"];
  const isPrompt = reveal.type === "prompt";
  const confirmer = reveal.entries[0]?.name;

  return (
    <CenterOverlay>
      <div className="modal-card from-slate-950/96 to-indigo-950/96">
        <div className="inline-flex items-center gap-2 rounded-sm border border-violet-400/30 bg-violet-500/15 px-3 py-1.5 text-xs font-black uppercase tracking-[0.3em] text-violet-200">
          {isPrompt ? "Evento" : "🏅 Resultados"}
        </div>
        <h2 className="mt-4 text-center text-3xl font-black text-amber-100 sm:text-5xl">{reveal.title}</h2>
        {reveal.story?.reveal && <p className="mx-auto mt-3 max-w-2xl text-center text-base font-black text-violet-100">{reveal.story.reveal}</p>}
        <div className="mx-auto my-5 h-px w-24 rounded-full bg-white/20" />
        {isPrompt ? (
          <div className="mx-auto max-w-2xl rounded-sm border border-white/10 bg-white/8 px-4 py-4 text-center text-lg font-black text-white sm:text-2xl">
            {confirmer ? `${confirmer} confirmó la acción.` : "Acción confirmada."}
          </div>
        ) : (
          <ol className="mx-auto grid max-w-2xl gap-2 text-left">
            {reveal.entries.map((entry, index) => (
              <li
                key={entry.playerId}
                className="flex items-center justify-between gap-3 rounded-sm border border-white/10 bg-white/8 px-4 py-3 text-lg font-black text-white sm:text-2xl"
              >
                <span>{medals[index] ?? `${entry.rank}.`} {entry.name}</span>
                {entry.coins > 0 && <span className="shrink-0 text-amber-200">+🪙{entry.coins}</span>}
              </li>
            ))}
          </ol>
        )}
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
  const ranked = [...state.players].sort((a, b) => b.stars - a.stars || b.coins - a.coins);
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
                <span className="text-yellow-200">⭐{player.stars}</span>
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

function LeaveButton({ onLeave }: { onLeave: () => void }) {
  return (
    <Button
      type="button"
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
      <p className="mt-1">Abrí /map-builder para editar casilleros, rutas, terrenos y artefactos.</p>
      <p className="mt-1 text-sky-200/80">{active ? `Cámara siguiendo a ${active.name}` : "Mapa tipo Game of Life"}</p>
    </aside>
  );
}

function turnTitle(state: GameState, active: Player | undefined, isMyTurn: boolean): string {
  if (state.phase === "moving") return "Moviendo ficha...";
  if (state.phase === "shop") return "Parada en kiosco 24hs";
  if (state.phase === "event") return "Casillero especial";
  if (state.phase === "turn") return isMyTurn ? "¡Es tu turno!" : `Turno de ${active?.name ?? "..."}`;
  return active ? `Turno de ${active.name}` : "Tablero";
}

function phaseLabel(phase: GameState["phase"]): string {
  const labels: Record<GameState["phase"], string> = {
    lobby: "Lobby",
    turn: "Turno",
    moving: "Movimiento",
    shop: "Kiosco",
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
