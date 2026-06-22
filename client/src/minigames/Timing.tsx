import { useEffect, useRef, useState } from "react";
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
    <div className="flex flex-col items-center gap-8 p-6 max-w-md mx-auto w-full">
      <h2 className="text-2xl font-bold text-center">{content?.label ?? "Tocá en el centro"}</h2>
      <div className="relative w-full h-16 rounded-full bg-white/10 overflow-hidden border-2 border-white/20">
        {/* zona segura */}
        <div
          className="absolute top-0 h-full bg-emerald-500/40"
          style={{ left: `${centerPct - safeHalf}%`, width: `${safeHalf * 2}%` }}
        />
        {/* centro */}
        <div className="absolute top-0 h-full w-0.5 bg-emerald-300" style={{ left: "50%" }} />
        {/* aguja */}
        <div
          className="absolute top-0 h-full w-2 bg-amber-300 rounded-full shadow-[0_0_12px_3px_rgba(252,211,77,0.8)]"
          style={{ left: `calc(${pos * 100}% - 4px)` }}
        />
      </div>
      <button
        onClick={tap}
        disabled={done}
        className="rounded-full w-44 h-44 text-2xl font-black bg-amber-400 text-amber-950 active:scale-90 transition disabled:opacity-50 shadow-xl"
      >
        {done ? "✓" : "¡TOCÁ!"}
      </button>
      {done && (
        <p className="text-lg font-semibold animate-pop">
          {Math.abs(pos - 0.5) > windowFraction
            ? isBostezo
              ? "😴 Te vio la profe..."
              : "Fallaste la ventana"
            : "😎 Zafaste"}
        </p>
      )}
    </div>
  );
}
