import { useState } from "react";
import { ArrowLeft, Gamepad2, LogIn, Map, Users } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/8bit/card";
import { Input } from "@/components/ui/8bit/input";

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

          {mode === "menu" ? (
            <div className="flex w-full flex-col gap-4">
              <Button
                type="button"
                onClick={() => name.trim() && onCreate(name.trim())}
                disabled={!name.trim()}
                className="h-12 w-full bg-[#f5d547] text-sm uppercase text-[#201507]"
              >
                <Users data-icon="inline-start" />
                Crear sala
              </Button>
              <Button
                type="button"
                onClick={() => setMode("join")}
                disabled={!name.trim()}
                className="h-12 w-full bg-[#38bdf8] text-sm uppercase text-[#061926]"
              >
                <LogIn data-icon="inline-start" />
                Unirme
              </Button>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              </div>
            </div>
          ) : (
            <div className="flex w-full flex-col gap-4">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="CÓDIGO"
                maxLength={4}
                className="h-16 w-full bg-[#100b1a] text-center text-2xl font-black uppercase text-[#fff8d6]"
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
              <Button type="button" variant="ghost" onClick={() => setMode("menu")} className="h-10 w-full text-[#c7bddc]">
                <ArrowLeft data-icon="inline-start" />
                Volver
              </Button>
            </div>
          )}

          {error && <p className="animate-pop text-center font-semibold text-[#fb7185]">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
