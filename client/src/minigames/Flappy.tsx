import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/8bit/badge";
import { ArcadeShell } from "./ArcadeShell";
import type { MinigameProps } from "./types";
import { mulberry32, contentSeed } from "./rng";
import { useMinigameActions, useCountdown } from "./realtime";

// Mundo lógico (el canvas escala responsivo manteniendo esta relación)
const W = 420;
const H = 480;
const FLOOR_H = 36;
const FLOOR_Y = H - FLOOR_H;

// Física
const GRAVITY = 1400; // px/s²
const FLAP_VY = -400; // impulso de aleteo
const SPEED = 150; // scroll del mundo px/s
const BIRD_X = 110; // x fija en pantalla
const BIRD_R = 14;

// Caños
const PIPE_SPACING = 230;
const PIPE_W = 56;
const FIRST_PIPE = 400; // distancia mundial del primer caño
const MAX_PIPES = 256; // de sobra para el cap de duración

const RETRO_FONT = '"Press Start 2P", system-ui, sans-serif';

interface Ghost {
  name: string;
  initial: string;
  color: string;
  d: number;
  y: number;
  pipes: number;
  dead: boolean;
  diedAt: number; // performance.now() de la muerte (para el ✕ breve)
  lastSeen: number;
  renderD: number; // interpolados para dibujar suave
  renderY: number;
}

interface FlappyPacket {
  g?: string;
  d?: number;
  y?: number;
  dead?: boolean;
  pipes?: number;
}

type Phase = "countdown" | "play" | "spectate";

export default function Flappy({ content, players, me, onFinish, onAction, spectator }: MinigameProps) {
  const gap: number = content?.gapPx ?? 155;
  const maxDurationMs: number = content?.maxDurationMs ?? 90000;
  const label: string = content?.label ?? "Tocá o apretá ESPACIO para volar";

  const [phase, setPhase] = useState<Phase>(spectator ? "spectate" : "countdown");
  const [pipesHud, setPipesHud] = useState(0);
  const [aliveHud, setAliveHud] = useState(players.length);
  const [watching, setWatching] = useState<string | null>(null);
  const countdown = useCountdown(3);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const finishedRef = useRef(!!spectator); // spectator = resultado ya enviado antes de reconectar
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const countdownRef = useRef(countdown);
  countdownRef.current = countdown;
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const playersRef = useRef(players);
  playersRef.current = players;

  // Estado mutable del run (nunca useState adentro del rAF)
  const stateRef = useRef({ y: H / 2 - 40, vy: 0, d: 0, pipes: 0, dead: !!spectator, diedAt: 0 });
  const ghostsRef = useRef(new Map<string, Ghost>());
  const cameraRef = useRef(0); // cámara en modo espectador

  // Caños compartidos: misma seed del server → mismo recorrido en todos los clientes
  const gapCentersRef = useRef<number[]>([]);
  if (!gapCentersRef.current.length) {
    const rng = mulberry32(contentSeed(content));
    const minC = gap / 2 + 34;
    const maxC = FLOOR_Y - gap / 2 - 26;
    gapCentersRef.current = Array.from({ length: MAX_PIPES }, () => minC + rng() * (maxC - minC));
  }

  // countdown terminado → arranca la física
  useEffect(() => {
    if (countdown === 0 && phase === "countdown") setPhase("play");
  }, [countdown, phase]);

  // Relay: posiciones de los rivales (me llegan también las mías — filtrar)
  useMinigameActions(({ playerId, data }) => {
    if (playerId === me.id) return;
    const a = data as FlappyPacket | null;
    if (!a || a.g !== "flappy") return;
    const now = performance.now();
    let g = ghostsRef.current.get(playerId);
    if (!g) {
      const p = playersRef.current.find((pl) => pl.id === playerId);
      if (!p) return;
      g = {
        name: p.name,
        initial: p.name.slice(0, 1).toUpperCase(),
        color: p.color,
        d: a.d ?? 0,
        y: a.y ?? H / 2,
        pipes: a.pipes ?? 0,
        dead: false,
        diedAt: 0,
        lastSeen: now,
        renderD: a.d ?? 0,
        renderY: a.y ?? H / 2,
      };
      ghostsRef.current.set(playerId, g);
    }
    if (typeof a.d === "number") g.d = a.d;
    if (typeof a.y === "number") g.y = a.y;
    if (typeof a.pipes === "number") g.pipes = a.pipes;
    g.lastSeen = now;
    if (a.dead && !g.dead) {
      g.dead = true;
      g.diedAt = now;
    }
  });

  // Aleteo: techo clampa, así que solo empuja para arriba
  const flap = () => {
    const s = stateRef.current;
    if (phaseRef.current !== "play" || countdownRef.current > 0 || s.dead) return;
    s.vy = FLAP_VY;
  };

  useEffect(() => {
    if (!players.length) {
      if (!finishedRef.current) {
        finishedRef.current = true;
        onFinishRef.current(0, { pipes: 0, distance: 0 });
      }
      return;
    }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const s = stateRef.current;
    const gaps = gapCentersRef.current;
    let raf = 0;
    let last = performance.now();
    let startMs: number | null = null;
    let lastSend = 0;
    let hudPipes = -1;
    let hudAlive = -1;
    let hudWatching: string | null | undefined;
    let meAlive = !spectator;
    if (spectator) cameraRef.current = 0;

    const send = (dead: boolean) => {
      onActionRef.current?.({ g: "flappy", d: Math.round(s.d), y: Math.round(s.y), dead, pipes: s.pipes });
    };

    // Muerte o cap: reporto UNA vez y paso a espectador
    const endRun = (now: number, outcome?: "win") => {
      if (s.dead) return;
      s.dead = true;
      s.diedAt = now;
      meAlive = false;
      send(true); // evento terminal, sin throttle
      if (!finishedRef.current) {
        finishedRef.current = true;
        onFinishRef.current(s.pipes * 100_000 + Math.round(s.d), { pipes: s.pipes, distance: Math.round(s.d) }, outcome);
      }
      cameraRef.current = s.d;
      setPhase("spectate");
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault(); // Space scrollea la página
        flap();
      }
    };
    window.addEventListener("keydown", onKey);

    const pipeCenterX = (i: number) => FIRST_PIPE + i * PIPE_SPACING;

    const drawBird = (x: number, y: number, color: string, initial: string, alpha: number) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, BIRD_R, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#fff8d6";
      ctx.stroke();
      ctx.font = `bold 11px ${RETRO_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#0d1829";
      ctx.fillText(initial, x, y + 1);
      ctx.restore();
    };

    const drawCross = (x: number, y: number, alpha: number) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = "#fb7185";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 9);
      ctx.lineTo(x + 9, y + 9);
      ctx.moveTo(x + 9, y - 9);
      ctx.lineTo(x - 9, y + 9);
      ctx.stroke();
      ctx.restore();
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.035, (now - last) / 1000);
      last = now;

      // Canvas nítido: backing store en píxeles reales según DPR y ancho actual
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.clientWidth || W;
      const bw = Math.round(cw * dpr);
      const bh = Math.round(cw * (H / W) * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      const scale = bw / W;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);

      const playing = phaseRef.current === "play" && countdownRef.current === 0 && !s.dead;

      // --- física propia ---
      if (playing) {
        if (startMs === null) startMs = now;
        s.vy += GRAVITY * dt;
        s.y += s.vy * dt;
        s.d += SPEED * dt;
        // techo clampa sin muerte
        if (s.y < BIRD_R) {
          s.y = BIRD_R;
          s.vy = Math.max(0, s.vy);
        }
        const birdWX = s.d + BIRD_X;
        s.pipes = Math.max(0, Math.floor((birdWX - BIRD_R - PIPE_W / 2 - FIRST_PIPE) / PIPE_SPACING) + 1);
        // piso = muerte
        if (s.y + BIRD_R >= FLOOR_Y) {
          s.y = FLOOR_Y - BIRD_R;
          endRun(now);
        }
        // choque con caño
        if (!s.dead) {
          const i = Math.round((birdWX - FIRST_PIPE) / PIPE_SPACING);
          if (i >= 0 && i < MAX_PIPES && Math.abs(birdWX - pipeCenterX(i)) < PIPE_W / 2 + BIRD_R) {
            const c = gaps[i];
            if (s.y - BIRD_R < c - gap / 2 || s.y + BIRD_R > c + gap / 2) endRun(now);
          }
        }
        // cap de seguridad: sobreviviste todo → ganás con lo acumulado
        if (!s.dead && startMs !== null && now - startMs >= maxDurationMs) endRun(now, "win");
        // broadcast throttled (~100ms) mientras sigo vivo
        if (!s.dead && now - lastSend >= 100) {
          lastSend = now;
          send(false);
        }
      }

      // --- fantasmas: interpolar hacia el último paquete (extrapolando a los vivos) ---
      let leader: Ghost | null = null;
      const blend = 1 - Math.exp(-8 * dt);
      for (const g of ghostsRef.current.values()) {
        const targetD = g.dead ? g.d : g.d + (SPEED * (now - g.lastSeen)) / 1000;
        g.renderD += (targetD - g.renderD) * blend;
        g.renderY += (g.y - g.renderY) * blend;
        if (!g.dead && (!leader || g.renderD > leader.renderD)) leader = g;
      }

      // --- cámara: la mía jugando, o la del puntero vivo espectando ---
      let camD: number;
      if (phaseRef.current === "spectate") {
        if (leader) cameraRef.current += (leader.renderD - cameraRef.current) * (1 - Math.exp(-5 * dt));
        camD = cameraRef.current;
      } else {
        camD = s.d;
      }

      // --- dibujo ---
      ctx.fillStyle = "#0d1829";
      ctx.fillRect(0, 0, W, H);

      // caños visibles
      const firstIdx = Math.max(0, Math.floor((camD - FIRST_PIPE - PIPE_W) / PIPE_SPACING));
      for (let i = firstIdx; i < Math.min(firstIdx + 5, MAX_PIPES); i++) {
        const px = pipeCenterX(i) - camD;
        if (px < -PIPE_W) continue;
        if (px > W + PIPE_W) break;
        const c = gaps[i];
        const top = c - gap / 2;
        const bottom = c + gap / 2;
        ctx.fillStyle = "#34d399";
        ctx.fillRect(px - PIPE_W / 2, 0, PIPE_W, top);
        ctx.fillRect(px - PIPE_W / 2, bottom, PIPE_W, FLOOR_Y - bottom);
        // labios del caño
        ctx.fillRect(px - PIPE_W / 2 - 5, top - 14, PIPE_W + 10, 14);
        ctx.fillRect(px - PIPE_W / 2 - 5, bottom, PIPE_W + 10, 14);
        // borde iluminado
        ctx.fillStyle = "#a7f3d0";
        ctx.fillRect(px - PIPE_W / 2 + 4, 0, 5, top - 14);
        ctx.fillRect(px - PIPE_W / 2 + 4, bottom + 14, 5, FLOOR_Y - bottom - 14);
      }

      // piso
      ctx.fillStyle = "#0a1322";
      ctx.fillRect(0, FLOOR_Y, W, FLOOR_H);
      ctx.fillStyle = "#f5d547";
      ctx.fillRect(0, FLOOR_Y, W, 3);
      for (let x = -((camD % 40) + 40); x < W; x += 40) {
        ctx.fillRect(x, FLOOR_Y + 14, 18, 4);
      }

      // fantasmas (✕ breve al morir, después desaparecen)
      for (const g of ghostsRef.current.values()) {
        const gx = BIRD_X + (g.renderD - camD);
        if (gx < -BIRD_R * 2 || gx > W + BIRD_R * 2) continue;
        if (g.dead) {
          if (now - g.diedAt < 900) drawCross(gx, g.renderY, 0.7);
          continue;
        }
        drawBird(gx, g.renderY, g.color, g.initial, 0.45);
      }

      // mi pájaro
      if (meAlive || (s.diedAt && now - s.diedAt < 900)) {
        const mx = BIRD_X + (s.d - camD);
        if (s.dead) drawCross(mx, s.y, 0.9);
        else drawBird(mx, s.y + (playing ? 0 : Math.sin(now / 260) * 5), me.color, me.name.slice(0, 1).toUpperCase(), 1);
      }

      // número de la cuenta regresiva
      if (phaseRef.current === "countdown" && countdownRef.current > 0) {
        ctx.font = `bold 56px ${RETRO_FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#f5d547";
        ctx.fillText(String(countdownRef.current), W / 2, H / 2 - 40);
      }

      // --- HUD (setState solo si cambia) ---
      if (s.pipes !== hudPipes) {
        hudPipes = s.pipes;
        setPipesHud(s.pipes);
      }
      let alive = meAlive ? 1 : 0;
      for (const p of playersRef.current) {
        if (p.id === me.id) continue;
        const g = ghostsRef.current.get(p.id);
        if (!g || !g.dead) alive += 1;
      }
      if (alive !== hudAlive) {
        hudAlive = alive;
        setAliveHud(alive);
      }
      const watchName = phaseRef.current === "spectate" ? (leader?.name ?? null) : null;
      if (watchName !== hudWatching) {
        hudWatching = watchName;
        setWatching(watchName);
      }
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ArcadeShell title="¡A volar!" kicker="Flappy" badge="vuelo">
      <div className="flex w-full items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="retro text-3xl font-black text-[#f5d547]">{pipesHud}</span>
          <span className="retro text-[9px] uppercase text-[#c7bddc]">caños</span>
        </div>
        <Badge className="border-[#fde68a] bg-[#f5d547] px-3 py-2 text-[10px] text-[#201507]">
          Vivos {aliveHud}
        </Badge>
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          e.preventDefault();
          flap();
        }}
        className="w-full cursor-pointer select-none border-2 border-[#fff4bf] bg-[#0d1829]"
        style={{ aspectRatio: "420 / 480", touchAction: "none" }}
      />
      {phase === "countdown" && (
        <p className="text-center text-sm font-bold text-[#fff8d6]">{label}</p>
      )}
      {phase === "spectate" && (
        <p className="text-center text-sm font-bold text-[#c7bddc] animate-pop">
          {watching ? (
            <>
              👀 Mirando a <span className="text-[#fff8d6]">{watching}</span>
            </>
          ) : (
            "Esperando al resto..."
          )}
        </p>
      )}
    </ArcadeShell>
  );
}
