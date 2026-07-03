import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { ArcadeShell } from "./ArcadeShell";
import type { MinigameProps } from "./types";

export default function Prompt({ content, me, onFinish }: MinigameProps) {
  const title = content?.title ?? content?.label ?? "Evento";
  const prompt = content?.prompt ?? content?.story?.prompt ?? "Completá la acción.";
  const [sent, setSent] = useState(false);

  const submitDone = () => {
    if (sent) return;
    setSent(true);
    onFinish(1, { confirmed: true, playerId: me.id });
  };

  return (
    <ArcadeShell title={title} kicker="Evento" badge="ok">
      <p className="text-center text-base font-black leading-7 text-[#fff8d6]">{prompt}</p>
      {content?.story?.setup && <p className="text-center text-sm font-black text-[#c7bddc]">{content.story.setup}</p>}

      <Button
        type="button"
        onClick={submitDone}
        disabled={sent}
        className="mx-auto h-14 w-full max-w-xs bg-[#f5d547] text-sm uppercase text-[#201507]"
      >
        <Check data-icon="inline-start" />
        {sent ? "Listo" : "Ya lo hice"}
      </Button>

      {sent && <p className="animate-pop text-center text-sm font-black text-emerald-300">Resultado enviado.</p>}
    </ArcadeShell>
  );
}
