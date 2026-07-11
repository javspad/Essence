import assert from "node:assert/strict";
import {
  advanceCardVotePlaytest,
  cardVotePlaytestRanking,
  createCardVotePlaytestRun,
  submitCardVotePlaytestVote,
} from "./cardVotePlaytest";

const participants = ["alice", "bob", "carla"];
let run = createCardVotePlaytestRun(
  { cards: ["Card one", "Card two", "Card three"], allowSelfVote: true, tieMode: "shared" },
  participants,
  participants
);

run = voteRound(run, { alice: "bob", bob: "bob", carla: "bob" });
assert.equal(run.phase, "result", "card 1 shows a round result instead of ending the minigame");
assert.equal(run.cardIndex, 0);
assert.deepEqual(run.roundResult?.voteCounts, { alice: 0, bob: 3, carla: 0 });
assert.deepEqual(run.roundResult?.winnerIds, ["bob"]);
assert.deepEqual(run.cardCounts, { alice: 0, bob: 1, carla: 0 });

run = advanceCardVotePlaytest(run);
assert.equal(run.phase, "voting");
assert.equal(run.cardIndex, 1);
assert.deepEqual(run.submitted, []);

run = voteRound(run, { alice: "alice", bob: "alice", carla: "bob" });
assert.deepEqual(run.roundResult?.voteCounts, { alice: 2, bob: 1, carla: 0 });
assert.deepEqual(run.cardCounts, { alice: 1, bob: 1, carla: 0 });

run = advanceCardVotePlaytest(run);
run = voteRound(run, { alice: "alice", bob: "alice", carla: "bob" });
assert.deepEqual(run.cardCounts, { alice: 2, bob: 1, carla: 0 });
assert.equal(run.phase, "result", "the last card still shows its vote totals before the final ranking");

run = advanceCardVotePlaytest(run);
assert.equal(run.phase, "complete");
assert.deepEqual(cardVotePlaytestRanking(run), ["alice", "bob", "carla"]);
assert.equal(run.cardCounts.alice > run.cardCounts.bob, true, "winner is ranked by cards, not total votes");

function voteRound(
  current: ReturnType<typeof createCardVotePlaytestRun>,
  votes: Record<string, string>
) {
  return Object.entries(votes).reduce(
    (next, [voterId, votedFor]) => submitCardVotePlaytestVote(next, voterId, votedFor),
    current
  );
}
