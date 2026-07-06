import type { RevealEntry } from "@essence/shared";

export function revealEntryResult(entry: RevealEntry): string {
  return entry.resultLabel ?? `Puntaje ${formatScore(entry.score)}`;
}

export function revealEntryDetail(entry: RevealEntry): string | undefined {
  return entry.detailLabel ?? entry.flavor;
}

export function formatScore(score: number): string {
  if (!Number.isFinite(score)) return "0";
  if (Math.abs(score) >= 1000) return Math.round(score).toLocaleString("es-AR");
  return Number.isInteger(score) ? String(score) : score.toFixed(3).replace(/\.?0+$/, "");
}
