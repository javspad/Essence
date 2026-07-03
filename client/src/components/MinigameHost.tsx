import { useEffect, useState } from "react";
import type { GameState, Player } from "@essence/shared";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { Card, CardContent } from "@/components/ui/8bit/card";
import { Progress } from "@/components/ui/8bit/progress";
import { ENGINES } from "../minigames";

interface Props {
  state: GameState;
  me: Player;
  isHost: boolean;
  onFinish: (score: number, payload: unknown) => void;
  onAction: (data: unknown) => void;
  onForce: () => void;
  onLeave: () => void;
}

export default function MinigameHost({ state, me, isHost, onFinish, onAction, onForce, onLeave }: Props) {
  const mg = state.activeMinigame;
  const [finished, setFinished] = useState(false);

  // Reset cuando arranca un minijuego nuevo.
  useEffect(() => {
    setFinished(false);
  }, [mg?.id, state.round, state.activeIndex]);

  if (!mg) return null;

  const Engine = ENGINES[mg.type];
  const amParticipant = mg.participants.includes(me.id);
  const alreadyIn = mg.submitted.includes(me.id) || finished;

  const submittedCount = mg.submitted.length;
  const total = mg.participants.length;

  if (!Engine) {
    return (
      <Centered>
        <p className="text-red-400">Motor "{mg.type}" no disponible.</p>
      </Centered>
    );
  }

  const force = isHost && submittedCount < total ? onForce : undefined;

  if (!amParticipant) {
    return <Waiting count={submittedCount} total={total} text="No participás en esta ronda." onForce={force} />;
  }

  if (alreadyIn) {
    return <Waiting count={submittedCount} total={total} text="¡Listo! Esperando al resto..." onForce={force} />;
  }

  const handleFinish = (score: number, payload: unknown) => {
    setFinished(true);
    onFinish(score, payload);
  };

  return (
    <div className="relative flex min-h-full w-full flex-col justify-center py-6">
      <Button
        type="button"
        onClick={onLeave}
        className="absolute right-3 top-3 z-10 flex h-9 items-center gap-1.5 border border-[#fb7185]/40 bg-[#2a070b]/80 px-3 text-[10px] font-black uppercase tracking-wider text-[#fda4af] backdrop-blur-xl hover:bg-[#fb7185]/25 hover:text-white"
      >
        <LogOut data-icon="inline-start" className="size-3.5" />
        Salir
      </Button>
      <Engine
        key={`${mg.id}-${state.round}-${state.activeIndex}`}
        content={mg.content}
        players={state.players.filter((p) => p.connected)}
        me={me}
        onFinish={handleFinish}
        onAction={onAction}
      />
    </div>
  );
}

function Waiting({
  count,
  total,
  text,
  onForce,
}: {
  count: number;
  total: number;
  text: string;
  onForce?: () => void;
}) {
  return (
    <Centered>
      <Card font="normal" className="w-full max-w-md border-[#7dd3fc] bg-[#171120]/92 text-[#fff8d6]">
        <CardContent font="normal" className="flex flex-col items-center gap-5 p-6">
          <div className="animate-pulse text-5xl">⏳</div>
          <p className="text-lg font-black">{text}</p>
          <Progress className="h-4 w-full" value={total ? (count / total) * 100 : 0} variant="retro" progressBg="bg-[#38bdf8]" />
          <p className="text-sm font-black text-[#c7bddc]">
            {count}/{total} enviaron su jugada
          </p>
          {onForce && (
            <Button
              type="button"
              onClick={onForce}
              className="h-11 w-full bg-[#fb7185] text-xs uppercase text-[#2a070b]"
            >
              Cerrar igual (host)
            </Button>
          )}
        </CardContent>
      </Card>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center p-6 text-center">{children}</div>
  );
}
