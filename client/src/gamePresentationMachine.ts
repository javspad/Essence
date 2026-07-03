import type { GameState, Phase, Player } from "@essence/shared";
import { setup } from "xstate";

export type BoardMotionKind = "walk" | "jump";

export interface BoardActiveMotion {
  playerId: string;
  path: number[];
  kind: BoardMotionKind;
  nonce: string;
}

export interface BoardDiceCue {
  playerId: string;
  value: number | null;
  rolling: boolean;
  nonce: string;
}

interface BoardPresentationContext {
  authoritativeState: GameState;
  displayState: GameState;
  pendingAfterMoveState: GameState | null;
  landingState: GameState | null;
  activePlayerId: string | null;
  landingPosition: number | null;
  motionPath: number[];
  activeMotion: BoardActiveMotion | null;
  diceCue: BoardDiceCue | null;
  animationRun: number;
}

interface BoardPresentationInput {
  initialState: GameState;
}

export enum BoardPresentationEventType {
  SERVER_STATE = "server.state",
  ROLL_REQUESTED = "roll.requested",
}

export type BoardPresentationEvent =
  | { type: BoardPresentationEventType.SERVER_STATE; state: GameState }
  | { type: BoardPresentationEventType.ROLL_REQUESTED };

interface RollPlan {
  playerId: string;
  roll: number | null;
  landingState: GameState;
  pendingAfterMoveState: GameState | null;
  landingPosition: number;
  path: number[];
}

const WALK_STEP_MS = 280;
const DICE_DELAY_MS = 950;
const EVENT_READ_DELAY_MS = 1050;
const JUMP_DELAY_MS = 760;

const presentationSetup = setup({
  types: {
    context: {} as BoardPresentationContext,
    events: {} as BoardPresentationEvent,
    input: {} as BoardPresentationInput,
  },
  guards: {
    isRollUpdate: ({ context, event }) =>
      event.type === BoardPresentationEventType.SERVER_STATE &&
      createRollPlan(context.authoritativeState, event.state) !== null,
    hasMotionPath: ({ context }) => context.motionPath.length > 1 && context.landingState !== null,
    hasDeferredEventJump: ({ context }) => hasDeferredEventJump(context),
    pendingStateIsEvent: ({ context }) => context.pendingAfterMoveState?.phase === "event",
    pendingStateIsMinigame: ({ context }) => context.pendingAfterMoveState?.phase === "minigame",
  },
  delays: {
    diceDelay: DICE_DELAY_MS,
    movementDelay: ({ context }) => {
      const steps = Math.max(1, context.motionPath.length - 1);
      return Math.min(2400, 340 + steps * WALK_STEP_MS);
    },
    eventReadDelay: EVENT_READ_DELAY_MS,
    jumpDelay: JUMP_DELAY_MS,
  },
});

const showServerState = presentationSetup.assign(({ event }) => {
  if (event.type !== BoardPresentationEventType.SERVER_STATE) return {};

  return {
    authoritativeState: event.state,
    displayState: event.state,
    pendingAfterMoveState: null,
    landingState: null,
    activePlayerId: null,
    landingPosition: null,
    motionPath: [],
    activeMotion: null,
    diceCue: null,
  };
});

const startLocalDice = presentationSetup.assign(({ context }) => {
  const playerId = activePlayerId(context.authoritativeState);
  if (!playerId) return {};

  const run = context.animationRun + 1;
  return {
    animationRun: run,
    displayState: withoutTransientBoardState(context.displayState, "moving"),
    activePlayerId: playerId,
    activeMotion: null,
    diceCue: {
      playerId,
      value: null,
      rolling: true,
      nonce: `dice-${run}`,
    },
  };
});

const captureRollUpdate = presentationSetup.assign(({ context, event }) => {
  if (event.type !== BoardPresentationEventType.SERVER_STATE) return {};

  const plan = createRollPlan(context.authoritativeState, event.state);
  if (!plan) {
    return {
      authoritativeState: event.state,
      pendingAfterMoveState: event.state,
    };
  }

  const run = context.animationRun + 1;
  return {
    animationRun: run,
    authoritativeState: event.state,
    displayState: withoutTransientBoardState(context.displayState, "moving"),
    pendingAfterMoveState: plan.pendingAfterMoveState,
    landingState: plan.landingState,
    activePlayerId: plan.playerId,
    landingPosition: plan.landingPosition,
    motionPath: plan.path,
    activeMotion: null,
    diceCue: {
      playerId: plan.playerId,
      value: plan.roll,
      rolling: true,
      nonce: `dice-${run}`,
    },
  };
});

const capturePendingServerState = presentationSetup.assign(({ context, event }) => {
  if (event.type !== BoardPresentationEventType.SERVER_STATE) return {};

  const plan = createRollPlan(context.authoritativeState, event.state);
  const diceCue = context.diceCue
    ? {
        ...context.diceCue,
        value: event.state.lastRoll ?? context.diceCue.value,
      }
    : context.diceCue;

  if (plan && context.motionPath.length <= 1) {
    return {
      authoritativeState: event.state,
      pendingAfterMoveState: plan.pendingAfterMoveState,
      landingState: plan.landingState,
      activePlayerId: plan.playerId,
      landingPosition: plan.landingPosition,
      motionPath: plan.path,
      diceCue,
    };
  }

  return {
    authoritativeState: event.state,
    pendingAfterMoveState: event.state.phase === "moving" ? context.pendingAfterMoveState ?? event.state : event.state,
    diceCue,
  };
});

const showLandingMotion = presentationSetup.assign(({ context }) => {
  if (!context.landingState || !context.activePlayerId) return {};

  const run = context.animationRun + 1;
  return {
    animationRun: run,
    displayState: context.landingState,
    activeMotion: {
      playerId: context.activePlayerId,
      path: context.motionPath,
      kind: "walk" as const,
      nonce: `walk-${run}`,
    },
    diceCue: context.diceCue
      ? {
          ...context.diceCue,
          rolling: false,
        }
      : null,
  };
});

const showEventAtLanding = presentationSetup.assign(({ context }) => {
  const pending = context.pendingAfterMoveState;
  if (!pending || !context.activePlayerId || context.landingPosition === null) return {};

  return {
    displayState: stateWithPlayerPosition(pending, context.activePlayerId, context.landingPosition),
    activeMotion: null,
    diceCue: null,
  };
});

const showJumpMotion = presentationSetup.assign(({ context }) => {
  const pending = context.pendingAfterMoveState;
  if (!pending || !context.activePlayerId || context.landingPosition === null) return {};

  const finalPosition = playerPosition(pending, context.activePlayerId);
  if (finalPosition === null) return {};

  const run = context.animationRun + 1;
  return {
    animationRun: run,
    displayState: pending,
    activeMotion: {
      playerId: context.activePlayerId,
      path: [context.landingPosition, finalPosition],
      kind: "jump" as const,
      nonce: `jump-${run}`,
    },
    diceCue: null,
  };
});

const showLatestStateAndClearMotion = presentationSetup.assign(({ context }) => {
  const latest = context.pendingAfterMoveState ?? context.authoritativeState;
  return {
    displayState: latest,
    pendingAfterMoveState: null,
    landingState: null,
    activePlayerId: null,
    landingPosition: null,
    motionPath: [],
    activeMotion: null,
    diceCue: null,
  };
});

export const gamePresentationMachine = presentationSetup.createMachine({
  id: "gamePresentation",
  context: ({ input }) => ({
    authoritativeState: input.initialState,
    displayState: input.initialState,
    pendingAfterMoveState: null,
    landingState: null,
    activePlayerId: null,
    landingPosition: null,
    motionPath: [],
    activeMotion: null,
    diceCue: null,
    animationRun: 0,
  }),
  initial: "idle",
  states: {
    idle: {
      on: {
        [BoardPresentationEventType.ROLL_REQUESTED]: {
          target: "rollingDice",
          actions: startLocalDice,
        },
        [BoardPresentationEventType.SERVER_STATE]: [
          {
            guard: "isRollUpdate",
            target: "rollingDice",
            actions: captureRollUpdate,
          },
          {
            actions: showServerState,
          },
        ],
      },
    },
    rollingDice: {
      on: {
        [BoardPresentationEventType.SERVER_STATE]: {
          actions: capturePendingServerState,
        },
      },
      after: {
        diceDelay: [
          {
            guard: "hasMotionPath",
            target: "moving",
            actions: showLandingMotion,
          },
          {
            target: "idle",
            actions: showLatestStateAndClearMotion,
          },
        ],
      },
    },
    moving: {
      on: {
        [BoardPresentationEventType.SERVER_STATE]: {
          actions: capturePendingServerState,
        },
      },
      after: {
        movementDelay: [
          {
            guard: "hasDeferredEventJump",
            target: "eventReading",
            actions: showEventAtLanding,
          },
          {
            guard: "pendingStateIsEvent",
            target: "eventReady",
            actions: showLatestStateAndClearMotion,
          },
          {
            guard: "pendingStateIsMinigame",
            target: "minigameReady",
            actions: showLatestStateAndClearMotion,
          },
          {
            target: "idle",
            actions: showLatestStateAndClearMotion,
          },
        ],
      },
    },
    eventReading: {
      on: {
        [BoardPresentationEventType.SERVER_STATE]: {
          actions: capturePendingServerState,
        },
      },
      after: {
        eventReadDelay: {
          target: "jumping",
          actions: showJumpMotion,
        },
      },
    },
    jumping: {
      on: {
        [BoardPresentationEventType.SERVER_STATE]: {
          actions: capturePendingServerState,
        },
      },
      after: {
        jumpDelay: {
          target: "eventReady",
          actions: showLatestStateAndClearMotion,
        },
      },
    },
    eventReady: {
      on: {
        [BoardPresentationEventType.SERVER_STATE]: [
          {
            guard: "isRollUpdate",
            target: "rollingDice",
            actions: captureRollUpdate,
          },
          {
            target: "idle",
            actions: showServerState,
          },
        ],
      },
    },
    minigameReady: {
      on: {
        [BoardPresentationEventType.SERVER_STATE]: [
          {
            guard: "isRollUpdate",
            target: "rollingDice",
            actions: captureRollUpdate,
          },
          {
            target: "idle",
            actions: showServerState,
          },
        ],
      },
    },
  },
});

function createRollPlan(previous: GameState, next: GameState): RollPlan | null {
  const playerId = activePlayerId(previous) ?? activePlayerId(next);
  if (!playerId || !next.lastRoll || next.lastRoll < 1) return null;
  if (previous.lastRoll === next.lastRoll && previous.phase !== "turn") return null;

  const startPosition = playerPosition(previous, playerId);
  const finalPosition = playerPosition(next, playerId);
  if (startPosition === null || finalPosition === null) return null;

  const rollLanding = clamp(startPosition + next.lastRoll, 0, Math.max(0, next.boardLength - 1));
  const landingPosition = next.phase === "moving" ? finalPosition : rollLanding;
  if (landingPosition === startPosition && finalPosition === startPosition) return null;

  const landingState =
    next.phase === "moving"
      ? next
      : withoutTransientBoardState(stateWithPlayerPosition(next, playerId, landingPosition), "moving");

  return {
    playerId,
    roll: next.lastRoll,
    landingState,
    pendingAfterMoveState: next.phase === "moving" ? null : next,
    landingPosition,
    path: numericPath(startPosition, landingPosition),
  };
}

function hasDeferredEventJump(context: BoardPresentationContext): boolean {
  const pending = context.pendingAfterMoveState;
  if (!pending || pending.phase !== "event" || !pending.activeEvent || !context.activePlayerId || context.landingPosition === null) {
    return false;
  }

  const finalPosition = playerPosition(pending, context.activePlayerId);
  return finalPosition !== null && finalPosition !== context.landingPosition;
}

function withoutTransientBoardState(state: GameState, phase: Phase): GameState {
  return {
    ...state,
    phase,
    activeEvent: phase === "event" ? state.activeEvent : null,
    activeMinigame: phase === "minigame" ? state.activeMinigame : null,
    reveal: phase === "reveal" ? state.reveal : null,
  };
}

function stateWithPlayerPosition(state: GameState, playerId: string, position: number): GameState {
  return {
    ...state,
    players: state.players.map((player) => (player.id === playerId ? { ...player, position } : player)),
  };
}

function activePlayerId(state: GameState): string | null {
  return state.turnOrder[state.activeIndex] ?? null;
}

function playerPosition(state: GameState, playerId: string): number | null {
  return state.players.find((player: Player) => player.id === playerId)?.position ?? null;
}

function numericPath(from: number, to: number): number[] {
  if (from === to) return [to];
  const step = from < to ? 1 : -1;
  const length = Math.abs(to - from) + 1;
  return Array.from({ length }, (_, index) => from + index * step);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
