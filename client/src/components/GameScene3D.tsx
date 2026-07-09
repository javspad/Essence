import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ArtifactOffer, EffectDef, EffectDuration, EffectInstance, EffectLifecycleHook, EventAction, GameContent, GameState, Player } from "@essence/shared";
import { consequenceLabel, durationStateFromDef, effectRemainingLabel } from "@essence/shared/consequences";
import { rankPlayersByProgress, rankPlayersForFinishedGame } from "@essence/shared/ranking";
import seedContent from "@shared/content.json";
import {
  Bug,
  Dice5,
  LogOut,
  Map as MapIcon,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  ShoppingBag,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { Badge } from "@/components/ui/8bit/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/8bit/card";
import { cn } from "@/lib/utils";
import { artifactUseMessage, effectEndedMessage } from "../artifactPresentation";
import { applyCameraIntent, supportsWebGL, type BoardCameraState, type CameraIntent } from "../board3d";
import type { BoardActiveMotion, BoardDiceCue } from "../gamePresentationMachine";
import type { EffectNotice } from "../useGame";
import { revealEntryDetail, revealEntryResult } from "../revealDisplay";
import Board3DShell from "./Board3DShell";
import CosmeticShop from "./CosmeticShop";
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
  onBuyCosmetic: (cosmeticId: string, onResult?: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  onEquipCosmetic: (cosmeticId: string, equipped: boolean, onResult?: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  onRollArtifactShop: (onResult?: (res: { ok: true; offers: ArtifactOffer[] } | { ok: false; error: string }) => void) => void;
  onBuyArtifact: (offerId: string, onResult?: (res: { ok: true; artifactId: string; requiresTarget: boolean } | { ok: false; error: string }) => void) => void;
  onUseArtifact: (targetPlayerId: string | undefined, onResult?: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  onSkipArtifactShop: (onResult?: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  onNext: () => void;
  onLeave: () => void;
  onDebugApplyEffect: (playerId: string, effect: EffectDef) => void;
  effectNotices?: EffectNotice[];
  onDismissEffectNotice?: (noticeId: string) => void;
}

const DICE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const DEFAULT_CAMERA_STATE: BoardCameraState = { mode: "followActivePlayer", focusedPlayerId: null };
const EVENT_BUILDER_STORAGE_KEY = "essence:event-builder:draft:v1";
const DEV_TOOLS_HIDDEN_EFFECTS_KEY = "essence:dev-tools:hidden-effects:v1";
const SEED_EFFECTS = (seedContent as unknown as GameContent).effects ?? {};
const BUILT_IN_DEBUG_EFFECTS: EffectDef[] = [
  {
    id: "debug-consequence-coins-plus",
    name: "Gain 1 coin",
    description: "At turn end, add 1 coin to this player.",
    icon: "🪙",
    duration: { mode: "uses", value: 1 },
    consequences: [{ type: "coins", hook: "onTurnEnd", value: 1, text: "Gain 1 coin.", icon: "🪙" }],
  },
  {
    id: "debug-consequence-coins-minus",
    name: "Lose 1 coin",
    description: "At turn end, remove 1 coin from this player.",
    icon: "🪙",
    duration: { mode: "uses", value: 1 },
    consequences: [{ type: "coins", hook: "onTurnEnd", value: -1, text: "Lose 1 coin.", icon: "🪙" }],
  },
  {
    id: "debug-consequence-move-plus",
    name: "Move +1 cell",
    description: "At turn end, move this player one cell forward.",
    icon: "➜",
    duration: { mode: "uses", value: 1 },
    consequences: [{ type: "move", hook: "onTurnEnd", delta: 1, text: "Move 1 cell forward.", icon: "➜" }],
  },
  {
    id: "debug-consequence-move-minus",
    name: "Move -1 cell",
    description: "At turn end, move this player one cell backward.",
    icon: "↩",
    duration: { mode: "uses", value: 1 },
    consequences: [{ type: "move", hook: "onTurnEnd", delta: -1, text: "Move 1 cell backward.", icon: "↩" }],
  },
  {
    id: "debug-consequence-skip-turn",
    name: "Skip turn",
    description: "At turn end, queue a skipped turn for this player.",
    icon: "⏭",
    duration: { mode: "uses", value: 1 },
    consequences: [{ type: "skipTurn", hook: "onTurnEnd", text: "Skip next turn.", icon: "⏭" }],
  },
  {
    id: "debug-consequence-extra-turn",
    name: "Extra turn",
    description: "At turn end, queue an extra turn for this player.",
    icon: "🔁",
    duration: { mode: "uses", value: 1 },
    consequences: [{ type: "extraTurn", hook: "onTurnEnd", text: "Play an extra turn.", icon: "🔁" }],
  },
  {
    id: "debug-consequence-double-movement",
    name: "Double movement",
    description: "For 2 rounds, double movement from the die roll.",
    icon: "×2",
    duration: { mode: "rounds", value: 2 },
    consequences: [{ type: "movementMultiplier", hook: "beforeMovement", multiplier: 2, rounding: "round", text: "Double movement.", icon: "×2" }],
  },
  {
    id: "debug-consequence-dice-bias-five",
    name: "Dice bias: five",
    description: "For 1 use, increase the chance of rolling five by 25%.",
    icon: "⚄",
    duration: { mode: "uses", value: 1 },
    consequences: [{ type: "diceBias", hook: "beforeRoll", face: 5, chanceDeltaPercent: 25, text: "+25% chance to roll five.", icon: "⚄" }],
  },
];

const EFFECT_HOOK_OPTIONS: { value: EffectLifecycleHook; label: string }[] = [
  { value: "beforeRoll", label: "Before roll" },
  { value: "afterRoll", label: "After roll" },
  { value: "beforeMovement", label: "Before movement" },
  { value: "afterMovement", label: "After movement" },
  { value: "onCellEnter", label: "On cell enter" },
  { value: "onActivityResult", label: "On activity result" },
  { value: "onTurnEnd", label: "On turn end" },
];

const EFFECT_ACTION_TYPE_OPTIONS: { value: EventAction["type"]; label: string }[] = [
  { value: "movementMultiplier", label: "Movement multiplier" },
  { value: "diceBias", label: "Dice bias" },
  { value: "coins", label: "Coins" },
  { value: "move", label: "Move cells" },
  { value: "skipTurn", label: "Skip turn" },
  { value: "extraTurn", label: "Extra turn" },
];

type EditableEffectAction = Extract<EventAction, { type: "movementMultiplier" | "diceBias" | "coins" | "move" | "skipTurn" | "extraTurn" }>;
type DraftContent = Partial<GameContent> & { effects?: Record<string, EffectDef> };

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
  onBuyCosmetic,
  onEquipCosmetic,
  onRollArtifactShop,
  onBuyArtifact,
  onUseArtifact,
  onSkipArtifactShop,
  onNext,
  onLeave,
  onDebugApplyEffect,
  effectNotices = [],
  onDismissEffectNotice,
}: GameScene3DProps) {
  const canLoad3D = useMemo(() => supportsWebGL(), []);
  const [cameraState, setCameraState] = useState<BoardCameraState>(DEFAULT_CAMERA_STATE);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [cosmeticShopOpen, setCosmeticShopOpen] = useState(false);
  const [artifactTargetPreviewId, setArtifactTargetPreviewId] = useState<string | null>(null);
  const forcedArtifactShopOpen = state.phase === "shop" && Boolean(state.artifactShop);
  const shopOpen = cosmeticShopOpen || forcedArtifactShopOpen;
  const canAdvance = isHost || isMyTurn;
  const editMode = useMemo(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("sceneEdit"),
    []
  );
  const focusedPlayer = cameraState.focusedPlayerId
    ? state.players.find((player) => player.id === cameraState.focusedPlayerId)
    : undefined;
  const effectiveCameraState = cameraState.focusedPlayerId && !focusedPlayer ? { ...cameraState, focusedPlayerId: null } : cameraState;
  const activeArtifactTargetPreviewId =
    state.phase === "shop" &&
    state.pendingArtifactUse &&
    artifactTargetPreviewId &&
    state.players.some((player) => player.id === artifactTargetPreviewId)
      ? artifactTargetPreviewId
      : null;
  const dispatchCameraIntent = useCallback((intent: CameraIntent) => {
    setCameraState((current) => applyCameraIntent(current, intent));
  }, []);
  const focusPlayer = useCallback(
    (playerId: string) => dispatchCameraIntent({ kind: "focusPlayer", playerId }),
    [dispatchCameraIntent]
  );
  const previewArtifactTarget = useCallback(
    (playerId: string | null) => {
      setArtifactTargetPreviewId(playerId);
      if (playerId) focusPlayer(playerId);
    },
    [focusPlayer]
  );
  const requestLeave = useCallback(() => setLeaveConfirmOpen(true), []);
  const confirmLeave = useCallback(() => {
    setLeaveConfirmOpen(false);
    onLeave();
  }, [onLeave]);

  const artifactTrajectory =
    state.pendingArtifactUse && activeArtifactTargetPreviewId
      ? { fromPlayerId: state.pendingArtifactUse.playerId, toPlayerId: activeArtifactTargetPreviewId }
      : null;

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
        {shopOpen && (
          <CosmeticShop
            state={state}
            me={me}
            sharedArtifactShop={forcedArtifactShopOpen}
            onClose={() => {
              if (!forcedArtifactShopOpen) setCosmeticShopOpen(false);
            }}
            onBuyCosmetic={onBuyCosmetic}
            onEquipCosmetic={onEquipCosmetic}
            onRollArtifacts={onRollArtifactShop}
            onBuyArtifact={onBuyArtifact}
            onUseArtifact={onUseArtifact}
            onSkipArtifactShop={onSkipArtifactShop}
            onTargetPreview={previewArtifactTarget}
          />
        )}
        <EffectNoticeStack state={state} me={me} notices={effectNotices} onDismiss={onDismissEffectNotice} />
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
        cosmetics={state.cosmetics}
        activeEffects={state.activeEffects}
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
        focusedPlayerId={effectiveCameraState.focusedPlayerId}
        onPlayerFocus={focusPlayer}
        artifactTrajectory={artifactTrajectory}
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
        isHost={isHost}
        cameraState={effectiveCameraState}
        eventBusyLabel={eventBusyLabel}
        rollBlocked={rollBlocked}
        statusLabel={statusLabel}
        onCameraIntent={dispatchCameraIntent}
        onFocusPlayer={focusPlayer}
        onRoll={onRoll}
        onOpenCosmeticShop={() => setCosmeticShopOpen(true)}
        onNext={onNext}
        onLeave={requestLeave}
        onDebugApplyEffect={onDebugApplyEffect}
      />

      {shopOpen && (
        <CosmeticShop
          state={state}
          me={me}
          sharedArtifactShop={forcedArtifactShopOpen}
          onClose={() => {
            if (!forcedArtifactShopOpen) setCosmeticShopOpen(false);
          }}
          onBuyCosmetic={onBuyCosmetic}
          onEquipCosmetic={onEquipCosmetic}
          onRollArtifacts={onRollArtifactShop}
          onBuyArtifact={onBuyArtifact}
          onUseArtifact={onUseArtifact}
          onSkipArtifactShop={onSkipArtifactShop}
          onTargetPreview={previewArtifactTarget}
        />
      )}
      <EffectNoticeStack state={state} me={me} notices={effectNotices} onDismiss={onDismissEffectNotice} />

      {leaveConfirmOpen && (
        <LeaveConfirmationOverlay
          isHost={isHost}
          playerName={me.name}
          onCancel={() => setLeaveConfirmOpen(false)}
          onConfirm={confirmLeave}
        />
      )}

      <div className="sr-only" aria-live="polite">
        {sceneStatus(state, activeId, effectiveCameraState, focusedPlayer)}
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
  isHost,
  cameraState,
  eventBusyLabel,
  rollBlocked,
  statusLabel,
  onCameraIntent,
  onFocusPlayer,
  onRoll,
  onOpenCosmeticShop,
  onNext,
  onLeave,
  onDebugApplyEffect,
}: {
  connected: boolean;
  state: GameState;
  me: Player;
  activeId?: string;
  isMyTurn: boolean;
  canAdvance: boolean;
  editMode: boolean;
  isHost: boolean;
  cameraState: BoardCameraState;
  eventBusyLabel?: string | null;
  rollBlocked: boolean;
  statusLabel?: string | null;
  onCameraIntent: (intent: CameraIntent) => void;
  onFocusPlayer: (playerId: string) => void;
  onRoll: () => void;
  onOpenCosmeticShop: () => void;
  onNext: () => void;
  onLeave: () => void;
  onDebugApplyEffect: (playerId: string, effect: EffectDef) => void;
}) {
  const active = state.players.find((player) => player.id === activeId);
  const sorted = rankPlayersByProgress(state.players);
  const debugToolsEnabled = isDevBuild() || (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debugTools"));
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
            <ShopButton onOpen={onOpenCosmeticShop} />
            {isHost && debugToolsEnabled && (
              <DebugEffectTool
                players={state.players}
                effects={state.effects}
                onApply={onDebugApplyEffect}
              />
            )}
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

      {state.phase === "event" && <EventOverlay state={state} me={me} canAdvance={canAdvance} busyLabel={eventBusyLabel} onNext={onNext} />}
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
  const [showStackDetails, setShowStackDetails] = useState(false);
  const hasAnyEffects = activeEffects.length > 0;
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
          <button
            type="button"
            aria-pressed={showStackDetails}
            disabled={!hasAnyEffects}
            onClick={() => setShowStackDetails((current) => !current)}
            className="w-fit rounded-sm border border-cyan-200/25 bg-cyan-300/10 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-cyan-100 transition hover:bg-cyan-300/15 disabled:opacity-35"
          >
            {showStackDetails ? "Hide stack" : "Show stack"}
          </button>
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
                      {effects.length > 0 && <EffectBadges effects={effects} />}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-[10px]">
                      <span className="text-[#d4cfea]">#{player.position}</span>
                      <span className="text-[#fbbf24]">🪙{player.coins}</span>
                    </span>
                  </button>
                  {showStackDetails && effects.length > 0 && <EffectStackDetails effects={effects} />}
                </li>
              );
            })}
          </ol>
        </CardContent>
      </aside>
    </Card>
  );
}

function EffectBadges({ effects }: { effects: EffectInstance[] }) {
  return (
    <span className="mt-1 flex max-w-full flex-wrap gap-1">
      {effects.map((effect) => (
        <span
          key={effect.id}
          title={effectTooltip(effect)}
          className="max-w-[10rem] truncate rounded-sm border border-cyan-200/30 bg-cyan-300/12 px-1.5 py-0.5 text-[8px] uppercase tracking-wide text-cyan-100"
        >
          <span className="mr-1">{effectIcon(effect)}</span>
          {effect.name} · {effectRemainingLabel(effect.remaining)}
        </span>
      ))}
    </span>
  );
}

function EffectStackDetails({ effects }: { effects: EffectInstance[] }) {
  return (
    <div className="mx-2 mb-2 grid gap-1 rounded-sm border border-cyan-200/15 bg-cyan-300/8 p-2">
      {effects.map((effect) => (
        <section key={effect.id} title={effectTooltip(effect)} className="rounded-sm border border-white/10 bg-black/20 p-2">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 truncate text-[10px] font-black uppercase tracking-wide text-cyan-100">
              <span className="mr-1">{effectIcon(effect)}</span>
              {effect.name}
            </p>
            <span className="shrink-0 text-[8px] font-black uppercase text-cyan-100/80">{effectRemainingLabel(effect.remaining)}</span>
          </div>
          {effect.description && <p className="mt-1 line-clamp-2 text-[9px] font-bold leading-4 text-[#d4cfea]/80">{effect.description}</p>}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {effect.consequences.map((consequence, index) => (
              <span
                key={`${effect.id}-${consequence.type}-${index}`}
                title={consequenceLabel(consequence)}
                className="max-w-full truncate rounded-sm border border-white/10 bg-white/8 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-[#fff8d6]/90"
              >
                <span className="mr-1">{actionIcon(consequence)}</span>
                {consequenceLabel(consequence)}
              </span>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function DebugEffectTool({
  players,
  effects,
  onApply,
}: {
  players: Player[];
  effects?: Record<string, EffectDef>;
  onApply: (playerId: string, effect: EffectDef) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftVersion, setDraftVersion] = useState(0);
  const draftEffects = useMemo(() => loadEventBuilderDraftEffects(), [draftVersion]);
  const hiddenEffectIds = useMemo(() => loadHiddenEffectIds(), [draftVersion]);
  const effectOptions = useMemo(
    () => mergedEffectCatalog(keyedEffects(BUILT_IN_DEBUG_EFFECTS), SEED_EFFECTS, effects, draftEffects).filter((effect) => !hiddenEffectIds.has(effect.id)),
    [draftEffects, effects, hiddenEffectIds]
  );
  const [selectedPlayerId, setSelectedPlayerId] = useState(players[0]?.id ?? "");
  const [selectedEffectId, setSelectedEffectId] = useState(effectOptions[0]?.id ?? "");
  const [editingEffect, setEditingEffect] = useState<EffectDef | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selectedEffect = effectOptions.find((effect) => effect.id === selectedEffectId);
  const selectedEffectIsDraft = Boolean(selectedEffect && draftEffects[selectedEffect.id]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === EVENT_BUILDER_STORAGE_KEY || event.key === DEV_TOOLS_HIDDEN_EFFECTS_KEY) setDraftVersion((version) => version + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (selectedPlayerId && players.some((player) => player.id === selectedPlayerId)) return;
    setSelectedPlayerId(players[0]?.id ?? "");
  }, [players, selectedPlayerId]);

  useEffect(() => {
    if (selectedEffectId && effectOptions.some((effect) => effect.id === selectedEffectId)) return;
    setSelectedEffectId(effectOptions[0]?.id ?? "");
  }, [effectOptions, selectedEffectId]);

  const apply = () => {
    if (!selectedPlayerId || !selectedEffect) return;
    onApply(selectedPlayerId, selectedEffect);
    setMessage(`${selectedEffect.name} added. Roll/turn timing depends on its hook.`);
    setOpen(false);
  };

  const createEffect = () => {
    const effect = defaultDevToolEffect(nextDraftEffectId({ ...draftEffects, ...keyedEffects(BUILT_IN_DEBUG_EFFECTS), ...SEED_EFFECTS, ...(effects ?? {}) }));
    setSelectedEffectId(effect.id);
    setEditingEffect(effect);
    setMessage(null);
  };

  const editEffect = () => {
    if (!selectedEffect) return;
    setEditingEffect(cloneEffect(selectedEffect));
    setMessage(null);
  };

  const saveEffect = () => {
    if (!editingEffect) return;
    const normalized = normalizeEditableEffect(editingEffect);
    saveDraftEffect(normalized);
    setSelectedEffectId(normalized.id);
    setEditingEffect(null);
    setDraftVersion((version) => version + 1);
    setMessage(`${normalized.name} saved.`);
  };

  const removeEffect = () => {
    if (!selectedEffect) return;
    if (draftEffects[selectedEffect.id]) {
      deleteDraftEffect(selectedEffect.id);
      setMessage(`${selectedEffect.name} removed from saved effects.`);
    } else {
      saveHiddenEffectIds(new Set([...hiddenEffectIds, selectedEffect.id]));
      setMessage(`${selectedEffect.name} hidden from Dev tools.`);
    }
    setEditingEffect(null);
    setDraftVersion((version) => version + 1);
  };

  const restoreHiddenEffects = () => {
    saveHiddenEffectIds(new Set());
    setDraftVersion((version) => version + 1);
    setMessage("Hidden effects restored.");
  };

  return (
    <div className="pointer-events-auto relative">
      <Button
        type="button"
        aria-label="Abrir dev tools"
        aria-expanded={open}
        title="Dev tools"
        data-testid="debug-effects-toggle"
        onClick={() => {
          setDraftVersion((version) => version + 1);
          setOpen((current) => !current);
        }}
        className={cn(
          "flex h-9 items-center gap-1.5 border border-[#a7f3d0]/35 px-3 text-[10px] font-black uppercase tracking-wider text-[#bbf7d0] shadow-[0_0_0_1px_rgba(167,243,208,0.08),0_8px_24px_rgb(0_0_0/0.4)] backdrop-blur-xl transition-colors hover:bg-[#34d399]/20 hover:text-white",
          open ? "bg-[#34d399]/24 ring-1 ring-[#a7f3d0]/60" : "bg-[#052e1a]/82"
        )}
      >
        <Bug data-icon="inline-start" className="size-3.5" />
        <span className="hidden sm:inline">Dev tools</span>
      </Button>

      {open && (
        <section
          aria-label="Development tools"
          data-testid="debug-effects-panel"
          className="absolute right-0 top-11 max-h-[calc(100vh-5rem)] w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto rounded-sm border border-[#a7f3d0]/35 bg-[#07140f]/96 p-3 text-[#ecfdf5] shadow-[0_0_0_1px_rgba(167,243,208,0.08),0_18px_50px_rgb(0_0_0/0.55)] backdrop-blur-xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="retro text-[8px] uppercase tracking-widest text-[#86efac]">Development</p>
              <h2 className="mt-1 text-sm font-black text-[#f0fdf4]">Dev tools</h2>
            </div>
            <Sparkles className="mt-0.5 size-4 shrink-0 text-[#f5d547]" />
          </div>

          <div className="mt-3 grid gap-2">
            <DevToolSelect
              label="Player"
              value={selectedPlayerId}
              disabled={!players.length}
              options={players.map((player) => ({ value: player.id, label: player.name }))}
              testId="debug-effect-player"
              onChange={setSelectedPlayerId}
            />
            <DevToolSelect
              label="Effect type"
              value={selectedEffectId}
              disabled={!effectOptions.length}
              options={effectOptions.length ? effectOptions.map((effect) => ({ value: effect.id, label: `${effectIcon(effect)} ${effect.name}` })) : [{ value: "", label: "No effects" }]}
              testId="debug-effect-effect"
              onChange={setSelectedEffectId}
            />
          </div>

          {selectedEffect ? (
            <div className="mt-3 rounded-sm border border-white/10 bg-black/25 p-2">
              <p className="truncate text-xs font-black text-[#f0fdf4]">
                <span className="mr-1">{effectIcon(selectedEffect)}</span>
                {selectedEffect.name}
              </p>
              <p className="mt-1 line-clamp-2 text-[10px] font-bold leading-4 text-[#bbf7d0]/75">
                {selectedEffect.description ?? "Custom effect from the active catalog."}
              </p>
              <p className="mt-2 w-fit rounded-sm border border-[#a7f3d0]/25 bg-[#34d399]/12 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-[#bbf7d0]">
                {effectRemainingLabel(durationStateFromDef(selectedEffect.duration))}
              </p>
              <p className="mt-2 text-[9px] font-bold uppercase tracking-wide text-[#86efac]/80">
                {selectedEffectIsDraft ? "Saved custom effect" : "Base catalog effect"}
              </p>
            </div>
          ) : (
            <p className="mt-3 rounded-sm border border-dashed border-white/15 p-2 text-xs font-bold text-[#bbf7d0]/70">
              Create and save an effect here, in Event Builder, or add effects to content.json.
            </p>
          )}

          <div className="mt-3 grid grid-cols-3 gap-1.5">
            <Button type="button" onClick={createEffect} className="h-8 bg-white/10 px-2 text-[9px] font-black uppercase tracking-wide text-[#d9f99d] hover:bg-white/15">
              <Plus data-icon="inline-start" className="size-3" />
              New
            </Button>
            <Button type="button" disabled={!selectedEffect} onClick={editEffect} className="h-8 bg-white/10 px-2 text-[9px] font-black uppercase tracking-wide text-[#d9f99d] hover:bg-white/15 disabled:opacity-45">
              <Pencil data-icon="inline-start" className="size-3" />
              Edit
            </Button>
            <Button type="button" disabled={!selectedEffect} onClick={removeEffect} className="h-8 bg-[#451a1a]/80 px-2 text-[9px] font-black uppercase tracking-wide text-[#fecaca] hover:bg-[#7f1d1d] disabled:opacity-45">
              <Trash2 data-icon="inline-start" className="size-3" />
              Remove
            </Button>
          </div>

          {hiddenEffectIds.size > 0 && (
            <Button type="button" onClick={restoreHiddenEffects} className="mt-2 h-8 w-full bg-white/8 px-2 text-[9px] font-black uppercase tracking-wide text-[#bfdbfe] hover:bg-white/15">
              <RotateCcw data-icon="inline-start" className="size-3" />
              Restore hidden effects
            </Button>
          )}

          {editingEffect && (
            <EffectComposer
              effect={editingEffect}
              onChange={setEditingEffect}
              onSave={saveEffect}
              onCancel={() => setEditingEffect(null)}
            />
          )}

          {message && <p className="mt-2 rounded-sm border border-[#86efac]/20 bg-[#34d399]/10 p-2 text-[10px] font-bold leading-4 text-[#bbf7d0]">{message}</p>}

          {selectedEffect && !editingEffect && (
            <p className="mt-2 rounded-sm border border-white/10 bg-black/20 p-2 text-[10px] font-bold leading-4 text-[#bbf7d0]/75">
              Movement and dice modifiers apply on the next matching roll. Turn-end effects apply when the turn advances.
            </p>
          )}

          <Button
            type="button"
            data-testid="debug-effect-apply"
            disabled={!selectedPlayerId || !selectedEffect || Boolean(editingEffect)}
            onClick={apply}
            className="mt-3 h-10 w-full bg-[#34d399] px-4 text-xs font-black uppercase tracking-wider text-[#052e1a] hover:bg-[#6ee7b7] disabled:bg-white/15 disabled:text-white/50"
          >
            Apply to player
          </Button>
        </section>
      )}
    </div>
  );
}

function EffectComposer({
  effect,
  onChange,
  onSave,
  onCancel,
}: {
  effect: EffectDef;
  onChange: (effect: EffectDef) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const actions = editableEffectActions(effect);
  const duration = effect.duration;
  const needsCount = duration.mode === "turns" || duration.mode === "rounds" || duration.mode === "uses";

  const updateAction = (index: number, action: EditableEffectAction) => {
    onChange({ ...effect, consequences: actions.map((current, actionIndex) => (actionIndex === index ? action : current)) });
  };

  const removeAction = (index: number) => {
    const nextActions = actions.filter((_, actionIndex) => actionIndex !== index);
    onChange({ ...effect, consequences: nextActions.length ? nextActions : [defaultEditableEffectAction("movementMultiplier")] });
  };

  return (
    <section className="mt-3 rounded-sm border border-[#86efac]/25 bg-[#06140f]/80 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-black text-[#f0fdf4]">Effect builder</h3>
          <p className="mt-1 text-[10px] font-bold leading-4 text-[#bbf7d0]/70">Saved effects appear in this list and in Event Builder.</p>
        </div>
        <Button type="button" onClick={onCancel} className="h-7 bg-white/8 px-2 text-[9px] font-black uppercase text-[#f0fdf4] hover:bg-white/15">
          <X data-icon="inline-start" className="size-3" />
          Close
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_4rem] gap-2">
        <DevTextInput label="Name" value={effect.name} onChange={(name) => onChange({ ...effect, name })} />
        <DevTextInput label="Icon" value={effect.icon ?? ""} onChange={(icon) => onChange({ ...effect, icon })} />
      </div>
      <DevTextInput label="Effect id" value={effect.id} onChange={(id) => onChange({ ...effect, id: effectIdFromName(id) })} />
      <DevTextArea label="Description" value={effect.description ?? ""} onChange={(description) => onChange({ ...effect, description })} />

      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
        <DevCompactSelect
          label="Duration"
          value={duration.mode}
          options={[
            { value: "uses", label: "Uses" },
            { value: "rounds", label: "Rounds" },
            { value: "turns", label: "Turns" },
            { value: "game", label: "Whole game" },
          ]}
          onChange={(mode) => onChange({ ...effect, duration: durationForMode(mode as EffectDuration["mode"], duration) })}
        />
        {needsCount ? <DevNumberInput label="Count" value={duration.value} onChange={(value) => onChange({ ...effect, duration: { ...duration, value: Math.max(1, Math.round(value)) } })} /> : <div />}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <h4 className="text-[10px] font-black uppercase tracking-wider text-[#86efac]">Consequences</h4>
        <Button
          type="button"
          onClick={() => onChange({ ...effect, consequences: [...actions, defaultEditableEffectAction("movementMultiplier")] })}
          className="h-7 bg-white/8 px-2 text-[9px] font-black uppercase text-[#d9f99d] hover:bg-white/15"
        >
          <Plus data-icon="inline-start" className="size-3" />
          Add
        </Button>
      </div>

      <div className="mt-2 grid gap-2">
        {actions.map((action, index) => (
          <EffectActionComposer
            key={`${index}-${action.type}`}
            action={action}
            canRemove={actions.length > 1}
            onChange={(nextAction) => updateAction(index, nextAction)}
            onRemove={() => removeAction(index)}
          />
        ))}
      </div>

      <Button type="button" onClick={onSave} className="mt-3 h-9 w-full bg-[#f5d547] px-3 text-xs font-black uppercase tracking-wider text-[#201507] hover:bg-[#ffe96c]">
        <Save data-icon="inline-start" className="size-3.5" />
        Save effect
      </Button>
    </section>
  );
}

function EffectActionComposer({
  action,
  canRemove,
  onChange,
  onRemove,
}: {
  action: EditableEffectAction;
  canRemove: boolean;
  onChange: (action: EditableEffectAction) => void;
  onRemove: () => void;
}) {
  return (
    <section className="rounded-sm border border-white/10 bg-black/25 p-2">
      <div className="grid grid-cols-[minmax(0,1fr)_2rem] gap-2">
        <DevCompactSelect
          label="Type"
          value={action.type}
          options={EFFECT_ACTION_TYPE_OPTIONS}
          onChange={(type) => onChange(convertEditableEffectAction(action, type as EditableEffectAction["type"]))}
        />
        <Button type="button" disabled={!canRemove} onClick={onRemove} className="mt-5 h-8 bg-[#451a1a]/80 p-0 text-[#fecaca] hover:bg-[#7f1d1d] disabled:opacity-35">
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <DevCompactSelect
          label="Hook"
          value={editableActionHookValue(action)}
          disabled={hasFixedHookForEditableAction(action.type)}
          options={hookOptionsForEditableAction(action.type)}
          onChange={(hook) => onChange({ ...action, hook: hook as EffectLifecycleHook })}
        />
        {"icon" in action && <DevTextInput label="Icon" value={action.icon ?? ""} onChange={(icon) => onChange({ ...action, icon })} />}
      </div>

      {action.type === "movementMultiplier" && (
        <div className="grid grid-cols-2 gap-2">
          <DevNumberInput label="Multiplier" value={action.multiplier} onChange={(multiplier) => onChange({ ...action, multiplier })} />
          <DevCompactSelect
            label="Rounding"
            value={action.rounding ?? "round"}
            options={[
              { value: "round", label: "Round" },
              { value: "ceil", label: "Ceil" },
              { value: "floor", label: "Floor" },
            ]}
            onChange={(rounding) => onChange({ ...action, rounding: rounding as "floor" | "ceil" | "round" })}
          />
        </div>
      )}
      {action.type === "diceBias" && (
        <div className="grid grid-cols-2 gap-2">
          <DevNumberInput label="Face" value={action.face} onChange={(face) => onChange({ ...action, face: Math.max(1, Math.round(face)) })} />
          <DevNumberInput label="Chance %" value={action.chanceDeltaPercent} onChange={(chanceDeltaPercent) => onChange({ ...action, chanceDeltaPercent })} />
        </div>
      )}
      {action.type === "coins" && <DevNumberInput label="Coins" value={action.value} onChange={(value) => onChange({ ...action, value })} />}
      {action.type === "move" && <DevNumberInput label="Cells" value={action.delta} onChange={(delta) => onChange({ ...action, delta })} />}

      <DevTextInput label="Display text" value={action.text ?? ""} onChange={(text) => onChange({ ...action, text })} />
    </section>
  );
}

function DevTextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-[9px] font-black uppercase tracking-wider text-[#86efac]">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-8 w-full rounded-sm border border-white/15 bg-[#0e0a1a] px-2 text-xs font-black normal-case tracking-normal text-[#f0fdf4] outline-none focus:border-[#86efac]"
      />
    </label>
  );
}

function DevTextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mt-2 block text-[9px] font-black uppercase tracking-wider text-[#86efac]">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-h-16 w-full resize-y rounded-sm border border-white/15 bg-[#0e0a1a] px-2 py-2 text-xs font-bold normal-case leading-4 tracking-normal text-[#f0fdf4] outline-none focus:border-[#86efac]"
      />
    </label>
  );
}

function DevNumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block text-[9px] font-black uppercase tracking-wider text-[#86efac]">
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 h-8 w-full rounded-sm border border-white/15 bg-[#0e0a1a] px-2 text-xs font-black normal-case tracking-normal text-[#f0fdf4] outline-none focus:border-[#86efac]"
      />
    </label>
  );
}

function DevCompactSelect({
  label,
  value,
  disabled,
  options,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-[9px] font-black uppercase tracking-wider text-[#86efac]">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-8 w-full rounded-sm border border-white/15 bg-[#0e0a1a] px-2 text-xs font-black normal-case tracking-normal text-[#f0fdf4] outline-none focus:border-[#86efac] disabled:opacity-45"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-[#0e0a1a] text-[#f0fdf4]">
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DevToolSelect({
  label,
  value,
  disabled,
  options,
  testId,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  options: { value: string; label: string }[];
  testId: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-[9px] font-black uppercase tracking-wider text-[#86efac]">
      {label}
      <select
        value={value}
        disabled={disabled}
        data-testid={testId}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-9 w-full rounded-sm border border-white/15 bg-[#0e0a1a] px-2 text-xs font-black normal-case tracking-normal text-[#f0fdf4] outline-none focus:border-[#86efac] disabled:opacity-45"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-[#0e0a1a] text-[#f0fdf4]">
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ShopButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button
      type="button"
      aria-label="Abrir shop"
      title="Abrir shop"
      data-testid="cosmetic-shop-open"
      onClick={onOpen}
      className="pointer-events-auto flex h-9 items-center gap-1.5 border border-[#6ee7b7]/40 bg-[#052e16]/82 px-3 text-[10px] font-black uppercase tracking-wider text-[#a7f3d0] shadow-[0_0_0_1px_rgba(110,231,183,0.1),0_8px_24px_rgb(0_0_0/0.4)] backdrop-blur-xl transition-colors hover:bg-[#10b981]/25 hover:text-white"
    >
      <ShoppingBag data-icon="inline-start" className="size-3.5" />
      Shop
    </Button>
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
                {diceDisplay(state.lastRoll, state.lastBaseRoll)}
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

function diceDisplay(value: number | null | undefined, baseValue?: number | null): string {
  if (!value) return "--";
  if (baseValue && baseValue !== value) return `${DICE[baseValue] ?? baseValue}→${value}`;
  return DICE[value] ?? String(value);
}

function EventOverlay({
  state,
  me,
  canAdvance,
  busyLabel,
  onNext,
}: {
  state: GameState;
  me: Player;
  canAdvance: boolean;
  busyLabel?: string | null;
  onNext: () => void;
}) {
  const event = state.activeEvent;
  if (!event) return null;
  const player = state.players.find((p) => p.id === event.playerId);
  const artifactTarget = event.artifactUse?.targetPlayerId
    ? state.players.find((p) => p.id === event.artifactUse?.targetPlayerId)
    : undefined;
  const displayPlayer = artifactTarget ?? player;
  const displayName = artifactTarget?.id === me.id ? "Vos" : displayPlayer?.name ?? "Jugador";
  const isDare = event.kind === "dare" || event.story?.title?.toLowerCase().includes("prenda");
  const title = event.title ?? event.story?.title ?? (isDare ? "Prenda" : "Evento");
  const artifactMessage = artifactUseMessage(event, state.players, me.id);

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
          style={{ color: displayPlayer?.color ?? "#fff", textShadow: `0 0 40px ${displayPlayer?.color ?? "#fff"}55` }}
        >
          {displayName}
        </h2>
        {/* Divider */}
        <div className="mx-auto my-5 h-px w-24 rounded-full bg-white/20" />
        {/* Event text */}
        {event.story?.setup && <p className="mx-auto max-w-2xl text-center text-base font-black leading-7 text-white/70 sm:text-xl">{event.story.setup}</p>}
        {artifactMessage && (
          <p className="mx-auto mt-3 max-w-2xl rounded-sm border border-[#67e8f9]/35 bg-[#0891b2]/18 px-4 py-3 text-center text-sm font-black leading-5 text-[#cffafe] sm:text-lg">
            {artifactMessage}
          </p>
        )}
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

function EffectNoticeStack({
  state,
  me,
  notices,
  onDismiss,
}: {
  state: GameState;
  me: Player;
  notices: EffectNotice[];
  onDismiss?: (noticeId: string) => void;
}) {
  if (!notices.length) return null;
  return (
    <div className="pointer-events-none fixed right-3 top-20 z-50 grid w-[min(22rem,calc(100vw-1.5rem))] gap-2 sm:right-5">
      {notices.map((notice) => (
        <article
          key={notice.id}
          className="pointer-events-auto rounded-md border border-[#67e8f9]/35 bg-[#071923]/92 p-3 text-[#ecfeff] shadow-[0_16px_40px_rgb(0_0_0/0.45)] backdrop-blur-xl"
        >
          <div className="flex items-start gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-sm border border-[#67e8f9]/30 bg-[#0891b2]/20 text-sm font-black">
              {notice.effectInstance.icon ?? <Sparkles className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-black uppercase tracking-wider text-[#67e8f9]">
                {notice.reason === "triggered" ? "Item consumed" : "Item expired"}
              </p>
              <p className="mt-1 text-sm font-black leading-5">
                {effectEndedMessage(notice.effectInstance, state.players, me.id, notice.reason)}
              </p>
            </div>
            {onDismiss && (
              <button
                type="button"
                aria-label="Dismiss item notification"
                onClick={() => onDismiss(notice.id)}
                className="grid size-7 shrink-0 place-items-center rounded-sm border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </article>
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

function defaultDevToolEffect(id: string): EffectDef {
  return {
    id,
    name: "New effect",
    description: "Custom effect for playtesting.",
    icon: "✦",
    duration: { mode: "uses", value: 1 },
    consequences: [defaultEditableEffectAction("movementMultiplier")],
  };
}

function defaultEditableEffectAction(type: EditableEffectAction["type"]): EditableEffectAction {
  if (type === "movementMultiplier") return { type, hook: "beforeMovement", multiplier: 2, rounding: "round", text: "Double movement.", icon: "×2" };
  if (type === "diceBias") return { type, hook: "beforeRoll", face: 5, chanceDeltaPercent: 25, text: "+25% chance to roll five.", icon: "⚄" };
  if (type === "coins") return { type, hook: "onTurnEnd", value: 1, text: "Gain 1 coin.", icon: "🪙" };
  if (type === "move") return { type, hook: "onTurnEnd", delta: 1, text: "Move 1 cell forward.", icon: "➜" };
  if (type === "skipTurn") return { type, hook: "onTurnEnd", text: "Skip next turn.", icon: "⏭" };
  return { type, hook: "onTurnEnd", text: "Play an extra turn.", icon: "🔁" };
}

function defaultHookForEditableAction(type: EditableEffectAction["type"]): EffectLifecycleHook {
  if (type === "movementMultiplier") return "beforeMovement";
  if (type === "diceBias") return "beforeRoll";
  return "onTurnEnd";
}

function convertEditableEffectAction(action: EditableEffectAction, type: EditableEffectAction["type"]): EditableEffectAction {
  if (action.type === type) return action;
  const next = defaultEditableEffectAction(type);
  return {
    ...next,
    hook: hasFixedHookForEditableAction(type) ? defaultHookForEditableAction(type) : action.hook ?? next.hook,
    text: action.text ?? next.text,
    icon: action.icon ?? next.icon,
  } as EditableEffectAction;
}

function editableEffectActions(effect: EffectDef): EditableEffectAction[] {
  const actions = (effect.consequences ?? effect.actions ?? []).filter(isEditableEffectAction);
  return actions.length ? actions.map((action) => ({ ...action })) : [defaultEditableEffectAction("movementMultiplier")];
}

function isEditableEffectAction(action: EventAction): action is EditableEffectAction {
  return action.type === "movementMultiplier" || action.type === "diceBias" || action.type === "coins" || action.type === "move" || action.type === "skipTurn" || action.type === "extraTurn";
}

function normalizeEditableEffect(effect: EffectDef): EffectDef {
  const id = effectIdFromName(effect.id || effect.name || "effect-custom");
  const name = effect.name.trim() || "New effect";
  return {
    id,
    name,
    description: effect.description?.trim() || "Custom effect for playtesting.",
    icon: effect.icon?.trim() || effectIcon(effect),
    duration: normalizeEffectDuration(effect.duration),
    consequences: editableEffectActions(effect).map(normalizeEditableAction),
  };
}

function normalizeEditableAction(action: EditableEffectAction): EditableEffectAction {
  const text = action.text?.trim();
  const icon = action.icon?.trim();
  return {
    ...action,
    hook: editableActionHookValue(action),
    ...(text ? { text } : { text: undefined }),
    ...(icon ? { icon } : { icon: undefined }),
  } as EditableEffectAction;
}

function editableActionHookValue(action: EditableEffectAction): EffectLifecycleHook {
  return hasFixedHookForEditableAction(action.type) ? defaultHookForEditableAction(action.type) : action.hook ?? defaultHookForEditableAction(action.type);
}

function hasFixedHookForEditableAction(type: EditableEffectAction["type"]): boolean {
  return type === "movementMultiplier" || type === "diceBias";
}

function hookOptionsForEditableAction(type: EditableEffectAction["type"]): { value: EffectLifecycleHook; label: string }[] {
  if (!hasFixedHookForEditableAction(type)) return EFFECT_HOOK_OPTIONS;
  const hook = defaultHookForEditableAction(type);
  return EFFECT_HOOK_OPTIONS.filter((option) => option.value === hook);
}

function normalizeEffectDuration(duration: EffectDuration): EffectDuration {
  if (duration.mode === "game") return { mode: duration.mode };
  return { mode: duration.mode, value: Math.max(1, Math.round(duration.value || 1)) };
}

function durationForMode(mode: EffectDuration["mode"], previous: EffectDuration): EffectDuration {
  if (mode === "game") return { mode };
  const value = previous.mode === "turns" || previous.mode === "rounds" || previous.mode === "uses" ? previous.value : 1;
  return { mode, value };
}

function cloneEffect(effect: EffectDef): EffectDef {
  return JSON.parse(JSON.stringify(effect)) as EffectDef;
}

function nextDraftEffectId(catalog: Record<string, EffectDef>): string {
  let index = Object.keys(catalog).length + 1;
  let id = `effect-custom-${index}`;
  while (catalog[id]) {
    index += 1;
    id = `effect-custom-${index}`;
  }
  return id;
}

function effectIdFromName(value: string): string {
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || "effect-custom";
}

function keyedEffects(effects: EffectDef[]): Record<string, EffectDef> {
  return Object.fromEntries(effects.map((effect) => [effect.id, effect]));
}

function mergedEffectCatalog(...catalogs: (Record<string, EffectDef> | undefined)[]): EffectDef[] {
  const merged = new Map<string, EffectDef>();
  for (const catalog of catalogs) {
    for (const effect of Object.values(catalog ?? {})) merged.set(effect.id, effect);
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function effectIcon(effect: { icon?: string; consequences?: EventAction[] }): string {
  if (effect.icon) return effect.icon;
  const firstAction = effect.consequences?.[0];
  if (firstAction) return actionIcon(firstAction);
  return "✦";
}

function actionIcon(action: EventAction): string {
  if (action.icon) return action.icon;
  if (action.type === "coins") return "🪙";
  if (action.type === "move" || action.type === "moveTo" || action.type === "moveToNearest") return "➜";
  if (action.type === "skipTurn") return "⏭";
  if (action.type === "extraTurn") return "🔁";
  if (action.type === "halfMovement") return "½";
  if (action.type === "movementMultiplier") return action.multiplier > 1 ? "×2" : "½";
  if (action.type === "diceBias") return "⚄";
  if (action.type === "swapPositions") return "⇄";
  if (action.type === "offlineAction") return "!";
  return "✦";
}

function effectTooltip(effect: EffectInstance): string {
  const description = effect.description ?? "Active effect";
  const consequences = effect.consequences.map((action) => consequenceLabel(action)).join(", ");
  return `${effect.name}: ${description} (${effectRemainingLabel(effect.remaining)})${consequences ? ` - ${consequences}` : ""}`;
}

function loadEventBuilderDraftEffects(): Record<string, EffectDef> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = loadEventBuilderDraftContent();
    if (!isRecord(parsed.effects)) return {};
    return Object.fromEntries(
      Object.entries(parsed.effects).flatMap(([id, value]) => {
        const effect = effectFromDraft(value);
        return effect ? [[id, effect]] : [];
      })
    );
  } catch {
    return {};
  }
}

function loadEventBuilderDraftContent(): DraftContent {
  if (typeof window === "undefined") return {};
  try {
    const saved = window.localStorage.getItem(EVENT_BUILDER_STORAGE_KEY);
    if (!saved) return {};
    const parsed = JSON.parse(saved);
    return isRecord(parsed) ? (parsed as DraftContent) : {};
  } catch {
    return {};
  }
}

function saveEventBuilderDraftContent(content: DraftContent) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(EVENT_BUILDER_STORAGE_KEY, JSON.stringify(content));
}

function saveDraftEffect(effect: EffectDef) {
  const draft = loadEventBuilderDraftContent();
  saveEventBuilderDraftContent({
    ...draft,
    effects: {
      ...(draft.effects ?? {}),
      [effect.id]: effect,
    },
  });
}

function deleteDraftEffect(effectId: string) {
  const draft = loadEventBuilderDraftContent();
  const { [effectId]: _deleted, ...effects } = draft.effects ?? {};
  saveEventBuilderDraftContent({ ...draft, effects });
}

function loadHiddenEffectIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const saved = window.localStorage.getItem(DEV_TOOLS_HIDDEN_EFFECTS_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

function saveHiddenEffectIds(effectIds: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEV_TOOLS_HIDDEN_EFFECTS_KEY, JSON.stringify([...effectIds]));
}

function effectFromDraft(value: unknown): EffectDef | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.name !== "string") return null;
  const duration = effectDurationFromDraft(value.duration);
  if (!duration) return null;
  if (!Array.isArray(value.consequences) && !Array.isArray(value.actions) && !Array.isArray(value.modifiers)) return null;
  return { ...(value as unknown as EffectDef), duration };
}

function effectDurationFromDraft(value: unknown): EffectDuration | null {
  if (!isRecord(value) || typeof value.mode !== "string") return null;
  if (value.mode === "untilTriggered") return { mode: "uses", value: 1 };
  if (value.mode === "game") return { mode: "game" };
  if (value.mode !== "turns" && value.mode !== "rounds" && value.mode !== "uses") return null;
  if (typeof value.value !== "number" || !Number.isFinite(value.value)) return null;
  return { mode: value.mode, value: Math.max(1, Math.round(value.value)) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isDevBuild(): boolean {
  return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
}

function turnTitle(state: GameState, active: Player | undefined, isMyTurn: boolean): string {
  if (state.phase === "moving") return "Moviendo ficha...";
  if (state.phase === "shop") return "Shop de artifacts";
  if (state.phase === "event") return "Casillero especial";
  if (state.phase === "turn") return isMyTurn ? "¡Es tu turno!" : `Turno de ${active?.name ?? "..."}`;
  return active ? `Turno de ${active.name}` : "Tablero";
}

function phaseLabel(phase: GameState["phase"]): string {
  const labels: Record<GameState["phase"], string> = {
    lobby: "Lobby",
    turn: "Turno",
    moving: "Movimiento",
    shop: "Shop",
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
      {state.phase === "event" && <EventCard state={state} me={me} canAdvance={canAdvance} onNext={onNext} />}
    </div>
  );
}
