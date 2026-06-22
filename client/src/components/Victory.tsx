import type { GameState } from "@essence/shared";

export default function Victory({ state, onLeave }: { state: GameState; onLeave: () => void }) {
  const ranked = [...state.players].sort((a, b) => b.stars - a.stars || b.coins - a.coins);
  const winner = state.players.find((p) => p.id === state.winnerId) ?? ranked[0];

  return (
    <div className="min-h-full flex flex-col items-center justify-center gap-6 p-6 max-w-sm mx-auto w-full text-center">
      <div className="text-7xl animate-pop">🏆</div>
      <div>
        <p className="text-violet-300">Ganador de la noche</p>
        <h1 className="text-4xl font-black" style={{ color: winner?.color }}>
          {winner?.name}
        </h1>
        <p className="text-amber-300 font-bold mt-1">
          ⭐{winner?.stars} · 🪙{winner?.coins}
        </p>
      </div>

      <div className="w-full flex flex-col gap-2">
        {ranked.map((p, i) => (
          <div
            key={p.id}
            className="flex items-center gap-2 rounded-2xl bg-white/5 border border-white/10 p-3"
          >
            <span className="w-6 text-center font-bold">{i + 1}</span>
            <span className="w-3 h-3 rounded-full" style={{ background: p.color }} />
            <span className="font-semibold flex-1 text-left">{p.name}</span>
            <span className="text-yellow-300">⭐{p.stars}</span>
            <span className="text-amber-300">🪙{p.coins}</span>
          </div>
        ))}
      </div>

      <button
        onClick={onLeave}
        className="rounded-2xl py-3 px-8 font-bold bg-white/10 border border-white/20 active:scale-95 transition"
      >
        Salir
      </button>
    </div>
  );
}
