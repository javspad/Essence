import { readFile, writeFile } from "node:fs/promises";

const extractionPath = new URL("./story-source-extraction.json", import.meta.url);
const data = JSON.parse(await readFile(extractionPath, "utf8"));

const eventById = (id) => {
  const event = data.events.find((candidate) => candidate.id === id);
  if (!event) throw new Error(`Missing reviewed event: ${id}`);
  return event;
};

const setActivity = (event, type, content, status = "ready_for_review") => {
  event.presentation.type = "minigame_intro";
  event.presentation.suggested_activity_type = type;
  event.presentation.suggested_activity_content = content;
  event.presentation.content_authoring_status = status;
};

const setReview = (event, {
  comment,
  currentPrimitive,
  support,
  proposedVersion,
  rankingConsequences = [],
  immediateConsequences = [],
  requiredFeature = null,
  interpretation = null
}) => {
  event.review_comment = comment;
  event.proposed_adaptation = {
    current_primitive: currentPrimitive,
    support,
    proposed_version: proposedVersion
  };
  event.reviewed_event_builder = {
    activity: {
      type: event.presentation.suggested_activity_type,
      content: event.presentation.suggested_activity_content
    },
    ranking_consequences: rankingConsequences,
    immediate_consequences: immediateConsequences,
    required_feature: requiredFeature,
    interpretation
  };
};

{
  const event = eventById("event-049");
  setActivity(event, "vote", { question: "¿Quién es el primero que se va a dormir hoy?" });
  setReview(event, {
    comment: "Vamos a mover este a vote. Pone quien es el primero que se va a dormir hoy.",
    currentPrimitive: "vote result + skipTurn",
    support: "supported",
    proposedVersion: "Usar Vote con la pregunta «¿Quién es el primero que se va a dormir hoy?». El jugador más votado pierde su próximo turno.",
    rankingConsequences: [{ appliesTo: "winner", actions: [{ type: "skipTurn", text: "El más votado pierde su próximo turno." }] }]
  });
}

data.events = data.events.filter((event) => event.id !== "event-052");

{
  const event = eventById("event-057");
  const prompt = "Creá el mejor título para el video de oratoria.";
  event.presentation.pre_minigame_caption = prompt;
  setActivity(event, "judge", { prompt, placeholder: "Escribí el título del video…" });
  setReview(event, {
    comment: "Cambia la premisa del ejercicio a: Crea el mejor titulo para el video de oratoria.",
    currentPrimitive: "judge ranking + move",
    support: "supported",
    proposedVersion: "Usar Judge para elegir el mejor título del video de oratoria. El ganador avanza 5 casilleros.",
    rankingConsequences: [{ appliesTo: "winner", actions: [{ type: "move", delta: 5, text: "El mejor título avanza 5 casilleros." }] }]
  });
}

{
  const event = eventById("event-059");
  setActivity(event, "vote", { question: "¿Quién tiene más paciencia?" });
  setReview(event, {
    comment: "Cambiar pregunta a: ¿Quién tiene más paciencia?",
    currentPrimitive: "ranking consequences",
    support: "supported",
    proposedVersion: "Usar Vote con la pregunta «¿Quién tiene más paciencia?». El ganador avanza 5 casilleros y el último retrocede 5.",
    rankingConsequences: [
      { appliesTo: "winner", actions: [{ type: "move", delta: 5 }] },
      { appliesTo: "loser", actions: [{ type: "move", delta: -5 }] }
    ]
  });
}

{
  const event = eventById("event-060");
  const label = "Cosechás tus regalos: agarralo rápido antes de que se lo lleven.";
  event.presentation.pre_minigame_caption = label;
  setActivity(event, "timing", { label, windowMs: 350 });
  setReview(event, {
    comment: "Cambiar el título para introducir la acción: Cosechás tus regalos, agarralo rápido antes de que se lo lleven.",
    currentPrimitive: "ranking effects",
    support: "partial",
    proposedVersion: "Usar Timing con la nueva premisa. El ganador recibe movimiento x2 por un turno; el último recibe movimiento x0,5 por dos rondas.",
    rankingConsequences: [
      { appliesTo: "winner", actions: [{ type: "applyEffect", effectId: "movement-x2-one-turn", status: "effect_needs_authoring" }] },
      { appliesTo: "loser", actions: [{ type: "applyEffect", effectId: "half-roll-2-rounds" }] }
    ]
  });
}

{
  const event = eventById("event-061");
  const prompt = "Escribí la mejor reflexión acerca de las falsas amistades.";
  setActivity(event, "judge", { prompt, placeholder: "Escribí tu reflexión…" });
  setReview(event, {
    comment: "Mover esta tarjeta a Judge en vez de trivia.",
    currentPrimitive: "judge ranking + turn consequences",
    support: "supported",
    proposedVersion: "Usar Judge para elegir la mejor reflexión. El ganador obtiene un turno extra y el resto pierde su próximo turno.",
    rankingConsequences: [
      { appliesTo: "winner", actions: [{ type: "extraTurn" }] },
      { appliesTo: { rankFrom: 2, rankTo: 99 }, actions: [{ type: "skipTurn" }] }
    ]
  });
}

{
  const event = eventById("event-062");
  setReview(event, {
    comment: "El ganador avanza 3 casillas.",
    currentPrimitive: "move by rank",
    support: "supported",
    proposedVersion: "Resolver Reaction por ranking; el ganador avanza 3 casilleros.",
    rankingConsequences: [{ appliesTo: "winner", actions: [{ type: "move", delta: 3 }] }]
  });
}

{
  const event = eventById("event-068");
  const label = "Soltá el regalo mientras el taxista no te ve.";
  event.presentation.pre_minigame_caption = label;
  setActivity(event, "redlight", { label, trackLength: 45, durationMs: 60000 });
  setReview(event, {
    comment: "Poner como mensaje: soltá el regalo mientras el taxista no te ve.",
    currentPrimitive: "move by rank",
    support: "supported",
    proposedVersion: "Usar Luz roja, luz verde con la nueva instrucción. El ganador avanza 3 casilleros.",
    rankingConsequences: [{ appliesTo: "winner", actions: [{ type: "move", delta: 3 }] }]
  });
}

{
  const event = eventById("event-069");
  setActivity(event, "vote", { question: "¿Quién imita mejor a Adrián?" });
  setReview(event, {
    comment: "En la pregunta, reemplazar rector favorito por Adrián.",
    currentPrimitive: "vote ranking + extraTurn",
    support: "supported",
    proposedVersion: "Usar Vote con la pregunta «¿Quién imita mejor a Adrián?». El ganador obtiene un turno extra.",
    rankingConsequences: [{ appliesTo: "winner", actions: [{ type: "extraTurn" }] }]
  });
}

{
  const event = eventById("event-070");
  setReview(event, {
    comment: "El ganador se mueve hasta la posición de Nico.",
    currentPrimitive: "moveToPlayerPosition",
    support: "planned",
    proposedVersion: "El ganador se mueve hasta la posición actual de Nico. Requiere el feature moveToPlayerPosition ya registrado en el roadmap.",
    requiredFeature: "moveToPlayerPosition",
    rankingConsequences: [{ appliesTo: "winner", actions: [{ type: "moveToPlayerPosition", playerId: "nico", status: "planned" }] }]
  });
  event.target_player_id = "nico";
}

{
  const event = eventById("event-072");
  setReview(event, {
    comment: "El perdedor pierde solamente 2 turnos.",
    currentPrimitive: "multi-turn skip counter",
    support: "planned",
    proposedVersion: "El perdedor pierde sus próximos 2 turnos. El skipTurn actual usa un Set y solo conserva un turno pendiente, por lo que hace falta un contador o efecto equivalente.",
    requiredFeature: "stackedSkipTurns",
    rankingConsequences: [{ appliesTo: "loser", actions: [{ type: "skipTurn", turns: 2, status: "planned" }] }]
  });
}

{
  const event = eventById("event-078");
  const label = "Tirá el examen por la ventana mientras Gio no te ve.";
  event.presentation.pre_minigame_caption = label;
  setActivity(event, "redlight", { label, trackLength: 45, durationMs: 60000 });
  setReview(event, {
    comment: "Usar como mensaje introductorio: tirá el examen por la ventana mientras Gio no te ve.",
    currentPrimitive: "coins by rank",
    support: "supported",
    proposedVersion: "Usar Luz roja, luz verde con la nueva instrucción. El perdedor pierde 5 monedas.",
    rankingConsequences: [{ appliesTo: "loser", actions: [{ type: "coins", value: -5 }] }]
  });
}

{
  const event = eventById("event-082");
  setReview(event, {
    comment: "El ganador gana 10 monedas.",
    currentPrimitive: "coins by rank",
    support: "supported",
    proposedVersion: "Resolver Reaction por ranking; el ganador gana 10 monedas.",
    rankingConsequences: [{ appliesTo: "winner", actions: [{ type: "coins", value: 10 }] }]
  });
}

{
  const event = eventById("event-086");
  setActivity(event, "vote", { question: "¿Quién se hace más pajas por día?" });
  setReview(event, {
    comment: "Cambiar la pregunta a: ¿Quién se hace más pajas por día?",
    currentPrimitive: "vote ranking + coins",
    support: "supported",
    proposedVersion: "Usar Vote con la nueva pregunta. El jugador más votado gana 5 monedas.",
    rankingConsequences: [{ appliesTo: "winner", actions: [{ type: "coins", value: 5 }] }]
  });
}

{
  const event = eventById("event-092");
  setReview(event, {
    comment: "El perdedor pierde un punto apenas.",
    currentPrimitive: "coins by rank",
    support: "supported",
    proposedVersion: "El perdedor pierde 1 moneda. Se interpreta «punto» como moneda porque el juego no tiene un recurso persistente genérico de puntos.",
    rankingConsequences: [{ appliesTo: "loser", actions: [{ type: "coins", value: -1 }] }],
    interpretation: "User wording 'one point' mapped to 1 coin; revise if 'one cell' was intended."
  });
}

const reviewedEvent = ({ id, sourceId, caption, effect, activityType, content, adaptation, immediateConsequences = [] }) => ({
  id,
  source_caption_group_id: sourceId,
  duplicate_of_caption: null,
  source_origin: "user_review_note",
  original_caption: caption,
  original_effect_proposed: effect,
  media_asset_id: null,
  presentation: {
    type: "minigame_intro",
    pre_minigame_caption: caption,
    prompt_caption: null,
    suggested_activity_type: activityType,
    activity_model_note: "Uses a current Event Builder activity.type engine and was added from a natural-language review note.",
    suggested_activity_content: content,
    content_authoring_status: "ready_for_review"
  },
  proposed_adaptation: adaptation,
  reviewed_event_builder: {
    activity: { type: activityType, content },
    ranking_consequences: [],
    immediate_consequences: immediateConsequences,
    required_feature: null,
    interpretation: null
  }
});

const newEvents = [
  reviewedEvent({
    id: "event-103",
    sourceId: "review-note-001",
    caption: "Examen de matemática: usá la calculadora mientras no te ven.",
    effect: null,
    activityType: "horserace",
    content: { label: "Examen de matemática: usá la calculadora mientras no te ven.", trackLength: 40, durationMs: 45000 },
    adaptation: {
      current_primitive: "base ranking reward comment",
      support: "comment_only",
      proposed_version: "Usar Carrera de caballos con la premisa del examen de matemática. Mantener por ahora la recompensa base como comentario."
    }
  }),
  reviewedEvent({
    id: "event-104",
    sourceId: "review-note-002",
    caption: "Estás con sueño: bostezá mientras Cristina no te ve.",
    effect: "Nico pierde 5 monedas y retrocede 1 casillero sin importar su posición; el resto resuelve el ranking normalmente.",
    activityType: "redlight",
    content: { label: "Estás con sueño: bostezá mientras Cristina no te ve.", trackLength: 45, durationMs: 60000 },
    adaptation: {
      current_primitive: "fixed-player coins + move",
      support: "supported",
      proposed_version: "Usar Luz roja, luz verde. Al resolver, Nico pierde 5 monedas y retrocede 1 casillero sin importar su ranking; el resto mantiene el resultado normal del minijuego."
    },
    immediateConsequences: [
      { appliesTo: { playerId: "nico" }, actions: [{ type: "coins", value: -5 }, { type: "move", delta: -1 }] }
    ]
  })
];

const newIds = new Set(newEvents.map((event) => event.id));
data.events = [...data.events.filter((event) => !newIds.has(event.id)), ...newEvents];

data.event_review = {
  id: "event-review-2026-07-11-01",
  applied_on: "2026-07-11",
  source_file: "/Users/facundopri/.codex/attachments/40be83ea-5e87-4768-85d0-df5100b1cb39/pasted-text.txt",
  updated_event_ids: ["event-049", "event-057", "event-059", "event-060", "event-061", "event-062", "event-068", "event-069", "event-070", "event-072", "event-078", "event-082", "event-086", "event-092"],
  removed_event_ids: ["event-052"],
  added_event_ids: ["event-103", "event-104"],
  interpretations: [{ event_id: "event-092", source_wording: "pierde un punto", applied_as: "loses 1 coin", reason: "The current app has persistent coins but no generic persistent points." }]
};

await writeFile(extractionPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`Applied review: ${data.event_review.updated_event_ids.length} updated, ${data.event_review.removed_event_ids.length} removed, ${data.event_review.added_event_ids.length} added.`);
