import { useEffect, useRef, useState } from "react";
import { Hand } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { ArcadeShell } from "./ArcadeShell";
import type { MinigameProps } from "./types";

const PERIOD_MS = 1600; // ida y vuelta de la aguja

export default function Timing({ content, onFinish }: MinigameProps) {
  const [pos, setPos] = useState(0); // 0..1 posición de la aguja
  const [done, setDone] = useState(false);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(performance.now());

  useEffect(() => {
    const loop = () => {
      const t = (performance.now() - startRef.current) % PERIOD_MS;
      // triangular 0->1->0
      const phase = t / PERIOD_MS;
      const p = phase < 0.5 ? phase * 2 : 2 - phase * 2;
      setPos(p);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const isBostezo = content?.label?.toString().toLowerCase().includes("profe") || true;
  const windowMs: number = content?.windowMs ?? 350;
  const windowFraction = Math.min(0.49, windowMs / PERIOD_MS);

  const tap = () => {
    if (done) return;
    setDone(true);
    cancelAnimationFrame(rafRef.current);
    const distance = Math.abs(pos - 0.5); // 0 = centro perfecto
    const lost = distance > windowFraction;
    const offsetMs = Math.round(distance * PERIOD_MS);
    // score más alto = más cerca del centro
    onFinish(1 - distance * 2, { offsetMs, lost, pos });
  };

  const centerPct = 50;
  const safeHalf = windowFraction * 100;

  return (
    <ArcadeShell title={content?.label ?? "Tocá en el centro"} kicker="Precisión" badge="centro">
      <div className="relative h-16 w-full overflow-hidden border-4 border-[#fff4bf] bg-[#0d1829]">
        {/* zona segura */}
        <div
          className="absolute top-0 h-full bg-[#34d399]/45"
          style={{ left: `${centerPct - safeHalf}%`, width: `${safeHalf * 2}%` }}
        />
        {/* centro */}
        <div className="absolute top-0 h-full w-1 bg-[#a7f3d0]" style={{ left: "50%" }} />
        {/* aguja */}
        <div
          className="absolute top-0 h-full w-3 bg-[#f5d547] shadow-[0_0_12px_3px_rgba(245,213,71,0.65)]"
          style={{ left: `calc(${pos * 100}% - 4px)` }}
        />
      </div>
      <Button
        type="button"
        onClick={tap}
        disabled={done}
        className="mx-auto h-24 w-full max-w-xs bg-[#f5d547] text-xl uppercase text-[#201507] disabled:opacity-50"
      >
        {!done && <Hand data-icon="inline-start" />}
        {done ? "✓" : "¡TOCÁ!"}
      </Button>
      {done && (
        <p className="animate-pop text-center text-lg font-black">
          {Math.abs(pos - 0.5) > windowFraction
            ? isBostezo
              ? "😴 Te vio la profe..."
              : "Fallaste la ventana"
            : "😎 Zafaste"}
        </p>
      )}
    </ArcadeShell>
  );
}
