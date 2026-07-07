import type {
  EventActivity,
  MinigameDef,
  MinigameResult,
  Player,
  RevealEntry,
  RevealPayload,
} from "@essence/shared";
import { applyRig } from "@essence/shared/rig";
import { toEventActivityType } from "@essence/shared/events";
import { judgeMessage } from "./judge.js";

interface ResolveArgs {
  minigameId: string;
  eventId?: string;
  def: MinigameDef | EventActivity;
  results: MinigameResult[];
  participants: string[]; // ids que debían jugar
  subjects?: string[]; // ids que se rankean; para host pick puede diferir de participants
  players: Player[];
  coinPayout: number[];
  story?: RevealPayload["story"];
}

interface ScoredResult {
  playerId: string;
  score: number;
  payload: unknown;
  flavor?: string;
  resultLabel?: string;
  detailLabel?: string;
}

/**
 * Resuelve un minijuego: calcula scores finales, ordena, aplica rig y reparte monedas.
 * Convención global: SCORE MÁS ALTO = MEJOR. Cada motor del cliente normaliza a eso.
 */
export async function resolveMinigame(args: ResolveArgs): Promise<RevealPayload> {
  const { def, participants, players, coinPayout } = args;
  const subjects = args.subjects?.length ? args.subjects : participants;

  // Indexar resultados por jugador; los que no enviaron quedan en 0 / último.
  const byId = new Map<string, MinigameResult>();
  for (const r of args.results) byId.set(r.playerId, r);

  // Algunos tipos recalculan el score del lado del server.
  let scored: ScoredResult[];

  if (def.type === "prompt") {
    scored = resolvePrompt(participants, subjects, byId);
  } else if (def.type === "hostPick") {
    scored = resolveHostPick(participants, subjects, byId);
  } else if (def.type === "selfTap") {
    scored = resolveSelfTap(subjects, byId);
  } else if (def.type === "judge") {
    scored = await resolveJudge(def, participants, byId);
  } else if (def.type === "vote") {
    scored = resolveVote(participants, subjects, byId);
  } else {
    scored = subjects.map((id) => {
      const r = byId.get(id);
      return { playerId: id, score: r?.score ?? Number.NEGATIVE_INFINITY, payload: r?.payload ?? null };
    });
  }

  // Ranking por score desc (no enviados / -inf al fondo), desempate estable por orden de participantes.
  const order = new Map(subjects.map((id, i) => [id, i]));
  let ranking = [...scored]
    .sort((a, b) => b.score - a.score || (order.get(a.playerId)! - order.get(b.playerId)!))
    .map((s) => s.playerId);

  // Rig: se aplica acá, en el server. El cliente nunca se entera.
  ranking = applyRig(ranking, def.rigged);

  // Monedas por puesto.
  const coins: Record<string, number> = {};
  ranking.forEach((id, idx) => {
    coins[id] = coinPayout[idx] ?? 0;
  });

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  const scoredById = new Map(scored.map((s) => [s.playerId, s]));

  const entries: RevealEntry[] = ranking.map((id, idx) => {
    const s = scoredById.get(id);
    const display = formatEntryDisplay(def, s, nameOf);
    return {
      playerId: id,
      name: nameOf(id),
      rank: idx + 1,
      score: s && Number.isFinite(s.score) ? s.score : 0,
      coins: coins[id] ?? 0,
      payload: s?.payload ?? null,
      resultLabel: s?.resultLabel ?? display.resultLabel,
      detailLabel: s?.detailLabel ?? display.detailLabel,
      flavor: s?.flavor ?? display.flavor,
    };
  });

  return {
    minigameId: args.minigameId,
    eventId: args.eventId,
    type: toEventActivityType(def.type),
    skin: def.skin,
    title: titleFor(def),
    story: args.story,
    ranking,
    entries,
    coins,
  };
}

// --- Resolvers específicos --------------------------------------------------

function resolvePrompt(participants: string[], subjects: string[], byId: Map<string, MinigameResult>): ScoredResult[] {
  const confirmedBy = participants.filter((id) => {
    const result = byId.get(id);
    if (!result) return false;
    const payload = result.payload as { confirmed?: boolean } | null | undefined;
    return payload?.confirmed !== false;
  });
  const missingConfirmers = participants.filter((id) => !confirmedBy.includes(id));
  return subjects.map((id) => ({
    playerId: id,
    score: confirmedBy.length,
    payload: {
      confirmed: missingConfirmers.length === 0,
      confirmedBy,
      missingConfirmers,
      requiredConfirmers: participants,
    },
  }));
}

function resolveHostPick(participants: string[], subjects: string[], byId: Map<string, MinigameResult>): ScoredResult[] {
  const hostPayload = participants.flatMap((id) => {
    const payload = byId.get(id)?.payload as { pickedPlayerId?: string; pick?: "winner" | "loser" } | undefined;
    return payload?.pickedPlayerId ? [payload] : [];
  })[0];
  const picked = hostPayload?.pickedPlayerId;
  const pick = hostPayload?.pick ?? "loser";
  return subjects.map((id, index) => {
    const selected = id === picked;
    const score = selected ? (pick === "winner" ? 1_000_000 : -1_000_000) : 1_000 - index;
    return {
      playerId: id,
      score,
      payload: selected ? { hostPick: pick } : null,
      flavor: selected ? (pick === "winner" ? "elegido como ganador" : "elegido como perdedor") : undefined,
    };
  });
}

function resolveSelfTap(subjects: string[], byId: Map<string, MinigameResult>): ScoredResult[] {
  return subjects.map((id) => {
    const r = byId.get(id);
    return {
      playerId: id,
      score: r?.score ?? Number.NEGATIVE_INFINITY,
      payload: r?.payload ?? null,
      flavor: r?.payload ? "confirmó" : "sin confirmar",
    };
  });
}

async function resolveJudge(
  def: MinigameDef | EventActivity,
  participants: string[],
  byId: Map<string, MinigameResult>
): Promise<ScoredResult[]> {
  const voteScored = participants.some((id) => {
    const payload = byId.get(id)?.payload as { votes?: unknown; voters?: unknown } | undefined;
    return typeof payload?.votes === "number" || Array.isArray(payload?.voters);
  });
  if (voteScored) {
    return participants.map((id) => {
      const result = byId.get(id);
      const payload = (result?.payload ?? {}) as { message?: string; votes?: number; voters?: string[] };
      const votes = typeof payload.votes === "number" ? payload.votes : Array.isArray(payload.voters) ? payload.voters.length : 0;
      return {
        playerId: id,
        score: votes,
        payload: {
          message: payload.message ?? "",
          votes,
          voters: Array.isArray(payload.voters) ? payload.voters : [],
        },
      };
    });
  }

  const persona = (def.content as { persona?: string })?.persona ?? "lujan";
  const verdicts = await Promise.all(
    participants.map(async (id) => {
      const payload = byId.get(id)?.payload as { message?: string } | undefined;
      const message = payload?.message ?? "";
      const verdict = await judgeMessage(persona, message);
      return {
        playerId: id,
        score: verdict.score,
        payload: { message, respuesta: verdict.respuesta },
        flavor: verdict.respuesta,
      };
    })
  );
  return verdicts;
}

function resolveVote(participants: string[], subjects: string[], byId: Map<string, MinigameResult>): ScoredResult[] {
  // payload de cada jugador = { votedFor: playerId }. Score = votos recibidos.
  const votersBySubject: Record<string, string[]> = {};
  for (const id of subjects) votersBySubject[id] = [];
  for (const id of participants) {
    const voted = (byId.get(id)?.payload as { votedFor?: string })?.votedFor;
    if (voted && voted in votersBySubject) votersBySubject[voted].push(id);
  }
  return subjects.map((id) => ({
    playerId: id,
    score: votersBySubject[id]?.length ?? 0,
    payload: {
      votes: votersBySubject[id]?.length ?? 0,
      voters: votersBySubject[id] ?? [],
      votedFor: (byId.get(id)?.payload as { votedFor?: string } | undefined)?.votedFor,
    },
  }));
}

// --- Presentación -----------------------------------------------------------

function formatEntryDisplay(
  def: MinigameDef | EventActivity,
  result: ScoredResult | undefined,
  nameOf: (id: string) => string
): Pick<RevealEntry, "resultLabel" | "detailLabel" | "flavor"> {
  if (!result || !Number.isFinite(result.score)) return { resultLabel: "Sin resultado" };
  const p = (result.payload ?? {}) as Record<string, unknown>;

  switch (def.type) {
    case "prompt":
      return formatPromptDisplay(p, nameOf);
    case "hostPick":
      return { resultLabel: result.flavor ?? "Sin selección", flavor: result.flavor };
    case "selfTap":
      return {
        resultLabel: p.confirmed ? "Confirmó" : "Sin confirmar",
        detailLabel: typeof p.timeMs === "number" ? `${Math.round(p.timeMs)}ms` : undefined,
        flavor: result.flavor,
      };
    case "vote":
      return formatVoteDisplay(p, nameOf);
    case "judge":
      if (typeof p.votes === "number" || Array.isArray(p.voters)) return formatJudgeVoteDisplay(p, nameOf);
      return {
        resultLabel: `${formatScore(result.score)}/100`,
        detailLabel: typeof p.message === "string" && p.message ? p.message : undefined,
        flavor: result.flavor,
      };
    case "timing":
      return {
        resultLabel: typeof p.offsetMs === "number" ? `${Math.round(p.offsetMs)}ms` : `Puntaje ${formatScore(result.score)}`,
        flavor: formatFlavor(def, result.payload, result.playerId),
      };
    case "reaction":
      return {
        resultLabel: typeof p.reactionMs === "number" ? `${Math.round(p.reactionMs)}ms` : p.falseStart ? "Salida en falso" : `Puntaje ${formatScore(result.score)}`,
        flavor: formatFlavor(def, result.payload, result.playerId),
      };
    case "estimate": {
      const answer = (def.content as { answer?: unknown })?.answer;
      return {
        resultLabel: typeof p.guess === "number" ? `Estimó ${p.guess}` : `Puntaje ${formatScore(result.score)}`,
        detailLabel: typeof answer === "number" || typeof answer === "string" ? `Correcta: ${answer}` : undefined,
        flavor: formatFlavor(def, result.payload, result.playerId),
      };
    }
    case "buzzer":
      return formatBuzzerDisplay(def, p);
    case "whack":
      return {
        resultLabel: typeof p.hits === "number" ? `${p.hits} aciertos` : `Puntaje ${formatScore(result.score)}`,
        flavor: formatFlavor(def, result.payload, result.playerId),
      };
    case "tapduel":
      return {
        resultLabel: typeof p.taps === "number" ? `${p.taps} toques` : `Puntaje ${formatScore(result.score)}`,
        flavor: formatFlavor(def, result.payload, result.playerId),
      };
    case "maze":
    case "flappy":
    case "snake":
    case "horserace":
    case "redlight":
      return {
        resultLabel: `Puntaje ${formatScore(result.score)}`,
        flavor: formatFlavor(def, result.payload, result.playerId),
      };
    default:
      return {
        resultLabel: `Puntaje ${formatScore(result.score)}`,
        detailLabel: formatPayloadSummary(result.payload),
        flavor: formatFlavor(def, result.payload, result.playerId),
      };
  }
}

function formatPromptDisplay(payload: Record<string, unknown>, nameOf: (id: string) => string) {
  const confirmedBy = stringArray(payload.confirmedBy);
  const requiredConfirmers = stringArray(payload.requiredConfirmers);
  const missingConfirmers = stringArray(payload.missingConfirmers);
  const total = requiredConfirmers.length;
  const resultLabel = total ? `${confirmedBy.length}/${total} confirmaciones` : "Sin confirmación requerida";
  const confirmedText = confirmedBy.length ? `Confirmaron ${namesFor(confirmedBy, nameOf)}` : "Todavía no confirmó nadie";
  const missingText = missingConfirmers.length ? `Faltan ${namesFor(missingConfirmers, nameOf)}` : undefined;
  return {
    resultLabel,
    detailLabel: missingText ? `${confirmedText} · ${missingText}` : confirmedText,
    flavor: missingConfirmers.length ? "confirmación incompleta" : "confirmado por el grupo",
  };
}

function formatVoteDisplay(payload: Record<string, unknown>, nameOf: (id: string) => string) {
  const votes = typeof payload.votes === "number" ? payload.votes : stringArray(payload.voters).length;
  const voters = stringArray(payload.voters);
  return {
    resultLabel: `${votes} ${votes === 1 ? "voto" : "votos"}`,
    detailLabel: voters.length ? `Votos de ${namesFor(voters, nameOf)}` : "Sin votos",
    flavor: `${votes} ${votes === 1 ? "voto" : "votos"}`,
  };
}

function formatBuzzerDisplay(def: MinigameDef | EventActivity, payload: Record<string, unknown>) {
  const content = def.content as { options?: unknown; answer?: unknown };
  const options = Array.isArray(content.options) ? content.options.map((option) => String(option)) : [];
  const answerIndex = typeof content.answer === "number" ? content.answer : 0;
  const pickedIndex = typeof payload.answerIndex === "number" ? payload.answerIndex : -1;
  const picked = optionLabel(options, pickedIndex);
  const correct = optionLabel(options, answerIndex);
  const time = typeof payload.timeMs === "number" ? `${Math.round(payload.timeMs)}ms` : undefined;
  return {
    resultLabel: payload.correct ? "Correcto" : "Incorrecto",
    detailLabel: [`Eligió ${picked}`, `Correcta: ${correct}`, time].filter(Boolean).join(" · "),
    flavor: formatFlavor(def, payload, ""),
  };
}

function formatJudgeVoteDisplay(payload: Record<string, unknown>, nameOf: (id: string) => string) {
  const voters = stringArray(payload.voters);
  const votes = typeof payload.votes === "number" ? payload.votes : voters.length;
  const message = typeof payload.message === "string" ? payload.message : "";
  const voteText = voters.length ? `Votos de ${namesFor(voters, nameOf)}` : "Sin votos";
  return {
    resultLabel: `${votes} ${votes === 1 ? "voto" : "votos"}`,
    detailLabel: [`Texto: ${message || "(sin respuesta)"}`, voteText].join(" · "),
    flavor: `${votes} ${votes === 1 ? "voto" : "votos"}`,
  };
}

function titleFor(def: MinigameDef | EventActivity): string {
  const c = def.content as Record<string, unknown>;
  if (typeof c?.question === "string") return c.question as string;
  if (typeof c?.label === "string") return c.label as string;
  if (typeof c?.prompt === "string") return c.prompt as string;
  return def.type;
}

function formatFlavor(def: MinigameDef | EventActivity, payload: unknown, _id: string): string | undefined {
  const p = (payload ?? {}) as Record<string, unknown>;
  switch (def.type) {
    case "timing":
      if (def.skin === "bostezo" && p.lost) {
        return (def.content as { loseFlavor?: string })?.loseFlavor ?? "Te vio la profe.";
      }
      return typeof p.offsetMs === "number" ? `a ${Math.round(p.offsetMs as number)}ms del centro` : undefined;
    case "reaction":
      if (p.falseStart) return "salida en falso 🚫";
      return typeof p.reactionMs === "number" ? `${Math.round(p.reactionMs as number)}ms` : undefined;
    case "estimate":
      return typeof p.guess === "number" ? `estimó ${p.guess}` : undefined;
    case "buzzer":
      return p.correct ? `acertó (${Math.round((p.timeMs as number) ?? 0)}ms)` : "erró";
    case "whack":
      return typeof p.hits === "number" ? `${p.hits} aciertos` : undefined;
    case "tapduel":
      return typeof p.taps === "number" ? `${p.taps} toques` : undefined;
    case "maze":
      if (p.finished) return `salió en ${msToSeconds(p.timeMs)}s`;
      return typeof p.progress === "number" ? `llegó al ${Math.round((p.progress as number) * 100)}% 💥` : "chocó una pared";
    case "flappy":
      return typeof p.pipes === "number" ? `${p.pipes} caño(s)` : undefined;
    case "snake":
      if (p.winner) return "último en pie 🐍";
      return typeof p.survivedMs === "number" ? `sobrevivió ${msToSeconds(p.survivedMs)}s` : undefined;
    case "horserace":
      if (p.finished) return `llegó en ${msToSeconds(p.timeMs)}s 🏇`;
      return typeof p.progress === "number" ? `quedó al ${Math.round((p.progress as number) * 100)}%` : undefined;
    case "redlight":
      if (p.eliminated) return "lo vieron moverse 🚨";
      if (p.finished) return `llegó en ${msToSeconds(p.timeMs)}s`;
      return typeof p.progress === "number" ? `quedó al ${Math.round((p.progress as number) * 100)}%` : undefined;
    default:
      return undefined;
  }
}

function msToSeconds(value: unknown): string {
  return typeof value === "number" ? (value / 1000).toFixed(1) : "?";
}

function formatScore(score: number): string {
  if (!Number.isFinite(score)) return "0";
  if (Math.abs(score) >= 1000) return Math.round(score).toLocaleString("es-AR");
  return Number.isInteger(score) ? String(score) : score.toFixed(3).replace(/\.?0+$/, "");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function namesFor(ids: string[], nameOf: (id: string) => string): string {
  return ids.map(nameOf).join(", ");
}

function optionLabel(options: string[], index: number): string {
  if (index >= 0 && index < options.length) return options[index];
  return index >= 0 ? `opción ${index + 1}` : "sin respuesta";
}

function formatPayloadSummary(payload: unknown): string | undefined {
  if (payload == null) return undefined;
  if (typeof payload === "string" || typeof payload === "number" || typeof payload === "boolean") return String(payload);
  if (!Array.isArray(payload) && typeof payload === "object") {
    const entries = Object.entries(payload as Record<string, unknown>)
      .filter(([, value]) => value !== undefined && value !== null)
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${String(value)}`);
    return entries.length ? entries.join(" · ") : undefined;
  }
  return undefined;
}
