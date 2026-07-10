import type { CoinSource, CoinTransaction, Player } from "@essence/shared";

export interface CoinDeltaRequest {
  id: string;
  playerId: string;
  delta: number;
  source: CoinSource;
  text?: string;
  allowPartial?: boolean;
  counterpartyPlayerId?: string;
}

export interface CoinTransferRequest {
  nextId: () => string;
  fromPlayerId: string;
  toPlayerId: string;
  amount: number;
  source: CoinSource;
  text?: string;
  allowPartial?: boolean;
}

export function canSpendCoins(player: Pick<Player, "coins">, amount: number): boolean {
  return player.coins >= coinAmount(amount);
}

export function applyCoinDelta(players: Player[], request: CoinDeltaRequest): CoinTransaction | null {
  const player = players.find((candidate) => candidate.id === request.playerId);
  if (!player) return null;

  const requestedDelta = coinDelta(request.delta);
  const before = coinBalance(player.coins);
  if (requestedDelta === 0) {
    return transactionFor(player.id, before, before, requestedDelta, request, false);
  }

  if (requestedDelta < 0) {
    const spend = Math.abs(requestedDelta);
    const actualSpend = Math.min(before, spend);
    if (request.allowPartial === false && actualSpend < spend) return null;
    const after = before - actualSpend;
    player.coins = after;
    return transactionFor(player.id, before, after, requestedDelta, request, actualSpend < spend);
  }

  const after = before + requestedDelta;
  player.coins = after;
  return transactionFor(player.id, before, after, requestedDelta, request, false);
}

export function applyCoinTransfer(players: Player[], request: CoinTransferRequest): CoinTransaction[] {
  if (request.fromPlayerId === request.toPlayerId) return [];
  const amount = coinAmount(request.amount);
  if (amount <= 0) return [];
  const debit = applyCoinDelta(players, {
    id: request.nextId(),
    playerId: request.fromPlayerId,
    delta: -amount,
    source: request.source,
    text: request.text,
    allowPartial: request.allowPartial,
    counterpartyPlayerId: request.toPlayerId,
  });
  if (!debit) return [];

  const transferred = Math.abs(debit.delta);
  if (transferred <= 0) return [debit];
  const credit = applyCoinDelta(players, {
    id: request.nextId(),
    playerId: request.toPlayerId,
    delta: transferred,
    source: request.source,
    text: request.text,
    counterpartyPlayerId: request.fromPlayerId,
  });
  return credit ? [debit, credit] : [debit];
}

export function coinTransactionsSummary(transactions: CoinTransaction[], players: Pick<Player, "id" | "name">[]): string {
  if (!transactions.length) return "No coins changed.";
  return transactions.map((transaction) => coinTransactionSummary(transaction, players)).join(" ");
}

export function coinTransactionSummary(transaction: CoinTransaction, players: Pick<Player, "id" | "name">[]): string {
  const name = players.find((player) => player.id === transaction.playerId)?.name ?? transaction.playerId;
  const verb = transaction.delta >= 0 ? "gains" : "loses";
  const amount = Math.abs(transaction.delta);
  const requested = Math.abs(transaction.requestedDelta);
  const clamp = transaction.clamped ? ` (clamped from ${requested})` : "";
  return `${name} ${verb} ${amount} coin${amount === 1 ? "" : "s"}${clamp}.`;
}

function transactionFor(
  playerId: string,
  before: number,
  after: number,
  requestedDelta: number,
  request: CoinDeltaRequest,
  clamped: boolean
): CoinTransaction {
  const delta = after - before;
  return {
    id: request.id,
    playerId,
    delta,
    requestedDelta,
    before,
    after,
    source: request.source,
    text: request.text ?? request.source.label,
    ...(request.counterpartyPlayerId ? { counterpartyPlayerId: request.counterpartyPlayerId } : {}),
    ...(clamped ? { clamped: true } : {}),
  };
}

function coinBalance(value: number): number {
  return Math.max(0, coinAmount(value));
}

function coinDelta(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

function coinAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}
