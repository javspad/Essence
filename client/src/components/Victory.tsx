import type { GameState } from "@essence/shared";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { Badge } from "@/components/ui/8bit/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/8bit/card";

export default function Victory({ state, onLeave }: { state: GameState; onLeave: () => void }) {
  const ranked = [...state.players].sort((a, b) => b.stars - a.stars || b.coins - a.coins);
  const winner = state.players.find((p) => p.id === state.winnerId) ?? ranked[0];

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center p-6 text-center">
      <Card font="normal" className="w-full border-[#f5d547] bg-[#171120]/92 text-[#fff8d6] shadow-[0_20px_60px_rgb(0_0_0/0.38)]">
        <CardHeader font="normal" className="text-center">
          <div className="animate-pop text-7xl">🏆</div>
          <p className="retro text-[10px] uppercase text-[#c7bddc]">Ganador de la noche</p>
          <CardTitle font="normal" className="text-4xl font-black" style={{ color: winner?.color }}>
            {winner?.name}
          </CardTitle>
          <p className="font-bold text-[#f5d547]">
            ⭐{winner?.stars} · 🪙{winner?.coins}
          </p>
        </CardHeader>

        <CardContent font="normal" className="flex flex-col gap-5">
          <div className="flex w-full flex-col gap-2">
            {ranked.map((p, i) => (
              <div
                key={p.id}
                className="grid grid-cols-[1.5rem_0.75rem_minmax(0,1fr)_auto] items-center gap-2 border-2 border-[#fff4bf]/20 bg-[#0d1829] p-3 text-left"
              >
                <span className="retro text-center text-[9px] text-[#fff4bf]/70">{i + 1}</span>
                <span className="size-3 rounded-[2px] border border-black/35" style={{ background: p.color }} />
                <span className="min-w-0 truncate font-semibold">{p.name}</span>
                <span className="flex items-center gap-2 text-xs font-black text-[#fff4bf]">
                  <Badge className="border-[#fde68a] bg-[#f5d547] px-2 py-1 text-[9px] text-[#201507]">⭐{p.stars}</Badge>
                  <span>🪙{p.coins}</span>
                </span>
              </div>
            ))}
          </div>

          <Button
            type="button"
            onClick={onLeave}
            className="h-12 w-full bg-[#f5d547] text-sm uppercase text-[#201507]"
          >
            <LogOut data-icon="inline-start" />
            Salir
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
