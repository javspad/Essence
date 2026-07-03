import type { GameState } from "@essence/shared";
import { Button } from "@/components/ui/8bit/button";

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
        className={`modal-card max-w-sm animate-pop ${
          isDare ? "from-rose-900/95 to-pink-950/95" : "from-fuchsia-900/95 to-indigo-950/95"
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
          <Button
            type="button"
            onClick={onNext}
            className="h-12 w-full bg-[#f5d547] text-sm uppercase text-[#201507]"
          >
            {isDare ? "¡Listo, lo hizo!" : "Siguiente"}
          </Button>
        ) : (
          <p className="text-white/60 animate-pulse">Esperando...</p>
        )}
      </div>
    </div>
  );
}
