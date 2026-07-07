import type { GameState } from "@essence/shared";
import { effectRemainingLabel } from "@essence/shared/consequences";
import { rankPlayersByProgress } from "@essence/shared/ranking";
import { Badge } from "@/components/ui/8bit/badge";
import { cn } from "@/lib/utils";

export default function Scoreboard({
  state,
  activeId,
  focusedPlayerId,
  onFocusPlayer,
}: {
  state: GameState;
  activeId?: string;
  focusedPlayerId?: string | null;
  onFocusPlayer?: (playerId: string) => void;
}) {
  const sorted = rankPlayersByProgress(state.players);
  return (
    <div className="flex w-full flex-wrap justify-center gap-3">
      {sorted.map((p) => {
        const isFocused = p.id === focusedPlayerId;
        const effects = state.activeEffects.filter((effect) => effect.targetPlayerId === p.id);
        const content = (
          <span className="inline-flex min-w-0 flex-col items-start gap-1">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="inline-block size-3 rounded-[2px] border border-black/35 align-middle" style={{ background: p.color }} />
              <span className="truncate font-semibold">{p.name}</span>
              {p.groom && <span>🤵</span>}
              <span className="font-bold">🪙{p.coins}</span>
            </span>
            {effects.length > 0 && (
              <span className="flex max-w-full flex-wrap gap-1">
                {effects.map((effect) => (
                  <span
                    key={effect.id}
                    title={`${effect.name}: ${effect.description ?? "Active effect"} (${effectRemainingLabel(effect.remaining)})`}
                    className="max-w-[10rem] truncate rounded-sm border border-cyan-200/35 bg-cyan-300/15 px-1.5 py-0.5 text-[9px] font-black uppercase text-cyan-100"
                  >
                    {effect.name} · {effectRemainingLabel(effect.remaining)}
                  </span>
                ))}
              </span>
            )}
          </span>
        );
        const className = cn(
          "border-[#fff4bf] px-3 py-2 text-xs text-[#fff8d6]",
          isFocused ? "bg-[#67e8f9] text-[#062116]" : p.id === activeId ? "bg-[#f5d547] text-[#201507]" : "bg-[#171120]",
          p.connected ? "" : "opacity-40"
        );

        if (!onFocusPlayer) {
          return (
            <Badge key={p.id} className={className}>
              {content}
            </Badge>
          );
        }

        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={isFocused || undefined}
            aria-label={`Enfocar a ${p.name} en el mapa`}
            title={`Enfocar a ${p.name}`}
            onClick={() => onFocusPlayer(p.id)}
            className={cn(
              "inline-flex items-center rounded-none border font-bold",
              className,
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#67e8f9]"
            )}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
