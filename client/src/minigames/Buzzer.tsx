import { useRef, useState } from "react";
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
    <div className="flex flex-col items-center gap-6 p-6 max-w-md mx-auto w-full">
      <h2 className="text-2xl font-bold text-center">{content.question}</h2>
      <p className="text-violet-300 text-sm">¡El primero que acierta gana! ⚡</p>
      <div className="flex flex-col gap-3 w-full">
        {content.options.map((opt: string, i: number) => (
          <button
            key={i}
            onClick={() => pick(i)}
            disabled={answered}
            className="rounded-2xl py-6 px-4 font-bold text-xl bg-white/10 border-2 border-white/20 hover:border-white/60 active:scale-95 transition disabled:opacity-40"
          >
            {opt}
          </button>
        ))}
      </div>
      {answered && <p className="text-emerald-300 font-semibold animate-pop">¡Respuesta enviada!</p>}
    </div>
  );
}
