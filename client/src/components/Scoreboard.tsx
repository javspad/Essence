import type { GameState } from "@essence/shared";
import { Badge } from "@/components/ui/8bit/badge";
import { cn } from "@/lib/utils";

export default function Scoreboard({ state, activeId }: { state: GameState; activeId?: string }) {
  const sorted = [...state.players].sort((a, b) => b.stars - a.stars || b.coins - a.coins);
  return (
    <div className="flex w-full flex-wrap justify-center gap-3">
      {sorted.map((p) => (
        <Badge
          key={p.id}
          className={cn(
            "border-[#fff4bf] px-3 py-2 text-xs text-[#fff8d6]",
            p.id === activeId ? "bg-[#f5d547] text-[#201507]" : "bg-[#171120]",
            p.connected ? "" : "opacity-40"
          )}
        >
          <span className="mr-2 inline-block size-3 rounded-[2px] border border-black/35 align-middle" style={{ background: p.color }} />
          <span className="font-semibold">{p.name}</span>
          {p.groom && <span>🤵</span>}
          <span className="ml-2 font-bold">🪙{p.coins}</span>
          {p.stars > 0 && <span className="text-yellow-300 font-bold">⭐{p.stars}</span>}
        </Badge>
      ))}
    </div>
  );
}
