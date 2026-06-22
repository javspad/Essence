import type { GameState, Player } from "@essence/shared";

interface Props {
  state: GameState;
  me: Player;
  isMyTurn: boolean;
  onRoll: () => void;
}

const DICE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

export default function TurnControls({ state, me, isMyTurn, onRoll }: Props) {
  const active = state.players.find((p) => p.id === state.turnOrder[state.activeIndex]);
  const rolling = state.phase === "moving";

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <p className="text-sm text-violet-300">
        Ronda {state.round} ·{" "}
        {isMyTurn ? (
          <span className="text-amber-300 font-bold">¡Es tu turno!</span>
        ) : (
          <>
            Turno de <span className="font-bold" style={{ color: active?.color }}>{active?.name}</span>
          </>
        )}
      </p>

      {state.lastRoll && (
        <div className="text-5xl animate-pop" aria-label={`Dado: ${state.lastRoll}`}>
          {DICE[state.lastRoll]}
        </div>
      )}

      {isMyTurn && state.phase === "turn" ? (
        <button
          onClick={onRoll}
          className="rounded-full w-32 h-32 text-xl font-black bg-amber-400 text-amber-950 active:scale-90 transition shadow-xl"
        >
          TIRAR 🎲
        </button>
      ) : (
        <p className="text-violet-300/70 text-sm h-8 flex items-center">
          {rolling ? "Moviendo..." : !isMyTurn ? `Mirando a ${active?.name}...` : ""}
        </p>
      )}
      {me.position >= 0 && (
        <p className="text-xs text-white/40">Estás en el casillero {me.position}</p>
      )}
    </div>
  );
}
