import { useGame } from "./useGame";
import JoinScreen from "./components/JoinScreen";
import Lobby from "./components/Lobby";
import Board from "./components/Board";
import Scoreboard from "./components/Scoreboard";
import TurnControls from "./components/TurnControls";
import EventCard from "./components/EventCard";
import MinigameHost from "./components/MinigameHost";
import Reveal from "./components/Reveal";
import Victory from "./components/Victory";

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

  // El jugador activo o el host pueden avanzar desde reveal/event.
  const canAdvance = isHost || isMyTurn;

  return (
    <div className="min-h-full flex flex-col">
      <ConnBadge connected={connected} code={state.code} />

      {state.phase === "lobby" && <Lobby state={state} isHost={isHost} onStart={actions.start} />}

      {(state.phase === "turn" || state.phase === "moving" || state.phase === "event") && (
        <div className="flex flex-col gap-5 p-4 max-w-lg mx-auto w-full">
          <Scoreboard state={state} activeId={activeId ?? undefined} />
          <TurnControls state={state} me={me} isMyTurn={isMyTurn} onRoll={actions.roll} />
          <Board state={state} />
          {state.phase === "event" && (
            <EventCard state={state} canAdvance={canAdvance} onNext={actions.next} />
          )}
        </div>
      )}

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

      {state.phase === "reveal" && (
        <Reveal state={state} canAdvance={canAdvance} onNext={actions.next} />
      )}

      {state.phase === "finished" && <Victory state={state} onLeave={actions.leave} />}
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
