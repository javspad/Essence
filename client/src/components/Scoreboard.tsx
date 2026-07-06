import type { GameState } from "@essence/shared";
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
        const content = (
          <>
            <span className="mr-2 inline-block size-3 rounded-[2px] border border-black/35 align-middle" style={{ background: p.color }} />
            <span className="font-semibold">{p.name}</span>
            {p.groom && <span>🤵</span>}
            <span className="ml-2 font-bold">🪙{p.coins}</span>
          </>
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
