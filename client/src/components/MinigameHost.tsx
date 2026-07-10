import { useState } from "react";
import type { GameState, Player } from "@essence/shared";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { Card, CardContent } from "@/components/ui/8bit/card";
import { Progress } from "@/components/ui/8bit/progress";
import { ENGINES, SPECTATE_TYPES } from "../minigames";
import ActivityMediaStrip from "./ActivityMedia";

interface Props {
  state: GameState;
  me: Player;
  isHost: boolean;
  onFinish: (score: number, payload: unknown, outcome?: "win" | "loss") => void;
  onAction: (data: unknown) => void;
  onForce: () => void;
  onLeave: () => void;
}

export default function MinigameHost({ state, me, isHost, onFinish, onAction, onForce, onLeave }: Props) {
  const mg = state.activeMinigame;
  const [finishedMinigameKey, setFinishedMinigameKey] = useState<string | null>(null);

  if (!mg) return null;

  const minigameKey = `${mg.eventId}-${state.round}-${state.activeIndex}-${mg.judge?.phase ?? "play"}`;
  const Engine = ENGINES[mg.type];
  const amParticipant = mg.participants.includes(me.id);
  const finished = finishedMinigameKey === minigameKey;
  const alreadyIn = mg.submitted.includes(me.id) || finished;
  const connectedPlayers = state.players.filter((p) => p.connected);
  const subjectPlayers = (mg.subjects?.length ? mg.subjects : mg.participants)
    .map((id) => connectedPlayers.find((player) => player.id === id))
    .filter((player): player is Player => Boolean(player));
  const participantPlayers = mg.participants
    .map((id) => connectedPlayers.find((player) => player.id === id))
    .filter((player): player is Player => Boolean(player));

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

  if (!amParticipant && mg.type === "prompt") {
    return (
      <div className="relative flex min-h-full w-full flex-col justify-center py-6">
        <ActivityStory story={mg.story} />
        <div className="mx-auto w-full max-w-xl px-4">
          <ActivityMediaStrip assets={state.mediaAssets} media={mg.media} placement="prompt" compact />
        </div>
        <Engine
          key={`${mg.eventId}-${state.round}-${state.activeIndex}-${mg.judge?.phase ?? "play"}-spectator`}
          content={mg.content}
          players={connectedPlayers}
          participants={participantPlayers}
          subjects={subjectPlayers}
          activeMinigame={mg}
          me={me}
          onFinish={() => undefined}
          onAction={onAction}
          spectator
        />
        {force && (
          <Button
            type="button"
            onClick={force}
            className="mx-auto mt-4 h-11 w-full max-w-xs bg-[#fb7185] text-xs uppercase text-[#2a070b]"
          >
            Cerrar igual (host)
          </Button>
        )}
      </div>
    );
  }

  if (!amParticipant) {
    return <Waiting count={submittedCount} total={total} text="No participás en esta ronda." onForce={force} />;
  }

  // En los motores realtime el jugador que ya terminó sigue mirando la partida.
  const spectates = SPECTATE_TYPES.has(mg.type);
  if (alreadyIn && !spectates) {
    return <Waiting count={submittedCount} total={total} text="¡Listo! Esperando al resto..." onForce={force} />;
  }

  const handleFinish = (score: number, payload: unknown, outcome?: "win" | "loss") => {
    if (finished) return;
    setFinishedMinigameKey(minigameKey);
    onFinish(score, payload, outcome);
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
      <ActivityStory story={mg.story} />
      <div className="mx-auto w-full max-w-xl px-4">
        <ActivityMediaStrip assets={state.mediaAssets} media={mg.media} placement="prompt" compact />
      </div>
      <Engine
        key={`${mg.eventId}-${state.round}-${state.activeIndex}-${mg.judge?.phase ?? "play"}`}
        content={mg.content}
        players={mg.type === "vote" ? subjectPlayers : connectedPlayers}
        participants={participantPlayers}
        subjects={subjectPlayers}
        activeMinigame={mg}
        me={me}
        onFinish={handleFinish}
        onAction={onAction}
        spectator={alreadyIn}
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

function ActivityStory({ story }: { story?: { title?: string; setup?: string; prompt?: string; reward?: string } }) {
  if (!story?.setup && !story?.reward) return null;
  return (
    <aside className="mx-auto mb-3 w-full max-w-xl rounded-md border border-[#fff4bf]/25 bg-[#171120]/70 px-4 py-3 text-center text-sm font-black text-[#c7bddc]">
      {story.setup && <p>{story.setup}</p>}
      {story.reward && <p className="mt-1 text-[#f5d547]">{story.reward}</p>}
    </aside>
  );
}
