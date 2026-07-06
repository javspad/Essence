import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Gamepad2, LogIn, Map, Palette, RefreshCw, Users } from "lucide-react";
import type { RoomSummary } from "@essence/shared";
import { Button } from "@/components/ui/8bit/button";
import { Badge } from "@/components/ui/8bit/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/8bit/card";
import { Input } from "@/components/ui/8bit/input";

interface Props {
  error: string | null;
  onCreate: (name: string, roomName: string) => void;
  onJoin: (code: string, name: string) => void;
}

type Mode = "menu" | "create" | "join";

export default function JoinScreen({ error, onCreate, onJoin }: Props) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("menu");

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center p-6">
      <Card font="normal" className="w-full border-[#fff4bf] bg-[#171120]/92 text-[#fff8d6] shadow-[0_20px_60px_rgb(0_0_0/0.38)]">
        <CardHeader font="normal" className="text-center">
          <div className="mb-2 text-5xl">🎲🍻</div>
          <CardTitle font="normal" className="text-3xl font-black">Despedida de Javi</CardTitle>
          <p className="text-sm font-bold text-[#c7bddc]">15 años de amistad, una noche de joda</p>
        </CardHeader>

        <CardContent font="normal" className="flex flex-col gap-5">
          <Input
            font="normal"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tu nombre"
            maxLength={16}
            className="h-14 w-full bg-[#100b1a] text-center text-lg font-black text-[#fff8d6]"
          />

          {mode === "menu" && <MenuView name={name} setMode={setMode} />}
          {mode === "create" && (
            <CreateView name={name} error={error} onCreate={onCreate} onBack={() => setMode("menu")} />
          )}
          {mode === "join" && (
            <JoinView name={name} error={error} onJoin={onJoin} onBack={() => setMode("menu")} />
          )}

          {mode === "menu" && error && <p className="animate-pop text-center font-semibold text-[#fb7185]">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function MenuView({ name, setMode }: { name: string; setMode: (m: Mode) => void }) {
  return (
    <div className="flex w-full flex-col gap-4">
      <Button
        type="button"
        onClick={() => name.trim() && setMode("create")}
        disabled={!name.trim()}
        className="h-12 w-full bg-[#f5d547] text-sm uppercase text-[#201507]"
      >
        <Users data-icon="inline-start" />
        Crear sala
      </Button>
      <Button
        type="button"
        onClick={() => name.trim() && setMode("join")}
        disabled={!name.trim()}
        className="h-12 w-full bg-[#38bdf8] text-sm uppercase text-[#061926]"
      >
        <LogIn data-icon="inline-start" />
        Unirme
      </Button>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Button
          type="button"
          onClick={() => { window.location.href = "/map-builder"; }}
          className="h-11 w-full bg-[#34d399] text-[11px] uppercase text-[#062116]"
        >
          <Map data-icon="inline-start" />
          Map builder
        </Button>
        <Button
          type="button"
          onClick={() => { window.location.href = "/minigame-builder"; }}
          className="h-11 w-full bg-[#f472b6] text-[11px] uppercase text-[#2a0718]"
        >
          <Gamepad2 data-icon="inline-start" />
          Minigames
        </Button>
        <Button
          type="button"
          onClick={() => { window.location.href = "/character-builder"; }}
          className="h-11 w-full bg-[#38bdf8] text-[11px] uppercase text-[#061926]"
        >
          <Palette data-icon="inline-start" />
          Personajes
        </Button>
      </div>
    </div>
  );
}

function CreateView({
  name,
  error,
  onCreate,
  onBack,
}: {
  name: string;
  error: string | null;
  onCreate: (name: string, roomName: string) => void;
  onBack: () => void;
}) {
  const [roomName, setRoomName] = useState("");
  return (
    <div className="flex w-full flex-col gap-4">
      <p className="text-center text-xs font-bold uppercase text-[#c7bddc]">Nombre de la sala</p>
      <Input
        font="normal"
        value={roomName}
        onChange={(e) => setRoomName(e.target.value)}
        placeholder="Ej. Mesa de Javi"
        maxLength={40}
        className="h-14 w-full bg-[#100b1a] text-center text-lg font-black text-[#fff8d6]"
      />
      <Button
        type="button"
        onClick={() => name.trim() && roomName.trim() && onCreate(name.trim(), roomName.trim())}
        disabled={!name.trim() || !roomName.trim()}
        className="h-12 w-full bg-[#f5d547] text-sm uppercase text-[#201507]"
      >
        <Users data-icon="inline-start" />
        Crear
      </Button>
      <Button type="button" variant="ghost" onClick={onBack} className="h-10 w-full text-[#c7bddc]">
        <ArrowLeft data-icon="inline-start" />
        Volver
      </Button>
      {error && <p className="animate-pop text-center font-semibold text-[#fb7185]">{error}</p>}
    </div>
  );
}

function JoinView({
  name,
  error,
  onJoin,
  onBack,
}: {
  name: string;
  error: string | null;
  onJoin: (code: string, name: string) => void;
  onBack: () => void;
}) {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/rooms");
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { rooms: RoomSummary[] };
      setRooms(data.rooms);
    } catch {
      setRooms(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  const joinable = (rooms ?? []).filter((r) => r.phase === "lobby" && r.players < r.maxPlayers);
  const inProgress = (rooms ?? []).filter((r) => r.phase !== "lobby");

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="retro text-[10px] uppercase text-[#c7bddc]">Salas disponibles</p>
        <Button
          type="button"
          variant="ghost"
          onClick={refresh}
          className="h-7 px-2 text-[10px] uppercase text-[#c7bddc]"
        >
          <RefreshCw data-icon="inline-start" />
          Refrescar
        </Button>
      </div>

      {rooms === null ? (
        <p className="text-center text-sm font-bold text-[#c7bddc]">Cargando salas...</p>
      ) : joinable.length === 0 ? (
        <div className="border-2 border-dashed border-[#fff4bf]/20 bg-[#0d1829] p-4 text-center">
          <p className="text-sm font-black text-[#fff8d6]">No hay salas abiertas</p>
          <p className="mt-1 text-xs text-[#c7bddc]">Pedile a alguien que cree una, o entrá con un código.</p>
        </div>
      ) : (
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
          {joinable.map((r) => (
            <button
              key={r.code}
              type="button"
              onClick={() => name.trim() && onJoin(r.code, name.trim())}
              disabled={!name.trim()}
              className="group grid grid-cols-[1fr_auto] items-center gap-3 border-2 border-[#fff4bf]/20 bg-[#0d1829] p-3 text-left transition hover:border-[#f5d547] hover:bg-[#15102a] disabled:opacity-50"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate font-black text-[#fff8d6]">{r.name}</span>
                  <Badge className="border-[#fde68a] bg-[#f5d547] px-1.5 py-0.5 text-[8px] uppercase text-[#201507]">
                    {r.code}
                  </Badge>
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-[#c7bddc]">
                  {r.host ? `Anfitrión: ${r.host}` : "Sin anfitrión"}
                </span>
              </span>
              <Badge className="border-[#a7f3d0] bg-[#34d399] px-2 py-1 text-[9px] text-[#062116]">
                <Users data-icon="inline-start" />
                {r.players}/{r.maxPlayers}
              </Badge>
            </button>
          ))}
        </div>
      )}

      {inProgress.length > 0 && (
        <p className="text-center text-[10px] text-[#c7bddc]/70">
          {inProgress.length} sala{inProgress.length > 1 ? "s" : ""} en juego no aparece{inProgress.length > 1 ? "n" : ""} en la lista
        </p>
      )}

      <div className="mt-1 border-t border-[#fff4bf]/15 pt-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setManual((v) => !v)}
          className="h-8 w-full text-[11px] uppercase text-[#c7bddc]"
        >
          {manual ? "Ocultar código manual" : "Tengo un código"}
        </Button>
        {manual && (
          <div className="mt-3 flex flex-col gap-3">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="CÓDIGO"
              maxLength={4}
              className="h-14 w-full bg-[#100b1a] text-center text-2xl font-black uppercase text-[#fff8d6]"
            />
            <Button
              type="button"
              onClick={() => name.trim() && code.trim() && onJoin(code.trim(), name.trim())}
              disabled={!name.trim() || code.length < 4}
              className="h-12 w-full bg-[#f5d547] text-sm uppercase text-[#201507]"
            >
              <LogIn data-icon="inline-start" />
              Entrar
            </Button>
          </div>
        )}
      </div>

      <Button type="button" variant="ghost" onClick={onBack} className="h-10 w-full text-[#c7bddc]">
        <ArrowLeft data-icon="inline-start" />
        Volver
      </Button>

      {error && <p className="animate-pop text-center font-semibold text-[#fb7185]">{error}</p>}
    </div>
  );
}
