import { useState } from "react";
import { Crown, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { ArcadeShell } from "./ArcadeShell";
import type { MinigameProps } from "./types";

export default function HostPick({ content, players, onFinish }: MinigameProps) {
  const title = content?.title ?? content?.label ?? "Elección del host";
  const prompt = content?.prompt ?? content?.story?.prompt ?? "Elegí quién gana o pierde esta ronda.";
  const [sent, setSent] = useState(false);
  const [pickMode, setPickMode] = useState<"winner" | "loser">(content?.defaultPick === "winner" ? "winner" : "loser");

  const pickPlayer = (playerId: string) => {
    if (sent) return;
    setSent(true);
    onFinish(0, { pickedPlayerId: playerId, pick: pickMode });
  };

  return (
    <ArcadeShell title={title} kicker="Host" badge={pickMode === "winner" ? "gana" : "pierde"}>
      <p className="text-center text-base font-black leading-7 text-[#fff8d6]">{prompt}</p>
      {content?.story?.setup && <p className="text-center text-sm font-black text-[#c7bddc]">{content.story.setup}</p>}

      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            onClick={() => setPickMode("loser")}
            className={`h-11 text-xs uppercase ${pickMode === "loser" ? "bg-[#fb7185] text-[#2a070b]" : "bg-[#0d1829] text-[#fff8d6]"}`}
          >
            <ThumbsDown data-icon="inline-start" />
            Pierde
          </Button>
          <Button
            type="button"
            onClick={() => setPickMode("winner")}
            className={`h-11 text-xs uppercase ${pickMode === "winner" ? "bg-[#34d399] text-[#062116]" : "bg-[#0d1829] text-[#fff8d6]"}`}
          >
            <Crown data-icon="inline-start" />
            Gana
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {players.map((player) => (
            <Button
              key={player.id}
              type="button"
              onClick={() => pickPlayer(player.id)}
              disabled={sent}
              className="min-h-14 bg-[#0d1829] px-3 text-sm normal-case text-[#fff8d6]"
              style={{ background: sent ? undefined : `${player.color}33` }}
            >
              {player.name}
            </Button>
          ))}
        </div>
      </div>

      {sent && <p className="animate-pop text-center text-sm font-black text-emerald-300">Resultado enviado.</p>}
    </ArcadeShell>
  );
}
