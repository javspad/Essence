import { useRef, useState } from "react";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { ArcadeShell } from "./ArcadeShell";
import type { MinigameProps } from "./types";

export default function Buzzer({ content, onFinish, onAction }: MinigameProps) {
  const startRef = useRef<number>(performance.now());
  const [answered, setAnswered] = useState(false);

  const pick = (i: number) => {
    if (answered) return;
    setAnswered(true);
    const timeMs = performance.now() - startRef.current;
    const correct = i === content.answer;
    onAction?.({ buzzed: true });
    // Convención: score más alto = mejor. Correcto y rápido gana.
    const score = correct ? 1_000_000 - timeMs : -timeMs;
    onFinish(score, { answerIndex: i, timeMs, correct });
  };

  return (
    <ArcadeShell title={content.question} kicker="Buzzer" badge="rápido">
      <p className="text-center text-sm font-black text-[#c7bddc]">¡El primero que acierta gana!</p>
      <div className="flex w-full flex-col gap-4">
        {content.options.map((opt: string, i: number) => (
          <Button
            type="button"
            font="normal"
            key={i}
            onClick={() => pick(i)}
            disabled={answered}
            className="min-h-16 w-full bg-[#0d1829] px-4 text-base normal-case text-[#fff8d6] hover:bg-[#12253f]"
          >
            <Zap data-icon="inline-start" />
            {opt}
          </Button>
        ))}
      </div>
      {answered && <p className="text-emerald-300 font-semibold animate-pop">¡Respuesta enviada!</p>}
    </ArcadeShell>
  );
}
