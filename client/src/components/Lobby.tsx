import type { GameState } from "@essence/shared";

interface Props {
  state: GameState;
  isHost: boolean;
  onStart: () => void;
}

export default function Lobby({ state, isHost, onStart }: Props) {
  const connected = state.players.filter((p) => p.connected);
  return (
    <div className="min-h-full flex flex-col items-center justify-center gap-6 p-6 max-w-sm mx-auto w-full">
      <div className="text-center">
        <p className="text-violet-300 text-sm">Código de sala</p>
        <p className="text-5xl font-black tracking-[0.3em] text-amber-300">{state.code}</p>
        <p className="text-violet-300 text-xs mt-1">Compartilo: todos entran con este código</p>
      </div>

      <div className="w-full">
        <p className="text-sm text-violet-300 mb-2">Jugadores ({connected.length})</p>
        <div className="flex flex-col gap-2">
          {connected.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-2xl bg-white/5 border border-white/10 p-3"
            >
              <span className="w-5 h-5 rounded-full" style={{ background: p.color }} />
              <span className="font-bold">{p.name}</span>
              {p.groom && <span title="El novio">🤵</span>}
              {p.isHost && <span className="text-xs text-amber-300 ml-auto">host</span>}
            </div>
          ))}
        </div>
      </div>

      {isHost ? (
        <button
          onClick={onStart}
          disabled={connected.length < 1}
          className="rounded-2xl py-4 w-full font-bold text-lg bg-amber-400 text-amber-950 active:scale-95 transition disabled:opacity-40"
        >
          ¡Arrancar! 🎲
        </button>
      ) : (
        <p className="text-violet-300 animate-pulse">Esperando que el host arranque...</p>
      )}
    </div>
  );
}
