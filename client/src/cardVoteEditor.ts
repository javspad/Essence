import type { CardVoteActivityContent } from "@essence/shared";

export type EditableCardVoteContent = CardVoteActivityContent & Record<string, unknown>;

export function cardVoteEditorContent(content: unknown): EditableCardVoteContent {
  const base = isRecord(content) ? content : {};
  const cards = Array.isArray(base.cards)
    ? base.cards.filter((card): card is string => typeof card === "string")
    : [];
  return {
    ...base,
    cards: cards.length ? cards : [""],
    allowSelfVote: base.allowSelfVote !== false,
    tieMode: base.tieMode === "noCard" ? "noCard" : "shared",
  };
}

export function updateCardVoteCard(content: EditableCardVoteContent, index: number, card: string): EditableCardVoteContent {
  if (index < 0 || index >= content.cards.length) return content;
  return { ...content, cards: content.cards.map((current, currentIndex) => currentIndex === index ? card : current) };
}

export function addCardVoteCard(content: EditableCardVoteContent): EditableCardVoteContent {
  return { ...content, cards: [...content.cards, ""] };
}

export function removeCardVoteCard(content: EditableCardVoteContent, index: number): EditableCardVoteContent {
  if (content.cards.length <= 1 || index < 0 || index >= content.cards.length) return content;
  return { ...content, cards: content.cards.filter((_, currentIndex) => currentIndex !== index) };
}

export function moveCardVoteCard(content: EditableCardVoteContent, index: number, direction: -1 | 1): EditableCardVoteContent {
  const nextIndex = index + direction;
  if (index < 0 || index >= content.cards.length || nextIndex < 0 || nextIndex >= content.cards.length) return content;
  const cards = [...content.cards];
  [cards[index], cards[nextIndex]] = [cards[nextIndex], cards[index]];
  return { ...content, cards };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
