import type { CoinTransaction, GameState, Player } from "@essence/shared";
import { artifactUseMessage } from "../artifactPresentation";
import { Button } from "@/components/ui/8bit/button";

interface Props {
  state: GameState;
  me: Player;
  canAdvance: boolean;
  onNext: () => void;
}

export default function EventCard({ state, me, canAdvance, onNext }: Props) {
  const ev = state.activeEvent;
  if (!ev) return null;
  const player = state.players.find((p) => p.id === ev.playerId);
  const artifactTarget = ev.artifactUse?.targetPlayerId
    ? state.players.find((p) => p.id === ev.artifactUse?.targetPlayerId)
    : undefined;
  const displayPlayer = artifactTarget ?? player;
  const displayName = artifactTarget?.id === me.id ? "Vos" : displayPlayer?.name ?? "Jugador";
  const isDare = ev.kind === "dare" || ev.story?.title?.toLowerCase().includes("prenda");
  const title = ev.title ?? ev.story?.title ?? (isDare ? "Prenda" : "Evento");
  const artifactMessage = artifactUseMessage(ev, state.players, me.id);

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
        <p className="font-bold text-lg mb-1" style={{ color: displayPlayer?.color }}>
          {displayName}
        </p>
        {ev.story?.setup && <p className="mb-3 text-sm font-bold text-white/65">{ev.story.setup}</p>}
        {artifactMessage && (
          <p className="mb-3 rounded-sm border border-cyan-200/30 bg-cyan-300/10 px-3 py-2 text-sm font-black text-cyan-100">
            {artifactMessage}
          </p>
        )}
        <p className="text-xl font-semibold mb-4">{ev.story?.prompt ?? ev.text}</p>
        {ev.story?.reward && <p className="mb-4 text-sm font-black text-amber-200">{ev.story.reward}</p>}
        {ev.actions?.length ? (
          <div className="mb-4 grid gap-2">
            {ev.actions.map((action, index) => (
              <div key={`${action.text}-${index}`} className="rounded-sm border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm font-black text-amber-100">
                <p>{action.text}</p>
                {action.coinTransactions?.length ? (
                  <div className="mt-2 grid gap-1">
                    {action.coinTransactions.map((transaction) => (
                      <p key={transaction.id} className="rounded-sm border border-cyan-200/25 bg-cyan-300/10 px-2 py-1 text-xs leading-4 text-cyan-100">
                        {coinTransactionText(transaction, state)}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
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

function coinTransactionText(transaction: CoinTransaction, state: GameState): string {
  const playerName = state.players.find((player) => player.id === transaction.playerId)?.name ?? transaction.playerId;
  const amount = Math.abs(transaction.delta);
  const verb = transaction.delta >= 0 ? "gained" : "lost";
  const clamp = transaction.clamped ? `, clamped from ${Math.abs(transaction.requestedDelta)}` : "";
  return `${playerName} ${verb} ${amount} coin${amount === 1 ? "" : "s"} · ${transaction.source.label}${clamp}`;
}
