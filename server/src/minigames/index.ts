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
  let scored: Array<{ playerId: string; score: number; payload: unknown; flavor?: string }>;

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
    return {
      playerId: id,
      name: nameOf(id),
      rank: idx + 1,
      score: s && Number.isFinite(s.score) ? s.score : 0,
      coins: coins[id] ?? 0,
      payload: s?.payload ?? null,
      flavor: s?.flavor ?? formatFlavor(def, s?.payload, id),
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

function resolvePrompt(participants: string[], subjects: string[], byId: Map<string, MinigameResult>) {
  return subjects.map((id, index) => ({
    playerId: id,
    score: subjects.length - index,
    payload: byId.get(id)?.payload ?? null,
    flavor: participants.includes(id) ? "confirmó" : undefined,
  }));
}

function resolveHostPick(participants: string[], subjects: string[], byId: Map<string, MinigameResult>) {
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

function resolveSelfTap(subjects: string[], byId: Map<string, MinigameResult>) {
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
) {
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

function resolveVote(participants: string[], subjects: string[], byId: Map<string, MinigameResult>) {
  // payload de cada jugador = { votedFor: playerId }. Score = votos recibidos.
  const received: Record<string, number> = {};
  for (const id of subjects) received[id] = 0;
  for (const id of participants) {
    const voted = (byId.get(id)?.payload as { votedFor?: string })?.votedFor;
    if (voted && voted in received) received[voted] += 1;
  }
  return subjects.map((id) => ({
    playerId: id,
    score: received[id] ?? 0,
    payload: byId.get(id)?.payload ?? null,
    flavor: `${received[id] ?? 0} voto(s)`,
  }));
}

// --- Presentación -----------------------------------------------------------

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
