import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { ArcadeShell } from "./ArcadeShell";
import type { MinigameProps } from "./types";

export default function SelfTap({ content, me, onFinish }: MinigameProps) {
  const title = content?.title ?? content?.label ?? "Acción rápida";
  const prompt = content?.prompt ?? content?.story?.prompt ?? "Completá la acción y tocá cuando termines.";
  const startRef = useRef(performance.now());
  const [sent, setSent] = useState(false);

  const submitDone = () => {
    if (sent) return;
    setSent(true);
    const timeMs = performance.now() - startRef.current;
    onFinish(1_000_000 - timeMs, { confirmed: true, playerId: me.id, timeMs });
  };

  return (
    <ArcadeShell title={title} kicker="Acción" badge="tap">
      <p className="text-center text-base font-black leading-7 text-[#fff8d6]">{prompt}</p>
      {content?.story?.setup && <p className="text-center text-sm font-black text-[#c7bddc]">{content.story.setup}</p>}
      <Button
        type="button"
        onClick={submitDone}
        disabled={sent}
        className="mx-auto h-14 w-full max-w-xs bg-[#f5d547] text-sm uppercase text-[#201507]"
      >
        <Check data-icon="inline-start" />
        {sent ? "Listo" : "Ya terminé"}
      </Button>
      {sent && <p className="animate-pop text-center text-sm font-black text-emerald-300">Resultado enviado.</p>}
    </ArcadeShell>
  );
}
