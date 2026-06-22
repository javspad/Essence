import type { GameState, TileType } from "@essence/shared";

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
};

const TILE_COLOR: Record<TileType, string> = {
  start: "bg-slate-600/40",
  finish: "bg-amber-500/40",
  minigame: "bg-indigo-500/30",
  trivia: "bg-sky-500/30",
  vote: "bg-violet-500/30",
  judge: "bg-pink-500/30",
  dare: "bg-rose-600/30",
  fate: "bg-fuchsia-500/30",
  groom: "bg-amber-400/30",
  star: "bg-yellow-400/40",
};

export default function Board({ state }: { state: GameState }) {
  const activeId = state.turnOrder[state.activeIndex];

  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 w-full">
      {state.board.map((tile) => {
        const here = state.players.filter((p) => p.position === tile.id);
        return (
          <div
            key={tile.id}
            className={`relative aspect-square rounded-xl ${TILE_COLOR[tile.type]} border ${
              tile.id === activeIdPosition(state, activeId) ? "border-white/60" : "border-white/10"
            } flex flex-col items-center justify-center text-xs`}
          >
            <span className="absolute top-1 left-1 text-[10px] text-white/40">{tile.id}</span>
            <span className="text-lg">{TILE_ICON[tile.type]}</span>
            <div className="absolute bottom-0.5 flex flex-wrap justify-center gap-0.5 max-w-full px-0.5">
              {here.map((p) => (
                <span
                  key={p.id}
                  title={p.name}
                  className={`w-4 h-4 rounded-full text-[8px] flex items-center justify-center font-bold border ${
                    p.id === activeId ? "ring-2 ring-white" : ""
                  } ${p.connected ? "" : "opacity-40"}`}
                  style={{ background: p.color, borderColor: "#fff6" }}
                >
                  {p.name.slice(0, 1)}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function activeIdPosition(state: GameState, activeId: string | undefined): number {
  return state.players.find((p) => p.id === activeId)?.position ?? -1;
}
