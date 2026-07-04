import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/8bit/badge";
import { Button } from "@/components/ui/8bit/button";
import { Progress } from "@/components/ui/8bit/progress";
import { ArcadeShell } from "./ArcadeShell";
import { mulberry32, contentSeed } from "./rng";
import { useMinigameActions, useCountdown } from "./realtime";
import type { MinigameProps } from "./types";

type Dir = "up" | "down" | "left" | "right";
type Mode = "countdown" | "race" | "watch";

const DIRS: Dir[] = ["up", "down", "left", "right"];
const ARROW: Record<Dir, string> = { up: "⬆️", down: "⬇️", left: "⬅️", right: "➡️" };
const KEY_TO_DIR: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const SHAKE_CSS = `
@keyframes hr-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-8px); }
  40% { transform: translateX(8px); }
  60% { transform: translateX(-6px); }
  80% { transform: translateX(6px); }
}
.hr-shake { animation: hr-shake 0.35s ease; }
`;

interface Segment {
  end: number;
  dir: Dir;
}

export default function HorseRace({ content, players, me, onFinish, onAction, spectator }: MinigameProps) {
  const trackLength: number = content?.trackLength ?? 40;
  const duration: number = content?.durationMs ?? 45000;
  const label: string = content?.label ?? "Apretá la flecha indicada lo más rápido posible";

  const [mode, setMode] = useState<Mode>(spectator ? "watch" : "countdown");
  const [endMsg, setEndMsg] = useState(spectator ? "👀 Ya jugaste. Mirando la carrera..." : "");
  const [steps, setSteps] = useState(0);
  const [target, setTarget] = useState<Dir>("up");
  const [targetKey, setTargetKey] = useState(0);
  const [wrong, setWrong] = useState(false);
  const [timeLeft, setTimeLeft] = useState(Math.ceil(duration / 1000));
  const [rivals, setRivals] = useState<Record<string, { p: number; done: boolean }>>({});

  const stepsRef = useRef(0);
  const finishedRef = useRef(false); // garantiza onFinish exactamente una vez
  const startRef = useRef(0); // performance.now() en el GO
  const targetRef = useRef<Dir>("up");
  const wrongTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSentAt = useRef(0);
  const lastSentSteps = useRef(-1);

  // cronograma de flechas determinístico: misma semilla → misma carrera en todos
  const rngRef = useRef(mulberry32(contentSeed(content)));
  const scheduleRef = useRef<Segment[]>([]);

  const targetAt = (elapsed: number): Dir => {
    const sched = scheduleRef.current;
    const rng = rngRef.current;
    // extender perezosamente: segmentos de 1800–3200ms, nunca repite la anterior
    while (!sched.length || sched[sched.length - 1].end <= elapsed) {
      const prev = sched.length ? sched[sched.length - 1].dir : null;
      const opts = DIRS.filter((d) => d !== prev);
      const dir = opts[Math.floor(rng() * opts.length)];
      const start = sched.length ? sched[sched.length - 1].end : 0;
      sched.push({ end: start + 1800 + rng() * 1400, dir });
    }
    for (const seg of sched) if (elapsed < seg.end) return seg.dir;
    return sched[sched.length - 1].dir;
  };

  // sin jugadores: cerrar como Whack
  useEffect(() => {
    if (!players.length && !spectator && !finishedRef.current) {
      finishedRef.current = true;
      onFinish(0, { finished: false, progress: 0 });
    }
    return () => clearTimeout(wrongTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // rivales en vivo por el relay de la sala
  useMinigameActions(({ playerId, data }) => {
    if (playerId === me.id) return;
    const d = data as { g?: string; p?: number; done?: boolean } | null;
    if (!d || d.g !== "horserace") return;
    setRivals((r) => ({ ...r, [playerId]: { p: typeof d.p === "number" ? d.p : 0, done: !!d.done } }));
  });

  const sendProgress = (force = false, done = false) => {
    if (!onAction) return;
    const now = performance.now();
    if (!force && (now - lastSentAt.current < 150 || lastSentSteps.current === stepsRef.current)) return;
    lastSentAt.current = now;
    lastSentSteps.current = stepsRef.current;
    onAction({ g: "horserace", p: stepsRef.current, done });
  };

  const press = (dir: Dir) => {
    if (finishedRef.current) return;
    if (dir === targetRef.current) {
      stepsRef.current += 1;
      setSteps(stepsRef.current);
      if (stepsRef.current >= trackLength) {
        finishedRef.current = true;
        const elapsedMs = Math.round(performance.now() - startRef.current);
        onFinish(1_000_000 - elapsedMs, { finished: true, timeMs: elapsedMs, progress: 1 }, "win");
        sendProgress(true, true);
        setMode("watch");
        setEndMsg("🏁 ¡Llegaste! Mirando el final...");
        return;
      }
    } else {
      stepsRef.current = Math.max(0, stepsRef.current - 1);
      setSteps(stepsRef.current);
      setWrong(true);
      clearTimeout(wrongTimer.current);
      wrongTimer.current = setTimeout(() => setWrong(false), 420);
    }
    sendProgress();
  };

  // largada: 3..2..1 y GO
  const countdown = useCountdown(3);
  useEffect(() => {
    if (spectator || !players.length || mode !== "countdown" || countdown > 0) return;
    startRef.current = performance.now();
    const first = targetAt(0);
    targetRef.current = first;
    setTarget(first);
    setMode("race");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, mode, spectator, players.length]);

  // reloj de carrera: flecha objetivo, tiempo restante, flush de progreso y timeout
  useEffect(() => {
    if (mode !== "race") return;

    const onKey = (e: KeyboardEvent) => {
      const dir = KEY_TO_DIR[e.key];
      if (!dir) return;
      e.preventDefault(); // que no scrollee la página
      if (e.repeat) return;
      press(dir);
    };
    window.addEventListener("keydown", onKey);

    const iv = setInterval(() => {
      const elapsed = performance.now() - startRef.current;
      const dir = targetAt(elapsed);
      if (dir !== targetRef.current) {
        targetRef.current = dir;
        setTarget(dir);
        setTargetKey((k) => k + 1);
      }
      setTimeLeft(Math.max(0, Math.ceil((duration - elapsed) / 1000)));
      sendProgress();
      if (elapsed >= duration && !finishedRef.current) {
        finishedRef.current = true;
        onFinish(Math.round((stepsRef.current / trackLength) * 1000), {
          finished: false,
          progress: stepsRef.current / trackLength,
        });
        sendProgress(true, false);
        setMode("watch");
        setEndMsg("⏱ ¡Se acabó el tiempo!");
      }
    }, 100);

    return () => {
      window.removeEventListener("keydown", onKey);
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const timePercent = Math.max(0, Math.min(100, (timeLeft / Math.ceil(duration / 1000)) * 100));

  const lanes = (
    <div className="flex w-full flex-col gap-2">
      {players.map((pl) => {
        const mine = pl.id === me.id;
        const info = mine ? { p: steps, done: finishedRef.current && steps >= trackLength } : rivals[pl.id];
        const pct = info?.done ? 1 : Math.min(1, (info?.p ?? 0) / trackLength);
        return (
          <div key={pl.id} className="flex w-full items-center gap-2">
            <span className="w-14 shrink-0 truncate text-right text-[10px] font-black" style={{ color: pl.color }}>
              {pl.name}
            </span>
            <div
              className={`relative h-8 flex-1 overflow-hidden border-2 ${
                mine ? "border-[#f5d547] bg-[#12203a]" : "border-[#2a3a55] bg-[#0d1829]"
              }`}
            >
              <span className="absolute right-1 top-1/2 -translate-y-1/2 text-sm">🏁</span>
              <span
                className="absolute top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-xs font-black text-[#0d1829] transition-[left] duration-150"
                style={{ left: `calc(${pct} * (100% - 32px) + 2px)`, background: pl.color }}
              >
                {info?.done ? "🏆" : pl.name.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <ArcadeShell title="🐎 Carrera de caballos" kicker="Carrera" badge="hipódromo">
      <style>{SHAKE_CSS}</style>

      {mode === "countdown" && (
        <div className="flex flex-col items-center gap-4">
          <p className="text-center text-sm font-black text-[#c7bddc]">{label}</p>
          <p key={countdown} className="animate-pop text-7xl font-black text-[#f5d547]">
            {countdown > 0 ? countdown : "¡YA!"}
          </p>
        </div>
      )}

      {mode === "race" && (
        <>
          <div className="grid w-full grid-cols-2 gap-3">
            <Badge className="justify-center border-[#a7f3d0] bg-[#34d399] px-3 py-2 text-[10px] text-[#062116]">
              Pasos {steps}/{trackLength}
            </Badge>
            <Badge className="justify-center border-[#fde68a] bg-[#f5d547] px-3 py-2 text-[10px] text-[#201507]">
              {timeLeft}s
            </Badge>
          </div>
          <Progress className="h-4 w-full" value={timePercent} variant="retro" progressBg="bg-[#f5d547]" />

          <div
            key={`${targetKey}-${wrong ? "w" : "k"}`}
            className={`${wrong ? "hr-shake" : "animate-pop"} text-center text-7xl leading-none sm:text-8xl`}
          >
            {ARROW[target]}
          </div>
          <p className={`h-5 text-center text-sm font-black ${wrong ? "text-[#fb7185]" : "text-[#c7bddc]"}`}>
            {wrong ? "¡Flecha equivocada! -1" : "Apretá la flecha 🐎"}
          </p>

          {/* d-pad táctil, misma lógica que el teclado */}
          <div className="mx-auto grid w-full max-w-[220px] grid-cols-3 gap-2">
            <div />
            <Button
              type="button"
              font="normal"
              className="aspect-square h-auto w-full bg-[#0d1829] p-0 text-2xl"
              onPointerDown={(e) => {
                e.preventDefault();
                press("up");
              }}
            >
              ⬆️
            </Button>
            <div />
            <Button
              type="button"
              font="normal"
              className="aspect-square h-auto w-full bg-[#0d1829] p-0 text-2xl"
              onPointerDown={(e) => {
                e.preventDefault();
                press("left");
              }}
            >
              ⬅️
            </Button>
            <div />
            <Button
              type="button"
              font="normal"
              className="aspect-square h-auto w-full bg-[#0d1829] p-0 text-2xl"
              onPointerDown={(e) => {
                e.preventDefault();
                press("right");
              }}
            >
              ➡️
            </Button>
            <div />
            <Button
              type="button"
              font="normal"
              className="aspect-square h-auto w-full bg-[#0d1829] p-0 text-2xl"
              onPointerDown={(e) => {
                e.preventDefault();
                press("down");
              }}
            >
              ⬇️
            </Button>
            <div />
          </div>
        </>
      )}

      {mode === "watch" && <p className="animate-pop text-center text-lg font-bold">{endMsg}</p>}

      {mode !== "countdown" && lanes}
    </ArcadeShell>
  );
}
