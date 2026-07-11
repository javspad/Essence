import assert from "node:assert/strict";
import {
  addCardVoteCard,
  cardVoteEditorContent,
  moveCardVoteCard,
  removeCardVoteCard,
  updateCardVoteCard,
} from "./cardVoteEditor";

const normalized = cardVoteEditorContent({
  cards: ["First", "Second"],
  allowSelfVote: false,
  tieMode: "noCard",
  customFlag: "preserved",
});
assert.deepEqual(normalized.cards, ["First", "Second"]);
assert.equal(normalized.allowSelfVote, false);
assert.equal(normalized.tieMode, "noCard");
assert.equal(normalized.customFlag, "preserved");

const edited = updateCardVoteCard(normalized, 0, "Updated first");
assert.deepEqual(edited.cards, ["Updated first", "Second"]);

const moved = moveCardVoteCard(edited, 0, 1);
assert.deepEqual(moved.cards, ["Second", "Updated first"]);
assert.equal(moveCardVoteCard(moved, 0, -1), moved, "out-of-range moves keep the same content object");

const added = addCardVoteCard(moved);
assert.deepEqual(added.cards, ["Second", "Updated first", ""]);
assert.deepEqual(removeCardVoteCard(added, 1).cards, ["Second", ""]);

const single = cardVoteEditorContent({ cards: ["Only"] });
assert.equal(removeCardVoteCard(single, 0), single, "the editor keeps at least one sentence");
assert.deepEqual(cardVoteEditorContent(null).cards, [""], "invalid content gets one editable sentence");
