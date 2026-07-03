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
  const isDare = ev.kind === "dare" || ev.story?.title?.toLowerCase().includes("prenda");
  const title = ev.title ?? ev.story?.title ?? (isDare ? "Prenda" : "Evento");

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-6 z-40">
      <div
        className={`modal-card max-w-sm animate-pop ${
          isDare ? "from-rose-900/95 to-pink-950/95" : "from-fuchsia-900/95 to-indigo-950/95"
        }`}
      >
        <div className="text-6xl mb-3">{isDare ? "🍻" : "🃏"}</div>
        <p className="text-sm uppercase tracking-widest text-white/60 mb-1">
          {title}
        </p>
        <p className="font-bold text-lg mb-1" style={{ color: player?.color }}>
          {player?.name}
        </p>
        {ev.story?.setup && <p className="mb-3 text-sm font-bold text-white/65">{ev.story.setup}</p>}
        <p className="text-xl font-semibold mb-4">{ev.story?.prompt ?? ev.text}</p>
        {ev.story?.reward && <p className="mb-4 text-sm font-black text-amber-200">{ev.story.reward}</p>}
        {ev.actions?.length ? (
          <div className="mb-4 grid gap-2">
            {ev.actions.map((action, index) => (
              <p key={`${action.text}-${index}`} className="rounded-sm border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm font-black text-amber-100">
                {action.text}
              </p>
            ))}
          </div>
        ) : null}
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
