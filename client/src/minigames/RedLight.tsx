import { useEffect, useRef, useState } from "react";
import type { Player } from "@essence/shared";
import { Badge } from "@/components/ui/8bit/badge";
import { Button } from "@/components/ui/8bit/button";
import { Progress } from "@/components/ui/8bit/progress";
import { ArcadeShell } from "./ArcadeShell";
import { mulberry32, contentSeed } from "./rng";
import { useCountdown, useMinigameActions } from "./realtime";
import type { MinigameProps } from "./types";

/** gracia tras verde→roja: el jitter de red/reloj no te mata */
const GRACE_MS = 250;
/** throttle de broadcasts de progreso */
const SEND_EVERY_MS = 150;

interface RedLightAction {
  g: "redlight";
  p: number; // pasos
  dead: boolean;
  done: boolean;
}

interface LaneState {
  steps: number;
  dead: boolean;
  done: boolean;
}

interface LightSegment {
  green: boolean;
  start: number;
  end: number;
}

/** Semáforo determinístico desde la seed: mismos tramos en todos los clientes. */
function makeSchedule(seed: number): (elapsed: number) => LightSegment {
  const rng = mulberry32(seed);
  const segs: LightSegment[] = [];
  let t = 0;
  let green = true; // arranca en verde
  const extend = () => {
    const dur = green ? 1500 + rng() * 2000 : 1200 + rng() * 1600;
    segs.push({ green, start: t, end: t + dur });
    t += dur;
    green = !green;
  };
  return (elapsed) => {
    while (!segs.length || segs[segs.length - 1].end <= elapsed) extend();
    return segs.find((s) => elapsed >= s.start && elapsed < s.end)!;
  };
}

type Mode = "countdown" | "play" | "dead" | "done" | "timeout" | "spectate";

export default function RedLight({ content, players, me, onFinish, onAction, spectator }: MinigameProps) {
  const trackLength: number = content?.trackLength ?? 45;
  const duration: number = content?.durationMs ?? 60000;

  const [mode, setMode] = useState<Mode>(spectator ? "spectate" : "countdown");
  const [green, setGreen] = useState(true);
  const [mySteps, setMySteps] = useState(0);
  const [timeLeft, setTimeLeft] = useState(Math.ceil(duration / 1000));
  const [rivals, setRivals] = useState<Record<string, LaneState>>({});

  const modeRef = useRef<Mode>(mode);
  const stepsRef = useRef(0);
  const startRef = useRef(0); // reloj de carrera (performance.now al GO)
  const sentRef = useRef(!!spectator); // onFinish EXACTAMENTE una vez
  const lastSentRef = useRef(0);
  const phaseRef = useRef<(elapsed: number) => LightSegment>(null!);
  if (!phaseRef.current) phaseRef.current = makeSchedule(contentSeed(content));

  const countdown = useCountdown(3);

  const setModeNow = (m: Mode) => {
    modeRef.current = m;
    setMode(m);
  };

  const finishOnce = (score: number, payload: unknown, outcome?: "win" | "loss") => {
    if (sentRef.current) return;
    sentRef.current = true;
    onFinish(score, payload, outcome);
  };

  /** un intento de paso: verde suma, roja (pasada la gracia) elimina */
  const press = () => {
    if (modeRef.current !== "play" || !startRef.current) return;
    const elapsed = performance.now() - startRef.current;
    const seg = phaseRef.current(elapsed);
    if (seg.green) {
      stepsRef.current += 1;
      setMySteps(stepsRef.current);
      if (stepsRef.current >= trackLength) {
        const timeMs = Math.round(elapsed);
        setModeNow("done");
        finishOnce(1_000_000 - timeMs, { finished: true, eliminated: false, timeMs, progress: 1 }, "win");
        const msg: RedLightAction = { g: "redlight", p: stepsRef.current, dead: false, done: true };
        onAction?.(msg);
        return;
      }
      const now = performance.now();
      if (now - lastSentRef.current >= SEND_EVERY_MS) {
        lastSentRef.current = now;
        const msg: RedLightAction = { g: "redlight", p: stepsRef.current, dead: false, done: false };
        onAction?.(msg);
      }
    } else if (elapsed - seg.start > GRACE_MS) {
      // te vieron moverte en roja
      setModeNow("dead");
      finishOnce(
        -1_000_000 + Math.round((stepsRef.current / trackLength) * 1000),
        { eliminated: true, finished: false, progress: stepsRef.current / trackLength },
        "loss",
      );
      const msg: RedLightAction = { g: "redlight", p: stepsRef.current, dead: true, done: false };
      onAction?.(msg);
    }
    // dentro de la gracia: se ignora el toque
  };
  const pressRef = useRef(press);
  pressRef.current = press;

  // sin jugadores conectados: mismo trato que Whack
  useEffect(() => {
    if (!players.length && !spectator) {
      finishOnce(0, { finished: false, eliminated: false, progress: 0 });
      setModeNow("spectate");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // teclado: ESPACIO (sin repeat)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      e.preventDefault();
      if (e.repeat) return;
      pressRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // GO: arranca el reloj y el rAF que camina el cronograma del semáforo
  useEffect(() => {
    if (countdown > 0) return;
    if (modeRef.current === "countdown") setModeNow("play");
    if (!startRef.current) startRef.current = performance.now();
    let raf = 0;
    const loop = () => {
      const elapsed = performance.now() - startRef.current;
      setGreen(phaseRef.current(elapsed).green);
      setTimeLeft(Math.max(0, Math.ceil((duration - elapsed) / 1000)));
      if (elapsed >= duration && modeRef.current === "play") {
        // se acabó el tiempo sin llegar ni caer
        setModeNow("timeout");
        finishOnce(Math.round((stepsRef.current / trackLength) * 1000), {
          finished: false,
          eliminated: false,
          progress: stepsRef.current / trackLength,
        });
        const msg: RedLightAction = { g: "redlight", p: stepsRef.current, dead: false, done: false };
        onAction?.(msg);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  // rivales en vivo por el relay de la sala
  useMinigameActions(({ playerId, data }) => {
    if (playerId === me.id) return;
    const a = data as Partial<RedLightAction> | null | undefined;
    if (!a || a.g !== "redlight") return;
    setRivals((prev) => ({
      ...prev,
      [playerId]: {
        steps: typeof a.p === "number" ? a.p : prev[playerId]?.steps ?? 0,
        dead: !!a.dead,
        done: !!a.done,
      },
    }));
  });

  const laneFor = (p: Player): LaneState =>
    p.id === me.id
      ? { steps: mySteps, dead: mode === "dead", done: mode === "done" }
      : rivals[p.id] ?? { steps: 0, dead: false, done: false };

  const status =
    mode === "dead"
      ? "🚨 ¡Te vieron moverte!"
      : mode === "done"
        ? "🏁 ¡Llegaste!"
        : mode === "timeout"
          ? "⏰ Se acabó el tiempo"
          : mode === "spectate"
            ? "👀 Mirando la carrera"
            : null;

  const myPct = Math.min(100, (mySteps / trackLength) * 100);

  return (
    <ArcadeShell title="¡Corré, pero frená en roja!" kicker="Luz roja, luz verde" badge="muñeca">
      <div className="grid w-full grid-cols-2 gap-3">
        <Badge className="justify-center border-[#a7f3d0] bg-[#34d399] px-3 py-2 text-[10px] text-[#062116]">
          Pasos {mySteps}/{trackLength}
        </Badge>
        <Badge className="justify-center border-[#fde68a] bg-[#f5d547] px-3 py-2 text-[10px] text-[#201507]">
          {countdown > 0 ? "listos..." : `${timeLeft}s`}
        </Badge>
      </div>

      {/* semáforo gigante */}
      <div className="flex w-full flex-col items-center gap-2">
        <div
          className={`flex h-32 w-32 items-center justify-center rounded-full border-4 transition-colors duration-100 sm:h-36 sm:w-36 ${
            countdown > 0
              ? "border-[#c7bddc] bg-[#0d1829]"
              : green
                ? "border-[#a7f3d0] bg-[#34d399] shadow-[0_0_60px_rgba(52,211,153,0.65)]"
                : "border-[#fecdd3] bg-[#fb7185] shadow-[0_0_60px_rgba(251,113,133,0.65)]"
          }`}
        >
          <span
            className={`retro font-black uppercase ${
              countdown > 0 ? "animate-pop text-3xl text-[#fff8d6]" : "text-lg text-[#0d1829]"
            }`}
          >
            {countdown > 0 ? countdown : green ? "VERDE" : "ROJA"}
          </span>
        </div>
        {countdown > 0 ? (
          <p className="text-center text-sm font-black text-[#c7bddc]">
            {content?.label ?? "Avanzá con ESPACIO, solo en verde"}
          </p>
        ) : (
          status && <p className="animate-pop text-center text-lg font-black text-[#fff8d6]">{status}</p>
        )}
      </div>

      {/* carriles en vivo, uno por jugador */}
      <div className="flex w-full flex-col gap-2">
        {players.map((p) => {
          const lane = laneFor(p);
          const mine = p.id === me.id;
          const pct = Math.min(1, lane.steps / trackLength);
          return (
            <div
              key={p.id}
              className={`relative h-9 w-full overflow-hidden border-2 bg-[#0d1829] ${
                mine ? "border-[#f5d547]" : "border-[#3a2f4d]"
              }`}
            >
              <span className="absolute left-1 top-0 text-[8px] font-black uppercase tracking-wide text-[#c7bddc]/70">
                {p.name}
              </span>
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-base">🏁</span>
              <span
                className="absolute top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-xs font-black text-[#0d1829] transition-[left] duration-150"
                style={{ left: `${pct * 86}%`, background: lane.dead ? "#fb7185" : p.color }}
              >
                {lane.dead ? "🚨" : lane.done ? "🏁" : p.name.charAt(0).toUpperCase()}
              </span>
            </div>
          );
        })}
      </div>

      <Progress className="h-4 w-full" value={myPct} variant="retro" progressBg="bg-[#f5d547]" />

      {/* botón grande para touch */}
      <Button
        type="button"
        font="normal"
        disabled={mode !== "play"}
        onPointerDown={(e) => {
          e.preventDefault();
          pressRef.current();
        }}
        className={`h-24 w-full text-xl font-black normal-case ${
          mode === "play" && green ? "bg-[#34d399] text-[#062116]" : "bg-[#0d1829] text-[#fff8d6]"
        }`}
      >
        {mode === "play" ? (green ? "¡AVANZÁ!" : "¡FRENÁ!") : countdown > 0 ? "PREPARATE..." : "MIRANDO 👀"}
      </Button>
      <p className="text-center text-xs font-black text-[#c7bddc]">
        Apretá ESPACIO o el botón, solo en verde. En roja, ni te muevas.
      </p>
    </ArcadeShell>
  );
}
