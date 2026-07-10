import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AudioAssetDef, AudioTriggerBindingDef, AudioTriggerId } from "@essence/shared";
import {
  audioAssetPlaybackRange,
  audioBindingCandidates,
  audioBindingId,
  audioScopeKey,
  audioTriggerCandidates,
  pickWeightedAudioCandidate,
  type AudioTriggerContext,
  type AudioTriggerCandidate,
} from "@essence/shared/audio";
import { LockKeyhole, Music, Radio, Volume2, VolumeX, Waves } from "lucide-react";

interface RuntimeAudioSettings {
  muted: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
}

type AudioPlayResult =
  | { ok: true; assetId: string; trigger: AudioTriggerId }
  | { ok: false; reason: "missing" | "locked" | "muted" | "cooldown" | "voice-limit" | "blocked" };

interface AudioRuntime {
  unlocked: boolean;
  settings: RuntimeAudioSettings;
  setSettings: (updater: (settings: RuntimeAudioSettings) => RuntimeAudioSettings) => void;
  unlock: () => void;
  play: (trigger: AudioTriggerId, context?: Omit<AudioTriggerContext, "trigger">) => Promise<AudioPlayResult>;
  playBinding: (binding: AudioTriggerBindingDef) => Promise<AudioPlayResult>;
  playFirst: (triggers: AudioTriggerId[], context?: Omit<AudioTriggerContext, "trigger">) => Promise<AudioPlayResult>;
  stop: (trigger?: AudioTriggerId) => void;
}

interface ActiveVoice {
  audio: HTMLAudioElement;
  candidate: AudioTriggerCandidate;
  voiceKey: string;
  loopKey?: string;
  segmentTimer?: number;
}

const STORAGE_KEY = "essence:audio-settings:v1";
const DEFAULT_SETTINGS: RuntimeAudioSettings = {
  muted: false,
  masterVolume: 0.8,
  musicVolume: 0.55,
  sfxVolume: 0.85,
};

const AudioRuntimeContext = createContext<AudioRuntime | null>(null);

export function AudioTriggerProvider({
  assets = {},
  bindings = [],
  children,
}: {
  assets?: Record<string, AudioAssetDef>;
  bindings?: AudioTriggerBindingDef[];
  children: ReactNode;
}) {
  const [settings, setSettingsState] = useState<RuntimeAudioSettings>(() => loadAudioSettings());
  const [unlocked, setUnlocked] = useState(false);
  const settingsRef = useRef(settings);
  const unlockedRef = useRef(false);
  const activeVoicesRef = useRef(new Map<string, ActiveVoice[]>());
  const loopsRef = useRef(new Map<string, ActiveVoice>());
  const lastPlayedRef = useRef(new Map<string, number>());

  settingsRef.current = settings;

  useEffect(() => {
    persistAudioSettings(settings);
    for (const voices of activeVoicesRef.current.values()) {
      voices.forEach((voice) => applyVoiceVolume(voice, settings));
    }
  }, [settings]);

  const unlock = useCallback(() => {
    unlockedRef.current = true;
    setUnlocked(true);
  }, []);

  useEffect(() => {
    const unlockFromGesture = () => unlock();
    window.addEventListener("pointerdown", unlockFromGesture, { capture: true, once: true });
    window.addEventListener("keydown", unlockFromGesture, { capture: true, once: true });
    window.addEventListener("touchstart", unlockFromGesture, { capture: true, once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockFromGesture, { capture: true });
      window.removeEventListener("keydown", unlockFromGesture, { capture: true });
      window.removeEventListener("touchstart", unlockFromGesture, { capture: true });
    };
  }, [unlock]);

  const stop = useCallback((trigger?: AudioTriggerId) => {
    for (const [loopKey, voice] of loopsRef.current.entries()) {
      if (trigger && !loopKey.startsWith(`${trigger}:`)) continue;
      stopVoice(voice);
      removeActiveVoice(activeVoicesRef.current, voice);
      loopsRef.current.delete(loopKey);
    }
  }, []);

  const playCandidate = useCallback(
    async (
      candidate: AudioTriggerCandidate,
      trigger: AudioTriggerId,
      context: Omit<AudioTriggerContext, "trigger"> = {}
    ): Promise<AudioPlayResult> => {
      const now = Date.now();
      const asset = assets[candidate.variant.assetId];
      if (!asset?.src) return { ok: false, reason: "missing" };
      if (settingsRef.current.muted) return { ok: false, reason: "muted" };
      if (!unlockedRef.current) return { ok: false, reason: "locked" };

      const voiceKey = candidateVoiceKey(candidate);
      const lastPlayed = lastPlayedRef.current.get(voiceKey) ?? 0;
      if (candidate.cooldownMs && now - lastPlayed < candidate.cooldownMs) return { ok: false, reason: "cooldown" };
      const activeForKey = activeVoicesRef.current.get(voiceKey) ?? [];
      if (candidate.overlapPolicy === "skip" && activeForKey.length > 0) return { ok: false, reason: "voice-limit" };
      if (candidate.overlapPolicy === "interrupt" && activeForKey.length > 0) {
        stopVoices(activeVoicesRef.current, loopsRef.current, voiceKey);
      } else if (activeForKey.length >= candidate.maxVoices) {
        return { ok: false, reason: "voice-limit" };
      }

      const audio = new Audio(asset.src);
      const loop = candidate.playback === "loop";
      const hasTrim = (asset.trimStartMs ?? 0) > 0 || asset.trimEndMs !== undefined;
      const loopKey = loop ? `${trigger}:${audioScopeKey(candidate.binding.scope)}:${contextIdForLoop(context)}` : undefined;
      if (loop && loopKey) {
        const existing = loopsRef.current.get(loopKey);
        if (existing) return { ok: true, assetId: existing.candidate.variant.assetId, trigger };
      }
      audio.loop = loop && !hasTrim;
      audio.preload = "auto";
      audio.playbackRate = candidate.variant.playbackRate ?? 1;

      const voice: ActiveVoice = { audio, candidate, voiceKey, loopKey };
      const finishVoice = () => {
        clearVoiceTimer(voice);
        removeActiveVoice(activeVoicesRef.current, voice);
        if (loopKey) loopsRef.current.delete(loopKey);
      };
      applyVoiceVolume(voice, settingsRef.current);
      addActiveVoice(activeVoicesRef.current, voice);
      if (loopKey) loopsRef.current.set(loopKey, voice);
      audio.addEventListener("ended", finishVoice, { once: true });
      prepareTrimmedPlayback(voice, asset, loop, finishVoice);

      try {
        await audio.play();
        lastPlayedRef.current.set(voiceKey, now);
        return { ok: true, assetId: asset.id, trigger };
      } catch {
        finishVoice();
        return { ok: false, reason: "blocked" };
      }
    },
    [assets]
  );

  const play = useCallback(
    async (trigger: AudioTriggerId, context: Omit<AudioTriggerContext, "trigger"> = {}): Promise<AudioPlayResult> => {
      const now = Date.now();
      const playableCandidates = audioTriggerCandidates(bindings, { ...context, trigger }).filter((candidate) => Boolean(assets[candidate.variant.assetId]?.src));
      const candidates = playableCandidates.filter((candidate) => {
        const lastPlayed = lastPlayedRef.current.get(candidateVoiceKey(candidate)) ?? 0;
        return !candidate.cooldownMs || now - lastPlayed >= candidate.cooldownMs;
      });
      const candidate = pickWeightedAudioCandidate(candidates);
      if (candidate) return playCandidate(candidate, trigger, context);
      return { ok: false, reason: playableCandidates.length ? "cooldown" : "missing" };
    },
    [assets, bindings, playCandidate]
  );

  const playBinding = useCallback(
    async (binding: AudioTriggerBindingDef): Promise<AudioPlayResult> => {
      const now = Date.now();
      const playableCandidates = audioBindingCandidates(binding).filter((candidate) => Boolean(assets[candidate.variant.assetId]?.src));
      const candidates = playableCandidates.filter((candidate) => {
        const lastPlayed = lastPlayedRef.current.get(candidateVoiceKey(candidate)) ?? 0;
        return !candidate.cooldownMs || now - lastPlayed >= candidate.cooldownMs;
      });
      const candidate = pickWeightedAudioCandidate(candidates);
      if (candidate) return playCandidate(candidate, binding.trigger);
      return { ok: false, reason: playableCandidates.length ? "cooldown" : "missing" };
    },
    [assets, playCandidate]
  );

  const playFirst = useCallback(
    async (triggers: AudioTriggerId[], context: Omit<AudioTriggerContext, "trigger"> = {}): Promise<AudioPlayResult> => {
      for (const trigger of triggers) {
        const result = await play(trigger, context);
        if (result.ok || result.reason !== "missing") return result;
      }
      return { ok: false, reason: "missing" };
    },
    [play]
  );

  const setSettings = useCallback((updater: (settings: RuntimeAudioSettings) => RuntimeAudioSettings) => {
    setSettingsState((current) => normalizeAudioSettings(updater(current)));
  }, []);

  const value = useMemo<AudioRuntime>(
    () => ({ unlocked, settings, setSettings, unlock, play, playBinding, playFirst, stop }),
    [play, playBinding, playFirst, settings, setSettings, stop, unlock, unlocked]
  );

  return <AudioRuntimeContext.Provider value={value}>{children}</AudioRuntimeContext.Provider>;
}

export function useAudioRuntime(): AudioRuntime {
  const runtime = useContext(AudioRuntimeContext);
  if (!runtime) return silentAudioRuntime;
  return runtime;
}

export function AudioRuntimeControls() {
  const audio = useAudioRuntime();
  return (
    <div
      className="pointer-events-auto flex items-center gap-1.5 rounded-sm border border-[#67e8f9]/30 bg-[#061923]/88 px-2 py-1.5 text-[#ecfeff] shadow-[0_8px_24px_rgb(0_0_0/0.35)] backdrop-blur-xl"
      data-audio-runtime-controls="true"
    >
      <button
        type="button"
        aria-label={audio.settings.muted ? "Unmute audio" : "Mute audio"}
        title={audio.settings.muted ? "Unmute audio" : "Mute audio"}
        onClick={() => audio.setSettings((settings) => ({ ...settings, muted: !settings.muted }))}
        className="grid size-8 place-items-center rounded-sm border border-white/10 bg-white/5 text-[#a5f3fc] hover:bg-white/10"
      >
        {audio.settings.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </button>
      <button
        type="button"
        aria-label="Unlock audio"
        title={audio.unlocked ? "Audio unlocked" : "Unlock audio"}
        onClick={audio.unlock}
        className="grid size-8 place-items-center rounded-sm border border-white/10 bg-white/5 text-[#a5f3fc] hover:bg-white/10"
      >
        {audio.unlocked ? <Radio className="size-4" /> : <LockKeyhole className="size-4" />}
      </button>
      <VolumeSlider
        label="Master volume"
        icon={<Waves className="size-3.5" />}
        value={audio.settings.masterVolume}
        onChange={(masterVolume) => audio.setSettings((settings) => ({ ...settings, masterVolume }))}
      />
      <VolumeSlider
        label="Sound effects volume"
        icon={<Volume2 className="size-3.5" />}
        value={audio.settings.sfxVolume}
        onChange={(sfxVolume) => audio.setSettings((settings) => ({ ...settings, sfxVolume }))}
      />
      <VolumeSlider
        label="Music volume"
        icon={<Music className="size-3.5" />}
        value={audio.settings.musicVolume}
        onChange={(musicVolume) => audio.setSettings((settings) => ({ ...settings, musicVolume }))}
      />
    </div>
  );
}

function VolumeSlider({
  label,
  icon,
  value,
  onChange,
}: {
  label: string;
  icon: ReactNode;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex h-8 items-center gap-1 rounded-sm border border-white/10 bg-black/20 px-1.5 text-[#a5f3fc]" title={label}>
      {icon}
      <span className="sr-only">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-7 w-14 accent-[#67e8f9]"
      />
    </label>
  );
}

function candidateVoiceKey(candidate: AudioTriggerCandidate): string {
  return `${audioBindingId(candidate.binding)}:${candidate.variant.assetId}`;
}

function addActiveVoice(active: Map<string, ActiveVoice[]>, voice: ActiveVoice) {
  const voices = active.get(voice.voiceKey) ?? [];
  active.set(voice.voiceKey, [...voices, voice]);
}

function removeActiveVoice(active: Map<string, ActiveVoice[]>, voice: ActiveVoice) {
  const voices = active.get(voice.voiceKey) ?? [];
  const next = voices.filter((candidate) => candidate !== voice);
  if (next.length) active.set(voice.voiceKey, next);
  else active.delete(voice.voiceKey);
}

function stopVoices(active: Map<string, ActiveVoice[]>, loops: Map<string, ActiveVoice>, voiceKey: string) {
  for (const voice of active.get(voiceKey) ?? []) {
    stopVoice(voice);
    if (voice.loopKey) loops.delete(voice.loopKey);
  }
  active.delete(voiceKey);
}

function prepareTrimmedPlayback(
  voice: ActiveVoice,
  asset: AudioAssetDef,
  loop: boolean,
  onFinished: () => void
) {
  const hasTrim = (asset.trimStartMs ?? 0) > 0 || asset.trimEndMs !== undefined;
  if (!hasTrim) return;
  const range = audioAssetPlaybackRange(asset);
  const seekToStart = () => {
    try {
      voice.audio.currentTime = range.startSeconds;
    } catch {
      // Metadata may not be ready yet; loadedmetadata will retry.
    }
  };
  if (voice.audio.readyState >= 1) seekToStart();
  else voice.audio.addEventListener("loadedmetadata", seekToStart, { once: true });
  if (range.endSeconds === undefined) return;
  voice.segmentTimer = window.setInterval(() => {
    if (voice.audio.currentTime + 0.015 < range.endSeconds!) return;
    if (loop) {
      seekToStart();
      void voice.audio.play().catch(() => undefined);
      return;
    }
    voice.audio.pause();
    onFinished();
  }, 25);
}

function stopVoice(voice: ActiveVoice) {
  clearVoiceTimer(voice);
  voice.audio.pause();
  try {
    voice.audio.currentTime = 0;
  } catch {
    // A voice can be stopped before metadata is available.
  }
}

function clearVoiceTimer(voice: ActiveVoice) {
  if (voice.segmentTimer === undefined) return;
  window.clearInterval(voice.segmentTimer);
  voice.segmentTimer = undefined;
}

function applyVoiceVolume(voice: ActiveVoice, settings: RuntimeAudioSettings) {
  const categoryVolume = voice.candidate.category === "music" ? settings.musicVolume : settings.sfxVolume;
  voice.audio.volume = clamp01(settings.muted ? 0 : settings.masterVolume * categoryVolume * voice.candidate.volume);
}

function loadAudioSettings(): RuntimeAudioSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_SETTINGS;
    return normalizeAudioSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistAudioSettings(settings: RuntimeAudioSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Audio preferences are non-critical.
  }
}

function normalizeAudioSettings(settings: RuntimeAudioSettings): RuntimeAudioSettings {
  return {
    muted: Boolean(settings.muted),
    masterVolume: clamp01(settings.masterVolume),
    musicVolume: clamp01(settings.musicVolume),
    sfxVolume: clamp01(settings.sfxVolume),
  };
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function contextIdForLoop(context: Omit<AudioTriggerContext, "trigger">): string {
  return context.minigameId ?? context.playerId ?? context.artifactId ?? context.cosmeticId ?? context.effectId ?? context.purchaseId ?? "global";
}

const silentAudioRuntime: AudioRuntime = {
  unlocked: false,
  settings: DEFAULT_SETTINGS,
  setSettings: () => undefined,
  unlock: () => undefined,
  play: async () => ({ ok: false, reason: "missing" }),
  playBinding: async () => ({ ok: false, reason: "missing" }),
  playFirst: async () => ({ ok: false, reason: "missing" }),
  stop: () => undefined,
};
