import { useState } from "react";
import { Vote as VoteIcon } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { ArcadeShell } from "./ArcadeShell";
import type { MinigameProps } from "./types";

export default function Vote({ content, players, onFinish }: MinigameProps) {
  const [picked, setPicked] = useState<string | null>(null);

  const choose = (id: string) => {
    if (picked) return;
    setPicked(id);
    onFinish(0, { votedFor: id });
  };

  return (
    <ArcadeShell title={content.question} kicker="Votación" badge="secreto">
      <p className="text-center text-sm font-black text-[#c7bddc]">Votá en secreto.</p>
      <div className="grid w-full grid-cols-2 gap-4">
        {players.map((p) => (
          <Button
            type="button"
            font="normal"
            key={p.id}
            onClick={() => choose(p.id)}
            disabled={!!picked}
            className={`min-h-16 px-3 text-base font-black normal-case text-[#fff8d6] ${
              picked === p.id
                ? "scale-105 bg-[#f5d547] text-[#201507]"
                : picked
                  ? "opacity-40"
                  : "bg-[#0d1829] hover:bg-[#12253f]"
            }`}
            style={picked === p.id ? undefined : { background: p.color + "33" }}
          >
            <VoteIcon data-icon="inline-start" />
            {p.name}
          </Button>
        ))}
      </div>
      {picked && <p className="text-emerald-300 font-semibold animate-pop">¡Voto registrado!</p>}
    </ArcadeShell>
  );
}
