import { lazy, Suspense } from "react";
import { useGame } from "./useGame";
import JoinScreen from "./components/JoinScreen";
import Lobby from "./components/Lobby";
import MinigameHost from "./components/MinigameHost";

const GameScene3D = lazy(() => import("./components/GameScene3D"));

export default function App() {
  const { connected, state, me, activeId, isMyTurn, isHost, error, actions } = useGame();

  // Sin identidad todavía → pantalla de ingreso.
  if (!state || !me) {
    return (
      <>
        {!connected && <ConnBadge connected={connected} />}
        <JoinScreen error={error} onCreate={actions.create} onJoin={actions.join} />
      </>
    );
  }

  if (["turn", "moving", "event", "reveal", "finished"].includes(state.phase)) {
    return (
      <Suspense fallback={<SceneLoading code={state.code} />}>
        <GameScene3D
          connected={connected}
          state={state}
          me={me}
          activeId={activeId ?? undefined}
          isMyTurn={isMyTurn}
          isHost={isHost}
          onRoll={actions.roll}
          onNext={actions.next}
          onLeave={actions.leave}
        />
      </Suspense>
    );
  }

  return (
    <div className="min-h-full flex flex-col">
      <ConnBadge connected={connected} code={state.code} />

      {state.phase === "lobby" && <Lobby state={state} isHost={isHost} onStart={actions.start} />}

      {state.phase === "minigame" && (
        <MinigameHost
          state={state}
          me={me}
          isHost={isHost}
          onFinish={actions.submitResult}
          onAction={actions.action}
          onForce={actions.forceResolve}
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

function ConnBadge({ connected, code }: { connected: boolean; code?: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 text-xs text-white/50">
      <span>{code ? `Sala ${code}` : "Despedida de Javi"}</span>
      <span className={connected ? "text-emerald-400" : "text-red-400"}>
        {connected ? "● en línea" : "● reconectando..."}
      </span>
    </div>
  );
}
