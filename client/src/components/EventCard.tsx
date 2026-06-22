import type { GameState } from "@essence/shared";

interface Props {
  state: GameState;
  canAdvance: boolean;
  onNext: () => void;
}

export default function EventCard({ state, canAdvance, onNext }: Props) {
  const ev = state.activeEvent;
  if (!ev) return null;
  const player = state.players.find((p) => p.id === ev.playerId);
  const isDare = ev.kind === "dare";

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-6 z-40">
      <div
        className={`max-w-sm w-full rounded-3xl p-8 text-center animate-pop border-2 ${
          isDare ? "bg-rose-900/90 border-rose-400" : "bg-fuchsia-900/90 border-fuchsia-400"
        }`}
      >
        <div className="text-6xl mb-3">{isDare ? "🍻" : "🃏"}</div>
        <p className="text-sm uppercase tracking-widest text-white/60 mb-1">
          {isDare ? "Prenda" : "Carta del destino"}
        </p>
        <p className="font-bold text-lg mb-1" style={{ color: player?.color }}>
          {player?.name}
        </p>
        <p className="text-xl font-semibold mb-6">{ev.text}</p>
        {canAdvance ? (
          <button
            onClick={onNext}
            className="rounded-2xl py-3 px-8 font-bold bg-white text-slate-900 active:scale-95 transition w-full"
          >
            {isDare ? "¡Listo, lo hizo! →" : "Siguiente →"}
          </button>
        ) : (
          <p className="text-white/60 animate-pulse">Esperando...</p>
        )}
      </div>
    </div>
  );
}
