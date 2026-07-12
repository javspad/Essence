import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const extractionPath = path.join(here, "story-source-extraction.json");
const contentPath = path.join(root, "shared/content.json");
const publicImageDir = path.join(root, "client/public/story-events");

const extraction = JSON.parse(fs.readFileSync(extractionPath, "utf8"));
const content = JSON.parse(fs.readFileSync(contentPath, "utf8"));

const triviaAnswers = new Map([
  [1, 1], // B
  [2, 0], // A
  [3, 0], // A
  [5, 0], // A
  [6, 1], // B
  [7, 1], // B
  [8, 2], // C
  [9, 2], // C
  [10, 2], // C
]);

const playerVoteQuestions = new Map([
  ["event-021", "¿Quién del grupo merece recibir este ukelele fuera de época?"],
  ["event-031", "¿Quién tiene el pelo más largo del grupo?"],
  ["event-036", "¿Quién es la persona más colgada del grupo?"],
  ["event-055", "¿Quién todavía se reiría de este chiste aunque ya lo hayas exprimido de más?"],
  ["event-085", "¿Quién cumple años más pronto?"],
  ["event-088", "¿Con quién te irías de festejo sin preguntar a dónde?"],
  ["event-091", "¿Quién podría quedarse dormido en cualquier lugar?"],
  ["event-093", "¿Quién tiene más alma de jubilado?"],
]);

const playerVoteReveals = new Map([
  ["event-021", "Todos votan en secreto. Quien cayó avanza hasta la posición de la persona más votada para regalarle el ukelele."],
  ["event-031", "Todos votan en secreto. Quien cayó avanza hasta la posición de la persona más votada."],
  ["event-036", "Todos votan en secreto. Quien cayó intercambia posiciones con la persona más votada."],
  ["event-055", "Todos votan en secreto. Quien cayó avanza hasta la posición de la persona más votada para seguir exprimiendo el chiste."],
  ["event-085", "Todos votan en secreto. Quien cayó avanza hasta la posición de la persona más votada para festejarle."],
  ["event-088", "Todos votan en secreto. Quien cayó avanza hasta la posición de la persona más votada para salir de festejo."],
  ["event-091", "Todos votan en secreto. Quien cayó se mueve hasta la posición de la persona más votada."],
  ["event-093", "Todos votan en secreto. Quien cayó avanza hasta la posición de la persona más votada para festejarle el cumpleaños."],
]);

for (const trivia of extraction.trivia ?? []) {
  const answer = triviaAnswers.get(trivia.source_number);
  if (answer === undefined) throw new Error(`Missing answer for trivia ${trivia.source_number}`);
  trivia.activity_content = { ...trivia.activity_content, answer };
  trivia.correct_choice_id = trivia.choices?.[answer]?.id ?? null;
  trivia.content_authoring_status = "ready";
  trivia.content_authoring_note = "Answer key supplied by the game author on 2026-07-11.";
}

normalizePlayerVoteEvents(extraction);
normalizeExtractedTraitProposals(extraction);
markImplementedStoryCapabilities(extraction);

canonicalizeGaston(content);
ensureExtractedCharacters(content, extraction.character_traits ?? []);

fs.mkdirSync(publicImageDir, { recursive: true });
const captionByAssetId = new Map(
  (extraction.events ?? []).filter((event) => event.media_asset_id).map((event) => [event.media_asset_id, event.original_caption])
);
content.mediaAssets = { ...(content.mediaAssets ?? {}) };
for (const asset of extraction.image_assets ?? []) {
  const fileName = path.basename(asset.local_path);
  fs.copyFileSync(path.join(here, asset.local_path), path.join(publicImageDir, fileName));
  content.mediaAssets[asset.id] = {
    id: asset.id,
    type: "image",
    src: `/story-events/${fileName}`,
    caption: captionByAssetId.get(asset.id) ?? "Imagen del documento fuente",
    alt: captionByAssetId.get(asset.id) ?? `Material de historia ${asset.id}`,
    fit: "contain",
  };
}

content.effects = { ...(content.effects ?? {}) };
ensureCatalogEffects(content.effects);
ensureExtractedTraits(content);

const importedEvents = {};
for (const source of extraction.events ?? []) importedEvents[source.id] = storyEvent(source, content.effects);
for (const trivia of extraction.trivia ?? []) importedEvents[`event-${trivia.id}`] = triviaEvent(trivia);
for (const set of extraction.card_vote_sets ?? []) {
  const id = set.event_definition.id;
  importedEvents[id] = cardVoteEvent(set);
}
importedEvents["trait-event-beltro-europa-universalis"] = beltroEuropaUniversalisEvent();

content.events = { ...content.events, ...importedEvents };
distributeImportedEvents(content, Object.keys(importedEvents));

fs.writeFileSync(extractionPath, `${JSON.stringify(extraction, null, 2)}\n`);
fs.writeFileSync(contentPath, `${JSON.stringify(content, null, 2)}\n`);

const importedCounts = Object.values(importedEvents).reduce((counts, event) => {
  const type = event.activity?.type ?? "prompt";
  counts[type] = (counts[type] ?? 0) + 1;
  return counts;
}, {});
console.log(JSON.stringify({
  importedEvents: Object.keys(importedEvents).length,
  totalEvents: Object.keys(content.events).length,
  characters: Object.keys(content.characters ?? {}).length,
  mediaAssets: Object.keys(content.mediaAssets ?? {}).length,
  triviaAnswers: triviaAnswers.size,
  importedCounts,
}, null, 2));

function canonicalizeGaston(gameContent) {
  const legacyCharacter = gameContent.characters?.["character-7"];
  const legacyPlayer = gameContent.players?.find((player) => player.id === "character-7");
  if (legacyCharacter) {
    const { ["character-7"]: _removed, ...rest } = gameContent.characters;
    gameContent.characters = {
      ...rest,
      gaston: { ...legacyCharacter, id: "gaston", displayName: legacyCharacter.displayName || "Gaston" },
    };
  }
  if (legacyPlayer) {
    gameContent.players = gameContent.players.map((player) =>
      player.id === "character-7" ? { ...player, id: "gaston", name: player.name || "Gaston" } : player
    );
  }
}

function normalizePlayerVoteEvents(data) {
  for (const event of data.events ?? []) {
    const question = playerVoteQuestions.get(event.id);
    if (!question) continue;
    event.presentation = {
      type: "minigame_intro",
      pre_minigame_caption: event.original_caption,
      prompt_caption: null,
      suggested_activity_type: "vote",
      activity_model_note: "Uses the current Event Builder Vote activity: every player votes in secret and the highest-ranked subject becomes the consequence target.",
      suggested_activity_content: { question },
      content_authoring_status: "ready_for_review",
    };
    event.proposed_adaptation = {
      current_primitive: event.id === "event-036" ? "vote + swapPositions" : "vote + moveToPlayerPosition",
      support: "supported",
      proposed_version: playerVoteReveals.get(event.id),
    };
  }
}

function normalizeExtractedTraitProposals(data) {
  const proposals = {
    "trait-javi-buff": ["For the first 3 rounds, face 5 receives a +10 percentage-point dice bias.", "supported", "Uses the current round duration and diceBias effect."],
    "trait-javi-nerf": ["False abstemious: take one shot at the start of each of the first 2 turns.", "supported", "Uses the onTurnStart effect hook so the action appears before the roll."],
    "trait-willy-buff": ["The first time Willy rolls 1, the nearest player behind him loses 3 coins.", "supported", "Uses a nearest-behind target and expires after the first trigger."],
    "trait-willy-nerf": ["If Willy's last 2 rolls total more than 10, his next turn has 0.5x movement rounded down.", "supported", "Uses rollTotal and applies a one-turn movement effect."],
    "trait-willy-bonus": ["After five exact consecutive 5s, face 5 receives a +5 percentage-point dice bias for the next 3 rolls.", "supported", "The streak grants a bounded bonus and never ends the match."],
    "trait-nico-buff": ["Whenever Nico rolls 1, he gains 1 coin.", "supported", "Replaces the intentionally omitted per-player shop discount."],
    "trait-nico-nerf": ["If Nico finishes outside the top 3 in a minigame, he gains 1 extra coin.", "supported", "Uses the trait owner's resolved ranking position."],
    "trait-facu-buff": ["For Facu's first 3 turns, face 6 receives a +5 percentage-point dice bias.", "supported", "Replaces face-specific skip inventory with a bounded passive bonus."],
    "trait-facu-nerf": ["Facu still plays minigames, but loses 3 coins after each scored minigame he participates in.", "supported", "Prompts are excluded and no player is removed from an activity."],
    "trait-frang-buff": ["When FranG rolls 1, move +2 and give face 5 a +5 percentage-point bias on the next roll.", "supported", "Replaces rerolling with current movement and dice-bias primitives."],
    "trait-frang-nerf": ["If FranG finishes outside the top 3 in a minigame, he gains 1 extra coin.", "supported", "Replaces the removed tile-occupancy query with a ranking result condition."],
    "trait-bilbo-buff": ["Beltro can trigger a dedicated Europa Universalis IV Buzzer event with a 3-coin loser-to-winner transfer.", "supported", "The current player-specific event trigger replaces tile occupancy."],
    "trait-bilbo-nerf": ["If Beltro finishes outside the top 3 in a minigame, he loses 1 coin.", "supported", "Replaces dangerous-neighborhood entry memory with a ranking result condition."],
    "trait-gaston-buff": ["Gastón starts with Mochila de Gastón active for the first 2 rounds, moving at 0.5x speed.", "supported", "The starting trait applies the artifact's timed movement effect immediately."],
    "trait-gaston-nerf": ["While the starting backpack is active, rolling 6 makes Gastón take one shot.", "supported", "Keeps the backpack downside without artifact-possession triggers."],
  };
  for (const group of data.character_traits ?? []) {
    for (const trait of group.traits ?? []) {
      const proposal = proposals[trait.id];
      if (!proposal) continue;
      trait.proposed_adaptation = {
        current_best_fit: proposal[0],
        support: proposal[1],
        reason: proposal[2],
      };
      if (trait.id === "trait-javi-nerf") {
        trait.original_name = "Falso abstemio";
        trait.source_original ??= trait.original;
        trait.original = trait.original.replace(/^Abstemio\b/, "Falso abstemio");
      }
    }
  }
  const beltroTraitEventId = "trait-event-beltro-europa-universalis";
  if (!(data.events ?? []).some((event) => event.id === beltroTraitEventId)) {
    data.events.push({
      id: beltroTraitEventId,
      source_caption_group_id: "trait-beltro-europa-universalis",
      duplicate_of_caption: null,
      original_caption: "Europa Universalis IV",
      original_effect_proposed: "Beltro inicia un duelo Buzzer de historia; el último transfiere 3 monedas al ganador.",
      media_asset_id: null,
      presentation: {
        type: "minigame_intro",
        pre_minigame_caption: "Beltro convierte la mesa en un duelo relámpago de historia.",
        prompt_caption: "¿Qué imperio cayó con la toma de Constantinopla en 1453?",
        suggested_activity_type: "buzzer",
        suggested_activity_content: {
          question: "¿Qué imperio cayó con la toma de Constantinopla en 1453?",
          options: ["Imperio romano de Occidente", "Imperio bizantino", "Imperio otomano"],
          answer: 1,
        },
        content_authoring_status: "ready",
      },
      proposed_adaptation: {
        current_primitive: "player trigger + buzzer + coinTransfer",
        support: "supported",
        proposed_version: "Evento exclusivo de Beltro con recompensa base por ranking y transferencia de 3 monedas del último al ganador.",
      },
    });
  }
  const proposalUpdates = {
    "bias-and-conditional-consequences": {
      status: "supported",
      description: "Use diceBias for bounded roll changes, rollTotal or exact consecutiveRolls for dice history, and rankingPosition conditions for activity-result traits.",
    },
    "five-streak-becomes-bias": {
      status: "supported",
      description: "Willy never ends the match. Five exact rolls of 5 grant +5 percentage points on face 5 for the next 3 rolls.",
    },
    "keep-players-in-the-activity": {
      status: "supported",
      description: "Everyone remains in the minigame. Character traits can add a coin reward or penalty after the result and prompts can be excluded.",
    },
    "fixed-price-and-fixed-ranking": {
      status: "supported",
      description: "Prices and rankings stay global. Nico's unemployment becomes a roll-based coin reward, while Frustración reacts to finishing outside the top 3 without rewriting the ranking.",
    },
    "no-hidden-board-state": {
      status: "supported",
      description: "Occupancy and first-entry memory remain omitted. Those jokes now use explicit roll totals, minigame ranking conditions, or character-specific events.",
    },
    "artifact-effects-resolve-on-use": {
      status: "supported",
      description: "Artifacts still resolve on use. Gastón's starting backpack is represented by two round-limited default trait effects using the same movement and shot behavior.",
    },
  };
  for (const proposal of data.implementation_proposals ?? []) {
    if (proposalUpdates[proposal.id]) Object.assign(proposal, proposalUpdates[proposal.id]);
  }
}

function markImplementedStoryCapabilities(data) {
  for (const event of data.events ?? []) {
    const usesPlayerPosition = event.proposed_adaptation?.current_primitive === "moveToPlayerPosition";
    const usesStackedSkips = event.reviewed_event_builder?.required_feature === "stackedSkipTurns";
    if (!usesPlayerPosition && !usesStackedSkips) continue;
    event.proposed_adaptation.support = "supported";
    if (usesPlayerPosition) {
      event.proposed_adaptation.proposed_version = event.proposed_adaptation.proposed_version
        .replace(/^Implementar moveToPlayerPosition y\s*/i, "Usar moveToPlayerPosition y ")
        .replace(/^Implementar moveToPlayerPosition;?\s*/i, "Usar moveToPlayerPosition: ")
        .replace(/\. Requiere el feature moveToPlayerPosition ya registrado en el roadmap\.?/i, ".");
    }
    if (usesStackedSkips) {
      event.proposed_adaptation.proposed_version = "El último pierde sus próximos 2 turnos; el contador de turnos salteados ya es acumulable.";
    }
    if (event.reviewed_event_builder) {
      event.reviewed_event_builder.required_feature = null;
      for (const rule of [
        ...(event.reviewed_event_builder.ranking_consequences ?? []),
        ...(event.reviewed_event_builder.immediate_consequences ?? []),
      ]) {
        for (const action of rule.actions ?? []) delete action.status;
      }
    }
  }
  const movementProposal = data.implementation_proposals?.find((proposal) => proposal.id === "movement-scope");
  if (movementProposal) movementProposal.status = "supported";
}

function ensureExtractedCharacters(gameContent, groups) {
  gameContent.characters = { ...(gameContent.characters ?? {}) };
  gameContent.players = [...(gameContent.players ?? [])];
  const aliases = { bilbo: "beltro" };
  const palette = ["#ffa200", "#ef4444", "#3b82f6", "#34d399", "#f5d547", "#a78bfa", "#fb7185"];
  for (const [index, group] of groups.entries()) {
    const id = aliases[group.id] ?? group.id;
    const displayName = id === "beltro" ? "Beltro" : titleCase(group.name || id);
    if (!gameContent.characters[id]) {
      gameContent.characters[id] = { id, displayName, color: palette[index % palette.length] };
    }
    if (!gameContent.players.some((player) => player.id === id)) {
      gameContent.players.push({ id, name: displayName, color: gameContent.characters[id].color ?? palette[index % palette.length] });
    }
  }
}

function ensureExtractedTraits(gameContent) {
  const retiredTraitIds = [
    "javi-two-turn-implosion",
    "facu-language-scramble",
    "nico-luck-complaint",
    "willy-countryside-trip",
    "beltro-belgrano-4pm",
    "frang-finance-pop-quiz",
  ];
  const retiredEffectIds = [
    "javi-low-movement-implosion",
    "facu-one-turn-language",
    "nico-two-high-rolls-back",
    "willy-two-four-plus-skip",
    "beltro-belgrano-zone-back",
    "frang-finance-challenge",
  ];
  gameContent.characterTraits = { ...(gameContent.characterTraits ?? {}) };
  for (const id of retiredTraitIds) delete gameContent.characterTraits[id];
  for (const id of retiredEffectIds) delete gameContent.effects[id];

  Object.assign(gameContent.effects, {
    "trait-javi-finance-bias": {
      id: "trait-javi-finance-bias",
      name: "Gurú de las finanzas",
      description: "Durante las primeras 3 rondas, aumenta 10 puntos porcentuales la probabilidad de sacar 5.",
      icon: "⚄",
      duration: { mode: "rounds", value: 3 },
      consequences: [{ type: "diceBias", hook: "beforeRoll", face: 5, chanceDeltaPercent: 10, text: "Gurú de las finanzas: +10% de probabilidad de sacar 5." }],
    },
    "trait-javi-false-abstemious": {
      id: "trait-javi-false-abstemious",
      name: "Falso abstemio",
      description: "Antes de jugar sus primeros 2 turnos, Javi toma un shot.",
      icon: "🥃",
      duration: { mode: "turns", value: 2 },
      consequences: [{ type: "offlineAction", hook: "onTurnStart", action: "takeShot", text: "Falso abstemio: Javi toma un shot antes de jugar." }],
    },
    "trait-willy-rugby-pass": {
      id: "trait-willy-rugby-pass",
      name: "Rugby",
      description: "La primera vez que Willy saca 1, el jugador más cercano detrás pierde 3 monedas.",
      icon: "🏉",
      duration: { mode: "game" },
      consequences: [{
        type: "coins",
        hook: "afterMovement",
        when: { rollEquals: 1 },
        target: { nearest: "behind", from: "target" },
        value: -3,
        text: "Rugby: recibe el pase y pierde 3 monedas.",
        expiresOnTrigger: true,
      }],
    },
    "trait-willy-larpi": {
      id: "trait-willy-larpi",
      name: "Larpi",
      description: "Si sus últimos 2 tiros suman más de 10, Willy se mueve a 0.5x en su próximo turno.",
      icon: "½",
      duration: { mode: "game" },
      consequences: [{
        type: "applyEffect",
        hook: "afterMovement",
        when: { rollTotal: { turns: 2, gte: 11 } },
        effectId: "trait-willy-larpi-next-turn",
        text: "Larpi: movimiento a la mitad durante el próximo turno.",
      }],
    },
    "trait-willy-larpi-next-turn": {
      id: "trait-willy-larpi-next-turn",
      name: "Larpi · próximo turno",
      description: "Willy se mueve a la mitad, redondeando hacia abajo, durante su próximo turno.",
      icon: "½",
      duration: { mode: "turns", value: 1 },
      consequences: [{ type: "movementMultiplier", hook: "beforeMovement", multiplier: 0.5, rounding: "floor", text: "Larpi: movimiento x0.5." }],
    },
    "trait-willy-five-streak": {
      id: "trait-willy-five-streak",
      name: "Cinco cincos",
      description: "Después de cinco 5 consecutivos, aumenta 5 puntos porcentuales la probabilidad de sacar 5 durante 3 tiros.",
      icon: "⚄",
      duration: { mode: "game" },
      consequences: [{
        type: "applyEffect",
        hook: "afterMovement",
        when: { consecutiveRolls: { count: 5, atLeast: 5, atMost: 5 } },
        effectId: "trait-willy-five-streak-reward",
        text: "Cinco cincos: +5% de probabilidad de sacar 5 durante 3 tiros.",
        expiresOnTrigger: true,
      }],
    },
    "trait-willy-five-streak-reward": {
      id: "trait-willy-five-streak-reward",
      name: "Racha de cincos",
      description: "+5 puntos porcentuales a la cara 5 durante los próximos 3 tiros.",
      icon: "⚄",
      duration: { mode: "uses", value: 3 },
      consequences: [{ type: "diceBias", hook: "beforeRoll", face: 5, chanceDeltaPercent: 5, text: "Racha de cincos: +5% a la cara 5." }],
    },
    "trait-nico-unemployment": {
      id: "trait-nico-unemployment",
      name: "Desempleo",
      description: "Cada vez que Nico saca 1, gana 1 moneda.",
      icon: "+",
      duration: { mode: "game" },
      consequences: [{ type: "coins", hook: "afterMovement", when: { rollEquals: 1 }, value: 1, text: "Desempleo: Nico ahorra gastos fijos y gana 1 moneda." }],
    },
    "trait-nico-frustration": {
      id: "trait-nico-frustration",
      name: "Frustración",
      description: "Si Nico queda fuera del top 3 en un minijuego, gana 1 moneda extra.",
      icon: "+",
      duration: { mode: "game" },
      consequences: [{
        type: "coins",
        hook: "onActivityResult",
        when: { rankingPositionGte: 4, activityTypesNone: ["prompt"] },
        value: 1,
        text: "Frustración: fuera del top 3, Nico gana 1 moneda extra.",
      }],
    },
    "trait-facu-class-sleep": {
      id: "trait-facu-class-sleep",
      name: "Dormir en clase",
      description: "Durante sus primeros 3 turnos, Facu tiene +5 puntos porcentuales de probabilidad de sacar 6.",
      icon: "⚅",
      duration: { mode: "turns", value: 3 },
      consequences: [{ type: "diceBias", hook: "beforeRoll", face: 6, chanceDeltaPercent: 5, text: "Dormir en clase: +5% de probabilidad de sacar 6." }],
    },
    "trait-facu-ubuntu": {
      id: "trait-facu-ubuntu",
      name: "Ubuntu",
      description: "Facu juega el minijuego, pero pierde 3 monedas al terminar.",
      icon: "🐧",
      duration: { mode: "game" },
      consequences: [{
        type: "coins",
        hook: "onActivityResult",
        when: { rankingPositionGte: 1, activityTypesNone: ["prompt"] },
        value: -3,
        text: "Ubuntu: Facu participó, pero pierde 3 monedas.",
      }],
    },
    "trait-frang-home-office": {
      id: "trait-frang-home-office",
      name: "Home office",
      description: "Cuando FranG saca 1, avanza 2 casilleros extra y sesga el próximo tiro hacia el 5.",
      icon: "🏠",
      duration: { mode: "game" },
      consequences: [
        { type: "move", hook: "afterMovement", when: { rollEquals: 1 }, delta: 2, text: "Home office: FranG avanza 2 casilleros extra." },
        { type: "applyEffect", hook: "afterMovement", when: { rollEquals: 1 }, effectId: "trait-frang-home-office-next-roll", text: "Home office: +5% a la cara 5 en el próximo tiro." },
      ],
    },
    "trait-frang-home-office-next-roll": {
      id: "trait-frang-home-office-next-roll",
      name: "Home office · próximo tiro",
      description: "+5 puntos porcentuales a la cara 5 durante el próximo tiro.",
      icon: "⚄",
      duration: { mode: "uses", value: 1 },
      consequences: [{ type: "diceBias", hook: "beforeRoll", face: 5, chanceDeltaPercent: 5, text: "Home office: +5% a la cara 5." }],
    },
    "trait-frang-excuse": {
      id: "trait-frang-excuse",
      name: "Excusa",
      description: "Si FranG queda fuera del top 3 en un minijuego, gana 1 moneda extra.",
      icon: "+",
      duration: { mode: "game" },
      consequences: [{
        type: "coins",
        hook: "onActivityResult",
        when: { rankingPositionGte: 4, activityTypesNone: ["prompt"] },
        value: 1,
        text: "Excusa: fuera del top 3, FranG gana 1 moneda extra.",
      }],
    },
    "trait-beltro-europa-universalis": {
      id: "trait-beltro-europa-universalis",
      name: "Europa Universalis IV",
      description: "Habilita un evento Buzzer exclusivo de Beltro con transferencia de 3 monedas.",
      icon: "🏳️",
      duration: { mode: "game" },
      hooks: [],
      consequences: [],
    },
    "trait-beltro-zone-punga": {
      id: "trait-beltro-zone-punga",
      name: "Zona punga",
      description: "Si Beltro queda fuera del top 3 en un minijuego, pierde 1 moneda.",
      icon: "−",
      duration: { mode: "game" },
      consequences: [{
        type: "coins",
        hook: "onActivityResult",
        when: { rankingPositionGte: 4, activityTypesNone: ["prompt"] },
        value: -1,
        text: "Zona punga: fuera del top 3, Beltro pierde 1 moneda.",
      }],
    },
    "trait-gaston-starting-backpack": {
      id: "trait-gaston-starting-backpack",
      name: "Mochila de Gastón",
      description: "Gastón empieza con la mochila activa durante 2 rondas y se mueve a 0.5x.",
      icon: "🎒",
      visualAssetId: "backpack",
      duration: { mode: "rounds", value: 2 },
      consequences: [{ type: "movementMultiplier", hook: "beforeMovement", multiplier: 0.5, rounding: "ceil", text: "Mochila de Gastón: movimiento x0.5." }],
    },
    "trait-gaston-backpack-shot": {
      id: "trait-gaston-backpack-shot",
      name: "Malas decisiones",
      description: "Mientras la mochila inicial está activa, Gastón toma un shot cuando saca 6.",
      icon: "🥃",
      visualAssetId: "backpack",
      duration: { mode: "rounds", value: 2 },
      consequences: [{ type: "offlineAction", hook: "afterRoll", when: { rollEquals: 6 }, action: "takeShot", text: "Mochila de Gastón: sacó 6 y toma un shot." }],
    },
  });

  gameContent.characterTraits = {
    ...gameContent.characterTraits,
    "trait-javi-buff": trait("trait-javi-buff", "Gurú de las finanzas", "Durante las primeras 3 rondas, +10% a la probabilidad de sacar 5.", "trait-javi-finance-bias", "⚄"),
    "trait-javi-nerf": trait("trait-javi-nerf", "Falso abstemio", "Javi toma un shot antes de jugar sus primeros 2 turnos.", "trait-javi-false-abstemious", "🥃"),
    "trait-willy-buff": trait("trait-willy-buff", "Rugby", "La primera vez que Willy saca 1, el jugador más cercano detrás pierde 3 monedas.", "trait-willy-rugby-pass", "🏉"),
    "trait-willy-nerf": trait("trait-willy-nerf", "Larpi", "Si sus últimos 2 tiros suman más de 10, se mueve a 0.5x el próximo turno.", "trait-willy-larpi", "½"),
    "trait-willy-bonus": trait("trait-willy-bonus", "Cinco cincos", "Cinco 5 consecutivos otorgan un sesgo de +5% a la cara 5 durante 3 tiros.", "trait-willy-five-streak", "⚄"),
    "trait-nico-buff": trait("trait-nico-buff", "Desempleo", "Cada vez que Nico saca 1, gana 1 moneda.", "trait-nico-unemployment", "+"),
    "trait-nico-nerf": trait("trait-nico-nerf", "Frustración", "Fuera del top 3 en un minijuego, Nico gana 1 moneda extra.", "trait-nico-frustration", "+"),
    "trait-facu-buff": trait("trait-facu-buff", "Dormir en clase", "Durante 3 turnos, +5% a la probabilidad de sacar 6.", "trait-facu-class-sleep", "⚅"),
    "trait-facu-nerf": trait("trait-facu-nerf", "Ubuntu", "Facu juega los minijuegos, pero pierde 3 monedas al terminar.", "trait-facu-ubuntu", "🐧"),
    "trait-frang-buff": trait("trait-frang-buff", "Home office", "Al sacar 1, avanza 2 extra y sesga el próximo tiro hacia el 5.", "trait-frang-home-office", "🏠"),
    "trait-frang-nerf": trait("trait-frang-nerf", "Excusa", "Fuera del top 3 en un minijuego, FranG gana 1 moneda extra.", "trait-frang-excuse", "+"),
    "trait-bilbo-buff": trait("trait-bilbo-buff", "Europa Universalis IV", "Habilita un Buzzer exclusivo de Beltro con transferencia de monedas.", "trait-beltro-europa-universalis", "🏳️"),
    "trait-bilbo-nerf": trait("trait-bilbo-nerf", "Zona punga", "Fuera del top 3 en un minijuego, Beltro pierde 1 moneda.", "trait-beltro-zone-punga", "−"),
    "trait-gaston-buff": trait("trait-gaston-buff", "Mochila de Gastón", "Empieza con movimiento x0.5 durante 2 rondas.", "trait-gaston-starting-backpack", "🎒"),
    "trait-gaston-nerf": trait("trait-gaston-nerf", "Malas decisiones", "Con la mochila inicial activa, un 6 obliga a tomar un shot.", "trait-gaston-backpack-shot", "🥃"),
  };

  const assignments = {
    javi: ["trait-javi-buff", "trait-javi-nerf"],
    willy: ["trait-willy-buff", "trait-willy-nerf", "trait-willy-bonus"],
    nico: ["trait-nico-buff", "trait-nico-nerf"],
    facu: ["trait-facu-buff", "trait-facu-nerf"],
    frang: ["trait-frang-buff", "trait-frang-nerf"],
    beltro: ["trait-bilbo-buff", "trait-bilbo-nerf"],
    gaston: ["trait-gaston-buff", "trait-gaston-nerf"],
  };
  for (const [characterId, defaultTraits] of Object.entries(assignments)) {
    if (gameContent.characters?.[characterId]) gameContent.characters[characterId].defaultTraits = defaultTraits;
  }
}

function trait(id, name, description, effectId, icon) {
  return { id, name, description, effectId, icon };
}

function beltroEuropaUniversalisEvent() {
  const question = "¿Qué imperio cayó con la toma de Constantinopla en 1453?";
  return {
    name: "Europa Universalis IV",
    kind: "activity",
    tags: ["story-source-import", "character-trait-event", "beltro", "buzzer"],
    trigger: { type: "player", playerId: "beltro" },
    story: {
      title: "Europa Universalis IV",
      setup: "Beltro convierte la mesa en un duelo relámpago de historia.",
      prompt: question,
      reward: "Recompensa base por ranking más 3 monedas transferidas del último al ganador.",
      reveal: "Respuesta correcta: Imperio bizantino.",
    },
    activity: {
      type: "buzzer",
      participants: "everyone",
      content: {
        question,
        options: ["Imperio romano de Occidente", "Imperio bizantino", "Imperio otomano"],
        answer: 1,
      },
      rankingPayout: baseRankingPayout(),
    },
    consequences: [rule("winner", [{
      type: "coinTransfer",
      amount: 3,
      from: "loser",
      target: "winner",
      clamp: true,
      text: "Europa Universalis IV: el último transfiere 3 monedas al ganador.",
    }], "Duelo de historia")],
  };
}

function storyEvent(source, effects) {
  const type = activityTypeFor(source);
  const caption = source.original_caption.trim() || `Evento ${source.id}`;
  const sourceContent = source.reviewed_event_builder?.activity?.content ?? source.presentation?.suggested_activity_content ?? {};
  const eventSpecific = specificRulesFor(source, effects);
  const consequences = type === "prompt"
    ? [promptRewardRule(source, eventSpecific), ...eventSpecific]
    : eventSpecific;
  const contentForActivity = activityContent(type, caption, sourceContent, source);
  const support = source.proposed_adaptation?.support ?? "supported";
  return {
    name: caption,
    kind: type === "prompt" ? "story" : "activity",
    tags: ["story-source-import", type, support],
    trigger: { type: "anyPlayer" },
    story: {
      title: caption,
      setup: source.original_effect_proposed ? `Consecuencia original: ${source.original_effect_proposed}` : undefined,
      prompt: promptForActivity(type, caption, contentForActivity),
      reward: type === "prompt" ? `Recompensa base: +${promptReward(source, eventSpecific)} moneda(s) para quien cayó.` : "Recompensa base por ranking: 1.º +5, 2.º +3, resto +1.",
      reveal: source.proposed_adaptation?.proposed_version,
    },
    media: source.media_asset_id ? [{ assetId: source.media_asset_id, caption, placement: "both" }] : undefined,
    activity: {
      type,
      participants: type === "hostPick" ? "host" : "everyone",
      ...(type === "hostPick" || type === "vote" || type === "cardVote" ? { subjects: "everyone" } : {}),
      content: contentForActivity,
      ...(type === "prompt" ? {} : { rankingPayout: baseRankingPayout() }),
    },
    consequences,
  };
}

function triviaEvent(trivia) {
  const answer = triviaAnswers.get(trivia.source_number);
  return {
    name: trivia.question,
    kind: "activity",
    tags: ["story-source-import", "trivia", "buzzer"],
    trigger: { type: "anyPlayer" },
    story: {
      title: `Trivia ${trivia.source_number}`,
      prompt: trivia.question,
      reward: "Recompensa base por ranking: 1.º +5, 2.º +3, resto +1.",
      reveal: `Respuesta correcta: ${trivia.choices[answer].text}`,
    },
    activity: {
      type: "buzzer",
      participants: "everyone",
      content: {
        question: trivia.question,
        options: trivia.choices.map((choice) => choice.text),
        answer,
      },
      rankingPayout: baseRankingPayout(),
    },
    consequences: [],
  };
}

function cardVoteEvent(set) {
  const source = set.event_definition;
  return {
    ...source,
    tags: ["story-source-import", "card-vote", "amigos-de-mierda"],
    trigger: { type: "anyPlayer" },
    story: {
      ...source.story,
      reward: "Recompensa base por ranking final: 1.º +5, 2.º +3, resto +1.",
    },
    activity: {
      ...source.activity,
      rankingPayout: baseRankingPayout(),
    },
    consequences: [],
  };
}

function activityTypeFor(source) {
  if (playerVoteQuestions.has(source.id)) return "vote";
  return source.reviewed_event_builder?.activity?.type ?? source.presentation?.suggested_activity_type ?? "prompt";
}

function activityContent(type, caption, sourceContent, source) {
  const given = structuredClone(sourceContent ?? {});
  if (type === "buzzer") return given;
  if (type === "vote") return { question: given.question ?? caption };
  if (type === "judge") return { prompt: given.prompt ?? caption, placeholder: given.placeholder ?? "Escribí acá…" };
  if (type === "hostPick") {
    return {
      title: caption,
      prompt: given.prompt ?? caption,
      defaultPick: "winner",
    };
  }
  const label = minigameInstruction(type, caption, given.label);
  if (type === "timing") return { label, windowMs: given.windowMs ?? 350 };
  if (type === "reaction") return { label, minDelayMs: given.minDelayMs ?? 1500, maxDelayMs: given.maxDelayMs ?? 5000 };
  if (type === "whack") return { label, durationMs: given.durationMs ?? 20000 };
  if (type === "maze") return { label, cols: given.cols ?? 13, rows: given.rows ?? 13 };
  if (type === "flappy") return { label, maxDurationMs: given.maxDurationMs ?? 90000 };
  if (type === "snake") return { label, gridSize: given.gridSize ?? 100, durationMs: given.durationMs ?? 120000 };
  if (type === "horserace") return { label, trackLength: given.trackLength ?? 40, durationMs: given.durationMs ?? 45000 };
  if (type === "redlight") return { label, trackLength: given.trackLength ?? 45, durationMs: given.durationMs ?? 60000 };
  return { prompt: caption, label: "Evento" };
}

function minigameInstruction(type, caption, authoredLabel) {
  if (authoredLabel && authoredLabel !== caption) return authoredLabel;
  const prefix = {
    timing: "Tocá justo cuando el indicador pase por el centro",
    reaction: "Esperá el verde y tocá lo más rápido posible",
    whack: "Golpeá solamente al amigo indicado",
    maze: "Llegá a la salida sin tocar las paredes",
    flappy: "Volá con ESPACIO sin chocar",
    snake: "Sobreviví y conseguí el mejor puntaje",
    horserace: "Seguí la secuencia de flechas y llegá primero",
    redlight: "Avanzá solo cuando la luz esté verde",
  }[type];
  return prefix ? `${prefix}. ${caption}` : caption;
}

function promptForActivity(type, caption, activity) {
  if (type === "prompt") return caption;
  if (type === "vote") return activity.question;
  if (type === "judge") return activity.prompt;
  if (type === "buzzer") return activity.question;
  if (type === "hostPick") return activity.prompt;
  return activity.label ?? caption;
}

function baseRankingPayout() {
  return {
    consequences: [
      rule({ rank: 1 }, [{ type: "coins", value: 5, text: "Recompensa base del 1.º puesto: +5 monedas." }], "1.º puesto"),
      rule({ rank: 2 }, [{ type: "coins", value: 3, text: "Recompensa base del 2.º puesto: +3 monedas." }], "2.º puesto"),
      rule({ rankFrom: 3, rankTo: 99 }, [{ type: "coins", value: 1, text: "Recompensa base por participar: +1 moneda." }], "Resto de participantes"),
    ],
  };
}

function promptRewardRule(source, eventSpecific) {
  const value = promptReward(source, eventSpecific);
  return rule("landing", [{ type: "coins", value, text: `Recompensa base del evento: +${value} moneda(s).` }], "Recompensa base del evento");
}

function promptReward(source, eventSpecific) {
  const actions = eventSpecific.flatMap((item) => item.actions ?? []).filter((action) => !action.target || action.target === "landing");
  if (actions.some((action) => action.type === "skipTurn" || (action.type === "move" && action.delta < 0) || (action.type === "coins" && action.value < 0))) return 1;
  if (actions.some((action) => action.type === "extraTurn" || (action.type === "move" && action.delta > 0) || (action.type === "coins" && action.value > 0))) return 3;
  const lower = `${source.original_effect_proposed ?? ""} ${source.proposed_adaptation?.proposed_version ?? ""}`.toLowerCase();
  if (/perd|retrocede|paga|0[,.](25|5|75)/.test(lower)) return 1;
  if (/gan[aá]|avanza|corr[eé]|\bx[123](?:[,.]5)?\b/.test(lower)) return 3;
  return 2;
}

function specificRulesFor(source, effects) {
  if (source.reviewed_event_builder) {
    return [
      ...(source.reviewed_event_builder.ranking_consequences ?? []),
      ...(source.reviewed_event_builder.immediate_consequences ?? []),
    ].map(sanitizeRule).filter((item) => item.actions.length);
  }
  return unstructuredRules(source.id, effects);
}

function sanitizeRule(input) {
  return {
    ...(input.label ? { label: input.label } : {}),
    appliesTo: input.appliesTo,
    actions: (input.actions ?? []).map((action) => {
      const { status: _status, playerId, ...rest } = action;
      if (action.type === "moveToPlayerPosition") return { ...rest, withTarget: { playerId } };
      if (action.type === "skipTurn" && action.turns) return { ...rest, turns: action.turns };
      return rest;
    }),
  };
}

function unstructuredRules(id, effects) {
  const landing = (actions) => [rule("landing", actions)];
  const winner = (actions) => [rule("winner", actions)];
  const loser = (actions) => [rule("loser", actions)];
  const move = (delta) => ({ type: "move", delta });
  const skip = (turns = 1) => ({ type: "skipTurn", turns });
  const apply = (effectId) => ({ type: "applyEffect", effectId });
  const direct = {
    "event-001": landing([{ type: "swapPositions", withTarget: { playerId: "beltro" }, text: "Intercambia posiciones con Beltro." }]),
    "event-002": landing([move(-1)]), "event-003": landing([skip()]), "event-004": landing([apply("story-event-004-movement")]),
    "event-005": landing([skip()]), "event-006": landing([move(-6)]),
    "event-007": [rule({ playerId: "frang" }, [{ type: "moveToPlayerPosition", withTarget: "landing", text: "Frang se mueve a la posición de quien activó el evento." }])],
    "event-008": landing([apply("story-event-008-movement")]), "event-009": landing([apply("story-event-009-movement")]),
    "event-010": landing([skip()]), "event-011": landing([{ type: "extraTurn" }]), "event-012": landing([apply("story-event-012-movement")]),
    "event-013": landing([move(-4)]), "event-014": landing([move(4)]), "event-015": landing([skip(2)]), "event-016": landing([{ type: "extraTurn" }]),
    "event-017": landing([apply("story-event-017-movement")]), "event-018": landing([move(7)]), "event-019": landing([skip()]),
    "event-020": winner([move(-5)]),
    "event-021": [rule("landing", [{ type: "moveToPlayerPosition", withTarget: "winner" }])],
    "event-022": landing([apply("story-event-022-dice")]), "event-023": landing([apply("story-event-023-movement")]),
    "event-024": landing([move(4)]), "event-025": landing([apply("story-event-025-movement")]), "event-026": landing([move(4)]),
    "event-027": landing([skip()]), "event-028": landing([apply("story-event-028-movement")]), "event-029": landing([move(-2)]),
    "event-030": landing([apply("story-event-030-movement")]),
    "event-031": [rule("landing", [{ type: "moveToPlayerPosition", withTarget: "winner" }])],
    "event-032": landing([skip(2)]), "event-033": landing([apply("story-event-033-movement")]), "event-034": landing([apply("story-event-034-dice")]),
    "event-035": landing([move(6)]), "event-036": landing([{ type: "swapPositions", withTarget: "winner" }]), "event-037": landing([skip(2)]),
    "event-038": landing([apply("story-event-038-movement")]), "event-039": landing([move(3)]), "event-040": landing([skip(3)]),
    "event-041": landing([apply("story-event-041-movement")]), "event-042": landing([move(3)]), "event-043": winner([move(-1)]),
    "event-044": landing([{ type: "coins", value: -3 }]), "event-045": landing([move(10)]), "event-046": landing([move(2)]),
    "event-047": landing([apply("story-event-047-movement")]), "event-048": landing([{ type: "coins", value: 5 }]),
    "event-050": landing([move(5)]), "event-051": landing([skip()]), "event-053": landing([apply("story-event-053-dice")]),
    "event-054": landing([apply("story-event-054-movement")]), "event-055": [rule("landing", [{ type: "moveToPlayerPosition", withTarget: "winner" }])],
    "event-056": landing([skip()]), "event-058": landing([move(-3)]),
    "event-063": [rule("winner", [{ type: "coins", value: 5 }]), rule({ rankFrom: 2, rankTo: 99 }, [move(-3)])],
    "event-064": winner([move(5)]),
    "event-065-a": [rule("winner", [apply("movement-x2-one-turn")]), rule({ rankFrom: 2, rankTo: 99 }, [skip()])],
    "event-065-b": [rule("winner", [apply("movement-x2-one-turn")]), rule({ rankFrom: 2, rankTo: 99 }, [skip()])],
    "event-066": winner([move(6)]), "event-067": [rule("winner", [{ type: "coins", value: 5 }]), rule("loser", [{ type: "coins", value: -5 }])],
    "event-071": loser([move(-5)]), "event-073": loser([apply("half-roll-2-rounds")]), "event-074": loser([skip()]),
    "event-075": landing([{ type: "moveToPlayerPosition", withTarget: { playerId: "willy" } }]), "event-076": landing([move(2)]),
    "event-077": landing([apply("story-event-077-movement")]), "event-079": landing([move(-5)]),
    "event-080": [rule({ rank: 1 }, [{ type: "coins", value: 5 }]), rule({ rank: 2 }, [{ type: "coins", value: 3 }]), rule({ rankFrom: 3, rankTo: 99 }, [{ type: "coins", value: 1 }])],
    "event-081": landing([{ type: "moveToPlayerPosition", withTarget: { playerId: "willy" } }]), "event-083": landing([skip(2)]),
    "event-084": loser([skip(3)]),
    "event-085": [rule("landing", [{ type: "moveToPlayerPosition", withTarget: "winner" }])],
    "event-087": loser([{ type: "coins", value: -3 }]),
    "event-088": [rule("landing", [{ type: "moveToPlayerPosition", withTarget: "winner" }])],
    "event-089": landing([move(4)]), "event-090": landing([{ type: "extraTurn" }]),
    "event-091": [rule("landing", [{ type: "moveToPlayerPosition", withTarget: "winner" }])],
    "event-093": [rule("landing", [{ type: "moveToPlayerPosition", withTarget: "winner" }])],
    "event-094-a": landing([skip(2)]), "event-094-b": landing([skip(2)]), "event-094-c": landing([skip(2)]), "event-094-d": landing([skip(2)]),
    "event-095": landing([move(-3)]), "event-096": winner([move(6)]), "event-097": landing([apply("story-event-097-movement")]),
    "event-098": landing([move(4)]), "event-099": landing([move(-5)]), "event-100": landing([{ type: "coins", value: 5 }]),
    "event-101": landing([move(-2020)]), "event-102": landing([move(11)]),
  };
  return direct[id] ?? [];
}

function ensureCatalogEffects(effects) {
  const movement = (id, multiplier, mode, value) => {
    effects[id] = {
      id,
      name: `Movimiento x${multiplier}`,
      description: `Multiplica el movimiento por ${multiplier} durante ${value} ${mode}.`,
      icon: multiplier >= 1 ? "×" : "½",
      duration: { mode, value },
      consequences: [{ type: "movementMultiplier", hook: "beforeMovement", multiplier, rounding: "ceil", text: `Movimiento x${multiplier}.` }],
    };
  };
  const dice = (id, face, turns) => {
    effects[id] = {
      id,
      name: `Sesgo al ${face}`,
      description: `Eleva la probabilidad de sacar ${face} a aproximadamente 50% durante ${turns} turnos.`,
      icon: "⚄",
      duration: { mode: "turns", value: turns },
      consequences: [{ type: "diceBias", hook: "beforeRoll", face, chanceDeltaPercent: 33.33, text: `Mayor probabilidad de sacar ${face}.` }],
    };
  };
  movement("movement-x2-one-turn", 2, "turns", 1);
  movement("story-event-004-movement", 0.5, "rounds", 3);
  movement("story-event-008-movement", 1.5, "turns", 3);
  movement("story-event-009-movement", 0.5, "turns", 3);
  movement("story-event-012-movement", 0.5, "turns", 3);
  movement("story-event-017-movement", 0.5, "turns", 2);
  movement("story-event-023-movement", 0.25, "turns", 5);
  movement("story-event-025-movement", 0.75, "turns", 2);
  movement("story-event-028-movement", 3, "turns", 1);
  movement("story-event-030-movement", 1.25, "turns", 4);
  movement("story-event-033-movement", 0.5, "turns", 2);
  movement("story-event-038-movement", 0.5, "turns", 1);
  movement("story-event-041-movement", 2, "turns", 3);
  movement("story-event-047-movement", 1.5, "turns", 3);
  movement("story-event-054-movement", 2, "turns", 2);
  movement("story-event-077-movement", 1.5, "turns", 2);
  movement("story-event-097-movement", 0.75, "turns", 3);
  dice("story-event-022-dice", 1, 3);
  dice("story-event-034-dice", 4, 4);
  dice("story-event-053-dice", 3, 3);
}

function distributeImportedEvents(gameContent, importedIds) {
  gameContent.board = distributeAcrossBoard(gameContent.board, importedIds);
  gameContent.maps = gameContent.maps?.map((map) => ({
    ...map,
    board: distributeAcrossBoard(map.board, importedIds),
  }));
}

function distributeAcrossBoard(board, importedIds) {
  const imported = new Set(importedIds);
  const next = board.map((tile) => ({
    ...tile,
    eventIds: tile.eventIds?.filter((id) => !imported.has(id)),
    eventId: tile.eventId && imported.has(tile.eventId) ? undefined : tile.eventId,
  }));
  const poolIndexes = next
    .map((tile, index) => ({ tile, index }))
    .filter(({ tile }) => tile.type !== "shop" && (tile.eventId || tile.eventIds?.length))
    .map(({ index }) => index);
  if (!poolIndexes.length) throw new Error("The active board has no event cells for the imported story catalog");
  importedIds.forEach((eventId, index) => {
    const tile = next[poolIndexes[index % poolIndexes.length]];
    tile.eventIds = [...new Set([...(tile.eventIds ?? []), eventId])];
  });
  return next;
}

function rule(appliesTo, actions, label) {
  return { ...(label ? { label } : {}), appliesTo, actions };
}

function titleCase(value) {
  return String(value).toLocaleLowerCase("es-AR").replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase("es-AR"));
}
