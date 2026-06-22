import { useState } from "react";

interface Props {
  error: string | null;
  onCreate: (name: string) => void;
  onJoin: (code: string, name: string) => void;
}

export default function JoinScreen({ error, onCreate, onJoin }: Props) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"menu" | "join">("menu");

  return (
    <div className="min-h-full flex flex-col items-center justify-center gap-6 p-6 max-w-sm mx-auto w-full">
      <div className="text-center">
        <div className="text-6xl mb-2">🎲🍻</div>
        <h1 className="text-3xl font-black">Despedida de Javi</h1>
        <p className="text-violet-300 text-sm mt-1">15 años de amistad, una noche de joda</p>
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Tu nombre"
        maxLength={16}
        className="w-full rounded-2xl bg-white/10 border-2 border-white/20 focus:border-white/60 outline-none p-4 text-lg text-center"
      />

      {mode === "menu" ? (
        <div className="flex flex-col gap-3 w-full">
          <button
            onClick={() => name.trim() && onCreate(name.trim())}
            disabled={!name.trim()}
            className="rounded-2xl py-4 font-bold text-lg bg-amber-400 text-amber-950 active:scale-95 transition disabled:opacity-40"
          >
            Crear sala
          </button>
          <button
            onClick={() => setMode("join")}
            disabled={!name.trim()}
            className="rounded-2xl py-4 font-bold text-lg bg-white/10 border-2 border-white/20 active:scale-95 transition disabled:opacity-40"
          >
            Unirme con código
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 w-full">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="CÓDIGO"
            maxLength={4}
            className="w-full rounded-2xl bg-white/10 border-2 border-white/20 focus:border-white/60 outline-none p-4 text-2xl text-center tracking-[0.4em] font-black uppercase"
          />
          <button
            onClick={() => name.trim() && code.trim() && onJoin(code.trim(), name.trim())}
            disabled={!name.trim() || code.length < 4}
            className="rounded-2xl py-4 font-bold text-lg bg-amber-400 text-amber-950 active:scale-95 transition disabled:opacity-40"
          >
            Entrar
          </button>
          <button onClick={() => setMode("menu")} className="text-violet-300 text-sm">
            ← Volver
          </button>
        </div>
      )}

      {error && <p className="text-red-400 font-semibold animate-pop">{error}</p>}
    </div>
  );
}
