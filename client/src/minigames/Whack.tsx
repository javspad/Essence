import { useEffect, useRef, useState } from "react";
import type { Player } from "@essence/shared";
import type { MinigameProps } from "./types";

const HOLES = 9;

export default function Whack({ content, players, onFinish }: MinigameProps) {
  const duration: number = content?.durationMs ?? 20000;
  const pool: Player[] = players.length ? players : [];
  const [moles, setMoles] = useState<(Player | null)[]>(Array(HOLES).fill(null));
  const [targetId, setTargetId] = useState<string>(pool[0]?.id ?? "");
  const [hits, setHits] = useState(0);
  const [timeLeft, setTimeLeft] = useState(Math.ceil(duration / 1000));
  const [over, setOver] = useState(false);
  const hitsRef = useRef(0);

  useEffect(() => {
    if (!pool.length) {
      onFinish(0, { hits: 0 });
      return;
    }
    const rnd = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

    const spawn = setInterval(() => {
      setMoles(() => {
        const next: (Player | null)[] = Array(HOLES).fill(null);
        const count = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
          const h = Math.floor(Math.random() * HOLES);
          next[h] = rnd(pool);
        }
        return next;
      });
    }, 850);

    const targetSwap = setInterval(() => setTargetId(rnd(pool).id), 2600);

    const tick = setInterval(() => setTimeLeft((t) => Math.max(0, t - 1)), 1000);

    const end = setTimeout(() => {
      clearInterval(spawn);
      clearInterval(targetSwap);
      clearInterval(tick);
      setOver(true);
      onFinish(hitsRef.current, { hits: hitsRef.current });
    }, duration);

    return () => {
      clearInterval(spawn);
      clearInterval(targetSwap);
      clearInterval(tick);
      clearTimeout(end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const target = pool.find((p) => p.id === targetId);

  const whack = (i: number) => {
    if (over) return;
    const mole = moles[i];
    if (!mole) return;
    setMoles((m) => {
      const n = [...m];
      n[i] = null;
      return n;
    });
    if (mole.id === targetId) {
      hitsRef.current += 1;
      setHits(hitsRef.current);
    } else {
      hitsRef.current = Math.max(0, hitsRef.current - 1);
      setHits(hitsRef.current);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 p-6 max-w-md mx-auto w-full">
      <div className="flex justify-between w-full text-sm font-semibold">
        <span className="text-emerald-300">Aciertos: {hits}</span>
        <span className="text-amber-300">⏱ {timeLeft}s</span>
      </div>
      <h2 className="text-xl font-bold text-center">
        ¡Golpeá a <span style={{ color: target?.color }}>{target?.name}</span>!
      </h2>
      <div className="grid grid-cols-3 gap-3 w-full">
        {moles.map((mole, i) => (
          <button
            key={i}
            onClick={() => whack(i)}
            className="aspect-square rounded-2xl bg-white/5 border-2 border-white/10 flex items-center justify-center text-2xl font-black active:scale-90 transition overflow-hidden"
          >
            {mole && (
              <span
                className="w-full h-full flex items-center justify-center animate-pop rounded-2xl"
                style={{ background: mole.color + "55" }}
              >
                {mole.name.slice(0, 3)}
              </span>
            )}
          </button>
        ))}
      </div>
      {over && <p className="text-lg font-bold animate-pop">¡{hits} aciertos!</p>}
    </div>
  );
}
