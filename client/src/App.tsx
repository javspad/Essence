import { lazy, Suspense } from "react";
import type { GameState, Player } from "@essence/shared";
import { useGame } from "./useGame";
import { useBoardPresentation } from "./useBoardPresentation";
import JoinScreen from "./components/JoinScreen";
import Lobby from "./components/Lobby";
import MinigameHost from "./components/MinigameHost";
import { Badge } from "@/components/ui/8bit/badge";

const GameScene3D = lazy(() => import("./components/GameScene3D"));
const MapBuilder = lazy(() => import("./components/MapBuilder"));
const EventBuilder = lazy(() => import("./components/MinigameBuilder"));
const CharacterBuilder = lazy(() => import("./components/CharacterBuilder"));
const CosmeticBuilder = lazy(() => import("./components/CosmeticBuilder"));
const ArtifactBuilder = lazy(() => import("./components/ArtifactBuilder"));
const ToolsHub = lazy(() => import("./components/ToolsHub"));

export default function App() {
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const builderMode =
    path === "/map-builder" || search.has("mapBuilder");
  const eventBuilderMode =
    path === "/event-builder" || path === "/minigame-builder" || search.has("eventBuilder") || search.has("minigameBuilder");
  const characterBuilderMode = path === "/character-builder" || search.has("characterBuilder");
  const cosmeticBuilderMode = path === "/cosmetic-builder" || search.has("cosmeticBuilder");
  const artifactBuilderMode = path === "/artifact-builder" || search.has("artifactBuilder");
  const toolsMode = path === "/tools";

  if (toolsMode) {
    return (
      <Suspense fallback={<SceneLoading code="TOOLS" />}>
        <ToolsHub />
      </Suspense>
    );
  }

  if (builderMode) {
    return (
      <Suspense fallback={<SceneLoading code="MAP" />}>
        <MapBuilder />
      </Suspense>
    );
  }

  if (eventBuilderMode) {
    return (
      <Suspense fallback={<SceneLoading code="EVNT" />}>
        <EventBuilder />
      </Suspense>
    );
  }

  if (characterBuilderMode) {
    return (
      <Suspense fallback={<SceneLoading code="CHAR" />}>
        <CharacterBuilder />
      </Suspense>
    );
  }

  if (cosmeticBuilderMode) {
    return (
      <Suspense fallback={<SceneLoading code="COSM" />}>
        <CosmeticBuilder />
      </Suspense>
    );
  }

  if (artifactBuilderMode) {
    return (
      <Suspense fallback={<SceneLoading code="ARTF" />}>
        <ArtifactBuilder />
      </Suspense>
    );
  }

  return <GameApp />;
}

function GameApp() {
  const { connected, state, me, activeId, isHost, error, effectNotices, dismissEffectNotice, actions } = useGame();

  // Sin identidad todavía → pantalla de ingreso.
  if (!state || !me) {
    return (
      <>
        {!connected && <ConnBadge connected={connected} />}
        <JoinScreen error={error} onCreate={actions.create} onJoin={actions.join} />
      </>
    );
  }

  return (
    <ConnectedGame
      connected={connected}
      state={state}
      me={me}
      activeId={activeId}
      isHost={isHost}
      effectNotices={effectNotices}
      onDismissEffectNotice={dismissEffectNotice}
      actions={actions}
    />
  );
}

function ConnectedGame({
  connected,
  state,
  me,
  activeId,
  isHost,
  effectNotices,
  onDismissEffectNotice,
  actions,
}: {
  connected: boolean;
  state: GameState;
  me: Player;
  activeId: string | null;
  isHost: boolean;
  effectNotices: ReturnType<typeof useGame>["effectNotices"];
  onDismissEffectNotice: ReturnType<typeof useGame>["dismissEffectNotice"];
  actions: ReturnType<typeof useGame>["actions"];
}) {
  const presentation = useBoardPresentation(state);
  const boardState = presentation.displayState;
  const boardMe = boardState.players.find((player) => player.id === me.id) ?? me;
  const boardActiveId = boardState.turnOrder[boardState.activeIndex] ?? activeId ?? undefined;
  const boardIsMyTurn = boardMe.id === boardActiveId;

  const boardPhaseVisible = ["turn", "moving", "shop", "event", "reveal", "finished"].includes(boardState.phase);
  const holdingMinigameForBoard = state.phase === "minigame" && !presentation.showMinigame;

  if (boardPhaseVisible || holdingMinigameForBoard) {
    return (
      <Suspense fallback={<SceneLoading code={boardState.code} />}>
        <GameScene3D
          connected={connected}
          state={boardState}
          me={boardMe}
          activeId={boardActiveId}
          isMyTurn={boardIsMyTurn}
          isHost={isHost}
          activeMotion={presentation.activeMotion}
          diceCue={presentation.diceCue}
          eventBusyLabel={presentation.eventBusyLabel}
          rollBlocked={presentation.rollBlocked}
          statusLabel={presentation.statusLabel}
          onRoll={() => {
            presentation.rollRequested();
            actions.roll();
          }}
          onBuyCosmetic={actions.buyCosmetic}
          onEquipCosmetic={actions.equipCosmetic}
          onRollArtifactShop={actions.rollArtifactShop}
          onBuyArtifact={actions.buyArtifact}
          onUseArtifact={actions.useArtifact}
          onSkipArtifactShop={actions.skipArtifactShop}
          onNext={actions.next}
          onLeave={actions.leave}
          onDebugApplyEffect={actions.debugApplyEffect}
          effectNotices={effectNotices}
          onDismissEffectNotice={onDismissEffectNotice}
        />
      </Suspense>
    );
  }

  return (
    <div className="min-h-full flex flex-col">
      {(state.phase === "lobby" || !connected) && <ConnBadge connected={connected} code={state.code} roomName={state.roomName} />}

      {state.phase === "lobby" && <Lobby state={state} isHost={isHost} onStart={actions.start} onLeave={actions.leave} />}

      {presentation.showMinigame && (
        <MinigameHost
          state={state}
          me={me}
          isHost={isHost}
          onFinish={actions.submitResult}
          onAction={actions.action}
          onForce={actions.forceResolve}
          onLeave={actions.leave}
        />
      )}
    </div>
  );
}

function SceneLoading({ code }: { code: string }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-950 text-sm font-bold tracking-[0.3em] text-amber-300">
      SALA {code} · CARGANDO 3D
    </div>
  );
}

function ConnBadge({ connected, code, roomName }: { connected: boolean; code?: string; roomName?: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 text-xs text-white/60">
      <span>{code ? `${roomName ?? "Sala"} · ${code}` : "Despedida de Javi"}</span>
      <Badge className={connected ? "border-[#a7f3d0] bg-[#34d399] px-2 py-1 text-[9px] text-[#062116]" : "border-[#fecaca] bg-[#fb7185] px-2 py-1 text-[9px] text-[#2a070b]"}>
        {connected ? "● en línea" : "● reconectando..."}
      </Badge>
    </div>
  );
}
