import Anthropic from "@anthropic-ai/sdk";

const PERSONAS: Record<string, string> = {
  lujan: `Sos "Luján Eppens", un personaje de un juego de despedida de soltero entre amigos.
Tu rol es puntuar, con humor, qué tan convincente es un mensaje que te invita a
tomar un helado. Sos exigente, irónica y difícil de impresionar, pero divertida.

Te paso un mensaje de un jugador. Devolvé SOLO un objeto JSON, sin texto extra,
sin markdown, con esta forma exacta:
{
  "score": <entero 0-100, probabilidad de que aceptes el helado>,
  "respuesta": "<una respuesta corta tuya en personaje, 1-2 oraciones>"
}

Reglas:
- Puntuá honestamente según lo creativo/gracioso/encantador del mensaje.
- La "respuesta" siempre en primera persona, en personaje, con onda canchera.
- Nunca rompas el personaje ni menciones que sos una IA.`,

  // Personas reutilizables para "El mejor chamuyo", "Roast del novio", "Discurso de padrino"
  roast: `Sos el juez de un concurso de roasts en una despedida de soltero. Puntuás qué tan
gracioso y filoso (sin ser cruel de verdad) es un roast al novio, Javi.
Devolvé SOLO JSON: {"score": <0-100>, "respuesta": "<reacción corta del juez en personaje>"}.`,

  padrino: `Sos el juez de discursos de padrino en una boda. Puntuás qué tan épico, ridículo y
emotivo es un brindis. Devolvé SOLO JSON: {"score": <0-100>, "respuesta": "<reacción corta>"}.`,
};

export interface JudgeVerdict {
  score: number;
  respuesta: string;
}

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  client = new Anthropic({ apiKey });
  return client;
}

/** Puntúa un mensaje en personaje. Si no hay API key, usa un fallback determinístico. */
export async function judgeMessage(persona: string, message: string): Promise<JudgeVerdict> {
  const system = PERSONAS[persona] ?? PERSONAS.lujan;
  const anthropic = getClient();

  if (!anthropic) {
    return fallbackVerdict(message);
  }

  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system,
      messages: [{ role: "user", content: message || "(no escribió nada)" }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const parsed = parseVerdict(text);
    if (parsed) return parsed;
    return fallbackVerdict(message);
  } catch (err) {
    console.error("[judge] error llamando a Anthropic:", err);
    return fallbackVerdict(message);
  }
}

function parseVerdict(text: string): JudgeVerdict | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    const obj = JSON.parse(text.slice(start, end + 1));
    const score = Math.max(0, Math.min(100, Math.round(Number(obj.score))));
    if (Number.isNaN(score)) return null;
    return { score, respuesta: String(obj.respuesta ?? "...") };
  } catch {
    return null;
  }
}

/** Determinístico: largo + signos de admiración + variedad. Sirve sin API key. */
function fallbackVerdict(message: string): JudgeVerdict {
  const m = (message || "").trim();
  const len = Math.min(m.length, 200);
  const bonus = (m.match(/[!¡😍❤️🍦]/g)?.length ?? 0) * 4;
  const variety = new Set(m.toLowerCase().split(/\s+/)).size;
  const score = Math.max(5, Math.min(95, Math.round(len * 0.3 + bonus + variety * 1.5)));
  const respuesta = m.length
    ? "Mmm... no está mal, pero me imaginaba algo más original. Lo pienso."
    : "¿En serio no me vas a decir nada? Paso.";
  return { score, respuesta };
}
