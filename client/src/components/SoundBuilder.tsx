import { useEffect, useMemo, useState } from "react";
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
  audioScopeLabel,
  audioTriggerLabel,
} from "@essence/shared/audio";
import { normalizeContentSchema, validateGameContent } from "@essence/shared/contentValidation";
import seedContent from "@shared/content.json";
import { Copy, Download, Music, Play, Plus, Save, Trash2, Upload, Volume2, Wrench } from "lucide-react";
import { saveContentJsonToDisk } from "../lib/contentDiskSave";

const STORAGE_KEY = "essence:sound-builder:draft:v1";
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
  const [previewStatus, setPreviewStatus] = useState("");

  const assetIds = useMemo(() => Object.keys(content.audioAssets ?? {}), [content.audioAssets]);
  const bindings = content.audioTriggers ?? [];
  const selectedAsset = selectedAssetId ? content.audioAssets?.[selectedAssetId] : undefined;
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

  useEffect(() => {
    if (!previewStatus) return;
    const timeout = window.setTimeout(() => setPreviewStatus(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [previewStatus]);

  const createUrlAsset = () => {
    const id = nextId("sound", content.audioAssets ?? {});
    const asset: AudioAssetDef = {
      id,
      name: "New sound",
      src: "",
      kind: "oneShot",
    };
    setContent((current) => ({
      ...current,
      audioAssets: {
        ...(current.audioAssets ?? {}),
        [id]: asset,
      },
    }));
    setSelectedAssetId(id);
    setSaveStatus("Created");
  };

  const uploadFiles = async (files: FileList | null) => {
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
    setSaveStatus("Deleted");
  };

  const previewAsset = async (asset: AudioAssetDef | undefined) => {
    if (!asset?.src) {
      setPreviewStatus("No source");
      return;
    }
    try {
      const audio = new Audio(asset.src);
      audio.volume = 0.75;
      await audio.play();
      setPreviewStatus("Playing");
    } catch {
      setPreviewStatus("Playback blocked");
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
    <main data-sound-builder="true" className="flex min-h-dvh flex-col bg-[#0d141b] text-slate-100 lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <header className="flex flex-none flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#121a24]/98 px-4 py-3 shadow-lg shadow-black/25">
        <div className="min-w-0">
          <p className="text-[0.58rem] font-black uppercase tracking-[0.2em] text-sky-200">Essence tools</p>
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

      <div className="grid flex-1 grid-cols-1 lg:min-h-0 lg:overflow-hidden lg:grid-cols-[18rem_minmax(0,1fr)_20rem]">
        <aside className="flex flex-col border-b border-white/10 bg-[#0f1722] p-3 lg:min-h-0 lg:border-b-0 lg:border-r">
          <PanelHeader eyebrow={`${assetIds.length} assets`} title="Audio assets" action={createUrlAsset} actionLabel="Create audio asset" />
          <label className="builder-button preview mt-3 cursor-pointer gap-2">
            <Upload className="h-4 w-4" />
            Upload audio
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
          <div className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto pr-1 lg:min-h-0 lg:max-h-none lg:flex-1">
            {assetIds.map((id) => {
              const asset = content.audioAssets?.[id];
              if (!asset) return null;
              return (
                <button
                  key={id}
                  type="button"
                  data-audio-asset-id={id}
                  onClick={() => setSelectedAssetId(id)}
                  className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md border p-2 text-left transition ${
                    id === selectedAssetId ? "border-sky-200/70 bg-sky-300/12" : "border-white/10 bg-white/[0.035] hover:bg-white/[0.06]"
                  }`}
                >
                  <span className="grid size-8 place-items-center rounded-sm border border-white/10 bg-sky-300/15 text-sky-100">
                    {asset.kind === "loop" ? <Music className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black text-white">{asset.name}</span>
                    <span className="block truncate text-[0.56rem] font-black uppercase tracking-[0.08em] text-slate-500">{asset.id}</span>
                  </span>
                  <span className="font-mono text-[0.58rem] font-black text-sky-200">{asset.kind ?? "oneShot"}</span>
                </button>
              );
            })}
            {!assetIds.length && <EmptyState label="Upload audio or create a URL asset." />}
          </div>
        </aside>

        <section className="bg-[#141d29] p-3 lg:min-h-0 lg:overflow-y-auto">
          {selectedAsset ? (
            <AssetEditor
              asset={selectedAsset}
              previewStatus={previewStatus}
              onPreview={() => void previewAsset(selectedAsset)}
              onDelete={() => deleteAsset(selectedAsset.id)}
              onChange={(updater) => updateAsset(selectedAsset.id, updater)}
            />
          ) : (
            <EmptyState label="Add an audio asset to start editing." />
          )}

          <section className="mt-3 rounded-md border border-white/10 bg-white/[0.035] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-black text-white">Trigger bindings</h2>
                <p className="mt-1 text-xs font-bold leading-4 text-slate-500">
                  Default bindings and matching scoped bindings are both included at runtime.
                </p>
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

        <aside className="border-t border-white/10 bg-[#0f1722] p-3 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
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
                  <p className="truncate text-xs font-black text-white">{audioTriggerLabel(binding.trigger)}</p>
                  <p className="mt-1 truncate text-[0.58rem] font-black uppercase tracking-wider text-slate-500">
                    {audioScopeLabel(binding.scope)} · {binding.variants.length} variants
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
  );
}

function AssetEditor({
  asset,
  previewStatus,
  onPreview,
  onDelete,
  onChange,
}: {
  asset: AudioAssetDef;
  previewStatus: string;
  onPreview: () => void;
  onDelete: () => void;
  onChange: (updater: (asset: AudioAssetDef) => AudioAssetDef) => void;
}) {
  return (
    <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-sky-200">Audio asset</p>
          <h2 className="mt-1 text-lg font-black text-white">{asset.name}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onPreview} className="builder-button preview gap-2">
            <Play className="h-4 w-4" />
            Preview
          </button>
          <button type="button" onClick={onDelete} className="builder-button danger gap-2">
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <TextInput label="Name" value={asset.name} onChange={(name) => onChange((current) => ({ ...current, name }))} />
        <TextInput label="Id" value={asset.id} onChange={(id) => onChange((current) => ({ ...current, id }))} />
        <SelectInput
          label="Kind"
          value={asset.kind ?? "oneShot"}
          options={[
            { value: "oneShot", label: "One-shot" },
            { value: "loop", label: "Loop" },
          ]}
          onChange={(kind) => onChange((current) => ({ ...current, kind: kind as AudioPlaybackMode }))}
        />
        <TextInput label="MIME type" value={asset.mimeType ?? ""} onChange={(mimeType) => onChange((current) => ({ ...current, mimeType: mimeType || undefined }))} />
      </div>
      <TextArea label="Source URL or data URL" value={asset.src} onChange={(src) => onChange((current) => ({ ...current, src }))} />
      <p className="mt-2 rounded-md border border-sky-200/15 bg-sky-300/10 p-2 text-[0.68rem] font-bold leading-4 text-sky-50/75">
        {previewStatus || "Uploaded data URLs stay in exports and saves. Browser backup stores a compact draft."}
      </p>
    </section>
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
  const assetOptions = audioAssetOptions(content, selectedAssetId);
  const scopeType = binding.scope?.type ?? "global";
  const scopeOptions = scopeIdOptions(content, scopeType, binding.scope?.id);

  const addVariant = () => {
    const assetId = selectedAssetId || Object.keys(content.audioAssets ?? {})[0] || "";
    if (!assetId) return;
    onChange((current) => ({
      ...current,
      variants: [...current.variants, { assetId, weight: 1 }],
    }));
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
    <div className="mt-3 rounded-md border border-sky-200/15 bg-sky-300/10 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-sky-200">Binding {bindingIndex + 1}</p>
          <h3 className="mt-1 truncate text-base font-black text-white">{audioTriggerLabel(binding.trigger)}</h3>
        </div>
        <button type="button" onClick={onDelete} className="builder-button danger compact gap-1.5">
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-black uppercase tracking-wider text-sky-100">Variants</h4>
        <button type="button" onClick={addVariant} disabled={!assetOptions.length} className="builder-button preview compact gap-1.5 disabled:opacity-40">
          <Plus className="h-3.5 w-3.5" />
          Add variant
        </button>
      </div>
      <div className="mt-2 grid gap-2">
        {binding.variants.map((variant, index) => (
          <div key={`${variant.assetId}-${index}`} className="grid gap-2 rounded-md border border-white/10 bg-black/20 p-2 sm:grid-cols-[minmax(0,1fr)_5rem_5rem_2rem]">
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
        {!binding.variants.length && <p className="rounded-sm border border-dashed border-white/10 p-2 text-xs font-bold text-slate-500">No variants selected.</p>}
      </div>
    </div>
  );
}

function PanelHeader({ eyebrow, title, action, actionLabel }: { eyebrow: string; title: string; action: () => void; actionLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p>
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
    <label className="block text-[0.62rem] font-black uppercase tracking-wider text-slate-400">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#0b1118] px-3 text-sm font-bold normal-case text-slate-100 outline-none focus:border-sky-300/60" />
    </label>
  );
}

function NumberInput({ label, value, step = 1, onChange }: { label: string; value: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="block text-[0.62rem] font-black uppercase tracking-wider text-slate-400">
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
    <label className="block text-[0.62rem] font-black uppercase tracking-wider text-slate-400">
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

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mt-3 block text-[0.62rem] font-black uppercase tracking-wider text-slate-400">
      {label}
      <textarea value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-28 w-full rounded-md border border-white/10 bg-[#0b1118] px-3 py-2 text-sm font-bold normal-case leading-5 text-slate-100 outline-none focus:border-sky-300/60" />
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
        ? Object.keys(content.minigames ?? {}).map((id) => ({ value: id, label: id }))
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
  return { id, name: "New sound", src: "", kind: "oneShot" };
}

function nextId(prefix: string, catalog: Record<string, unknown>): string {
  let index = Object.keys(catalog).length + 1;
  let id = `${prefix}-${index}`;
  while (catalog[id]) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
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
    kind: "oneShot",
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
