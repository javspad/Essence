import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/8bit/badge";
import { Button } from "@/components/ui/8bit/button";
import { ArcadeShell } from "./ArcadeShell";
import { mulberry32, contentSeed } from "./rng";
import { useMinigameActions, useCountdown } from "./realtime";
import type { MinigameProps } from "./types";

const TICK_MS = 110;
const GROW_EVERY = 27; // ~3s por celda extra
const START_LEN = 6;

type Cell = [number, number];
type Dir = [number, number];

interface RivalState {
  cells: Cell[];
  keys: Set<string>;
  dead: boolean;
}

type PhaseState = "countdown" | "playing" | "dead" | "won" | "timeout" | "spectator";

const key = (x: number, y: number) => `${x},${y}`;

/** Aclara un color hex mezclándolo con blanco (para la cabeza). */
function lighten(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return "#fff8d6";
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.min(255, Math.round(c + (255 - c) * amt));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `rgb(${r},${g},${b})`;
}

/** Spawn determinístico: N jugadores en círculo, dirección tangente (sin choques). */
function buildSpawn(content: unknown, playerCount: number, myIndex: number, grid: number) {
  const rng = mulberry32(contentSeed(content));
  const offset = rng() * Math.PI * 2; // mismo offset en todos los clientes
  const n = Math.max(1, playerCount);
  const angle = offset + (Math.PI * 2 * Math.max(0, myIndex)) / n;
  const cx = grid / 2;
  const cy = grid / 2;
  const r = grid * 0.35;
  const wrap = (v: number) => ((Math.round(v) % grid) + grid) % grid;
  const hx = wrap(cx + Math.cos(angle) * r);
  const hy = wrap(cy + Math.sin(angle) * r);
  // tangente del círculo, ajustada al eje dominante
  const tx = -Math.sin(angle);
  const ty = Math.cos(angle);
  const dir: Dir = Math.abs(tx) >= Math.abs(ty) ? [tx >= 0 ? 1 : -1, 0] : [0, ty >= 0 ? 1 : -1];
  const body: Cell[] = [];
  for (let i = 0; i < START_LEN; i++) {
    body.push([wrap(hx - dir[0] * i), wrap(hy - dir[1] * i)]);
  }
  return { body, dir };
}

export default function Snake({ content, players, me, onFinish, onAction, spectator }: MinigameProps) {
  const grid: number = content?.gridSize ?? 100;
  const duration: number = content?.durationMs ?? 120000;
  const label: string = content?.label ?? "Sobreviví: el último vivo gana";

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<PhaseState>(spectator ? "spectator" : "countdown");
  const [timeLeft, setTimeLeft] = useState(Math.ceil(duration / 1000));
  const [aliveCount, setAliveCount] = useState(players.length);
  const [deadIds, setDeadIds] = useState<string[]>([]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const spawn = useMemo(() => buildSpawn(content, players.length, players.findIndex((p) => p.id === me.id), grid), []);

  // estado del juego en refs (el loop no re-renderiza)
  const snakeRef = useRef<Cell[]>(spawn.body.map((c) => [c[0], c[1]] as Cell));
  const dirRef = useRef<Dir>([spawn.dir[0], spawn.dir[1]]);
  const pendingDirRef = useRef<Dir | null>(null);
  const rivalsRef = useRef<Map<string, RivalState>>(new Map());
  const tickRef = useRef(0);
  const startRef = useRef<number | null>(null);
  const deadRef = useRef(false);
  const finishedRef = useRef(false);
  const flashUntilRef = useRef(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const finish = (score: number, payload: unknown, outcome?: "win" | "loss") => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish(score, payload, outcome);
  };

  const survivedMs = () => Date.now() - (startRef.current ?? Date.now());

  const updateAlive = () => {
    let alive = deadRef.current || spectator ? 0 : 1;
    for (const p of players) {
      if (p.id === me.id) continue;
      if (rivalsRef.current.get(p.id)?.dead !== true) alive++;
    }
    setAliveCount(alive);
  };

  const checkWin = () => {
    if (finishedRef.current || deadRef.current || spectator || startRef.current === null) return;
    const others = players.filter((p) => p.id !== me.id);
    // sin rivales (playtest) no hay victoria anticipada: manda el timeout
    if (!others.length) return;
    // solo cuentan como muertos los que lo anunciaron; los mudos no confirman nada
    if (!others.every((p) => rivalsRef.current.get(p.id)?.dead === true)) return;
    const ms = survivedMs();
    finish(1_000_000 + ms, { winner: true, survivedMs: ms, length: snakeRef.current.length }, "win");
    setPhase("won");
  };

  const die = () => {
    deadRef.current = true;
    flashUntilRef.current = Date.now() + 900;
    onAction?.({ g: "snake", cells: snakeRef.current.map((c) => [c[0], c[1]]), dead: true });
    const ms = survivedMs();
    finish(ms, { winner: false, survivedMs: ms, length: snakeRef.current.length }, "loss");
    setDeadIds((d) => [...d, me.id]);
    setPhase("dead");
    updateAlive();
  };

  const steer = (dx: number, dy: number) => {
    const [cx, cy] = dirRef.current;
    if (dx === -cx && dy === -cy) return; // sin reversa de 180°
    pendingDirRef.current = [dx, dy];
  };

  // relay: cuerpos de los rivales (llega a todos, me filtro a mí mismo)
  useMinigameActions(({ playerId, data }) => {
    if (playerId === me.id) return;
    const d = data as { g?: string; cells?: unknown; dead?: unknown } | null;
    if (!d || d.g !== "snake") return;
    const cells: Cell[] = Array.isArray(d.cells)
      ? (d.cells as unknown[])
          .filter((c): c is number[] => Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number")
          .map((c) => [c[0], c[1]] as Cell)
      : [];
    const dead = d.dead === true;
    rivalsRef.current.set(playerId, { cells, keys: new Set(cells.map((c) => key(c[0], c[1]))), dead });
    if (dead) {
      setDeadIds((prev) => (prev.includes(playerId) ? prev : [...prev, playerId]));
      updateAlive();
      checkWin();
    }
  });

  const countdown = useCountdown(spectator ? 0 : 3);

  // sala vacía: reporto 0 y listo (igual que Whack)
  useEffect(() => {
    if (!players.length && !spectator) {
      finish(0, { winner: false, survivedMs: 0, length: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // teclado: flechas + WASD
  useEffect(() => {
    if (spectator) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k.startsWith("Arrow")) e.preventDefault();
      if (k === "ArrowUp" || k === "w" || k === "W") steer(0, -1);
      else if (k === "ArrowDown" || k === "s" || k === "S") steer(0, 1);
      else if (k === "ArrowLeft" || k === "a" || k === "A") steer(-1, 0);
      else if (k === "ArrowRight" || k === "d" || k === "D") steer(1, 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // dibujo (devicePixelRatio-aware); corre siempre, también de espectador
  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const size = canvas.clientWidth || 480;
      if (canvas.width !== Math.round(size * dpr)) {
        canvas.width = Math.round(size * dpr);
        canvas.height = Math.round(size * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cell = size / grid;

      ctx.fillStyle = "#0d1829";
      ctx.fillRect(0, 0, size, size);
      // grilla sutil cada 10 celdas
      ctx.strokeStyle = "rgba(255,248,214,0.05)";
      ctx.lineWidth = 1;
      for (let i = 10; i < grid; i += 10) {
        ctx.beginPath();
        ctx.moveTo(i * cell, 0);
        ctx.lineTo(i * cell, size);
        ctx.moveTo(0, i * cell);
        ctx.lineTo(size, i * cell);
        ctx.stroke();
      }

      const paintBody = (cells: Cell[], color: string, alpha: number) => {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        for (let i = cells.length - 1; i >= 1; i--) {
          ctx.fillRect(cells[i][0] * cell, cells[i][1] * cell, cell, cell);
        }
        if (cells.length) {
          ctx.fillStyle = lighten(color, 0.4);
          ctx.fillRect(cells[0][0] * cell, cells[0][1] * cell, cell, cell);
        }
        ctx.globalAlpha = 1;
      };

      // rivales vivos al 75%; los muertos dejan de dibujarse
      for (const p of players) {
        if (p.id === me.id) continue;
        const r = rivalsRef.current.get(p.id);
        if (!r || r.dead) continue;
        paintBody(r.cells, p.color, 0.75);
      }

      // mi víbora
      if (!spectator) {
        const now = Date.now();
        if (!deadRef.current) {
          paintBody(snakeRef.current, me.color, 1);
          const head = snakeRef.current[0];
          if (head && cell >= 9) {
            ctx.fillStyle = "#0d1829";
            ctx.font = `bold ${Math.floor(cell * 0.8)}px monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(me.name.charAt(0).toUpperCase(), (head[0] + 0.5) * cell, (head[1] + 0.5) * cell);
          }
        } else if (now < flashUntilRef.current) {
          paintBody(snakeRef.current, me.color, 0.25);
          const head = snakeRef.current[0];
          if (head) {
            ctx.font = `${Math.max(18, cell * 3)}px serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("💥", (head[0] + 0.5) * cell, (head[1] + 0.5) * cell);
          }
        }
      }
    };
    draw();
    const paint = setInterval(draw, TICK_MS);
    return () => clearInterval(paint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // loop de simulación: solo mi víbora, arranca al terminar la cuenta regresiva
  useEffect(() => {
    if (spectator || countdown > 0 || !players.length) return;
    startRef.current = Date.now();
    setPhase("playing");

    const wrap = (v: number) => ((v % grid) + grid) % grid;

    const step = () => {
      if (deadRef.current || finishedRef.current) return;
      tickRef.current++;
      const pending = pendingDirRef.current;
      if (pending) {
        const [cx, cy] = dirRef.current;
        if (!(pending[0] === -cx && pending[1] === -cy)) dirRef.current = pending;
        pendingDirRef.current = null;
      }
      const body = snakeRef.current;
      const head = body[0];
      const hx = wrap(head[0] + dirRef.current[0]);
      const hy = wrap(head[1] + dirRef.current[1]);
      const grows = tickRef.current % GROW_EVERY === 0;

      // choque contra mi cuerpo (la cola que se libera no cuenta si no crezco)
      const selfLimit = grows ? body.length : body.length - 1;
      for (let i = 0; i < selfLimit; i++) {
        if (body[i][0] === hx && body[i][1] === hy) {
          die();
          return;
        }
      }
      // choque contra el último cuerpo conocido de cada rival vivo
      const k = key(hx, hy);
      for (const p of players) {
        if (p.id === me.id) continue;
        const r = rivalsRef.current.get(p.id);
        if (r && !r.dead && r.keys.has(k)) {
          die();
          return;
        }
      }

      body.unshift([hx, hy]);
      if (!grows) body.pop();
      onAction?.({ g: "snake", cells: body.map((c) => [c[0], c[1]]), dead: false });
      checkWin();
    };

    const sim = setInterval(step, TICK_MS);
    const clock = setInterval(() => {
      const left = Math.max(0, Math.ceil((duration - survivedMs()) / 1000));
      setTimeLeft(left);
    }, 500);
    const cap = setTimeout(() => {
      if (finishedRef.current || deadRef.current) return;
      const length = snakeRef.current.length;
      // los que llegan vivos al final superan a cualquier muerto (score de muerto < duration)
      finish(500_000 + length * 100 + Math.round(duration / 1000), { winner: false, survivedMs: duration, length });
      setPhase("timeout");
    }, duration);

    return () => {
      clearInterval(sim);
      clearInterval(clock);
      clearTimeout(cap);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  const dpad = (dx: number, dy: number, glyph: string) => (
    <Button
      type="button"
      font="normal"
      className="h-12 w-full bg-[#0d1829] p-0 text-lg text-[#fff8d6]"
      onClick={() => steer(dx, dy)}
    >
      {glyph}
    </Button>
  );

  return (
    <ArcadeShell title="Snake" kicker="Snake" badge="supervivencia">
      <div className="grid w-full grid-cols-2 gap-3">
        <Badge className="justify-center border-[#fde68a] bg-[#f5d547] px-3 py-2 text-[10px] text-[#201507]">
          {timeLeft}s
        </Badge>
        <Badge className="justify-center border-[#a7f3d0] bg-[#34d399] px-3 py-2 text-[10px] text-[#062116]">
          Vivos {aliveCount}
        </Badge>
      </div>

      <div className="relative w-full">
        <canvas
          ref={canvasRef}
          className="aspect-square w-full touch-none rounded border-2 border-[#fff4bf]/30 bg-[#0d1829]"
        />
        {phase === "countdown" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0d1829]/80 p-4 text-center">
            <p className="text-sm text-[#c7bddc]">{label}</p>
            <p className="text-5xl font-black text-[#f5d547] animate-pop">{countdown}</p>
            <p className="text-xs text-[#c7bddc]">Usá las flechas, WASD o los botones</p>
          </div>
        )}
        {phase === "dead" && (
          <p className="absolute inset-x-0 top-2 text-center text-sm font-bold text-[#fb7185] animate-pop">
            💥 ¡Moriste! Mirás de espectador…
          </p>
        )}
        {phase === "won" && (
          <p className="absolute inset-x-0 top-2 text-center text-lg font-black text-[#f5d547] animate-pop">
            🐍 ¡Último en pie!
          </p>
        )}
        {phase === "timeout" && (
          <p className="absolute inset-x-0 top-2 text-center text-sm font-bold text-[#34d399] animate-pop">
            ⏱️ ¡Sobreviviste hasta el final!
          </p>
        )}
        {phase === "spectator" && (
          <p className="absolute inset-x-0 top-2 text-center text-xs font-bold text-[#c7bddc]">Modo espectador</p>
        )}
      </div>

      {/* leyenda: inicial + color de cada jugador */}
      <div className="flex w-full flex-wrap items-center justify-center gap-2">
        {players.map((p) => {
          const isDead = deadIds.includes(p.id);
          return (
            <span
              key={p.id}
              className={`flex items-center gap-1 rounded border border-[#fff4bf]/20 px-2 py-1 text-[10px] uppercase ${
                isDead ? "opacity-40 line-through" : ""
              }`}
              style={{ color: p.color }}
            >
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
              {p.name.slice(0, 3)}
            </span>
          );
        })}
      </div>

      {!spectator && (
        <div className="mx-auto grid w-44 grid-cols-3 gap-2">
          <div />
          {dpad(0, -1, "▲")}
          <div />
          {dpad(-1, 0, "◀")}
          {dpad(0, 1, "▼")}
          {dpad(1, 0, "▶")}
        </div>
      )}
    </ArcadeShell>
  );
}
