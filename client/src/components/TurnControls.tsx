import type { GameState, Player } from "@essence/shared";
import { Dice5 } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { Card, CardContent } from "@/components/ui/8bit/card";

interface Props {
  state: GameState;
  me: Player;
  isMyTurn: boolean;
  onRoll: () => void;
}

const DICE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

export default function TurnControls({ state, me, isMyTurn, onRoll }: Props) {
  const active = state.players.find((p) => p.id === state.turnOrder[state.activeIndex]);
  const rolling = state.phase === "moving";

  return (
    <Card font="normal" className="w-full border-[#f5d547] bg-[#171120]/92 text-[#fff8d6]">
      <CardContent font="normal" className="p-4 text-center">
        <div className="flex items-end justify-between gap-4 text-left">
          <div>
            <p className="retro text-[9px] uppercase text-[#c7bddc]">Ronda {state.round}</p>
            <p className="mt-1 text-sm font-black" style={{ color: active?.color ?? "#fff8d6" }}>
              {isMyTurn ? "¡Es tu turno!" : `Turno de ${active?.name ?? "..."}`}
            </p>
          </div>
          <div className="text-right">
            <p className="retro text-[9px] uppercase text-[#c7bddc]">Ficha</p>
            <p className="mt-1 text-2xl font-black text-[#fff4bf]">#{Math.max(0, me.position)}</p>
          </div>
        </div>

        {state.lastRoll && (
          <div className="mt-4 text-5xl animate-pop" aria-label={`Dado: ${state.lastRoll}`}>
            {diceDisplay(state.lastRoll, state.lastBaseRoll)}
          </div>
        )}

        {isMyTurn && state.phase === "turn" ? (
          <Button
            type="button"
            onClick={onRoll}
            className="mt-4 h-12 w-full bg-[#f5d547] text-sm uppercase text-[#201507] hover:bg-[#ffe96c]"
          >
            <Dice5 data-icon="inline-start" />
            Tirar
          </Button>
        ) : (
          <p className="mt-4 min-h-8 text-sm font-black text-[#c7bddc]">
            {rolling ? "Moviendo..." : !isMyTurn ? `Mirando a ${active?.name ?? "..."}` : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function diceDisplay(value: number, baseValue?: number | null): string {
  if (baseValue && baseValue !== value) return `${DICE[baseValue] ?? baseValue}→${value}`;
  return DICE[value] ?? String(value);
}
