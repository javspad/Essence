import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AudioAssetDef,
  AudioCategory,
  AudioOverlapPolicy,
  AudioPlaybackMode,
  AudioTriggerBindingDef,
  AudioTriggerId,
  AudioTriggerScopeType,
  GameContent,
} from "@essence/shared";
import {
  AUDIO_SCOPE_TYPES,
  AUDIO_TRIGGER_IDS,
  audioAssetPlaybackRange,
  audioScopeLabel,
  audioTriggerLabel,
} from "@essence/shared/audio";
import { normalizeContentSchema, validateGameContent } from "@essence/shared/contentValidation";
import { eventTitle } from "@essence/shared/events";
import seedContent from "@shared/content.json";
import { Copy, Download, GripVertical, Pause, Play, Plus, RotateCcw, Save, Scissors, Square, Trash2, Upload, Volume2, Wrench, X } from "lucide-react";
import { AudioTriggerProvider, useAudioRuntime } from "../audio";
import { saveContentJsonToDisk } from "../lib/contentDiskSave";

const STORAGE_KEY = "essence:sound-builder:draft:v1";
const AUDIO_ASSET_DRAG_TYPE = "application/x-essence-audio-asset";
const BASE_CONTENT = normalizeContentSchema(seedContent);

type SoundBuilderDraft = Pick<GameContent, "audioAssets" | "audioTriggers"> & {
  selectedAssetId?: string;
  selectedBindingIndex?: number;
};

export default function SoundBuilder() {
  const [initialState] = useState(() => loadInitialSoundBuilderState());
  const [content, setContent] = useState<GameContent>(initialState.content);
  const [selectedAssetId, setSelectedAssetId] = useState(initialState.selectedAssetId);
  const [selectedBindingIndex, setSelectedBindingIndex] = useState(initialState.selectedBindingIndex);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [trimAssetId, setTrimAssetId] = useState<string | null>(null);
  const [fileDropActive, setFileDropActive] = useState(false);
  const [playingAssetId, setPlayingAssetId] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const assetIds = useMemo(() => Object.keys(content.audioAssets ?? {}), [content.audioAssets]);
  const bindings = content.audioTriggers ?? [];
  const trimAsset = trimAssetId ? content.audioAssets?.[trimAssetId] : undefined;
  const selectedBinding = bindings[selectedBindingIndex];
  const validation = useMemo(() => validateGameContent(content), [content]);
  const exportJson = useMemo(() => JSON.stringify(normalizeContentSchema(content), null, 2), [content]);
  const compactDraftJson = useMemo(
    () => JSON.stringify(soundDraftFromContent(content, selectedAssetId, selectedBindingIndex), null, 2),
    [content.audioAssets, content.audioTriggers, selectedAssetId, selectedBindingIndex]
  );

  useEffect(() => {
    if (selectedAssetId && assetIds.includes(selectedAssetId)) return;
    setSelectedAssetId(assetIds[0] ?? "");
  }, [assetIds, selectedAssetId]);

  useEffect(() => {
    if (bindings.length === 0) {
      setSelectedBindingIndex(-1);
      return;
    }
    if (selectedBindingIndex >= 0 && selectedBindingIndex < bindings.length) return;
    setSelectedBindingIndex(0);
  }, [bindings.length, selectedBindingIndex]);

  useEffect(() => {
    if (!saveStatus) return;
    const timeout = window.setTimeout(() => setSaveStatus(""), 3000);
    return () => window.clearTimeout(timeout);
  }, [saveStatus]);

  useEffect(() => () => stopPreview(previewAudioRef.current), []);

  const uploadFiles = async (files: FileList | File[] | null) => {
    const uploadList = Array.from(files ?? []);
    if (!uploadList.length) return;
    let firstId = "";
    const assets = await Promise.all(uploadList.map(fileToAudioAsset));
    setContent((current) => {
      const nextAssets = { ...(current.audioAssets ?? {}) };
      for (const asset of assets) {
        const id = nextAvailableImportId(asset.id, nextAssets);
        nextAssets[id] = { ...asset, id };
        if (!firstId) firstId = id;
      }
      return { ...current, audioAssets: nextAssets };
    });
    if (firstId) setSelectedAssetId(firstId);
    setSaveStatus(`Uploaded ${assets.length}`);
  };

  const dropFiles = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setFileDropActive(false);
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("audio/") || !file.type);
    void uploadFiles(files);
  };

  const updateAsset = (id: string, updater: (asset: AudioAssetDef) => AudioAssetDef) => {
    let nextSelectedId = id;
    setContent((current) => {
      const currentAssets = current.audioAssets ?? {};
      const updatedDraft = updater(currentAssets[id] ?? emptyAudioAsset(id));
      const requestedId = idFromName(updatedDraft.id || id, "sound");
      const nextId = requestedId !== id && currentAssets[requestedId] ? nextAvailableImportId(requestedId, currentAssets) : requestedId;
      nextSelectedId = nextId;
      const updated = { ...updatedDraft, id: nextId };
      const { [id]: _previous, ...rest } = currentAssets;
      const nextTriggers = (current.audioTriggers ?? []).map((binding) => ({
        ...binding,
        variants: binding.variants.map((variant) => ({
          ...variant,
          assetId: variant.assetId === id ? nextId : variant.assetId,
        })),
      }));
      return {
        ...current,
        audioAssets: { ...rest, [nextId]: updated },
        audioTriggers: nextTriggers,
      };
    });
    if (selectedAssetId === id) setSelectedAssetId(nextSelectedId);
  };

  const deleteAsset = (id: string) => {
    const asset = content.audioAssets?.[id];
    if (!asset) return;
    if (!window.confirm(`Delete "${asset.name}"?`)) return;
    setContent((current) => {
      const { [id]: _deleted, ...audioAssets } = current.audioAssets ?? {};
      const audioTriggers = (current.audioTriggers ?? [])
        .map((binding) => ({
          ...binding,
          variants: binding.variants.filter((variant) => variant.assetId !== id),
        }))
        .filter((binding) => binding.variants.length > 0);
      return { ...current, audioAssets, audioTriggers };
    });
    if (trimAssetId === id) setTrimAssetId(null);
    if (playingAssetId === id) {
      stopPreview(previewAudioRef.current);
      previewAudioRef.current = null;
      setPlayingAssetId(null);
    }
    setSaveStatus("Deleted");
  };

  const previewAsset = async (asset: AudioAssetDef) => {
    if (playingAssetId === asset.id) {
      stopPreview(previewAudioRef.current);
      previewAudioRef.current = null;
      setPlayingAssetId(null);
      return;
    }
    stopPreview(previewAudioRef.current);
    const audio = createAssetPreview(asset, () => {
      previewAudioRef.current = null;
      setPlayingAssetId(null);
    });
    previewAudioRef.current = audio;
    setPlayingAssetId(asset.id);
    try {
      await audio.play();
    } catch {
      previewAudioRef.current = null;
      setPlayingAssetId(null);
      setSaveStatus("Playback blocked");
    }
  };

  const createBinding = () => {
    const firstAssetId = selectedAssetId || assetIds[0] || "";
    const binding: AudioTriggerBindingDef = {
      trigger: "player.clicked",
      scope: { type: "global" },
      category: "sfx",
      playback: "oneShot",
      volume: 1,
      cooldownMs: 80,
      maxVoices: 4,
      overlapPolicy: "overlap",
      enabled: true,
      variants: firstAssetId ? [{ assetId: firstAssetId, weight: 1 }] : [],
    };
    setContent((current) => ({
      ...current,
      audioTriggers: [...(current.audioTriggers ?? []), binding],
    }));
    setSelectedBindingIndex(bindings.length);
    setSaveStatus("Binding created");
  };

  const updateBinding = (index: number, updater: (binding: AudioTriggerBindingDef) => AudioTriggerBindingDef) => {
    setContent((current) => ({
      ...current,
      audioTriggers: (current.audioTriggers ?? []).map((binding, bindingIndex) => (bindingIndex === index ? updater(binding) : binding)),
    }));
  };

  const deleteBinding = (index: number) => {
    setContent((current) => ({
      ...current,
      audioTriggers: (current.audioTriggers ?? []).filter((_, bindingIndex) => bindingIndex !== index),
    }));
    setSelectedBindingIndex(Math.max(0, index - 1));
    setSaveStatus("Binding deleted");
  };

  const importJson = () => {
    try {
      const parsed = JSON.parse(importText);
      const next = normalizeContentSchema(isFullContent(parsed) ? parsed : { ...BASE_CONTENT, ...parsed });
      setContent(next);
      setSelectedAssetId(Object.keys(next.audioAssets ?? {})[0] ?? "");
      setSelectedBindingIndex(next.audioTriggers?.length ? 0 : -1);
      setImportText("");
      setJsonOpen(false);
      setSaveStatus("Imported");
    } catch {
      window.alert("JSON invalido");
    }
  };

  const resetDraft = () => {
    const saved = loadSavedSoundBuilderState();
    const next = saved ?? baseSoundBuilderState();
    setContent(next.content);
    setSelectedAssetId(next.selectedAssetId);
    setSelectedBindingIndex(next.selectedBindingIndex);
    setImportText("");
    setJsonOpen(false);
    setSaveStatus(saved ? "Recovered browser draft" : "Loaded content.json");
  };

  const copyJson = async () => {
    await navigator.clipboard?.writeText(exportJson);
    setSaveStatus("Copied");
  };

  const saveDraft = async () => {
    const stored = persistDraft(compactDraftJson);
    setSaveStatus(stored ? "Saving..." : "Storage full; saving...");
    try {
      await saveContentJsonToDisk(exportJson);
      setSaveStatus("Saved to content.json");
    } catch (error) {
      console.error("Unable to save content.json", error);
      setSaveStatus(stored ? "Browser backup only" : "Save failed");
    }
  };

  const downloadJson = () => {
    const blob = new Blob([exportJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "content.sound-builder.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setSaveStatus("Downloaded");
  };

  return (
    <AudioTriggerProvider assets={content.audioAssets} bindings={content.audioTriggers}>
    <main data-sound-builder="true" className="flex min-h-dvh flex-col bg-[#0b1219] text-slate-100 lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <header className="flex flex-none flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#121a24]/98 px-4 py-3 shadow-lg shadow-black/25">
        <div className="min-w-0">
          <p className="text-[0.58rem] font-black uppercase text-sky-200">Essence tools</p>
          <h1 className="truncate text-xl font-black tracking-normal text-white">Sound builder</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={saveDraft} className="builder-button preview gap-2">
            <Save className="h-4 w-4" />
            Save
          </button>
          <button type="button" onClick={() => setJsonOpen(true)} className="builder-button preview gap-2">
            <Upload className="h-4 w-4" />
            Import/export
          </button>
          <button type="button" onClick={downloadJson} className="builder-button gap-2">
            <Download className="h-4 w-4" />
            Download
          </button>
          <span className="min-w-20 text-center text-xs font-black text-sky-200">{saveStatus}</span>
          <a href="/tools" className="builder-button gap-2">
            <Wrench className="h-4 w-4" />
            Tools
          </a>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 lg:min-h-0 lg:overflow-hidden lg:grid-cols-[19rem_minmax(0,1fr)_20rem]">
        <aside className="flex flex-col border-b border-white/10 bg-[#101923] p-3 lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.58rem] font-black uppercase text-slate-500">{assetIds.length} sounds</p>
              <h2 className="text-base font-black text-white">Sound library</h2>
            </div>
            <label className="builder-button preview grid h-9 w-9 cursor-pointer place-items-center p-0" aria-label="Upload audio" title="Upload audio">
              <Upload className="h-4 w-4" />
              <input
                type="file"
                accept="audio/*"
                multiple
                className="sr-only"
                onChange={(event) => {
                  void uploadFiles(event.target.files);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          <label
            data-audio-file-dropzone="true"
            onDragEnter={(event) => {
              event.preventDefault();
              setFileDropActive(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setFileDropActive(false)}
            onDrop={dropFiles}
            className={`mt-3 grid min-h-20 cursor-pointer place-items-center rounded-md border border-dashed px-3 py-3 text-center transition ${
              fileDropActive ? "border-teal-300 bg-teal-300/12 text-teal-100" : "border-white/15 bg-black/15 text-slate-400 hover:border-teal-300/50 hover:text-slate-200"
            }`}
          >
            <span className="flex items-center gap-2 text-xs font-black">
              <Upload className="h-4 w-4" />
              Drop audio files
            </span>
            <span className="text-[0.6rem] font-bold text-slate-500">or choose from your computer</span>
            <input
              type="file"
              accept="audio/*"
              multiple
              className="sr-only"
              onChange={(event) => {
                void uploadFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <div className="mt-3 flex max-h-80 flex-col gap-2 overflow-y-auto pr-1 lg:min-h-0 lg:max-h-none lg:flex-1">
            {assetIds.map((id) => {
              const asset = content.audioAssets?.[id];
              if (!asset) return null;
              return (
                <div
                  key={id}
                  data-audio-asset-id={id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(AUDIO_ASSET_DRAG_TYPE, id);
                    event.dataTransfer.setData("text/plain", id);
                  }}
                  onClick={() => setSelectedAssetId(id)}
                  className={`group relative grid min-h-12 cursor-grab grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md border p-2 text-left transition active:cursor-grabbing ${
                    id === selectedAssetId ? "border-teal-300/65 bg-teal-300/10" : "border-white/10 bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.06]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void previewAsset(asset);
                    }}
                    className="grid size-8 place-items-center rounded-sm border border-teal-200/20 bg-teal-300/10 text-teal-100 hover:bg-teal-300/20"
                    aria-label={playingAssetId === id ? `Stop ${asset.name}` : `Play ${asset.name}`}
                    title={playingAssetId === id ? "Stop" : "Play"}
                  >
                    {playingAssetId === id ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                  <input
                    aria-label={`Name for ${id}`}
                    value={asset.name}
                    draggable={false}
                    onClick={(event) => event.stopPropagation()}
                    onFocus={() => setSelectedAssetId(id)}
                    onChange={(event) => updateAsset(id, (current) => ({ ...current, name: event.target.value }))}
                    className="min-w-0 rounded-sm border border-transparent bg-transparent px-1 py-1 text-sm font-black text-white outline-none hover:border-white/10 focus:border-teal-300/60 focus:bg-black/25"
                  />
                  <div className="flex items-center gap-0.5">
                    <GripVertical className="h-4 w-4 text-slate-600" aria-hidden="true" />
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedAssetId(id);
                        setTrimAssetId(id);
                      }}
                      className="grid size-7 place-items-center rounded-sm text-amber-200 hover:bg-amber-300/15"
                      aria-label={`Trim ${asset.name}`}
                      title="Trim"
                    >
                      <Scissors className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteAsset(id);
                      }}
                      className="grid size-7 place-items-center rounded-sm text-rose-300 hover:bg-rose-400/15"
                      aria-label={`Delete ${asset.name}`}
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <span className="pointer-events-none absolute left-11 top-1/2 z-20 max-w-[calc(100%-7.5rem)] -translate-y-1/2 truncate rounded-sm border border-white/10 bg-[#05090d] px-1.5 py-1 font-mono text-[0.58rem] font-bold text-slate-300 opacity-0 shadow-lg transition group-hover:opacity-100">
                    {asset.id}
                  </span>
                </div>
              );
            })}
            {!assetIds.length && <EmptyState label="Drop audio above to build your sound library." />}
          </div>
        </aside>

        <section className="bg-[#141d29] p-3 lg:min-h-0 lg:overflow-y-auto">
          {trimAsset && (
            <TrimEditor
              asset={trimAsset}
              playing={playingAssetId === trimAsset.id}
              onPreview={() => void previewAsset(trimAsset)}
              onClose={() => setTrimAssetId(null)}
              onChange={(updater) => updateAsset(trimAsset.id, updater)}
            />
          )}

          <section className={trimAsset ? "mt-4" : ""}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[0.58rem] font-black uppercase text-teal-200">Sound behavior</p>
                <h2 className="text-sm font-black text-white">Selected trigger</h2>
              </div>
              <button type="button" onClick={createBinding} className="builder-button preview gap-2">
                <Plus className="h-4 w-4" />
                Add binding
              </button>
            </div>

            {selectedBinding ? (
              <BindingEditor
                binding={selectedBinding}
                bindingIndex={selectedBindingIndex}
                content={content}
                selectedAssetId={selectedAssetId}
                onChange={(updater) => updateBinding(selectedBindingIndex, updater)}
                onDelete={() => deleteBinding(selectedBindingIndex)}
              />
            ) : (
              <div className="mt-3">
                <EmptyState label="Create a trigger binding for an audio event." />
              </div>
            )}
          </section>
        </section>

        <aside className="border-t border-white/10 bg-[#101923] p-3 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
            <PanelHeader eyebrow={`${bindings.length} bindings`} title="Trigger list" action={createBinding} actionLabel="Create trigger binding" />
            <div className="mt-3 grid gap-2">
              {bindings.map((binding, index) => (
                <button
                  key={`${binding.trigger}-${index}`}
                  type="button"
                  onClick={() => setSelectedBindingIndex(index)}
                  className={`rounded-md border p-2 text-left transition ${
                    index === selectedBindingIndex ? "border-sky-200/65 bg-sky-300/12" : "border-white/10 bg-black/15 hover:bg-white/[0.06]"
                  }`}
                >
                  <p className="truncate text-xs font-black text-white">When {audioTriggerLabel(binding.trigger)}</p>
                  <p className="mt-1 truncate text-[0.58rem] font-black uppercase text-slate-500">
                    {audioScopeLabel(binding.scope)} · {binding.variants.length} {binding.variants.length === 1 ? "sound" : "sounds"}
                  </p>
                </button>
              ))}
              {!bindings.length && <p className="text-xs font-bold leading-5 text-slate-500">No trigger bindings yet.</p>}
            </div>
          </section>

          <section className="mt-3 rounded-md border border-white/10 bg-white/[0.035] p-3">
            <h2 className="text-sm font-black text-white">Validation</h2>
            <div className="mt-2 grid gap-1 text-xs font-bold leading-5">
              {validation.ok ? (
                <p className="text-emerald-200">Content validates.</p>
              ) : (
                validation.errors.slice(0, 10).map((error) => (
                  <p key={error} className="rounded-sm border border-rose-300/20 bg-rose-400/10 px-2 py-1 text-rose-100">
                    {error}
                  </p>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>

      {jsonOpen && (
        <JsonModal
          exportJson={exportJson}
          importText={importText}
          setImportText={setImportText}
          onCopy={copyJson}
          onDownload={downloadJson}
          onImport={importJson}
          onReset={resetDraft}
          onClose={() => setJsonOpen(false)}
        />
      )}
    </main>
    </AudioTriggerProvider>
  );
}

function TrimEditor({
  asset,
  playing,
  onPreview,
  onClose,
  onChange,
}: {
  asset: AudioAssetDef;
  playing: boolean;
  onPreview: () => void;
  onClose: () => void;
  onChange: (updater: (asset: AudioAssetDef) => AudioAssetDef) => void;
}) {
  const [waveform, setWaveform] = useState<number[]>([]);
  const [decodeStatus, setDecodeStatus] = useState<"loading" | "ready" | "error">("loading");
  const durationMs = asset.durationMs ?? 0;
  const startMs = Math.min(asset.trimStartMs ?? 0, durationMs);
  const endMs = Math.max(startMs, Math.min(asset.trimEndMs ?? durationMs, durationMs));
  const startPercent = durationMs ? (startMs / durationMs) * 100 : 0;
  const endPercent = durationMs ? (endMs / durationMs) * 100 : 100;

  useEffect(() => {
    let cancelled = false;
    setDecodeStatus("loading");
    void decodeWaveform(asset.src)
      .then(({ samples, durationMs: decodedDurationMs }) => {
        if (cancelled) return;
        setWaveform(samples);
        setDecodeStatus("ready");
        onChange((current) => {
          if (Math.abs((current.durationMs ?? 0) - decodedDurationMs) < 1) return current;
          const trimEndMs = current.trimEndMs !== undefined ? Math.min(current.trimEndMs, decodedDurationMs) : undefined;
          return { ...current, durationMs: decodedDurationMs, trimEndMs };
        });
      })
      .catch(() => {
        if (!cancelled) setDecodeStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [asset.src]);

  const updateStart = (value: number) => {
    const nextStart = Math.max(0, Math.min(value, Math.max(0, endMs - 10)));
    onChange((current) => ({ ...current, trimStartMs: nextStart > 0 ? Math.round(nextStart) : undefined }));
  };

  const updateEnd = (value: number) => {
    const nextEnd = Math.max(startMs + 10, Math.min(value, durationMs));
    onChange((current) => ({ ...current, trimEndMs: nextEnd < durationMs - 1 ? Math.round(nextEnd) : undefined }));
  };

  return (
    <section data-audio-trim-editor="true" className="rounded-md border border-amber-200/20 bg-amber-300/[0.055] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.58rem] font-black uppercase text-amber-200">Trim sound</p>
          <h2 className="mt-1 truncate text-lg font-black text-white">{asset.name}</h2>
          <p className="mt-1 font-mono text-[0.62rem] font-bold text-slate-500">{formatTime(startMs)} - {formatTime(endMs)} / {formatTime(durationMs)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onPreview} className="builder-button compact gap-1.5 border-amber-200/30 text-amber-100">
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {playing ? "Stop" : "Preview cut"}
          </button>
          <button
            type="button"
            onClick={() => onChange((current) => ({ ...current, trimStartMs: undefined, trimEndMs: undefined }))}
            className="builder-button compact icon"
            aria-label="Reset trim"
            title="Reset trim"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onClose} className="builder-button compact icon" aria-label="Close trim editor" title="Close">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="relative mt-4 h-36 overflow-hidden rounded-md border border-white/10 bg-[#090f14] px-2 py-4" data-audio-waveform="true">
        {decodeStatus === "loading" && <div className="absolute inset-0 z-10 grid place-items-center text-xs font-black text-slate-500">Reading waveform...</div>}
        {decodeStatus === "error" && <div className="absolute inset-0 z-10 grid place-items-center text-xs font-black text-rose-200">Waveform unavailable</div>}
        <div className="flex h-full items-center gap-px" aria-hidden="true">
          {waveform.map((peak, index) => {
            const percent = waveform.length > 1 ? (index / (waveform.length - 1)) * 100 : 0;
            const selected = percent >= startPercent && percent <= endPercent;
            return (
              <span
                key={index}
                className={`min-w-px flex-1 rounded-full transition-colors ${selected ? "bg-teal-300" : "bg-slate-700"}`}
                style={{ height: `${Math.max(5, peak * 100)}%` }}
              />
            );
          })}
        </div>
        <div className="pointer-events-none absolute inset-y-0 w-px bg-amber-200 shadow-[0_0_10px_rgb(253_230_138/0.8)]" style={{ left: `${startPercent}%` }} />
        <div className="pointer-events-none absolute inset-y-0 w-px bg-amber-200 shadow-[0_0_10px_rgb(253_230_138/0.8)]" style={{ left: `${endPercent}%` }} />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <TrimControl
          label="Start"
          valueMs={startMs}
          minMs={0}
          maxMs={Math.max(0, endMs - 10)}
          durationMs={durationMs}
          onChange={updateStart}
        />
        <TrimControl
          label="End"
          valueMs={endMs}
          minMs={Math.min(durationMs, startMs + 10)}
          maxMs={durationMs}
          durationMs={durationMs}
          onChange={updateEnd}
        />
      </div>
    </section>
  );
}

function TrimControl({
  label,
  valueMs,
  minMs,
  maxMs,
  durationMs,
  onChange,
}: {
  label: string;
  valueMs: number;
  minMs: number;
  maxMs: number;
  durationMs: number;
  onChange: (valueMs: number) => void;
}) {
  return (
    <label className="block rounded-md border border-white/10 bg-black/20 p-2 text-[0.62rem] font-black uppercase text-slate-400">
      <span className="flex items-center justify-between gap-3">
        {label}
        <input
          type="number"
          min={minMs / 1000}
          max={maxMs / 1000}
          step={0.01}
          value={(valueMs / 1000).toFixed(2)}
          onChange={(event) => onChange(Number(event.target.value) * 1000)}
          className="h-7 w-24 rounded-sm border border-white/10 bg-[#0b1118] px-2 text-right font-mono text-xs font-bold normal-case text-white outline-none focus:border-amber-200/60"
        />
      </span>
      <input
        type="range"
        min={minMs}
        max={Math.max(minMs, maxMs)}
        step={10}
        value={valueMs}
        disabled={!durationMs}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 h-5 w-full accent-amber-300 disabled:opacity-30"
      />
    </label>
  );
}

function BindingEditor({
  binding,
  bindingIndex,
  content,
  selectedAssetId,
  onChange,
  onDelete,
}: {
  binding: AudioTriggerBindingDef;
  bindingIndex: number;
  content: GameContent;
  selectedAssetId: string;
  onChange: (updater: (binding: AudioTriggerBindingDef) => AudioTriggerBindingDef) => void;
  onDelete: () => void;
}) {
  const audio = useAudioRuntime();
  const [testStatus, setTestStatus] = useState("");
  const assetOptions = audioAssetOptions(content, selectedAssetId);
  const scopeType = binding.scope?.type ?? "global";
  const scopeOptions = scopeIdOptions(content, scopeType, binding.scope?.id);

  useEffect(() => {
    if (!testStatus) return;
    const timeout = window.setTimeout(() => setTestStatus(""), 1800);
    return () => window.clearTimeout(timeout);
  }, [testStatus]);

  const addVariant = (assetId = selectedAssetId || Object.keys(content.audioAssets ?? {})[0] || "") => {
    if (!assetId) return;
    onChange((current) => ({
      ...current,
      variants: [...current.variants, { assetId, weight: 1 }],
    }));
  };

  const dropVariant = (event: React.DragEvent<HTMLElement>, index?: number) => {
    event.preventDefault();
    event.stopPropagation();
    const assetId = event.dataTransfer.getData(AUDIO_ASSET_DRAG_TYPE) || event.dataTransfer.getData("text/plain");
    if (!content.audioAssets?.[assetId]) return;
    if (index === undefined) addVariant(assetId);
    else updateVariant(index, (current) => ({ ...current, assetId }));
  };

  const testBinding = async () => {
    const result = await audio.playBinding(binding);
    setTestStatus(result.ok ? `Played ${content.audioAssets?.[result.assetId]?.name ?? result.assetId}` : audioTestResultLabel(result.reason));
  };

  const updateVariant = (index: number, updater: (variant: NonNullable<AudioTriggerBindingDef["variants"]>[number]) => NonNullable<AudioTriggerBindingDef["variants"]>[number]) => {
    onChange((current) => ({
      ...current,
      variants: current.variants.map((variant, variantIndex) => (variantIndex === index ? updater(variant) : variant)),
    }));
  };

  const removeVariant = (index: number) => {
    onChange((current) => ({
      ...current,
      variants: current.variants.filter((_, variantIndex) => variantIndex !== index),
    }));
  };

  return (
    <div data-audio-binding-editor={bindingIndex} className="mt-3 rounded-md border border-teal-200/15 bg-teal-300/[0.075] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.58rem] font-black uppercase text-teal-200">Binding {bindingIndex + 1}</p>
          <h3 className="mt-1 truncate text-base font-black text-white">When {audioTriggerLabel(binding.trigger)}</h3>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {testStatus && <span className="rounded-sm border border-amber-200/20 bg-amber-300/10 px-2 py-1 text-[0.65rem] font-black text-amber-100">{testStatus}</span>}
          <button type="button" onClick={() => void testBinding()} disabled={!binding.variants.length || binding.enabled === false} className="builder-button compact gap-1.5 border-amber-200/30 text-amber-100 disabled:opacity-40">
            <Play className="h-3.5 w-3.5" />
            Test trigger
          </button>
          {binding.playback === "loop" && (
            <button
              type="button"
              onClick={() => {
                audio.stop(binding.trigger);
                setTestStatus("Stopped");
              }}
              className="builder-button compact icon"
              aria-label="Stop trigger test"
              title="Stop test"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          )}
          <button type="button" onClick={onDelete} className="builder-button danger compact icon" aria-label="Delete binding" title="Delete binding">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <SelectInput
          label="Trigger"
          value={binding.trigger}
          options={AUDIO_TRIGGER_IDS.map((trigger) => ({ value: trigger, label: audioTriggerLabel(trigger) }))}
          onChange={(trigger) => onChange((current) => ({ ...current, trigger: trigger as AudioTriggerId }))}
        />
        <SelectInput
          label="Category"
          value={binding.category ?? "sfx"}
          options={[
            { value: "sfx", label: "Sound effect" },
            { value: "music", label: "Music" },
          ]}
          onChange={(category) => onChange((current) => ({ ...current, category: category as AudioCategory }))}
        />
        <SelectInput
          label="Playback"
          value={binding.playback ?? "oneShot"}
          options={[
            { value: "oneShot", label: "One-shot" },
            { value: "loop", label: "Loop" },
          ]}
          onChange={(playback) => onChange((current) => ({ ...current, playback: playback as AudioPlaybackMode }))}
        />
        <SelectInput
          label="Scope"
          value={scopeType}
          options={AUDIO_SCOPE_TYPES.map((type) => ({ value: type, label: scopeTypeLabel(type) }))}
          onChange={(type) =>
            onChange((current) => ({
              ...current,
              scope: type === "global" ? { type: "global" } : { type: type as AudioTriggerScopeType, id: firstScopeId(content, type as AudioTriggerScopeType) },
            }))
          }
        />
        {scopeType === "global" ? (
          <div />
        ) : scopeOptions.length ? (
          <SelectInput
            label="Scope id"
            value={binding.scope?.id ?? scopeOptions[0]?.value ?? ""}
            options={scopeOptions}
            onChange={(id) => onChange((current) => ({ ...current, scope: { type: scopeType, id } }))}
          />
        ) : (
          <TextInput
            label="Scope id"
            value={binding.scope?.id ?? ""}
            onChange={(id) => onChange((current) => ({ ...current, scope: { type: scopeType, id } }))}
          />
        )}
        <SelectInput
          label="Overlap"
          value={binding.overlapPolicy ?? "overlap"}
          options={[
            { value: "overlap", label: "Overlap" },
            { value: "skip", label: "Skip while playing" },
            { value: "interrupt", label: "Interrupt" },
          ]}
          onChange={(overlapPolicy) => onChange((current) => ({ ...current, overlapPolicy: overlapPolicy as AudioOverlapPolicy }))}
        />
        <NumberInput label="Volume" value={binding.volume ?? 1} step={0.05} onChange={(volume) => onChange((current) => ({ ...current, volume }))} />
        <NumberInput label="Cooldown ms" value={binding.cooldownMs ?? 0} onChange={(cooldownMs) => onChange((current) => ({ ...current, cooldownMs: Math.max(0, Math.round(cooldownMs)) }))} />
        <NumberInput label="Max voices" value={binding.maxVoices ?? 4} onChange={(maxVoices) => onChange((current) => ({ ...current, maxVoices: Math.max(1, Math.round(maxVoices)) }))} />
      </div>

      <label className="mt-3 flex w-fit items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs font-black text-slate-200">
        <input
          type="checkbox"
          checked={binding.enabled !== false}
          onChange={(event) => onChange((current) => ({ ...current, enabled: event.target.checked }))}
          className="accent-sky-300"
        />
        Enabled
      </label>

      <section
        data-audio-variant-dropzone="true"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => dropVariant(event)}
        className="mt-3 border-t border-dashed border-white/15 pt-3 transition hover:border-teal-300/40"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-black uppercase text-teal-100">Sounds</h4>
            <span className="text-[0.62rem] font-bold text-slate-500">Drop from the library</span>
          </div>
          <button type="button" onClick={() => addVariant()} disabled={!assetOptions.length} className="builder-button preview compact gap-1.5 disabled:opacity-40">
            <Plus className="h-3.5 w-3.5" />
            Add sound
          </button>
        </div>
      <div className="mt-2 grid gap-2">
        {binding.variants.map((variant, index) => (
          <div
            key={`${variant.assetId}-${index}`}
            data-audio-variant-index={index}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => dropVariant(event, index)}
            className="grid gap-2 rounded-md border border-white/10 bg-black/20 p-2 sm:grid-cols-[minmax(0,1fr)_5rem_5rem_2rem]"
          >
            <SelectInput
              label="Asset"
              value={variant.assetId}
              options={assetOptions}
              onChange={(assetId) => updateVariant(index, (current) => ({ ...current, assetId }))}
            />
            <NumberInput label="Weight" value={variant.weight ?? 1} step={0.1} onChange={(weight) => updateVariant(index, (current) => ({ ...current, weight: Math.max(0, weight) }))} />
            <NumberInput label="Volume" value={variant.volume ?? 1} step={0.05} onChange={(volume) => updateVariant(index, (current) => ({ ...current, volume }))} />
            <button type="button" onClick={() => removeVariant(index)} className="builder-button danger icon mt-5" aria-label="Remove variant">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {!binding.variants.length && <p className="rounded-sm border border-dashed border-white/10 p-4 text-center text-xs font-bold text-slate-500">Drop a sound here</p>}
      </div>
      </section>
    </div>
  );
}

function PanelHeader({ eyebrow, title, action, actionLabel }: { eyebrow: string; title: string; action: () => void; actionLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[0.58rem] font-black uppercase text-slate-500">{eyebrow}</p>
        <h2 className="text-base font-black text-white">{title}</h2>
      </div>
      <button type="button" onClick={action} className="builder-button preview h-9 w-9 p-0" aria-label={actionLabel}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function JsonModal({
  exportJson,
  importText,
  setImportText,
  onCopy,
  onDownload,
  onImport,
  onReset,
  onClose,
}: {
  exportJson: string;
  importText: string;
  setImportText: (value: string) => void;
  onCopy: () => void;
  onDownload: () => void;
  onImport: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="sound-json-modal-title"
        className="grid max-h-[90dvh] w-[min(60rem,calc(100vw-2rem))] grid-cols-1 overflow-hidden rounded-lg border border-white/15 bg-[#101923] shadow-2xl lg:grid-cols-2"
      >
        <h2 id="sound-json-modal-title" className="sr-only">Import and export sound JSON</h2>
        <div className="min-h-0 p-4">
          <h2 className="text-lg font-black text-white">Export JSON</h2>
          <textarea aria-label="Sound export JSON" readOnly value={exportJson} className="mt-3 h-[56dvh] w-full rounded-md border border-white/10 bg-[#071018] p-3 font-mono text-xs text-slate-200" />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={onCopy} className="builder-button preview gap-2"><Copy className="h-4 w-4" />Copy</button>
            <button type="button" onClick={onDownload} className="builder-button gap-2"><Download className="h-4 w-4" />Download</button>
          </div>
        </div>
        <div className="min-h-0 border-t border-white/10 p-4 lg:border-l lg:border-t-0">
          <h2 className="text-lg font-black text-white">Import JSON</h2>
          <textarea aria-label="Sound import JSON" value={importText} onChange={(event) => setImportText(event.target.value)} className="mt-3 h-[56dvh] w-full rounded-md border border-white/10 bg-[#071018] p-3 font-mono text-xs text-slate-200" />
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onReset} className="builder-button danger">Recover browser draft</button>
            <button type="button" onClick={onClose} className="builder-button">Close</button>
            <button type="button" onClick={onImport} className="builder-button preview">Import</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-[0.62rem] font-black uppercase text-slate-400">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#0b1118] px-3 text-sm font-bold normal-case text-slate-100 outline-none focus:border-sky-300/60" />
    </label>
  );
}

function NumberInput({ label, value, step = 1, onChange }: { label: string; value: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="block text-[0.62rem] font-black uppercase text-slate-400">
      {label}
      <input type="number" step={step} value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#0b1118] px-3 text-sm font-bold normal-case text-slate-100 outline-none focus:border-sky-300/60" />
    </label>
  );
}

type SelectOption = { value: string; label: string };

function SelectInput({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-[0.62rem] font-black uppercase text-slate-400">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#0b1118] px-3 text-sm font-bold normal-case text-slate-100 outline-none focus:border-sky-300/60"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-[#0b1118] text-slate-100">
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="grid min-h-32 place-items-center rounded-md border border-dashed border-white/15 bg-white/[0.025] p-4 text-center text-sm font-bold text-slate-500">
      {label}
    </div>
  );
}

function audioAssetOptions(content: GameContent, selectedAssetId: string): SelectOption[] {
  const options = Object.values(content.audioAssets ?? {}).map((asset) => ({ value: asset.id, label: asset.name }));
  if (selectedAssetId && !options.some((option) => option.value === selectedAssetId)) {
    options.push({ value: selectedAssetId, label: `Missing: ${selectedAssetId}` });
  }
  return options;
}

function scopeIdOptions(content: GameContent, scopeType: AudioTriggerScopeType, selectedId?: string): SelectOption[] {
  const options =
    scopeType === "player"
      ? content.players.map((player) => ({ value: player.id, label: player.name }))
      : scopeType === "minigame"
        ? Object.entries(content.events)
            .filter(([, event]) => Boolean(event.activity))
            .map(([id, event]) => ({ value: id, label: eventTitle(event) }))
        : scopeType === "artifact"
          ? Object.values(content.artifacts ?? {}).map((artifact) => ({ value: artifact.id, label: artifact.name }))
          : scopeType === "cosmetic"
            ? Object.values(content.cosmetics ?? {}).map((cosmetic) => ({ value: cosmetic.id, label: cosmetic.name }))
            : scopeType === "effect"
              ? Object.values(content.effects ?? {}).map((effect) => ({ value: effect.id, label: effect.name }))
              : [];
  if (selectedId && !options.some((option) => option.value === selectedId)) {
    options.push({ value: selectedId, label: `Missing: ${selectedId}` });
  }
  return options;
}

function firstScopeId(content: GameContent, scopeType: AudioTriggerScopeType): string | undefined {
  return scopeIdOptions(content, scopeType)[0]?.value;
}

function scopeTypeLabel(type: AudioTriggerScopeType): string {
  if (type === "global") return "Default";
  return type.slice(0, 1).toUpperCase() + type.slice(1);
}

function emptyAudioAsset(id: string): AudioAssetDef {
  return { id, name: "New sound", src: "" };
}

function nextAvailableImportId(baseId: string, catalog: Record<string, unknown>): string {
  if (!catalog[baseId]) return baseId;
  let index = 2;
  let id = `${baseId}-${index}`;
  while (catalog[id]) {
    index += 1;
    id = `${baseId}-${index}`;
  }
  return id;
}

function idFromName(value: string, fallback: string): string {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return id || fallback;
}

async function fileToAudioAsset(file: File): Promise<AudioAssetDef> {
  return {
    id: idFromName(file.name.replace(/\.[^.]+$/, ""), "sound"),
    name: file.name.replace(/\.[^.]+$/, "") || "Uploaded audio",
    src: await readFileAsDataUrl(file),
    mimeType: file.type || undefined,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function isFullContent(value: unknown): value is GameContent {
  return !!value && typeof value === "object" && "board" in value && "players" in value;
}

function loadInitialSoundBuilderState(): { content: GameContent; selectedAssetId: string; selectedBindingIndex: number } {
  return loadSavedSoundBuilderState() ?? baseSoundBuilderState();
}

function loadSavedSoundBuilderState(): { content: GameContent; selectedAssetId: string; selectedBindingIndex: number } | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as SoundBuilderDraft;
    const content = contentFromSavedDraft(parsed);
    return {
      content,
      selectedAssetId: parsed.selectedAssetId && content.audioAssets?.[parsed.selectedAssetId] ? parsed.selectedAssetId : Object.keys(content.audioAssets ?? {})[0] ?? "",
      selectedBindingIndex: typeof parsed.selectedBindingIndex === "number" ? parsed.selectedBindingIndex : content.audioTriggers?.length ? 0 : -1,
    };
  } catch {
    return null;
  }
}

function baseSoundBuilderState(): { content: GameContent; selectedAssetId: string; selectedBindingIndex: number } {
  return {
    content: BASE_CONTENT,
    selectedAssetId: Object.keys(BASE_CONTENT.audioAssets ?? {})[0] ?? "",
    selectedBindingIndex: BASE_CONTENT.audioTriggers?.length ? 0 : -1,
  };
}

function contentFromSavedDraft(draft: SoundBuilderDraft): GameContent {
  const baseAssets = BASE_CONTENT.audioAssets ?? {};
  const draftAssets = Object.fromEntries(
    Object.entries(draft.audioAssets ?? {}).map(([id, asset]) => [
      id,
      {
        ...asset,
        src: asset.src || baseAssets[id]?.src || "",
      },
    ])
  );
  return normalizeContentSchema({
    ...BASE_CONTENT,
    audioAssets: draftAssets,
    audioTriggers: draft.audioTriggers ?? BASE_CONTENT.audioTriggers,
  });
}

function soundDraftFromContent(content: GameContent, selectedAssetId: string, selectedBindingIndex: number): SoundBuilderDraft {
  return {
    audioAssets: Object.fromEntries(
      Object.entries(content.audioAssets ?? {}).map(([id, asset]) => [
        id,
        {
          ...asset,
          src: asset.src.startsWith("data:") ? "" : asset.src,
        },
      ])
    ),
    audioTriggers: content.audioTriggers,
    selectedAssetId,
    selectedBindingIndex,
  };
}

function persistDraft(json: string): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, json);
    return true;
  } catch (error) {
    console.warn("Unable to persist sound builder draft", error);
    return false;
  }
}

const previewTimers = new WeakMap<HTMLAudioElement, number>();

function createAssetPreview(asset: AudioAssetDef, onEnded: () => void): HTMLAudioElement {
  const audio = new Audio(asset.src);
  const range = audioAssetPlaybackRange(asset);
  const hasTrim = (asset.trimStartMs ?? 0) > 0 || asset.trimEndMs !== undefined;
  audio.volume = 0.75;
  audio.preload = "auto";

  const seekToStart = () => {
    try {
      audio.currentTime = range.startSeconds;
    } catch {
      // loadedmetadata retries the seek.
    }
  };
  if (audio.readyState >= 1) seekToStart();
  else audio.addEventListener("loadedmetadata", seekToStart, { once: true });

  const finish = () => {
    clearPreviewTimer(audio);
    onEnded();
  };
  audio.addEventListener("ended", finish, { once: true });
  if (hasTrim && range.endSeconds !== undefined) {
    previewTimers.set(
      audio,
      window.setInterval(() => {
        if (audio.currentTime + 0.015 < range.endSeconds!) return;
        audio.pause();
        finish();
      }, 25)
    );
  }
  return audio;
}

function stopPreview(audio: HTMLAudioElement | null) {
  if (!audio) return;
  clearPreviewTimer(audio);
  audio.pause();
  try {
    audio.currentTime = 0;
  } catch {
    // A preview can be stopped before metadata is available.
  }
}

function clearPreviewTimer(audio: HTMLAudioElement) {
  const timer = previewTimers.get(audio);
  if (timer !== undefined) window.clearInterval(timer);
  previewTimers.delete(audio);
}

async function decodeWaveform(src: string): Promise<{ samples: number[]; durationMs: number }> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Unable to read audio: ${response.status}`);
  const encoded = await response.arrayBuffer();
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(encoded.slice(0));
    const channel = decoded.getChannelData(0);
    const sampleCount = 120;
    const blockSize = Math.max(1, Math.floor(channel.length / sampleCount));
    const peaks = Array.from({ length: sampleCount }, (_, sampleIndex) => {
      const start = sampleIndex * blockSize;
      const end = Math.min(channel.length, start + blockSize);
      let peak = 0;
      for (let index = start; index < end; index += 1) peak = Math.max(peak, Math.abs(channel[index] ?? 0));
      return peak;
    });
    const maxPeak = Math.max(...peaks, 0.001);
    return {
      samples: peaks.map((peak) => peak / maxPeak),
      durationMs: Math.round(decoded.duration * 1000),
    };
  } finally {
    await context.close();
  }
}

function formatTime(valueMs: number): string {
  if (!Number.isFinite(valueMs)) return "0:00.00";
  const totalSeconds = Math.max(0, valueMs) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, "0")}`;
}

function audioTestResultLabel(reason: "missing" | "locked" | "muted" | "cooldown" | "voice-limit" | "blocked"): string {
  if (reason === "cooldown") return "Cooldown active";
  if (reason === "voice-limit") return "Voice limit reached";
  if (reason === "muted") return "Audio is muted";
  if (reason === "locked") return "Click again to unlock";
  if (reason === "blocked") return "Playback blocked";
  return "Add a playable sound";
}
