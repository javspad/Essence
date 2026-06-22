import { useEffect, useRef, useState } from "react";
import type { MinigameProps } from "./types";

type Stage = "wait" | "ready" | "done" | "false";

export default function Reaction({ content, onFinish }: MinigameProps) {
  const [stage, setStage] = useState<Stage>("wait");
  const greenAt = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const min = content?.minDelayMs ?? 1500;
    const max = content?.maxDelayMs ?? 5000;
    const delay = min + Math.random() * (max - min);
    timer.current = setTimeout(() => {
      greenAt.current = performance.now();
      setStage("ready");
    }, delay);
    return () => clearTimeout(timer.current);
  }, [content]);

  const tap = () => {
    if (stage === "wait") {
      // salida en falso
      clearTimeout(timer.current);
      setStage("false");
      onFinish(-1_000_000, { falseStart: true });
    } else if (stage === "ready") {
      const reactionMs = performance.now() - greenAt.current;
      setStage("done");
      onFinish(1_000_000 - reactionMs, { reactionMs, falseStart: false });
    }
  };

  const bg =
    stage === "ready" ? "bg-emerald-500" : stage === "false" ? "bg-red-600" : "bg-slate-700";

  return (
    <div className="flex flex-col items-center gap-4 p-6 max-w-md mx-auto w-full">
      <h2 className="text-xl font-bold text-center">{content?.label ?? "Esperá el verde"}</h2>
      <button
        onClick={tap}
        disabled={stage === "done" || stage === "false"}
        className={`${bg} w-full h-72 rounded-3xl text-2xl font-black transition active:scale-95 flex items-center justify-center`}
      >
        {stage === "wait" && "Esperá... 🔴"}
        {stage === "ready" && "¡TOCÁ AHORA! 🟢"}
        {stage === "false" && "¡Te adelantaste! 🚫"}
        {stage === "done" && "✓ ¡Listo!"}
      </button>
      <p className="text-violet-300 text-sm text-center">
        Si tocás antes del verde, quedás último.
      </p>
    </div>
  );
}
