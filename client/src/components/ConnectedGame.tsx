import { lazy, Suspense, type ReactNode } from "react";
import type { GameState, Player } from "@essence/shared";
import { Badge } from "@/components/ui/8bit/badge";
import { AudioTriggerProvider } from "../audio";
import { useBoardPresentation } from "../useBoardPresentation";
import type { useGame } from "../useGame";
import Lobby from "./Lobby";
import MinigameHost from "./MinigameHost";

const GameScene3D = lazy(() => import("./GameScene3D"));

interface ConnectedGameProps {
  connected: boolean;
  state: GameState;
  me: Player;
  activeId: string | null;
  isHost: boolean;
  effectNotices: ReturnType<typeof useGame>["effectNotices"];
  onDismissEffectNotice: ReturnType<typeof useGame>["dismissEffectNotice"];
  actions: ReturnType<typeof useGame>["actions"];
  overlay?: ReactNode;
}

export default function ConnectedGame({
  connected,
  state,
  me,
  activeId,
  isHost,
  effectNotices,
  onDismissEffectNotice,
  actions,
  overlay,
}: ConnectedGameProps) {
  const presentation = useBoardPresentation(state);
  const boardState = presentation.displayState;
  const boardMe = boardState.players.find((player) => player.id === me.id) ?? me;
  const boardActiveId = boardState.turnOrder[boardState.activeIndex] ?? activeId ?? undefined;
  const boardIsMyTurn = boardMe.id === boardActiveId;

  const boardPhaseVisible = ["turn", "moving", "shop", "event", "reveal", "finished"].includes(boardState.phase);
  const holdingMinigameForBoard = state.phase === "minigame" && !presentation.showMinigame;

  return (
    <>
      <AudioTriggerProvider assets={state.audioAssets} bindings={state.audioTriggers}>
        {boardPhaseVisible || holdingMinigameForBoard ? (
          <Suspense fallback={<GameSceneLoading code={boardState.code} />}>
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
        ) : (
          <div className="flex min-h-full flex-col">
            {(state.phase === "lobby" || !connected) && (
              <GameConnectionBadge connected={connected} code={state.code} roomName={state.roomName} />
            )}

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
        )}
      </AudioTriggerProvider>
      {overlay}
    </>
  );
}

function GameSceneLoading({ code }: { code: string }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-950 text-sm font-bold tracking-[0.3em] text-amber-300">
      SALA {code} · CARGANDO 3D
    </div>
  );
}

function GameConnectionBadge({ connected, code, roomName }: { connected: boolean; code?: string; roomName?: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 text-xs text-white/60">
      <span>{code ? `${roomName ?? "Sala"} · ${code}` : "Despedida de Javi"}</span>
      <Badge
        className={
          connected
            ? "border-[#a7f3d0] bg-[#34d399] px-2 py-1 text-[9px] text-[#062116]"
            : "border-[#fecaca] bg-[#fb7185] px-2 py-1 text-[9px] text-[#2a070b]"
        }
      >
        {connected ? "● en línea" : "● reconectando..."}
      </Badge>
    </div>
  );
}
