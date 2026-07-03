import { useEffect } from "react";
import type { GameState } from "@essence/shared";
import { useMachine } from "@xstate/react";
import {
  BoardPresentationEventType,
  gamePresentationMachine,
  type BoardActiveMotion,
  type BoardDiceCue,
} from "./gamePresentationMachine";

export interface BoardPresentation {
  displayState: GameState;
  activeMotion: BoardActiveMotion | null;
  diceCue: BoardDiceCue | null;
  eventBusyLabel: string | null;
  rollBlocked: boolean;
  showMinigame: boolean;
  statusLabel: string | null;
  rollRequested: () => void;
}

export function useBoardPresentation(authoritativeState: GameState): BoardPresentation {
  const [snapshot, send] = useMachine(gamePresentationMachine, {
    input: { initialState: authoritativeState },
  });

  useEffect(() => {
    send({ type: BoardPresentationEventType.SERVER_STATE, state: authoritativeState });
  }, [authoritativeState, send]);

  const rolling = snapshot.matches("rollingDice");
  const moving = snapshot.matches("moving");
  const eventReading = snapshot.matches("eventReading");
  const jumping = snapshot.matches("jumping");
  const busyOnBoard = rolling || moving || eventReading || jumping;

  return {
    displayState: snapshot.context.displayState,
    activeMotion: snapshot.context.activeMotion,
    diceCue: snapshot.context.diceCue,
    eventBusyLabel: eventReading ? "Leyendo..." : jumping ? "Moviendo..." : null,
    rollBlocked: rolling || moving,
    showMinigame: authoritativeState.phase === "minigame" && (snapshot.matches("minigameReady") || !busyOnBoard),
    statusLabel: rolling ? "Tirando dado..." : moving ? "Avanzando..." : jumping ? "Destino en marcha..." : null,
    rollRequested: () => send({ type: BoardPresentationEventType.ROLL_REQUESTED }),
  };
}
