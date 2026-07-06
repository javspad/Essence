import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { ArcadeShell } from "./ArcadeShell";
import type { MinigameProps } from "./types";

export default function Prompt({ content, me, onFinish, spectator }: MinigameProps) {
  const title = content?.title ?? content?.label ?? "Evento";
  const prompt = content?.prompt ?? content?.story?.prompt ?? "Completá la acción.";
  const protagonistId = typeof content?.protagonistId === "string" ? content.protagonistId : undefined;
  const protagonistName = typeof content?.protagonistName === "string" ? content.protagonistName : undefined;
  const isProtagonist = protagonistId === me.id;
  const [sent, setSent] = useState(false);

  const submitDone = () => {
    if (sent || spectator) return;
    setSent(true);
    onFinish(1, { confirmed: true, confirmerId: me.id, subjectPlayerId: protagonistId });
  };

  return (
    <ArcadeShell title={title} kicker="Evento" badge="ok">
      <p className="text-center text-base font-black leading-7 text-[#fff8d6]">{prompt}</p>
      {content?.story?.setup && <p className="text-center text-sm font-black text-[#c7bddc]">{content.story.setup}</p>}

      {spectator ? (
        <div className="mx-auto w-full max-w-sm rounded-sm border-2 border-[#fff4bf]/20 bg-[#0d1829] p-4 text-center text-sm font-black text-[#c7bddc]">
          {isProtagonist ? "Hacé la acción. El grupo la confirma." : `Esperando confirmación para ${protagonistName ?? "la persona elegida"}.`}
        </div>
      ) : (
        <Button
          type="button"
          onClick={submitDone}
          disabled={sent}
          className="mx-auto h-14 w-full max-w-xs bg-[#f5d547] text-sm uppercase text-[#201507]"
        >
          <Check data-icon="inline-start" />
          {sent ? "Listo" : isProtagonist ? "Ya lo hice" : "Confirmo que lo hizo"}
        </Button>
      )}

      {sent && <p className="animate-pop text-center text-sm font-black text-emerald-300">Resultado enviado.</p>}
    </ArcadeShell>
  );
}
