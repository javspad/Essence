import type { GameState } from "@essence/shared";
import { LogOut, Play, Users } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { Badge } from "@/components/ui/8bit/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/8bit/card";

interface Props {
  state: GameState;
  isHost: boolean;
  onStart: () => void;
  onLeave: () => void;
}

export default function Lobby({ state, isHost, onStart, onLeave }: Props) {
  const connected = state.players.filter((p) => p.connected);
  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center p-6">
      <Card font="normal" className="w-full border-[#fff4bf] bg-[#171120]/92 text-[#fff8d6] shadow-[0_20px_60px_rgb(0_0_0/0.38)]">
        <CardHeader font="normal" className="text-center">
          <p className="retro text-[10px] uppercase text-[#c7bddc]">{state.roomName || "Sala"}</p>
          {state.mapName && <p className="retro text-[10px] uppercase text-[#a7f3d0]">Mapa: {state.mapName}</p>}
          <p className="retro text-[10px] uppercase text-[#c7bddc]">Código de sala</p>
          <CardTitle font="normal" className="retro text-4xl text-[#f5d547]">{state.code}</CardTitle>
          <p className="text-xs font-bold text-[#c7bddc]">Compartilo: todos entran con este código</p>
        </CardHeader>

        <CardContent font="normal" className="flex flex-col gap-5">
          <div className="w-full">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="retro text-[10px] uppercase text-[#c7bddc]">Jugadores</p>
              <Badge className="border-[#a7f3d0] bg-[#34d399] px-2 py-1 text-[9px] text-[#062116]">
                <Users data-icon="inline-start" />
                {connected.length}
              </Badge>
            </div>
            <div className="flex flex-col gap-2">
              {connected.map((p) => {
                const slot = state.characterSlots?.find((candidate) => candidate.id === (p.characterId ?? p.id));
                const traits = slot?.defaultTraits ?? [];
                return (
                  <div
                    key={p.id}
                    className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-3 border-2 border-[#fff4bf]/20 bg-[#0d1829] p-3"
                  >
                    <span className="size-4 rounded-[2px] border border-black/35" style={{ background: p.color }} />
                    <span className="min-w-0">
                      <span className="block truncate font-black">{p.name}{p.groom ? " 🤵" : ""}</span>
                      {traits.length > 0 && (
                        <span className="mt-1 flex max-w-full flex-wrap gap-1">
                          {traits.slice(0, 3).map((trait) => (
                            <span
                              key={trait.id}
                              title={`${trait.name}: ${trait.description ?? trait.effectName}`}
                              className="max-w-[8rem] truncate border border-cyan-200/25 bg-cyan-300/10 px-1.5 py-0.5 text-[8px] font-black uppercase text-cyan-100"
                            >
                              {trait.name}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    {p.isHost && (
                      <Badge className="border-[#fde68a] bg-[#f5d547] px-2 py-1 text-[9px] uppercase text-[#201507]">
                        host
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {isHost ? (
            <Button
              type="button"
              onClick={onStart}
              disabled={connected.length < 1}
              className="h-12 w-full bg-[#f5d547] text-sm uppercase text-[#201507]"
            >
              <Play data-icon="inline-start" />
              Arrancar
            </Button>
          ) : (
            <p className="animate-pulse text-center text-sm font-black text-[#c7bddc]">Esperando que el host arranque...</p>
          )}

          <Button
            type="button"
            onClick={onLeave}
            className="h-10 w-full border border-[#fb7185]/40 bg-transparent text-xs uppercase text-[#fda4af] hover:bg-[#fb7185]/15"
          >
            <LogOut data-icon="inline-start" />
            Salir de la sala
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
