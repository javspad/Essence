import { useEffect, useRef, useState } from "react";
import type { Player } from "@essence/shared";
import { Badge } from "@/components/ui/8bit/badge";
import { Button } from "@/components/ui/8bit/button";
import { Progress } from "@/components/ui/8bit/progress";
import { ArcadeShell } from "./ArcadeShell";
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
  const timePercent = Math.max(0, Math.min(100, (timeLeft / Math.ceil(duration / 1000)) * 100));

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
    <ArcadeShell
      title={<>¡Golpeá a <span style={{ color: target?.color }}>{target?.name}</span>!</>}
      kicker="Whack"
      badge="reflejos"
    >
      <div className="grid w-full grid-cols-2 gap-3">
        <Badge className="justify-center border-[#a7f3d0] bg-[#34d399] px-3 py-2 text-[10px] text-[#062116]">
          Aciertos {hits}
        </Badge>
        <Badge className="justify-center border-[#fde68a] bg-[#f5d547] px-3 py-2 text-[10px] text-[#201507]">
          {timeLeft}s
        </Badge>
      </div>
      <Progress className="h-4 w-full" value={timePercent} variant="retro" progressBg="bg-[#f5d547]" />
      <div className="grid w-full grid-cols-3 gap-3">
        {moles.map((mole, i) => (
          <Button
            type="button"
            font="normal"
            key={i}
            onClick={() => whack(i)}
            className="flex aspect-square h-auto w-full items-center justify-center overflow-hidden bg-[#0d1829] p-0 text-2xl font-black"
          >
            {mole && (
              <span
                className="flex h-full w-full animate-pop items-center justify-center"
                style={{ background: mole.color + "55" }}
              >
                {mole.name.slice(0, 3)}
              </span>
            )}
          </Button>
        ))}
      </div>
      {over && <p className="text-lg font-bold animate-pop">¡{hits} aciertos!</p>}
    </ArcadeShell>
  );
}
