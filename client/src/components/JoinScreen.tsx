import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, LogIn, Map as MapIcon, RefreshCw, Users, Wrench } from "lucide-react";
import type { CharacterSlot, ContentMapSummary, RoomSummary } from "@essence/shared";
import { Button } from "@/components/ui/8bit/button";
import { Badge } from "@/components/ui/8bit/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/8bit/card";
import { Input } from "@/components/ui/8bit/input";

interface Props {
  error: string | null;
  onCreate: (name: string, roomName: string, characterId?: string, mapId?: string) => void;
  onJoin: (code: string, name: string, characterId?: string) => void;
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

          {mode === "menu" && <MenuView setMode={setMode} />}
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

function MenuView({ setMode }: { setMode: (m: Mode) => void }) {
  return (
    <div className="flex w-full flex-col gap-4">
      <Button
        type="button"
        onClick={() => setMode("create")}
        className="h-12 w-full bg-[#f5d547] text-sm uppercase text-[#201507]"
      >
        <Users data-icon="inline-start" />
        Crear sala
      </Button>
      <Button
        type="button"
        onClick={() => setMode("join")}
        className="h-12 w-full bg-[#38bdf8] text-sm uppercase text-[#061926]"
      >
        <LogIn data-icon="inline-start" />
        Unirme
      </Button>
      <Button
        type="button"
        onClick={() => { window.location.href = "/tools"; }}
        className="h-11 w-full bg-[#fbbf24] text-[11px] uppercase text-[#211505]"
      >
        <Wrench data-icon="inline-start" />
        Tools
      </Button>
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
  onCreate: (name: string, roomName: string, characterId?: string, mapId?: string) => void;
  onBack: () => void;
}) {
  const [roomName, setRoomName] = useState("");
  const [characters, setCharacters] = useState<CharacterSlot[] | null>(null);
  const [characterId, setCharacterId] = useState("");
  const [maps, setMaps] = useState<ContentMapSummary[] | null>(null);
  const [mapId, setMapId] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/characters")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { characters: CharacterSlot[] }) => {
        if (cancelled) return;
        setCharacters(data.characters);
        setCharacterId((current) => current || data.characters[0]?.id || "");
      })
      .catch(() => {
        if (!cancelled) setCharacters([]);
      });
    fetch("/api/maps")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { maps: ContentMapSummary[] }) => {
        if (cancelled) return;
        setMaps(data.maps);
        setMapId((current) => current || data.maps.find((map) => map.active)?.id || data.maps[0]?.id || "");
      })
      .catch(() => {
        if (!cancelled) setMaps([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCharacter = characters?.find((slot) => slot.id === characterId) ?? characters?.[0] ?? null;
  const selectedMap = maps?.find((map) => map.id === mapId) ?? maps?.find((map) => map.active) ?? maps?.[0] ?? null;
  const createName = name.trim() || selectedCharacter?.displayName || "";

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
      <div className="space-y-2">
        <p className="retro flex items-center gap-1 text-[10px] uppercase text-[#c7bddc]">
          <MapIcon className="h-3 w-3" />
          Mapa
        </p>
        {maps === null ? (
          <p className="text-center text-sm font-bold text-[#c7bddc]">Cargando mapas...</p>
        ) : maps.length === 0 ? (
          <p className="border-2 border-dashed border-[#fff4bf]/20 bg-[#0d1829] p-3 text-center text-sm font-black text-[#fff8d6]">
            No hay mapas guardados
          </p>
        ) : (
          <div className="border-2 border-[#fff4bf]/20 bg-[#0d1829] p-3">
            <label className="sr-only" htmlFor="room-map-select">Mapa de la sala</label>
            <select
              id="room-map-select"
              value={selectedMap?.id ?? ""}
              onChange={(event) => setMapId(event.target.value)}
              className="h-11 w-full rounded-none border-2 border-[#fff4bf]/20 bg-[#100b1a] px-3 text-sm font-black text-[#fff8d6] outline-none focus:border-[#f5d547]"
            >
              {maps.map((map) => (
                <option key={map.id} value={map.id}>
                  {map.name}{map.active ? " · activo" : ""}
                </option>
              ))}
            </select>
            {selectedMap && (
              <div className="mt-3 space-y-2">
                {selectedMap.description && <p className="line-clamp-2 text-xs font-bold leading-5 text-[#c7bddc]">{selectedMap.description}</p>}
                <div className="flex flex-wrap gap-1.5">
                  <MapStat label="Cells" value={selectedMap.cells} />
                  <MapStat label="Routes" value={selectedMap.routes} />
                  <MapStat label="Props" value={selectedMap.props} />
                  {selectedMap.terraces > 0 && <MapStat label="Terraces" value={selectedMap.terraces} />}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="space-y-2">
        <p className="retro text-[10px] uppercase text-[#c7bddc]">Tu personaje</p>
        {characters === null ? (
          <p className="text-center text-sm font-bold text-[#c7bddc]">Cargando personajes...</p>
        ) : characters.length === 0 ? (
          <p className="border-2 border-dashed border-[#fff4bf]/20 bg-[#0d1829] p-3 text-center text-sm font-black text-[#fff8d6]">
            No hay personajes disponibles
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {characters.map((slot) => (
              <CharacterSlotButton
                key={slot.id}
                slot={slot}
                selected={slot.id === selectedCharacter?.id}
                onClick={() => setCharacterId(slot.id)}
              />
            ))}
          </div>
        )}
      </div>
      <Button
        type="button"
        onClick={() =>
          roomName.trim() &&
          selectedCharacter &&
          selectedMap &&
          onCreate(createName, roomName.trim(), selectedCharacter.id, selectedMap.id)
        }
        disabled={!roomName.trim() || !selectedCharacter || !selectedMap}
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
  onJoin: (code: string, name: string, characterId?: string) => void;
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
          {joinable.map((r) => {
            const slots = r.characterSlots ?? [];
            const availableSlots = slots.filter((slot) => !slot.claimedByPlayerId);
            return (
              <div key={r.code} data-room-code={r.code} className="border-2 border-[#fff4bf]/20 bg-[#0d1829] p-3 text-left">
                <div className="grid grid-cols-[1fr_auto] items-start gap-3">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-black text-[#fff8d6]">{r.name}</span>
                      <Badge className="border-[#fde68a] bg-[#f5d547] px-1.5 py-0.5 text-[8px] uppercase text-[#201507]">
                        {r.code}
                      </Badge>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-[#c7bddc]">
                      {r.host ? `Host: ${r.host}` : "Sin host"}
                    </span>
                    {r.mapName && (
                      <span className="mt-0.5 block truncate text-[11px] text-[#a7f3d0]">
                        Mapa: {r.mapName}
                      </span>
                    )}
                  </span>
                  <Badge className="border-[#a7f3d0] bg-[#34d399] px-2 py-1 text-[9px] text-[#062116]">
                    <Users data-icon="inline-start" />
                    {r.players}/{r.maxPlayers}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {slots.length > 0 ? (
                    slots.map((slot) => (
                      <CharacterSlotButton
                        key={slot.id}
                        slot={slot}
                        disabled={Boolean(slot.claimedByPlayerId)}
                        selected={false}
                        onClick={() => onJoin(r.code, name.trim() || slot.displayName, slot.id)}
                      />
                    ))
                  ) : (
                    <Button
                      type="button"
                      onClick={() => name.trim() && onJoin(r.code, name.trim())}
                      disabled={!name.trim()}
                      className="col-span-2 h-10 w-full bg-[#f5d547] text-xs uppercase text-[#201507]"
                    >
                      <LogIn data-icon="inline-start" />
                      Entrar
                    </Button>
                  )}
                </div>
                {availableSlots.length === 0 && (
                  <p className="mt-2 text-center text-[10px] font-bold uppercase text-[#fb7185]">Sala completa</p>
                )}
              </div>
            );
          })}
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

function MapStat({ label, value }: { label: string; value: number }) {
  return (
    <span className="border border-[#fff4bf]/20 bg-[#100b1a] px-2 py-1 text-[9px] font-black uppercase text-[#fff8d6]">
      {label}: {value}
    </span>
  );
}

function CharacterSlotButton({
  slot,
  selected,
  disabled = false,
  onClick,
}: {
  slot: CharacterSlot;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const traits = slot.defaultTraits ?? [];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`grid min-h-12 grid-cols-[0.9rem_minmax(0,1fr)_auto] items-center gap-2 border-2 px-2 py-2 text-left transition disabled:opacity-45 ${
        selected ? "border-[#f5d547] bg-[#2a210b]" : "border-[#fff4bf]/20 bg-[#100b1a] hover:border-[#f5d547]/70"
      }`}
    >
      <span className="size-3 rounded-[2px] border border-black/35" style={{ background: slot.color }} />
      <span className="min-w-0">
        <span className="block truncate text-xs font-black text-[#fff8d6]">
          {slot.displayName}
          {slot.groom ? " groom" : ""}
        </span>
        {traits.length > 0 && (
          <span className="mt-1 flex max-w-full flex-wrap gap-1">
            {traits.slice(0, 2).map((trait) => (
              <span
                key={trait.id}
                title={`${trait.name}: ${trait.description ?? trait.effectName}`}
                className="max-w-[7rem] truncate border border-cyan-200/25 bg-cyan-300/10 px-1.5 py-0.5 text-[8px] font-black uppercase text-cyan-100"
              >
                {trait.name}
              </span>
            ))}
            {traits.length > 2 && (
              <span className="border border-cyan-200/25 bg-cyan-300/10 px-1.5 py-0.5 text-[8px] font-black uppercase text-cyan-100">
                +{traits.length - 2}
              </span>
            )}
          </span>
        )}
      </span>
      {selected ? (
        <Check className="h-4 w-4 text-[#f5d547]" />
      ) : disabled ? (
        <span className="text-[9px] font-black uppercase text-[#fb7185]">Ocupado</span>
      ) : (
        <span className="text-[9px] font-black uppercase text-[#34d399]">Libre</span>
      )}
    </button>
  );
}
