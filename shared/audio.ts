import type {
  AudioAssetDef,
  AudioCategory,
  AudioOverlapPolicy,
  AudioPlaybackMode,
  AudioTriggerBindingDef,
  AudioTriggerId,
  AudioTriggerScope,
  AudioTriggerScopeType,
  AudioTriggerVariantDef,
} from "./types";
import { AUDIO_TRIGGER_IDS } from "./types";

export { AUDIO_TRIGGER_IDS };
export type {
  AudioAssetDef,
  AudioCategory,
  AudioOverlapPolicy,
  AudioPlaybackMode,
  AudioTriggerBindingDef,
  AudioTriggerId,
  AudioTriggerScope,
  AudioTriggerScopeType,
  AudioTriggerVariantDef,
};

export const AUDIO_TRIGGER_ID_SET = new Set<string>(AUDIO_TRIGGER_IDS);

export const AUDIO_SCOPE_TYPES = [
  "global",
  "player",
  "minigame",
  "artifact",
  "cosmetic",
  "effect",
  "purchase",
] as const satisfies readonly AudioTriggerScopeType[];

export interface AudioTriggerContext {
  trigger: AudioTriggerId;
  playerId?: string;
  minigameId?: string;
  artifactId?: string;
  cosmeticId?: string;
  effectId?: string;
  purchaseId?: string;
}

export interface AudioTriggerCandidate {
  binding: AudioTriggerBindingDef;
  variant: AudioTriggerVariantDef;
  weight: number;
  volume: number;
  category: AudioCategory;
  playback: AudioPlaybackMode;
  cooldownMs: number;
  maxVoices: number;
  overlapPolicy: AudioOverlapPolicy;
}

export interface AudioAssetPlaybackRange {
  startSeconds: number;
  endSeconds?: number;
}

export function audioTriggerLabel(trigger: AudioTriggerId | string): string {
  const [domain, action] = trigger.split(".");
  return [titleFromId(domain ?? ""), titleFromId(action ?? "")]
    .filter(Boolean)
    .join(" / ");
}

export function audioScopeLabel(scope?: AudioTriggerScope): string {
  if (!scope || scope.type === "global") return "Default";
  return `${titleFromId(scope.type)}: ${scope.id ?? "missing"}`;
}

export function audioScopeKey(scope?: AudioTriggerScope): string {
  if (!scope || scope.type === "global") return "global";
  return `${scope.type}:${scope.id ?? ""}`;
}

export function audioBindingId(binding: Pick<AudioTriggerBindingDef, "trigger" | "scope">, index = 0): string {
  return `${binding.trigger}:${audioScopeKey(binding.scope)}:${index}`;
}

export function audioTriggerCandidates(
  bindings: AudioTriggerBindingDef[] | undefined,
  context: AudioTriggerContext
): AudioTriggerCandidate[] {
  return (bindings ?? [])
    .filter((binding) => binding.enabled !== false && binding.trigger === context.trigger && audioScopeMatchesContext(binding.scope, context))
    .flatMap(audioBindingCandidates);
}

export function audioBindingCandidates(binding: AudioTriggerBindingDef): AudioTriggerCandidate[] {
  if (binding.enabled === false) return [];
  return (binding.variants ?? [])
    .filter((variant) => variant.assetId)
    .map((variant) => ({
      binding,
      variant,
      weight: normalizedWeight(variant.weight),
      volume: clampVolume((binding.volume ?? 1) * (variant.volume ?? 1)),
      category: binding.category ?? (binding.playback === "loop" ? "music" : "sfx"),
      playback: binding.playback ?? "oneShot",
      cooldownMs: Math.max(0, binding.cooldownMs ?? 0),
      maxVoices: Math.max(1, Math.round(binding.maxVoices ?? 4)),
      overlapPolicy: binding.overlapPolicy ?? "overlap",
    }));
}

export function audioAssetPlaybackRange(asset: Pick<AudioAssetDef, "durationMs" | "trimStartMs" | "trimEndMs">): AudioAssetPlaybackRange {
  const durationMs = finiteNonNegative(asset.durationMs);
  const startMs = Math.min(finiteNonNegative(asset.trimStartMs), durationMs || Number.POSITIVE_INFINITY);
  const authoredEndMs = finitePositive(asset.trimEndMs);
  const endMs = authoredEndMs ? Math.min(authoredEndMs, durationMs || authoredEndMs) : durationMs || undefined;
  return {
    startSeconds: startMs / 1000,
    endSeconds: endMs !== undefined && endMs > startMs ? endMs / 1000 : undefined,
  };
}

export function pickWeightedAudioCandidate<T extends { weight?: number }>(
  candidates: readonly T[],
  random: () => number = Math.random
): T | null {
  if (!candidates.length) return null;
  const weighted = candidates.map((candidate) => ({ candidate, weight: normalizedWeight(candidate.weight) }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return weighted[0]?.candidate ?? null;
  let cursor = Math.max(0, Math.min(0.999999999, random())) * total;
  for (const entry of weighted) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.candidate;
  }
  return weighted[weighted.length - 1]?.candidate ?? null;
}

export function audioScopeMatchesContext(scope: AudioTriggerScope | undefined, context: AudioTriggerContext): boolean {
  if (!scope || scope.type === "global") return true;
  if (!scope.id) return false;
  if (scope.type === "player") return scope.id === context.playerId;
  if (scope.type === "minigame") return scope.id === context.minigameId;
  if (scope.type === "artifact") return scope.id === context.artifactId;
  if (scope.type === "cosmetic") return scope.id === context.cosmeticId;
  if (scope.type === "effect") return scope.id === context.effectId;
  if (scope.type === "purchase") return scope.id === context.purchaseId;
  return false;
}

export function contextIdForScope(type: AudioTriggerScopeType, context: AudioTriggerContext): string | undefined {
  if (type === "global") return undefined;
  if (type === "player") return context.playerId;
  if (type === "minigame") return context.minigameId;
  if (type === "artifact") return context.artifactId;
  if (type === "cosmetic") return context.cosmeticId;
  if (type === "effect") return context.effectId;
  if (type === "purchase") return context.purchaseId;
  return undefined;
}

function normalizedWeight(weight: number | undefined): number {
  return Number.isFinite(weight) && weight !== undefined ? Math.max(0, weight) : 1;
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.max(0, Math.min(2, volume));
}

function finiteNonNegative(value: number | undefined): number {
  return Number.isFinite(value) && value !== undefined ? Math.max(0, value) : 0;
}

function finitePositive(value: number | undefined): number | undefined {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : undefined;
}

function titleFromId(value: string): string {
  return value
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
