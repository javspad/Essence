import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/8bit/badge";
import { Button } from "@/components/ui/8bit/button";
import { Progress } from "@/components/ui/8bit/progress";
import { ArcadeShell } from "./ArcadeShell";
import type { MinigameProps } from "./types";

/**
 * "Todos contra uno": tap-race rápido. El perseguido y el resto tocan lo más
 * rápido posible; el que más toca, gana. Score = toques (más alto = mejor).
 */
export default function TapDuel({ content, me, onFinish }: MinigameProps) {
  const duration: number = content?.durationMs ?? 5000;
  const protagonistId: string | undefined = content?.protagonistId;
  const protagonistName: string = content?.protagonistName ?? "el perseguido";
  const amProtagonist = me.id === protagonistId;

  const [taps, setTaps] = useState(0);
  const [timeLeft, setTimeLeft] = useState(Math.ceil(duration / 1000));
  const [over, setOver] = useState(false);
  const tapsRef = useRef(0);

  useEffect(() => {
    const tick = setInterval(() => setTimeLeft((t) => Math.max(0, t - 1)), 1000);
    const end = setTimeout(() => {
      clearInterval(tick);
      setOver(true);
      onFinish(tapsRef.current, { taps: tapsRef.current });
    }, duration);
    return () => {
      clearInterval(tick);
      clearTimeout(end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tap = () => {
    if (over) return;
    tapsRef.current += 1;
    setTaps(tapsRef.current);
  };

  const totalSecs = Math.max(1, Math.ceil(duration / 1000));
  const timePercent = Math.max(0, Math.min(100, (timeLeft / totalSecs) * 100));

  return (
    <ArcadeShell
      title={
        amProtagonist ? (
          <>
            ¡Ganales a <span style={{ color: me.color }}>todos</span>!
          </>
        ) : (
          <>¡No dejes ganar a {protagonistName}!</>
        )
      }
      kicker="Todos contra uno"
      badge={amProtagonist ? "sobreviví" : "hundilo"}
    >
      <p className="text-center text-sm font-black text-[#c7bddc]">
        {amProtagonist
          ? "Tocás más que todos = volvés a tirar. Si perdés, retrocedés 1 casillero."
          : `Tocá lo más rápido posible para que ${protagonistName} pierda.`}
      </p>
      <div className="grid w-full grid-cols-2 gap-3">
        <Badge className="justify-center border-[#a7f3d0] bg-[#34d399] px-3 py-2 text-[10px] text-[#062116]">
          Toques {taps}
        </Badge>
        <Badge className="justify-center border-[#fde68a] bg-[#f5d547] px-3 py-2 text-[10px] text-[#201507]">
          {timeLeft}s
        </Badge>
      </div>
      <Progress className="h-4 w-full" value={timePercent} variant="retro" progressBg="bg-[#f5d547]" />
      <Button
        type="button"
        font="normal"
        onClick={tap}
        disabled={over}
        className="mx-auto flex aspect-square h-auto w-full max-w-[240px] items-center justify-center bg-[#0d1829] p-0 text-3xl font-black text-[#fff8d6] active:scale-95"
      >
        {over ? "¡Listo!" : "¡TOCÁ!"}
      </Button>
      {over && <p className="text-center text-lg font-bold animate-pop">¡{taps} toques!</p>}
    </ArcadeShell>
  );
}
