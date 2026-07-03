import { useEffect, useRef, useState } from "react";
import { Hand } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { ArcadeShell } from "./ArcadeShell";
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

  const bg = stage === "ready" ? "bg-[#34d399] text-[#062116]" : stage === "false" ? "bg-[#fb7185] text-[#2a070b]" : "bg-[#0d1829] text-[#fff8d6]";

  return (
    <ArcadeShell title={content?.label ?? "Esperá el verde"} kicker="Reacción" badge="timing">
      <Button
        type="button"
        onClick={tap}
        disabled={stage === "done" || stage === "false"}
        className={`${bg} flex h-72 w-full items-center justify-center px-4 text-2xl font-black normal-case`}
      >
        {stage !== "wait" && <Hand data-icon="inline-start" />}
        {stage === "wait" && "Esperá... 🔴"}
        {stage === "ready" && "¡TOCÁ AHORA! 🟢"}
        {stage === "false" && "¡Te adelantaste! 🚫"}
        {stage === "done" && "✓ ¡Listo!"}
      </Button>
      <p className="text-center text-sm font-black text-[#c7bddc]">
        Si tocás antes del verde, quedás último.
      </p>
    </ArcadeShell>
  );
}
