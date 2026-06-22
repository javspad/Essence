import { useState } from "react";
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
    <div className="flex flex-col items-center gap-6 p-6 max-w-md mx-auto w-full">
      <h2 className="text-2xl font-bold text-center">{content?.question}</h2>
      <p className="text-violet-300 text-sm">El más cercano gana 🎯</p>
      <div className="flex items-center gap-2 w-full">
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={sent}
          placeholder="0"
          className="flex-1 rounded-2xl bg-white/10 border-2 border-white/20 focus:border-white/60 outline-none p-4 text-2xl text-center disabled:opacity-50"
        />
        {content?.unit && <span className="text-xl text-violet-300">{content.unit}</span>}
      </div>
      <button
        onClick={submit}
        disabled={sent || value.trim() === ""}
        className="rounded-2xl py-4 px-8 font-bold text-lg bg-sky-500 active:scale-95 transition disabled:opacity-40 w-full"
      >
        {sent ? "Enviado ✓" : "Apostar"}
      </button>
    </div>
  );
}
