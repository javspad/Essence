import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/8bit/badge";
import { ArcadeShell } from "./ArcadeShell";
import { contentSeed, mulberry32 } from "./rng";
import type { MinigameProps } from "./types";

type Phase = "idle" | "run" | "won" | "lost";
type LoseReason = "wall" | "out" | "jump";

// bits de pared por celda
const N = 1;
const E = 2;
const S = 4;
const W = 8;

const WALL_T = 3; // grosor de pared en px CSS
const CURSOR_R = 2; // radio del cursor para colisiones
const HIT_R = WALL_T / 2 + CURSOR_R;
const MAX_SIZE = 440;

// vecinos: [dx, dy, pared propia, pared del vecino]
const DIRS: readonly (readonly [number, number, number, number])[] = [
  [0, -1, N, S],
  [1, 0, E, W],
  [0, 1, S, N],
  [-1, 0, W, E],
];

interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const clampInt = (v: unknown, def: number, lo: number, hi: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : def;
  return Math.max(lo, Math.min(hi, n));
};

/** laberinto perfecto por backtracker recursivo, determinístico con la seed compartida */
function buildMaze(cols: number, rows: number, seed: number) {
  const rnd = mulberry32(seed);
  const total = cols * rows;
  const walls = new Uint8Array(total).fill(N | E | S | W);
  const visited = new Uint8Array(total);
  const stack = [0];
  visited[0] = 1;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const cx = cur % cols;
    const cy = (cur - cx) / cols;
    const options: [number, number, number][] = [];
    for (const [dx, dy, w0, w1] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const n = ny * cols + nx;
      if (!visited[n]) options.push([n, w0, w1]);
    }
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [next, w0, w1] = options[Math.floor(rnd() * options.length)];
    walls[cur] &= ~w0;
    walls[next] &= ~w1;
    visited[next] = 1;
    stack.push(next);
  }
  // BFS de distancia a la salida por los pasillos, para rankear a los que pierden
  const dist = new Int32Array(total).fill(-1);
  const exit = total - 1;
  dist[exit] = 0;
  const queue = [exit];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const cx = cur % cols;
    const cy = (cur - cx) / cols;
    for (const [dx, dy, w0] of DIRS) {
      if (walls[cur] & w0) continue;
      const n = (cy + dy) * cols + (cx + dx);
      if (dist[n] === -1) {
        dist[n] = dist[cur] + 1;
        queue.push(n);
      }
    }
  }
  return { walls, dist, distStart: Math.max(1, dist[0]) };
}

/** segmentos de pared en coords de canvas (norte+oeste por celda, borde este/sur al final) */
function buildSegments(walls: Uint8Array, cols: number, rows: number, cell: number, off: number): Seg[] {
  const segs: Seg[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const w = walls[r * cols + c];
      const x = off + c * cell;
      const y = off + r * cell;
      if (w & N) segs.push({ x1: x, y1: y, x2: x + cell, y2: y });
      if (w & W) segs.push({ x1: x, y1: y, x2: x, y2: y + cell });
      if (c === cols - 1 && w & E) segs.push({ x1: x + cell, y1: y, x2: x + cell, y2: y + cell });
      if (r === rows - 1 && w & S) segs.push({ x1: x, y1: y + cell, x2: x + cell, y2: y + cell });
    }
  }
  return segs;
}

/** distancia al cuadrado entre un punto y un segmento */
function segDistSq(px: number, py: number, s: Seg): number {
  const vx = s.x2 - s.x1;
  const vy = s.y2 - s.y1;
  const lenSq = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - s.x1) * vx + (py - s.y1) * vy) / lenSq));
  const dx = px - (s.x1 + vx * t);
  const dy = py - (s.y1 + vy * t);
  return dx * dx + dy * dy;
}

export default function Maze({ content, players, onFinish }: MinigameProps) {
  const cols = clampInt(content?.cols, 13, 7, 21);
  const rows = clampInt(content?.rows, 13, 7, 21);
  const label: string = content?.label ?? "Llevá el cursor hasta la salida sin tocar las paredes";
  const seed = useMemo(() => contentSeed(content), [content]);
  const maze = useMemo(() => buildMaze(cols, rows, seed), [cols, rows, seed]);
  const total = cols * rows;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [reason, setReason] = useState<LoseReason>("wall");
  const [elapsed, setElapsed] = useState(0);
  const [resultMs, setResultMs] = useState(0);

  const phaseRef = useRef<Phase>("idle");
  const doneRef = useRef(false);
  const prevRef = useRef({ x: 0, y: 0 });
  const startRef = useRef(0);
  const bestRef = useRef(0); // mejor avance (0..1) para rankear si pierdo

  const setPhaseSafe = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const finish = (score: number, payload: unknown, outcome: "win" | "loss") => {
    if (doneRef.current) return;
    doneRef.current = true;
    onFinish(score, payload, outcome);
  };

  // geometría del tablero (celda, offset y paredes) según el ancho disponible
  const geo = useMemo(() => {
    if (!size) return null;
    const off = WALL_T / 2 + 1;
    const cell = (size - off * 2) / cols;
    const h = off * 2 + cell * rows;
    return { w: size, h, cell, off, segs: buildSegments(maze.walls, cols, rows, cell, off) };
  }, [size, maze, cols, rows]);

  useEffect(() => {
    if (!players.length) finish(0, { finished: false, progress: 0 }, "loss");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ancho responsive del canvas
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize(Math.min(MAX_SIZE, el.clientWidth));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // cronómetro visible durante la corrida
  useEffect(() => {
    if (phase !== "run") return;
    const t = setInterval(() => setElapsed(performance.now() - startRef.current), 100);
    return () => clearInterval(t);
  }, [phase]);

  // el laberinto es estático: se dibuja una sola vez por geometría
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !geo) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(geo.w * dpr);
    cv.height = Math.round(geo.h * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // pasillos
    ctx.fillStyle = "#0d1829";
    ctx.fillRect(0, 0, geo.w, geo.h);

    // celda de salida resaltada en dorado
    const ex = geo.off + (cols - 1) * geo.cell;
    const ey = geo.off + (rows - 1) * geo.cell;
    ctx.fillStyle = "rgba(245, 213, 71, 0.28)";
    ctx.fillRect(ex, ey, geo.cell, geo.cell);

    // celda de largada en verde
    ctx.fillStyle = "rgba(52, 211, 153, 0.25)";
    ctx.fillRect(geo.off, geo.off, geo.cell, geo.cell);
    ctx.fillStyle = "#34d399";
    ctx.beginPath();
    ctx.arc(geo.off + geo.cell / 2, geo.off + geo.cell / 2, geo.cell * 0.22, 0, Math.PI * 2);
    ctx.fill();

    // paredes
    ctx.strokeStyle = "#fff4bf";
    ctx.lineWidth = WALL_T;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const s of geo.segs) {
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.stroke();

    // banderita en la salida
    ctx.font = `${Math.round(geo.cell * 0.55)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🏁", ex + geo.cell / 2, ey + geo.cell / 2 + 1);
  }, [geo, cols, rows]);

  const win = () => {
    const timeMs = Math.round(performance.now() - startRef.current);
    setResultMs(timeMs);
    setPhaseSafe("won");
    finish(1_000_000 - timeMs, { finished: true, timeMs, progress: 1 }, "win");
  };

  const lose = (why: LoseReason) => {
    const progress = Math.min(1, Math.max(0, bestRef.current));
    setReason(why);
    setPhaseSafe("lost");
    finish(Math.round(progress * 1000), { finished: false, progress }, "loss");
  };

  const cellAt = (x: number, y: number) => {
    if (!geo) return -1;
    const c = Math.floor((x - geo.off) / geo.cell);
    const r = Math.floor((y - geo.off) / geo.cell);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return -1;
    return r * cols + c;
  };

  const handleMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (doneRef.current || !geo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (phaseRef.current === "idle") {
      // armar la corrida: entrar al punto verde (con margen para no morir al toque)
      const m = HIT_R + 1;
      const inStart =
        x > geo.off + m && x < geo.off + geo.cell - m && y > geo.off + m && y < geo.off + geo.cell - m;
      if (inStart) {
        prevRef.current = { x, y };
        startRef.current = performance.now();
        setElapsed(0);
        setPhaseSafe("run");
      }
      return;
    }
    if (phaseRef.current !== "run") return;

    const prev = prevRef.current;
    const dx = x - prev.x;
    const dy = y - prev.y;
    const len = Math.hypot(dx, dy);
    // anti-trampa: un salto enorme entre eventos no puede atravesar paredes
    if (len > geo.cell * 1.5) {
      lose("jump");
      return;
    }
    // interpolo el trayecto para que los movimientos rápidos legales se validen igual
    const steps = Math.max(1, Math.ceil(len / 3));
    const hitSq = HIT_R * HIT_R;
    for (let i = 1; i <= steps; i++) {
      const sx = prev.x + (dx * i) / steps;
      const sy = prev.y + (dy * i) / steps;
      for (const s of geo.segs) {
        if (segDistSq(sx, sy, s) < hitSq) {
          lose("wall");
          return;
        }
      }
      const c = cellAt(sx, sy);
      if (c >= 0) {
        const remaining = maze.dist[c];
        if (remaining >= 0) bestRef.current = Math.max(bestRef.current, 1 - remaining / maze.distStart);
        if (c === total - 1) {
          win();
          return;
        }
      }
    }
    prevRef.current = { x, y };
  };

  const handleLeave = () => {
    if (doneRef.current || phaseRef.current !== "run") return;
    lose("out");
  };

  const timeLabel =
    phase === "won" ? `${(resultMs / 1000).toFixed(1)}s` : phase === "run" ? `${(elapsed / 1000).toFixed(1)}s` : "0.0s";
  const stateLabel = phase === "idle" ? "esperando" : phase === "run" ? "¡corré!" : phase === "won" ? "¡ganaste!" : "perdiste";
  const loseText =
    reason === "wall" ? "💥 Tocaste la pared" : reason === "out" ? "🏃 Te escapaste del laberinto" : "⚡ Muy rápido: nada de teletransportarse";

  return (
    <ArcadeShell title={label} kicker="Laberinto" badge="pulso">
      <div className="grid w-full grid-cols-2 gap-3">
        <Badge className="justify-center border-[#fde68a] bg-[#f5d547] px-3 py-2 text-[10px] text-[#201507]">
          ⏱ {timeLabel}
        </Badge>
        <Badge
          className={`justify-center px-3 py-2 text-[10px] ${
            phase === "lost"
              ? "border-[#fda4af] bg-[#fb7185] text-[#2a070b]"
              : "border-[#a7f3d0] bg-[#34d399] text-[#062116]"
          }`}
        >
          {stateLabel}
        </Badge>
      </div>
      <div ref={wrapRef} className="relative mx-auto w-full max-w-[440px]">
        <canvas
          ref={canvasRef}
          onPointerMove={handleMove}
          onPointerLeave={handleLeave}
          className="block w-full cursor-crosshair touch-none select-none"
          style={geo ? { width: geo.w, height: geo.h } : undefined}
        />
        {phase === "idle" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
            <p className="animate-pop bg-[#0d1829]/85 px-3 py-2 text-center text-[11px] font-black text-[#fff8d6]">
              Llevá el cursor al punto verde para empezar
            </p>
          </div>
        )}
        {(phase === "won" || phase === "lost") && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0d1829]/80 text-center">
            <p className={`animate-pop text-xl font-black ${phase === "won" ? "text-[#34d399]" : "text-[#fb7185]"}`}>
              {phase === "won" ? `¡Saliste en ${(resultMs / 1000).toFixed(1)}s!` : loseText}
            </p>
            {phase === "lost" && (
              <p className="text-sm font-black text-[#c7bddc]">Avance: {Math.round(bestRef.current * 100)}%</p>
            )}
          </div>
        )}
      </div>
      <p className="text-center text-sm font-black text-[#c7bddc]">
        Si tocás una pared o te salís del tablero, perdés.
      </p>
    </ArcadeShell>
  );
}
