import type { CardVoteTieMode } from "@essence/shared";
import { cardVoteEditorContent } from "./cardVoteEditor";

export interface CardVotePlaytestRoundResult {
  card: string;
  cardIndex: number;
  winnerIds: string[];
  voteCounts: Record<string, number>;
  votersByPlayer: Record<string, string[]>;
}

export interface CardVotePlaytestRun {
  phase: "voting" | "result" | "complete";
  cards: string[];
  cardIndex: number;
  participants: string[];
  subjects: string[];
  allowSelfVote: boolean;
  tieMode: CardVoteTieMode;
  submitted: string[];
  votes: Record<string, string>;
  cardCounts: Record<string, number>;
  cardsWonByPlayer: Record<string, string[]>;
  roundResult?: CardVotePlaytestRoundResult;
}

export function createCardVotePlaytestRun(
  content: unknown,
  participants: string[],
  subjects: string[]
): CardVotePlaytestRun {
  const editable = cardVoteEditorContent(content);
  const cards = editable.cards.flatMap((card) => card.trim() ? [card.trim()] : []);
  return {
    phase: "voting",
    cards: cards.length ? cards : ["¿Quién encaja mejor con esta carta?"],
    cardIndex: 0,
    participants: [...participants],
    subjects: [...subjects],
    allowSelfVote: editable.allowSelfVote !== false,
    tieMode: editable.tieMode === "noCard" ? "noCard" : "shared",
    submitted: [],
    votes: {},
    cardCounts: Object.fromEntries(subjects.map((id) => [id, 0])),
    cardsWonByPlayer: Object.fromEntries(subjects.map((id) => [id, []])),
  };
}

export function submitCardVotePlaytestVote(
  run: CardVotePlaytestRun,
  voterId: string,
  votedFor: string
): CardVotePlaytestRun {
  if (run.phase !== "voting" || run.submitted.includes(voterId)) return run;
  if (!run.participants.includes(voterId) || !run.subjects.includes(votedFor)) return run;
  if (!run.allowSelfVote && voterId === votedFor) return run;
  const next: CardVotePlaytestRun = {
    ...run,
    submitted: [...run.submitted, voterId],
    votes: { ...run.votes, [voterId]: votedFor },
  };
  return next.participants.every((id) => next.submitted.includes(id)) ? finishCardVotePlaytestRound(next) : next;
}

export function forceCardVotePlaytestRound(run: CardVotePlaytestRun): CardVotePlaytestRun {
  return run.phase === "voting" ? finishCardVotePlaytestRound(run) : run;
}

export function advanceCardVotePlaytest(run: CardVotePlaytestRun): CardVotePlaytestRun {
  if (run.phase !== "result") return run;
  const nextIndex = run.cardIndex + 1;
  if (nextIndex >= run.cards.length) return { ...run, phase: "complete" };
  return {
    ...run,
    phase: "voting",
    cardIndex: nextIndex,
    submitted: [],
    votes: {},
    roundResult: undefined,
  };
}

export function cardVotePlaytestRanking(run: CardVotePlaytestRun): string[] {
  const order = new Map(run.subjects.map((id, index) => [id, index]));
  return [...run.subjects].sort(
    (a, b) => (run.cardCounts[b] ?? 0) - (run.cardCounts[a] ?? 0) || (order.get(a) ?? 0) - (order.get(b) ?? 0)
  );
}

function finishCardVotePlaytestRound(run: CardVotePlaytestRun): CardVotePlaytestRun {
  const votersByPlayer = Object.fromEntries(run.subjects.map((id) => [id, [] as string[]]));
  for (const [voterId, votedFor] of Object.entries(run.votes)) votersByPlayer[votedFor]?.push(voterId);
  const voteCounts = Object.fromEntries(run.subjects.map((id) => [id, votersByPlayer[id]?.length ?? 0]));
  const maxVotes = Math.max(0, ...Object.values(voteCounts));
  const leaders = maxVotes > 0 ? run.subjects.filter((id) => voteCounts[id] === maxVotes) : [];
  const winnerIds = run.tieMode === "noCard" && leaders.length > 1 ? [] : leaders;
  const card = run.cards[run.cardIndex];
  const cardCounts = { ...run.cardCounts };
  const cardsWonByPlayer = Object.fromEntries(
    run.subjects.map((id) => [id, [...(run.cardsWonByPlayer[id] ?? [])]])
  );
  for (const winnerId of winnerIds) {
    cardCounts[winnerId] = (cardCounts[winnerId] ?? 0) + 1;
    cardsWonByPlayer[winnerId].push(card);
  }
  return {
    ...run,
    phase: "result",
    cardCounts,
    cardsWonByPlayer,
    roundResult: {
      card,
      cardIndex: run.cardIndex,
      winnerIds,
      voteCounts,
      votersByPlayer,
    },
  };
}
