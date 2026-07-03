import { useState } from "react";
import { Target } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { Input } from "@/components/ui/8bit/input";
import { ArcadeShell } from "./ArcadeShell";
import type { MinigameProps } from "./types";

export default function Estimate({ content, onFinish }: MinigameProps) {
  const [value, setValue] = useState("");
  const [sent, setSent] = useState(false);

  const submit = () => {
    if (sent || value.trim() === "") return;
    setSent(true);
    const guess = Number(value);
    const answer = Number(content?.answer ?? 0);
    // El más cercano gana: score más alto = menor diferencia.
    const score = -Math.abs(guess - answer);
    onFinish(score, { guess });
  };

  return (
    <ArcadeShell title={content?.question} kicker="Estimación" badge="cerca">
      <p className="text-center text-sm font-black text-[#c7bddc]">El más cercano gana.</p>
      <div className="flex w-full items-center gap-3">
        <Input
          font="normal"
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={sent}
          placeholder="0"
          className="h-16 flex-1 bg-[#0d1829] text-center text-2xl font-black text-[#fff8d6] disabled:opacity-50"
        />
        {content?.unit && <span className="text-xl font-black text-[#c7bddc]">{content.unit}</span>}
      </div>
      <Button
        type="button"
        onClick={submit}
        disabled={sent || value.trim() === ""}
        className="h-12 w-full bg-[#38bdf8] text-sm uppercase text-[#061926]"
      >
        <Target data-icon="inline-start" />
        {sent ? "Enviado ✓" : "Apostar"}
      </Button>
    </ArcadeShell>
  );
}
