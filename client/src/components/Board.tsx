import { useEffect, useRef } from "react";
import { cameraFocus, movementPath, perimeterLayout, screenPosition, tableBaseBounds, tableCanvasPoints } from "../boardView";
import type { TableCanvasPoint } from "../boardView";
import type { GameState, Tile, TileLayout, TileType } from "@essence/shared";

const TILE_ICON: Record<TileType, string> = {
  start: "🏁",
  finish: "🏆",
  minigame: "🎮",
  trivia: "❓",
  vote: "🗳️",
  judge: "🧑‍⚖️",
  dare: "🍻",
  fate: "🃏",
  groom: "🤵",
  star: "⭐",
  reaction: "⚡",
  estimate: "🎯",
};

const TILE_COLOR: Record<TileType, string> = {
  start: "from-slate-400/50 to-slate-700/60",
  finish: "from-amber-300/70 to-orange-600/70",
  minigame: "from-indigo-300/50 to-indigo-700/60",
  trivia: "from-sky-300/50 to-sky-700/60",
  vote: "from-violet-300/50 to-violet-700/60",
  judge: "from-pink-300/50 to-pink-700/60",
  dare: "from-rose-300/50 to-rose-800/60",
  fate: "from-fuchsia-300/50 to-fuchsia-800/60",
  groom: "from-amber-200/60 to-yellow-700/70",
  star: "from-yellow-200/70 to-yellow-600/70",
  reaction: "from-lime-300/60 to-emerald-700/60",
  estimate: "from-cyan-300/60 to-blue-700/60",
};

interface BoardSlot {
  tile: Tile;
  layout: TileLayout;
}

export default function Board({ state }: { state: GameState }) {
  const activeId = state.turnOrder[state.activeIndex];
  const activePlayer = state.players.find((p) => p.id === activeId);
  const activePosition = activePlayer?.position ?? -1;
  const slots: BoardSlot[] = state.board.map((tile, index) => ({
    tile,
    layout: tile.layout ?? perimeterLayout(index, state.board.length),
  }));
  const maxX = Math.max(1, ...slots.map((slot) => slot.layout.x));
  const maxY = Math.max(1, ...slots.map((slot) => slot.layout.y));
  const activeSlot = slots.find((slot) => slot.tile.id === activePosition);
  const activePoint = activeSlot ? screenPosition(activeSlot.layout, maxX, maxY) : { left: 50, top: 50 };
  const camera = cameraFocus(activePoint);
  const movementTileIds = new Set(movementPath(activePosition, state.lastRoll, state.boardLength));
  const canvasPoints = tableCanvasPoints(
    slots.map(({ tile, layout }) => ({ id: tile.id, layout })),
    maxX,
    maxY
  );
  const boardStatus = activePlayer
    ? state.lastRoll
      ? `${activePlayer.name} sacó ${state.lastRoll} y avanzó al casillero ${activePosition}.`
      : `El tablero está centrado en ${activePlayer.name}, casillero ${activePosition}.`
    : "Tablero de juego.";

  return (
    <section aria-label="Tablero de juego" className="relative w-full overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/35 p-3 shadow-2xl">
      <p className="sr-only" aria-live="polite">{boardStatus}</p>
      <div
        className="relative isolate mx-auto aspect-[4/3] w-full max-w-[32rem] transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{ transform: `translate(${camera.x}%, ${camera.y}%) scale(${camera.scale})` }}
      >
        <BoardBackdropCanvas points={canvasPoints} activeId={activePosition} pathIds={movementTileIds} />
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 text-center">
          <p className="text-[10px] uppercase tracking-[0.35em] text-white/30">tablero</p>
          {activePlayer && (
            <p className="mt-1 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs font-bold text-white/80">
              Turno de <span style={{ color: activePlayer.color }}>{activePlayer.name}</span>
            </p>
          )}
        </div>

        {slots.map(({ tile, layout }) => {
          const here = state.players.filter((p) => p.position === tile.id);
          const visible = here.slice(0, 3);
          const hidden = here.length - visible.length;
          const isActive = tile.id === activePosition;
          const isPath = movementTileIds.has(tile.id);
          const pos = screenPosition(layout, maxX, maxY);
          const rot = layout.rot ?? 0;

          return (
            <div
              key={tile.id}
              role="group"
              aria-label={`Casillero ${tile.id}${tile.label ? `, ${tile.label}` : ""}, ${tile.type}${
                isActive && activePlayer ? `, turno de ${activePlayer.name}` : ""
              }`}
              className={`absolute h-12 w-12 rounded-2xl border bg-gradient-to-br ${TILE_COLOR[tile.type]} text-xs shadow-lg transition duration-300 motion-reduce:transition-none sm:h-14 sm:w-14 ${
                isActive
                  ? "border-white ring-2 ring-amber-300 shadow-amber-300/30"
                  : isPath
                    ? "border-amber-200/50 shadow-amber-200/20"
                    : "border-white/15"
              }`}
              style={{
                left: `${pos.left}%`,
                top: `${pos.top}%`,
                zIndex: Math.round(pos.top * 10),
                transform: `translate(-50%, -50%) rotate(${rot}deg)`,
              }}
            >
              <div className="relative flex h-full w-full flex-col items-center justify-center" style={{ transform: `rotate(${-rot}deg)` }}>
                {isActive && (
                  <span className="absolute -top-2 rounded-full bg-amber-300 px-1.5 py-0.5 text-[8px] font-black text-amber-950 shadow">
                    TURNO
                  </span>
                )}
                {isPath && !isActive && <span aria-hidden="true" className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-200 shadow shadow-amber-200/50" />}
                <span className="absolute left-1 top-1 text-[9px] font-bold text-white/45">{tile.id}</span>
                <span className="text-lg drop-shadow sm:text-xl" aria-hidden="true">
                  {TILE_ICON[tile.type]}
                </span>
                {tile.label && <span className="mt-0.5 max-w-10 truncate text-[8px] text-white/70">{tile.label}</span>}

                {here.length > 0 && (
                  <div className="absolute -bottom-2 left-1/2 flex -translate-x-1/2 items-center">
                    {visible.map((p, index) => (
                      <span
                        key={p.id}
                        title={p.name}
                        aria-label={`${p.name}${p.id === activeId ? ", jugador activo" : ""}`}
                        className={`flex h-5 w-5 items-center justify-center rounded-full border border-white/70 text-[9px] font-black text-white shadow transition-transform duration-300 motion-reduce:transition-none ${
                          p.id === activeId ? "-translate-y-1 scale-110 ring-2 ring-white" : ""
                        } ${state.lastRoll && p.id === activeId ? "animate-pop" : ""} ${p.connected ? "" : "opacity-40"}`}
                        style={{ background: p.color, marginLeft: index ? -4 : 0 }}
                      >
                        {p.name.slice(0, 1)}
                      </span>
                    ))}
                    {hidden > 0 && (
                      <span className="ml-0.5 rounded-full border border-white/30 bg-black/70 px-1 text-[9px] font-bold text-white">
                        +{hidden}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BoardBackdropCanvas({
  points,
  activeId,
  pathIds,
}: {
  points: TableCanvasPoint[];
  activeId: number;
  pathIds: Set<number>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pathKey = Array.from(pathIds).join(",");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => paintBoardBackdrop(canvas, points, activeId, pathIds);
    draw();

    if (!("ResizeObserver" in window)) {
      window.addEventListener("resize", draw);
      return () => window.removeEventListener("resize", draw);
    }

    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [activeId, pathKey, pathIds, points]);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 h-full w-full" />;
}

function paintBoardBackdrop(canvas: HTMLCanvasElement, points: TableCanvasPoint[], activeId: number, pathIds: Set<number>) {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.floor(width * dpr);
  const pixelHeight = Math.floor(height * dpr);

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const bounds = tableBaseBounds(points, 12);
  const x = (pct: number) => (pct / 100) * width;
  const y = (pct: number) => (pct / 100) * height;
  const centerX = x((bounds.left + bounds.right) / 2);
  const centerY = y((bounds.top + bounds.bottom) / 2) + height * 0.04;
  const baseWidth = x(bounds.width) * 0.72;
  const baseHeight = y(bounds.height) * 0.58;

  const tableGradient = ctx.createRadialGradient(centerX, centerY, Math.max(12, baseWidth * 0.08), centerX, centerY, Math.max(baseWidth, baseHeight));
  tableGradient.addColorStop(0, "rgba(80, 200, 160, 0.32)");
  tableGradient.addColorStop(0.58, "rgba(67, 56, 202, 0.36)");
  tableGradient.addColorStop(1, "rgba(15, 23, 42, 0.92)");

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 16;
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, baseWidth, baseHeight, 0, 0, Math.PI * 2);
  ctx.fillStyle = tableGradient;
  ctx.fill();
  ctx.restore();

  if (points.length > 1) {
    const slabGradient = ctx.createLinearGradient(0, y(bounds.top), width, y(bounds.bottom));
    slabGradient.addColorStop(0, "rgba(45, 212, 191, 0.18)");
    slabGradient.addColorStop(0.45, "rgba(99, 102, 241, 0.16)");
    slabGradient.addColorStop(1, "rgba(15, 23, 42, 0.42)");

    drawPointPath(ctx, points, width, height);
    ctx.fillStyle = slabGradient;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    ctx.stroke();

    drawPointPath(ctx, points, width, height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 18;
    ctx.strokeStyle = "rgba(2, 6, 23, 0.48)";
    ctx.stroke();

    drawPointPath(ctx, points, width, height);
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.stroke();
  }

  for (const point of points) {
    const px = x(point.left);
    const py = y(point.top);
    const isPath = pathIds.has(point.id);
    const isActive = point.id === activeId;

    if (isActive) {
      const glow = ctx.createRadialGradient(px, py, 4, px, py, 44);
      glow.addColorStop(0, "rgba(253, 224, 71, 0.42)");
      glow.addColorStop(1, "rgba(253, 224, 71, 0)");
      ctx.beginPath();
      ctx.arc(px, py, 44, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.ellipse(px, py + 15, 27, 10, 0, 0, Math.PI * 2);
    ctx.fillStyle = isPath ? "rgba(251, 191, 36, 0.34)" : "rgba(2, 6, 23, 0.48)";
    ctx.fill();

    if (isActive) {
      ctx.beginPath();
      ctx.arc(px, py, 30, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(253, 224, 71, 0.78)";
      ctx.stroke();
    }
  }
}

function drawPointPath(ctx: CanvasRenderingContext2D, points: TableCanvasPoint[], width: number, height: number) {
  ctx.beginPath();
  points.forEach((point, index) => {
    const px = (point.left / 100) * width;
    const py = (point.top / 100) * height;
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
}
