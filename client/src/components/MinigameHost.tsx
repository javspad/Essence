import { useEffect, useState } from "react";
import type { GameState, Player } from "@essence/shared";
import { ENGINES } from "../minigames";

interface Props {
  state: GameState;
  me: Player;
  isHost: boolean;
  onFinish: (score: number, payload: unknown) => void;
  onAction: (data: unknown) => void;
  onForce: () => void;
}

export default function MinigameHost({ state, me, isHost, onFinish, onAction, onForce }: Props) {
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
    <div className="min-h-full flex flex-col justify-center w-full py-6">
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
      <div className="text-5xl mb-4 animate-pulse">⏳</div>
      <p className="text-lg font-semibold">{text}</p>
      <p className="text-violet-300 mt-2">
        {count}/{total} enviaron su jugada
      </p>
      {onForce && (
        <button
          onClick={onForce}
          className="mt-6 rounded-2xl py-2 px-5 text-sm font-semibold bg-white/10 border border-white/20 active:scale-95 transition"
        >
          Cerrar igual (host)
        </button>
      )}
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full flex flex-col items-center justify-center text-center p-6">{children}</div>
  );
}
