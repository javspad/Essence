import { lazy, Suspense, useState } from "react";
import type { GameState, Tile, TileLayout, TileType } from "@essence/shared";
import { supportsWebGL } from "../board3d";
import { cameraFocus, movementPath, perimeterLayout, screenPosition } from "../boardView";

const Board3DShell = lazy(() => import("./Board3DShell"));

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
  const [canLoad3D] = useState(() => supportsWebGL());
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
        {canLoad3D ? (
          <Suspense fallback={<Board3DLoadFallback />}>
            <Board3DShell
              tiles={state.board}
              routes={state.routes}
              artifacts={state.artifacts}
              assetCatalog={state.assetCatalog}
              players={state.players}
              activeId={activeId}
              lastRoll={state.lastRoll}
              boardLength={state.boardLength}
            />
          </Suspense>
        ) : (
          <Board3DLoadFallback />
        )}
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
          const playersHere = here.map((player) => player.name).join(", ");
          const isActive = tile.id === activePosition;
          const isPath = movementTileIds.has(tile.id);
          const pos = screenPosition(layout, maxX, maxY);
          const rot = layout.rot ?? 0;

          return (
            <div
              key={tile.id}
              role="group"
              aria-label={`Casillero ${tile.id}${tile.label ? `, ${tile.label}` : ""}, ${tile.type}${
                playersHere ? `, jugadores: ${playersHere}` : ""
              }${isActive && activePlayer ? `, turno de ${activePlayer.name}` : ""}`}
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

                {playersHere && <span className="sr-only">Jugadores en este casillero: {playersHere}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Board3DLoadFallback() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[1.5rem] bg-slate-950/70">
      <div className="absolute left-1/2 top-1/2 h-[78%] w-[88%] -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-amber-300/25 bg-teal-700/20 shadow-inner" />
      <div className="absolute left-1/2 top-1/2 h-[52%] w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-cyan-200/5" />
      <div className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rotate-12 rounded-[1.5rem] bg-yellow-300/20" />
    </div>
  );
}
