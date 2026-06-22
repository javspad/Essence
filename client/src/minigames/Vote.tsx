import { useState } from "react";
import type { MinigameProps } from "./types";

export default function Vote({ content, players, onFinish }: MinigameProps) {
  const [picked, setPicked] = useState<string | null>(null);

  const choose = (id: string) => {
    if (picked) return;
    setPicked(id);
    onFinish(0, { votedFor: id });
  };

  return (
    <div className="flex flex-col items-center gap-6 p-6 max-w-md mx-auto w-full">
      <h2 className="text-2xl font-bold text-center">{content.question}</h2>
      <p className="text-violet-300 text-sm">Votá en secreto 🤫</p>
      <div className="grid grid-cols-2 gap-3 w-full">
        {players.map((p) => (
          <button
            key={p.id}
            onClick={() => choose(p.id)}
            disabled={!!picked}
            className={`rounded-2xl py-5 px-3 font-bold text-lg transition active:scale-95 border-2 ${
              picked === p.id
                ? "border-white scale-105"
                : picked
                  ? "border-transparent opacity-40"
                  : "border-white/20 hover:border-white/60"
            }`}
            style={{ background: p.color + "33" }}
          >
            {p.name}
          </button>
        ))}
      </div>
      {picked && <p className="text-emerald-300 font-semibold animate-pop">¡Voto registrado!</p>}
    </div>
  );
}
