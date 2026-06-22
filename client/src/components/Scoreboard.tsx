import type { GameState } from "@essence/shared";

export default function Scoreboard({ state, activeId }: { state: GameState; activeId?: string }) {
  const sorted = [...state.players].sort((a, b) => b.stars - a.stars || b.coins - a.coins);
  return (
    <div className="flex flex-wrap gap-2 justify-center w-full">
      {sorted.map((p) => (
        <div
          key={p.id}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm border ${
            p.id === activeId ? "border-white bg-white/15" : "border-white/10 bg-white/5"
          } ${p.connected ? "" : "opacity-40"}`}
        >
          <span className="w-3 h-3 rounded-full" style={{ background: p.color }} />
          <span className="font-semibold">{p.name}</span>
          {p.groom && <span>🤵</span>}
          <span className="text-amber-300 font-bold">🪙{p.coins}</span>
          {p.stars > 0 && <span className="text-yellow-300 font-bold">⭐{p.stars}</span>}
        </div>
      ))}
    </div>
  );
}
