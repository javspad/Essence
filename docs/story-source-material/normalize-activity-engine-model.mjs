import { readFile, writeFile } from "node:fs/promises";

const extractionPath = new URL("./story-source-extraction.json", import.meta.url);
const productionContentPath = new URL("../../shared/content.json", import.meta.url);
const data = JSON.parse(await readFile(extractionPath, "utf8"));
const production = JSON.parse(await readFile(productionContentPath, "utf8"));

const standardReward = "Comentario solamente — recompensa base sugerida: 1.º +5 monedas, 2.º +3 monedas y todos los demás participantes +1 moneda. No modifica el contenido jugable todavía.";
const nonCompetitiveReward = "Comentario solamente — este motor no necesita una recompensa competitiva automática; las consecuencias se deben autorizar explícitamente en el evento.";
const cardVoteReward = "Comentario solamente — recompensa sugerida: +1 moneda por cada carta ganada y bonus final de +5/+3/+1 por ranking. No modifica el contenido jugable todavía.";

const engineDefinitions = [
  ["prompt", "Prompt", "Prompt", nonCompetitiveReward],
  ["hostPick", "Host pick", "HostPick", nonCompetitiveReward],
  ["selfTap", "Self tap", "SelfTap", nonCompetitiveReward],
  ["vote", "Vote", "Vote", standardReward],
  ["cardVote", "Card vote", "CardVote", cardVoteReward],
  ["judge", "Judge", "Judge", standardReward],
  ["timing", "Timing", "Timing", standardReward],
  ["reaction", "Reaction", "Reaction", standardReward],
  ["buzzer", "Buzzer / trivia", "Buzzer", standardReward],
  ["estimate", "Estimate", "Estimate", standardReward],
  ["whack", "Whack", "Whack", standardReward],
  ["maze", "Laberinto", "Maze", standardReward],
  ["flappy", "Flappy bird", "Flappy", standardReward],
  ["snake", "Snake", "Snake", standardReward],
  ["horserace", "Carrera de caballos", "HorseRace", standardReward],
  ["redlight", "Luz roja, luz verde", "RedLight", standardReward]
];

data.current_app_reference.activity_engine_source = {
  verified_on: "2026-07-11",
  event_builder_types_file: "shared/events.ts#EVENT_ACTIVITY_TYPES",
  client_registry_file: "client/src/minigames/index.ts#ENGINES",
  note: "activity.type selects the reusable engine. Event IDs, skins, questions, and labels are authored content, not additional engine types.",
  legacy_fields_excluded: ["activity.resolutionMode", "EventResolutionMode.none"]
};
data.current_app_reference.activity_engines = engineDefinitions.map(([id, label, component, reward]) => ({
  id,
  label,
  event_builder_supported: true,
  client_engine_component: component,
  base_coin_reward_comment: reward
}));

const oldTemplates = data.event_templates ?? data.minigame_templates ?? [];
data.event_templates = oldTemplates.map((template) => {
  const productionEventId = template.id === "card-vote" ? null : `event-${template.id}`;
  const productionEvent = productionEventId ? production.events?.[productionEventId] : null;
  const originalName = template.short_name ?? template.name;
  const shortName = originalName.includes(" · ") ? originalName.split(" · ").slice(1).join(" · ") : originalName;
  const mismatch = template.id === "dos-verdades-1";
  return {
    id: template.id,
    short_name: shortName,
    activity_type: template.activity_type,
    production_event_id: productionEventId,
    production_event_name: productionEvent?.name ?? null,
    production_status: productionEvent ? "available" : "reference_only",
    engine_fit: mismatch ? "mismatch" : productionEvent ? "compatible" : "engine_supported_content_not_seeded",
    recommended_activity_type: mismatch ? "buzzer" : null,
    recommendation_status: mismatch ? "needs_statements_and_answer_key" : null,
    engine_fit_note: mismatch
      ? "The current Vote engine selects a player. This prompt asks players to select which statement is the lie, so it needs Buzzer/multiple-choice content or a different interaction."
      : productionEvent
        ? `Verified against ${productionEventId}: activity.type is ${productionEvent.activity?.type}.`
        : "The Card vote engine exists in Event Builder and the runtime, but this reference content is not present in shared/content.json yet.",
    base_coin_reward_comment: template.base_coin_reward_comment
  };
});
delete data.minigame_templates;

const templateById = new Map(data.event_templates.map((template) => [template.id, template]));
const voteQuestions = {
  "event-020": "¿Quién es más probable que pierda el celular esta noche?",
  "event-043": "¿Quién del grupo tendría que repetir salita de cinco?",
  "event-059": "¿Quién tiene menos paciencia para atender boludos?",
  "event-069": "¿Quién imita mejor al rector favorito?",
  "event-086": "¿Quién practica más el amor propio?"
};

for (const event of data.events) {
  const previousTemplateId = event.presentation?.suggested_minigame_id;
  if (event.presentation) delete event.presentation.suggested_minigame_id;
  if (!previousTemplateId) continue;
  const template = templateById.get(previousTemplateId);
  if (!template) throw new Error(`Missing event template for ${previousTemplateId}`);
  event.presentation.suggested_activity_type = template.activity_type;
  event.presentation.activity_model_note = "Uses the current Event Builder activity.type engine; the story caption supplies new authored content rather than becoming a new engine type.";
  if (template.activity_type === "vote") {
    event.presentation.suggested_activity_content = { question: voteQuestions[event.id] ?? event.original_caption };
    event.presentation.content_authoring_status = "ready_for_review";
  } else if (template.activity_type === "buzzer") {
    event.presentation.suggested_activity_content = { question: event.original_caption, options: [], answer: null };
    event.presentation.content_authoring_status = "needs_options_and_answer";
  } else if (template.activity_type === "estimate") {
    event.presentation.suggested_activity_content = { question: event.original_caption, unit: "por definir", answer: null };
    event.presentation.content_authoring_status = "needs_unit_and_answer";
  } else {
    event.presentation.suggested_activity_content = { label: event.original_caption };
    event.presentation.content_authoring_status = "ready_for_review";
  }
  delete event.minigame_reuse_note;
  event.proposed_adaptation.proposed_version = event.proposed_adaptation.proposed_version
    .replace(/Usar Más probable II:[^;]+;/, "Usar el motor Vote con una pregunta nueva;")
    .replace(/Usar Dos verdades y una mentira con el beat de salita de cinco;/, "Usar el motor Vote con una pregunta que selecciona a un jugador;")
    .replace(/Usar Quién dijo para convertir el beat de amor propio en una votación de cita;/, "Usar el motor Vote con una pregunta nueva sobre amor propio;")
    .replace(/la recompensa base queda como comentario en el template\./, "la recompensa base queda como comentario del motor.");
}

for (const question of data.trivia) {
  delete question.minigame_template_id;
  delete question.suggested_engine;
  question.suggested_activity_type = "buzzer";
  question.activity_content = {
    question: question.question,
    options: question.choices.map((choice) => choice.text),
    answer: null
  };
  question.content_authoring_status = "needs_answer_key";
  question.content_authoring_note = "Buzzer requires a zero-based answer index. The source extraction does not identify the correct choice."
}

for (const set of data.card_vote_sets) {
  set.suggested_activity_type = "cardVote";
  set.production_status = "reference_only_not_seeded";
}

await writeFile(extractionPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`Normalized ${data.current_app_reference.activity_engines.length} activity engines, ${data.event_templates.length} content templates, ${data.events.length} story events, and ${data.trivia.length} trivia events.`);
