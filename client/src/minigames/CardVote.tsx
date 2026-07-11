import { useState } from "react";
import { ArrowRight, Layers3, Vote as VoteIcon } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { ArcadeShell } from "./ArcadeShell";
import type { MinigameProps } from "./types";

export default function CardVote({ content, players, activeMinigame, me, onFinish, onAction, spectator }: MinigameProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const state = activeMinigame?.cardVote;
  const fallbackCards = Array.isArray(content?.cards)
    ? content.cards.filter((card: unknown): card is string => typeof card === "string" && Boolean(card.trim()))
    : [];
  const card = state?.card ?? fallbackCards[0] ?? "¿Quién encaja mejor con esta carta?";
  const cardIndex = state?.cardIndex ?? 0;
  const totalCards = state?.totalCards ?? Math.max(1, fallbackCards.length);

  if (state?.phase === "result" && state.roundResult) {
    const result = state.roundResult;
    const winners = result.winnerIds.map((id) => players.find((player) => player.id === id)).filter(Boolean);
    const canAdvance = me.isHost || me.id === activeMinigame?.protagonistId;
    const standings = [...players].sort(
      (a, b) => (state.cardCounts[b.id] ?? 0) - (state.cardCounts[a.id] ?? 0) || players.indexOf(a) - players.indexOf(b)
    );

    return (
      <ArcadeShell
        title={winners.length ? winnerText(winners.map((winner) => winner!.name)) : "Esta carta queda sin dueño"}
        kicker={`Carta ${cardIndex + 1} de ${totalCards}`}
        badge={winners.length > 1 ? "empate" : winners.length === 1 ? "adjudicada" : "sin carta"}
      >
        <blockquote className="border-l-4 border-[#f5d547] bg-[#f5d547]/10 px-4 py-3 text-center text-lg font-black leading-7 text-[#fff8d6]">
          {result.card}
        </blockquote>

        <div className="grid gap-2">
          {players.map((player) => {
            const voters = result.votersByPlayer[player.id] ?? [];
            return (
              <div key={player.id} className="rounded-sm border border-[#fff4bf]/15 bg-[#0d1829] px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-black text-[#fff8d6]">{player.name}</span>
                  <span className="retro text-[10px] text-[#7dd3fc]">
                    {result.voteCounts[player.id] ?? 0} {(result.voteCounts[player.id] ?? 0) === 1 ? "voto" : "votos"}
                  </span>
                </div>
                <p className="mt-1 text-xs font-bold text-[#c7bddc]">
                  {voters.length ? `Votaron ${namesFor(voters, players)}` : "Sin votos"}
                </p>
              </div>
            );
          })}
        </div>

        <div className="rounded-sm border border-[#a7f3d0]/20 bg-[#34d399]/10 p-3">
          <p className="retro text-center text-[9px] uppercase text-[#a7f3d0]">Cartas acumuladas</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {standings.map((player) => (
              <span key={player.id} className="inline-flex items-center gap-1.5 rounded-sm bg-[#0d1829] px-2.5 py-1.5 text-xs font-black text-[#fff8d6]">
                <Layers3 className="size-3.5 text-[#f5d547]" />
                {player.name} · {state.cardCounts[player.id] ?? 0}
              </span>
            ))}
          </div>
        </div>

        {canAdvance ? (
          <Button type="button" onClick={() => onAction?.({ type: "cardVote:next" })} className="h-12 w-full bg-[#f5d547] text-xs uppercase text-[#201507]">
            {cardIndex + 1 >= totalCards ? "Ver ranking final" : "Siguiente carta"}
            <ArrowRight data-icon="inline-end" />
          </Button>
        ) : (
          <p className="animate-pulse text-center text-sm font-black text-[#c7bddc]">Esperando la siguiente carta...</p>
        )}
      </ArcadeShell>
    );
  }

  const choose = (playerId: string) => {
    if (picked || spectator) return;
    setPicked(playerId);
    onFinish(0, { votedFor: playerId });
  };

  return (
    <ArcadeShell title={card} kicker={`Carta ${cardIndex + 1} de ${totalCards}`} badge="voto secreto">
      <p className="text-center text-sm font-black text-[#c7bddc]">¿A quién describe mejor? Elegí una persona.</p>
      <div className="grid w-full grid-cols-2 gap-3">
        {players.map((player) => {
          const cannotVoteSelf = state?.allowSelfVote === false && player.id === me.id;
          const selected = picked === player.id;
          return (
            <Button
              type="button"
              font="normal"
              key={player.id}
              onClick={() => choose(player.id)}
              disabled={Boolean(picked) || Boolean(spectator) || cannotVoteSelf}
              className={`min-h-16 px-3 text-base font-black normal-case text-[#fff8d6] ${
                selected
                  ? "scale-105 bg-[#f5d547] text-[#201507]"
                  : picked || spectator || cannotVoteSelf
                    ? "opacity-40"
                    : "bg-[#0d1829] hover:bg-[#12253f]"
              }`}
              style={selected ? undefined : { background: `${player.color}33` }}
            >
              <VoteIcon data-icon="inline-start" />
              {player.name}
            </Button>
          );
        })}
      </div>
      {(picked || spectator) && <p className="animate-pop text-center font-semibold text-emerald-300">¡Voto registrado! Esperando al resto...</p>}
    </ArcadeShell>
  );
}

function winnerText(names: string[]): string {
  if (names.length === 1) return `${names[0]} recibe la carta`;
  return `${names.slice(0, -1).join(", ")} y ${names.at(-1)} reciben la carta`;
}

function namesFor(ids: string[], players: MinigameProps["players"]): string {
  return ids.map((id) => players.find((player) => player.id === id)?.name ?? id).join(", ");
}
