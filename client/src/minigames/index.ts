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
};

export type { MinigameProps };
