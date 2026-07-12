import { readFile, writeFile } from "node:fs/promises";

const extractionPath = new URL("./story-source-extraction.json", import.meta.url);
const promptsPath = new URL("../../output/amigos de mierda sentences.txt", import.meta.url);

const data = JSON.parse(await readFile(extractionPath, "utf8"));
const rawPrompts = await readFile(promptsPath, "utf8");
const prompts = rawPrompts
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const match = line.match(/^(\d+)\.\s+(.+)$/);
    if (!match) throw new Error(`Expected a numbered prompt, received: ${line}`);
    return { number: Number(match[1]), sentence: match[2] };
  });

const deckSize = 5;
const playablePromptCount = Math.floor(prompts.length / deckSize) * deckSize;
const playablePrompts = prompts.slice(0, playablePromptCount);
const unassignedPrompts = prompts.slice(playablePromptCount);
const sourceFile = "output/amigos de mierda sentences.txt";

data.card_vote_source = {
  source_file: sourceFile,
  prompt_count: prompts.length,
  deck_size: deckSize,
  playable_prompt_count: playablePrompts.length,
  unassigned_prompts: unassignedPrompts,
  note: "CardVote decks use the source file verbatim. The remaining prompt is retained here instead of inventing a fourth card or mixing in material from another source."
};

data.card_vote_sets = Array.from({ length: playablePrompts.length / deckSize }, (_, deckIndex) => {
  const round = String(deckIndex + 1).padStart(2, "0");
  const id = `card-vote-amigos-de-mierda-ronda-${round}`;
  const cards = playablePrompts.slice(deckIndex * deckSize, (deckIndex + 1) * deckSize);
  const name = `Amigos de mierda — Ronda ${round}`;

  return {
    id,
    name,
    status: "listo_para_copiar",
    source_file: sourceFile,
    purpose: "Cinco frases textuales del archivo fuente. Para cada frase, todos votan en secreto por el amigo que mejor describe; las cartas ganadas ordenan el ranking final.",
    event_definition: {
      id: `event-${id}`,
      name,
      kind: "activity",
      trigger: { type: "anyPlayer" },
      story: {
        title: name,
        prompt: "Cinco frases, cinco votos secretos. Elegí a quién describe mejor cada carta.",
        reveal: "Las cartas ganadas ordenan el ranking final."
      },
      activity: {
        type: "cardVote",
        participants: "everyone",
        subjects: "everyone",
        content: {
          allowSelfVote: false,
          tieMode: "shared",
          cards: cards.map((card) => card.sentence)
        }
      }
    },
    cards: cards.map((card, cardIndex) => ({
      id: `${id}-card-${String(cardIndex + 1).padStart(2, "0")}`,
      source_file: sourceFile,
      source_sentence_number: card.number,
      sentence: card.sentence
    }))
  };
});

await writeFile(extractionPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`Built ${data.card_vote_sets.length} CardVote decks from ${playablePrompts.length} of ${prompts.length} source prompts.`);
