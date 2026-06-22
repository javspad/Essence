import type { GameState } from "@essence/shared";

interface Props {
  state: GameState;
  canAdvance: boolean;
  onNext: () => void;
}

const MEDAL = ["🥇", "🥈", "🥉"];

export default function Reveal({ state, canAdvance, onNext }: Props) {
  const r = state.reveal;
  if (!r) return null;

  return (
    <div className="min-h-full flex flex-col items-center gap-5 p-6 max-w-md mx-auto w-full">
      <div className="text-center">
        <p className="text-sm uppercase tracking-widest text-violet-300">Resultados</p>
        <h2 className="text-xl font-bold">{r.title}</h2>
      </div>

      <div className="flex flex-col gap-2 w-full">
        {r.entries.map((e, idx) => (
          <div
            key={e.playerId}
            className={`rounded-2xl p-3 border animate-pop ${
              idx === 0 ? "bg-amber-400/20 border-amber-400" : "bg-white/5 border-white/10"
            }`}
            style={{ animationDelay: `${idx * 60}ms` }}
          >
            <div className="flex items-center gap-2">
              <span className="text-xl w-7 text-center">{MEDAL[idx] ?? `${e.rank}.`}</span>
              <span className="font-bold flex-1">{e.name}</span>
              {e.coins > 0 && <span className="text-amber-300 font-bold">+🪙{e.coins}</span>}
            </div>
            {e.flavor && <p className="text-sm text-violet-200 mt-1 pl-9 italic">"{e.flavor}"</p>}
          </div>
        ))}
      </div>

      {canAdvance ? (
        <button
          onClick={onNext}
          className="rounded-2xl py-4 px-8 font-bold text-lg bg-amber-400 text-amber-950 active:scale-95 transition w-full"
        >
          Siguiente turno →
        </button>
      ) : (
        <p className="text-violet-300 animate-pulse">Esperando al host / jugador activo...</p>
      )}
    </div>
  );
}
