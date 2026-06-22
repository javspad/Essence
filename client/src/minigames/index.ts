import type { FC } from "react";
import type { MinigameType } from "@essence/shared";
import type { MinigameProps } from "./types";
import Vote from "./Vote";
import Buzzer from "./Buzzer";
import Timing from "./Timing";
import Judge from "./Judge";
import Reaction from "./Reaction";
import Estimate from "./Estimate";
import Whack from "./Whack";

/** Registro de motores: type → Component que corre LOCAL en cada compu. */
export const ENGINES: Partial<Record<MinigameType, FC<MinigameProps>>> = {
  vote: Vote,
  buzzer: Buzzer,
  timing: Timing,
  judge: Judge,
  reaction: Reaction,
  estimate: Estimate,
  whack: Whack,
};

export type { MinigameProps };
