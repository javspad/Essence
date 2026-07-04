import type { FC } from "react";
import type { EventActivityType } from "@essence/shared";
import type { MinigameProps } from "./types";
import Prompt from "./Prompt";
import HostPick from "./HostPick";
import SelfTap from "./SelfTap";
import Vote from "./Vote";
import Buzzer from "./Buzzer";
import Timing from "./Timing";
import Judge from "./Judge";
import Reaction from "./Reaction";
import Estimate from "./Estimate";
import Whack from "./Whack";
import Maze from "./Maze";
import Flappy from "./Flappy";
import Snake from "./Snake";
import HorseRace from "./HorseRace";
import RedLight from "./RedLight";

/** Registro de motores: type → Component que corre LOCAL en cada compu. */
export const ENGINES: Partial<Record<EventActivityType, FC<MinigameProps>>> = {
  prompt: Prompt,
  hostPick: HostPick,
  selfTap: SelfTap,
  vote: Vote,
  buzzer: Buzzer,
  timing: Timing,
  judge: Judge,
  reaction: Reaction,
  estimate: Estimate,
  whack: Whack,
  maze: Maze,
  flappy: Flappy,
  snake: Snake,
  horserace: HorseRace,
  redlight: RedLight,
};

/**
 * Motores realtime: después de enviar su resultado, el jugador sigue viendo la
 * partida en modo espectador (fantasmas del resto) en vez de la pantalla de espera.
 */
export const SPECTATE_TYPES = new Set<EventActivityType>(["flappy", "snake", "horserace", "redlight"]);

export type { MinigameProps };
