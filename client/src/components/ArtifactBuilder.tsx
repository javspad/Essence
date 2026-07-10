import { useEffect, useMemo, useState } from "react";
import type { ArtifactDef, ArtifactRarity, ArtifactRarityDef, ArtifactTargetMode, ArtifactUseFlow, CosmeticAnchorType, EffectDuration, EffectLifecycleHook, EventAction, EventActionTarget, GameContent } from "@essence/shared";
import { artifactActionsForUse, artifactRarityDefinitions, artifactRarityRatesFromDefinitions, rollArtifactShopOffers } from "@essence/shared/artifacts";
import { consequenceLabel, defaultHookForConsequence, durationStateFromDef, effectRemainingLabel } from "@essence/shared/consequences";
import { normalizeContentSchema, validateGameContent } from "@essence/shared/contentValidation";
import { BODY_COSMETIC_ANCHORS, FACE_COSMETIC_ANCHORS } from "@essence/shared/cosmetics";
import seedContent from "@shared/content.json";
import { Copy, Download, ExternalLink, Plus, Save, SlidersHorizontal, Sparkles, Trash2, Upload, Wrench } from "lucide-react";
import { saveContentJsonToDisk } from "../lib/contentDiskSave";
import { effectBuilderHref } from "./EffectBuilderSurface";

const STORAGE_KEY = "essence:artifact-builder:draft:v1";
const BASE_CONTENT = normalizeContentSchema(seedContent);
type ArtifactBuilderDraft = Pick<GameContent, "artifactRarities" | "artifactRarityRates" | "artifacts"> & { selectedArtifactId?: string };

export default function ArtifactBuilder() {
  const [initialState] = useState(() => loadInitialBuilderState());
  const [content, setContent] = useState<GameContent>(initialState.content);
  const artifactIds = useMemo(() => Object.keys(content.artifacts ?? {}), [content.artifacts]);
  const [selectedArtifactId, setSelectedArtifactId] = useState(initialState.selectedArtifactId);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [simulatedOffers, setSimulatedOffers] = useState<ReturnType<typeof rollArtifactShopOffers>>([]);
  const selectedArtifact = selectedArtifactId ? content.artifacts?.[selectedArtifactId] : undefined;
  const rarityDefs = useMemo(() => artifactRarityDefinitions(content), [content.artifactRarities, content.artifactRarityRates, content.artifacts]);
  const effectOptions = useMemo(() => Object.values(content.effects ?? {}).sort((a, b) => a.name.localeCompare(b.name)), [content.effects]);
  const exportJson = useMemo(() => JSON.stringify(normalizeContentSchema(content), null, 2), [content]);
  const draftJson = useMemo(
    () => JSON.stringify(artifactDraftFromContent(content, selectedArtifactId), null, 2),
    [content.artifactRarities, content.artifactRarityRates, content.artifacts, selectedArtifactId]
  );
  const validation = useMemo(() => validateGameContent(content), [content]);

  useEffect(() => {
    if (selectedArtifactId && artifactIds.includes(selectedArtifactId)) return;
    setSelectedArtifactId(artifactIds[0] ?? "");
  }, [artifactIds, selectedArtifactId]);

  useEffect(() => {
    if (!saveStatus) return;
    const timeout = window.setTimeout(() => setSaveStatus(""), 3000);
    return () => window.clearTimeout(timeout);
  }, [saveStatus]);

  const updateArtifact = (id: string, updater: (artifact: ArtifactDef) => ArtifactDef) => {
    const currentArtifacts = content.artifacts ?? {};
    const updatedDraft = updater(currentArtifacts[id] ?? emptyArtifact(id));
    const requestedId = updatedDraft.id || id;
    const nextId =
      requestedId !== id && currentArtifacts[requestedId]
        ? nextAvailableId(requestedId, currentArtifacts)
        : requestedId;
    const updated = { ...updatedDraft, id: nextId };
    setContent((current) => {
      const { [id]: _previous, ...rest } = current.artifacts ?? {};
      return {
        ...current,
        artifacts: {
          ...rest,
          [nextId]: updated,
        },
      };
    });
    if (nextId !== id) setSelectedArtifactId(nextId);
  };

  const setRarityDefinitions = (updater: (rarities: Record<string, ArtifactRarityDef>) => Record<string, ArtifactRarityDef>) => {
    setContent((current) => {
      const nextRarities = updater(artifactRarityDefinitions(current));
      return {
        ...current,
        artifactRarities: nextRarities,
        artifactRarityRates: artifactRarityRatesFromDefinitions(nextRarities),
      };
    });
  };

  const updateRarity = (id: ArtifactRarity, patch: Partial<ArtifactRarityDef>) => {
    setRarityDefinitions((current) => {
      const existing = current[id] ?? { id, name: titleFromId(id), weight: 0, color: "#34d399" };
      return {
        ...current,
        [id]: {
          ...existing,
          ...patch,
          id,
          weight: patch.weight === undefined ? existing.weight : Math.max(0, Math.round(patch.weight)),
        },
      };
    });
  };

  const addRarity = () => {
    setRarityDefinitions((current) => {
      const id = nextAvailableId("custom", current);
      return {
        ...current,
        [id]: { id, name: "Custom", weight: 0, color: colorForIndex(Object.keys(current).length) },
      };
    });
  };

  const deleteRarity = (id: ArtifactRarity) => {
    setContent((current) => {
      const currentRarities = artifactRarityDefinitions(current);
      const ids = Object.keys(currentRarities);
      if (ids.length <= 1) return current;
      const fallback = ids.find((candidate) => candidate !== id) ?? ids[0] ?? "common";
      const { [id]: _removed, ...nextRarities } = currentRarities;
      return {
        ...current,
        artifactRarities: nextRarities,
        artifactRarityRates: artifactRarityRatesFromDefinitions(nextRarities),
        artifacts: Object.fromEntries(
          Object.entries(current.artifacts ?? {}).map(([artifactId, artifact]) => [
            artifactId,
            artifact.rarity === id ? { ...artifact, rarity: fallback } : artifact,
          ])
        ),
      };
    });
  };

  const createArtifact = () => {
    const id = nextId("artifact", content.artifacts ?? {});
    setContent((current) => ({
      ...current,
      artifacts: {
        ...(current.artifacts ?? {}),
        [id]: emptyArtifact(id),
      },
    }));
    setSelectedArtifactId(id);
    setSaveStatus("Created");
  };

  const deleteArtifact = (id: string) => {
    const artifact = content.artifacts?.[id];
    if (!artifact) return;
    if (!window.confirm(`Delete "${artifact.name}"?`)) return;
    setContent((current) => {
      const { [id]: _deleted, ...artifacts } = current.artifacts ?? {};
      return { ...current, artifacts };
    });
    setSaveStatus("Deleted");
  };

  const importJson = () => {
    try {
      const parsed = JSON.parse(importText);
      const next = normalizeContentSchema(isFullContent(parsed) ? parsed : { ...BASE_CONTENT, ...parsed });
      setContent(next);
      setSelectedArtifactId(Object.keys(next.artifacts ?? {})[0] ?? "");
      setImportText("");
      setJsonOpen(false);
      setSaveStatus("Imported");
    } catch {
      window.alert("JSON invalido");
    }
  };

  const resetDraft = () => {
    const saved = loadSavedBuilderState();
    const next = saved ?? baseArtifactBuilderState();
    setContent(next.content);
    setSelectedArtifactId(next.selectedArtifactId);
    setImportText("");
    setJsonOpen(false);
    setSimulatedOffers([]);
    setSaveStatus(saved ? "Recovered browser draft" : "Loaded content.json");
  };

  const copyJson = async () => {
    await navigator.clipboard?.writeText(exportJson);
    setSaveStatus("Copied");
  };

  const saveDraft = async () => {
    const stored = persistDraft(draftJson);
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
    anchor.download = "content.artifact-builder.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setSaveStatus("Downloaded");
  };

  return (
    <main data-artifact-builder="true" className="flex min-h-dvh flex-col bg-[#0d141b] text-slate-100 lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <header className="flex flex-none flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#121a24]/98 px-4 py-3 shadow-lg shadow-black/25">
        <div className="min-w-0">
          <p className="text-[0.58rem] font-black uppercase tracking-[0.2em] text-emerald-200">Essence tools</p>
          <h1 className="truncate text-xl font-black tracking-normal text-white">Artifact builder</h1>
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
          <span className="min-w-16 text-center text-xs font-black text-emerald-200">{saveStatus}</span>
          <a href="/tools" className="builder-button gap-2">
            <Wrench className="h-4 w-4" />
            Tools
          </a>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 lg:min-h-0 lg:overflow-hidden lg:grid-cols-[18rem_minmax(0,1fr)_19rem]">
        <aside className="flex flex-col border-b border-white/10 bg-[#0f1722] p-3 lg:min-h-0 lg:border-b-0 lg:border-r">
          <PanelHeader eyebrow={`${artifactIds.length} artifacts`} title="Catalog" action={createArtifact} />
          <div className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto pr-1 lg:min-h-0 lg:max-h-none lg:flex-1">
            {artifactIds.map((id) => {
              const artifact = content.artifacts?.[id];
              if (!artifact) return null;
              return (
                <button
                  key={id}
                  type="button"
                  data-artifact-id={id}
                  onClick={() => setSelectedArtifactId(id)}
                  className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md border p-2 text-left transition ${
                    id === selectedArtifactId ? "border-emerald-200/70 bg-emerald-300/12" : "border-white/10 bg-white/[0.035] hover:bg-white/[0.06]"
                  }`}
                >
                  <span className="grid size-8 place-items-center rounded-sm border border-white/10 bg-emerald-300/15 text-[10px] font-black text-emerald-100">
                    {artifact.rarity.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black text-white">{artifact.name}</span>
                    <span className="block truncate text-[0.56rem] font-black uppercase tracking-[0.08em] text-slate-500">{artifact.targetMode}</span>
                  </span>
                  <span className="font-mono text-[0.62rem] font-black text-amber-200">{artifact.price}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="bg-[#141d29] p-3 lg:min-h-0 lg:overflow-y-auto">
          {selectedArtifact ? (
            <ArtifactEditor
              artifact={selectedArtifact}
              effectOptions={effectOptions}
              players={content.players}
              rarityDefs={rarityDefs}
              onChange={(updater) => updateArtifact(selectedArtifact.id, updater)}
              onDelete={() => deleteArtifact(selectedArtifact.id)}
            />
          ) : (
            <EmptyState label="Create an artifact to start editing." />
          )}
        </section>

        <aside className="border-t border-white/10 bg-[#0f1722] p-3 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <RaritySettingsPanel
            rarities={rarityDefs}
            onUpdate={updateRarity}
            onAdd={addRarity}
            onDelete={deleteRarity}
          />

          <section className="mt-3 rounded-md border border-white/10 bg-white/[0.035] p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-black text-white">Shop roll</h2>
              <button
                type="button"
                onClick={() => setSimulatedOffers(rollArtifactShopOffers(content, 4, "builder"))}
                className="builder-button preview h-8 gap-2 px-2 text-[0.6rem]"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Simulate
              </button>
            </div>
            <div className="mt-3 grid gap-2">
              {simulatedOffers.map((offer) => {
                const artifact = content.artifacts?.[offer.artifactId];
                return (
                  <div key={offer.id} className="rounded-sm border border-emerald-200/20 bg-emerald-300/10 p-2">
                    <p className="truncate text-xs font-black text-white">{artifact?.name ?? offer.artifactId}</p>
                    <p className="mt-1 text-[0.58rem] font-black uppercase tracking-wider text-emerald-100">
                      {offer.rarity} · {offer.price} coins
                    </p>
                  </div>
                );
              })}
              {!simulatedOffers.length && <p className="text-xs font-bold leading-5 text-slate-500">No roll yet.</p>}
            </div>
          </section>

          <section className="mt-3 rounded-md border border-white/10 bg-white/[0.035] p-3">
            <h2 className="text-sm font-black text-white">Validation</h2>
            <div className="mt-2 grid gap-1 text-xs font-bold leading-5">
              {validation.ok ? (
                <p className="text-emerald-200">Content validates.</p>
              ) : (
                validation.errors.slice(0, 8).map((error) => (
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

function ArtifactEditor({
  artifact,
  effectOptions,
  players,
  rarityDefs,
  onChange,
  onDelete,
}: {
  artifact: ArtifactDef;
  effectOptions: NonNullable<GameContent["effects"]>[string][];
  players: GameContent["players"];
  rarityDefs: Record<string, ArtifactRarityDef>;
  onChange: (updater: (artifact: ArtifactDef) => ArtifactDef) => void;
  onDelete: () => void;
}) {
  const effectIds = artifact.effects ?? [];
  const consequences = artifact.consequences ?? [];
  const availableEffects = effectOptions.filter((effect) => !effectIds.includes(effect.id));
  const availableKey = availableEffects.map((effect) => effect.id).join("|");
  const [effectToAdd, setEffectToAdd] = useState(availableEffects[0]?.id ?? "");

  useEffect(() => {
    if (effectToAdd && availableEffects.some((effect) => effect.id === effectToAdd)) return;
    setEffectToAdd(availableEffects[0]?.id ?? "");
  }, [availableKey, effectToAdd]);

  const addEffect = () => {
    if (!effectToAdd || effectIds.includes(effectToAdd)) return;
    onChange((current) => ({ ...current, effects: [...(current.effects ?? []), effectToAdd] }));
  };
  const removeEffect = (effectId: string) => {
    onChange((current) => ({ ...current, effects: (current.effects ?? []).filter((id) => id !== effectId) }));
  };
  const addConsequence = () => {
    onChange((current) => ({ ...current, consequences: [...(current.consequences ?? []), { type: "coins", value: 1 }] }));
  };
  const updateConsequence = (index: number, action: EventAction) => {
    onChange((current) => ({
      ...current,
      consequences: (current.consequences ?? []).map((existing, actionIndex) => (actionIndex === index ? action : existing)),
    }));
  };
  const removeConsequence = (index: number) => {
    onChange((current) => ({
      ...current,
      consequences: (current.consequences ?? []).filter((_, actionIndex) => actionIndex !== index),
    }));
  };

  return (
    <div className="grid gap-3">
      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-emerald-200">Artifact</p>
            <h2 className="mt-1 text-lg font-black text-white">{artifact.name}</h2>
          </div>
          <button type="button" onClick={onDelete} className="builder-button danger gap-2">
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <TextInput label="Name" value={artifact.name} onChange={(name) => onChange((current) => ({ ...current, name }))} />
          <TextInput label="Id" value={artifact.id} onChange={(id) => onChange((current) => ({ ...current, id: idFromName(id) }))} />
          <NumberInput label="Price" value={artifact.price} onChange={(price) => onChange((current) => ({ ...current, price: Math.max(0, Math.round(price)) }))} />
          <SelectInput
            label="Rarity"
            value={artifact.rarity}
            options={rarityOptions(rarityDefs, artifact.rarity)}
            onChange={(rarity) => onChange((current) => ({ ...current, rarity: rarity as ArtifactRarity }))}
          />
          <SelectInput
            label="Target"
            value={artifact.targetMode}
            options={["none", "self", "choosePlayer"]}
            onChange={(targetMode) => onChange((current) => ({ ...current, targetMode: targetMode as ArtifactTargetMode }))}
          />
          <SelectInput
            label="Use flow"
            value={artifact.useFlow ?? "immediate"}
            options={["immediate", "targeted"]}
            onChange={(useFlow) => onChange((current) => ({ ...current, useFlow: useFlow as ArtifactUseFlow }))}
          />
        </div>
        <TextArea label="Description" value={artifact.description ?? ""} onChange={(description) => onChange((current) => ({ ...current, description }))} />
      </section>

      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-black text-white">Effects and consequences</h3>
            <p className="mt-1 text-xs font-bold leading-4 text-slate-500">{effectIds.length} reusable effects · {consequences.length} immediate actions</p>
          </div>
          <a href={effectBuilderHref(effectIds[0], "/artifact-builder")} className="builder-button compact preview gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            Effect builder
          </a>
        </div>
        <div className="mt-3 rounded-md border border-cyan-200/15 bg-cyan-300/10 p-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <SelectInput
              label="Reusable effect"
              value={effectToAdd}
              options={availableEffects.length ? availableEffects.map((effect) => ({ value: effect.id, label: effect.name })) : [{ value: "", label: "No effects available" }]}
              onChange={setEffectToAdd}
            />
            <button type="button" onClick={addEffect} disabled={!effectToAdd || !availableEffects.length} className="builder-button preview mt-5 gap-2 disabled:opacity-40">
              <Plus className="h-4 w-4" />
              Add effect
            </button>
          </div>
          <div className="mt-3 grid gap-2">
            {effectIds.length === 0 && <p className="rounded-sm border border-dashed border-white/10 p-2 text-xs font-bold text-slate-500">No reusable effects selected.</p>}
            {effectIds.map((effectId) => {
              const effect = effectOptions.find((option) => option.id === effectId);
              return (
                <div key={effectId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-sm border border-cyan-200/15 bg-black/20 p-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-black text-white">{effect?.name ?? effectId}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <span className="rounded-sm border border-cyan-200/20 bg-cyan-300/10 px-2 py-0.5 text-[0.58rem] font-black uppercase text-cyan-100">
                        {effect ? effectRemainingLabel(durationStateFromDef(effect.duration)) : "Missing"}
                      </span>
                      <span className="rounded-sm border border-cyan-200/20 bg-cyan-300/10 px-2 py-0.5 text-[0.58rem] font-black uppercase text-cyan-100">
                        Applies to artifact target
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <a href={effectBuilderHref(effectId, "/artifact-builder")} className="builder-button compact preview" aria-label={`Open ${effect?.name ?? effectId}`}>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <button type="button" onClick={() => removeEffect(effectId)} className="builder-button compact danger" aria-label={`Remove ${effect?.name ?? effectId}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-3 rounded-md border border-emerald-200/15 bg-emerald-300/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-emerald-200">{consequences.length} actions</p>
              <h4 className="text-sm font-black text-white">Immediate consequences</h4>
            </div>
            <button type="button" onClick={addConsequence} className="builder-button preview gap-2">
              <Plus className="h-4 w-4" />
              Add consequence
            </button>
          </div>
          <div className="mt-3 grid gap-2">
            {consequences.length === 0 && <p className="rounded-sm border border-dashed border-white/10 p-2 text-xs font-bold text-slate-500">No immediate consequences.</p>}
            {consequences.map((action, index) => (
              <ArtifactActionEditor
                key={`${action.type}-${index}`}
                action={action}
                actionIndex={index}
                effectOptions={effectOptions}
                players={players}
                onChange={(next) => updateConsequence(index, next)}
                onRemove={() => removeConsequence(index)}
              />
            ))}
          </div>
        </div>
        <div className="mt-3 grid gap-1">
          {artifactActionsForUse(artifact).map((action, index) => (
            <p key={`${action.type}-${index}`} className="rounded-sm border border-white/10 bg-black/20 px-2 py-1 text-xs font-bold text-slate-300">
              {consequenceLabel(action, (effectId) => effectOptions.find((effect) => effect.id === effectId)?.name ?? effectId)}
            </p>
          ))}
          {!artifactActionsForUse(artifact).length && <p className="rounded-sm border border-dashed border-white/10 p-2 text-xs font-bold text-slate-500">No action preview.</p>}
        </div>
      </section>

      <VisualPresentationEditor artifact={artifact} onChange={onChange} />
    </div>
  );
}

function VisualPresentationEditor({ artifact, onChange }: { artifact: ArtifactDef; onChange: (updater: (artifact: ArtifactDef) => ArtifactDef) => void }) {
  const visual = artifact.visual ?? {};
  const anchorType = visual.anchorType ?? "body";
  const anchorId = visual.anchorId ?? defaultAnchorId(anchorType);
  return (
    <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-white">Visual presentation</h3>
          <p className="mt-1 text-xs font-bold leading-4 text-slate-500">
            Artifact visuals describe the purchased item. Effect visuals are only cues shown while an active effect is attached; choosing the same asset does not create another effect or a loop.
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <SelectInput
          label="Visual asset"
          value={visual.assetId ?? artifact.visualAssetId ?? ""}
          options={artifactVisualAssetOptions(artifact)}
          onChange={(assetId) => onChange((current) => withVisualPatch(current, { assetId: assetId || undefined }))}
        />
        <SelectInput
          label="Anchor type"
          value={anchorType}
          options={[
            { value: "body", label: "Body" },
            { value: "face", label: "Face" },
            { value: "token", label: "Token center" },
          ]}
          onChange={(nextAnchorType) =>
            onChange((current) =>
              withVisualPatch(current, {
                anchorType: nextAnchorType as CosmeticAnchorType,
                anchorId: defaultAnchorId(nextAnchorType as CosmeticAnchorType),
              })
            )
          }
        />
        <SelectInput
          label="Anchor"
          value={anchorId}
          options={anchorOptions(anchorType, anchorId)}
          onChange={(nextAnchorId) => onChange((current) => withVisualPatch(current, { anchorType, anchorId: nextAnchorId }))}
        />
      </div>
      <p className="mt-2 rounded-md border border-amber-200/15 bg-amber-300/10 p-2 text-[0.68rem] font-bold leading-4 text-amber-50/75">
        Anchor offsets and 3D preview belong with the visual asset tooling; this builder only chooses which authored item visual attaches and where.
      </p>
    </section>
  );
}

function ArtifactActionEditor({
  action,
  actionIndex,
  effectOptions,
  players,
  onChange,
  onRemove,
}: {
  action: EventAction;
  actionIndex: number;
  effectOptions: NonNullable<GameContent["effects"]>[string][];
  players: GameContent["players"];
  onChange: (action: EventAction) => void;
  onRemove: () => void;
}) {
  const fallbackEffectId = effectOptions[0]?.id ?? "half-roll-2-rounds";
  const editable = editableArtifactAction(action, fallbackEffectId);
  const timingMode = artifactActionTimingMode(editable);
  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-white">Action {actionIndex + 1}</p>
          <p className="mt-1 truncate text-xs font-bold text-slate-400">{consequenceLabel(editable, (effectId) => effectOptions.find((effect) => effect.id === effectId)?.name ?? effectId)}</p>
        </div>
        <button type="button" onClick={onRemove} className="builder-button danger compact gap-1.5">
          <Trash2 className="h-3.5 w-3.5" />
          Remove
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_7rem]">
        <SelectInput
          label="Type"
          value={editable.type}
          options={artifactActionTypeOptions(effectOptions)}
          onChange={(type) => onChange(convertArtifactActionType(editable, type as Exclude<EventAction["type"], "text">, fallbackEffectId))}
        />
        {(editable.type === "coins" || editable.type === "move") && (
          <NumberInput
            label={editable.type === "coins" ? "Coins" : "Cells"}
            value={editable.type === "coins" ? editable.value : editable.delta}
            onChange={(value) => onChange(updateActionAmount(editable, value))}
          />
        )}
        {(editable.type === "coinTransfer" || editable.type === "coinRedistribute") && (
          <NumberInput
            label="Coins"
            value={editable.amount}
            onChange={(amount) => onChange({ ...editable, amount: Math.max(0, Math.round(amount)) })}
          />
        )}
        {editable.type === "moveTo" && <NumberInput label="Cell" value={editable.tileId} onChange={(tileId) => onChange({ ...editable, tileId })} />}
        {editable.type === "movementMultiplier" && <NumberInput label="x" value={editable.multiplier} onChange={(multiplier) => onChange({ ...editable, multiplier: Math.max(0, multiplier) })} />}
        {editable.type === "diceBias" && <NumberInput label="Face" value={editable.face} onChange={(face) => onChange({ ...editable, face: clampInt(face, 1, 6) })} />}
        {(editable.type === "skipTurn" || editable.type === "extraTurn" || editable.type === "offlineAction" || editable.type === "applyEffect" || editable.type === "swapPositions" || editable.type === "moveToNearest" || editable.type === "halfMovement") && <div />}
      </div>

      {(editable.type === "coinTransfer" || editable.type === "coinRedistribute") && (
        <TargetSelect
          label={editable.type === "coinRedistribute" ? "Collect from" : "Take from"}
          target={editable.from}
          players={players}
          onChange={(from) => onChange({ ...editable, from })}
        />
      )}

      {editable.type === "applyEffect" && (
        <SelectInput
          label="Effect"
          value={editable.effectId}
          options={effectSelectOptions(effectOptions, editable.effectId)}
          onChange={(effectId) => onChange({ ...editable, effectId })}
        />
      )}
      {editable.type === "halfMovement" && (
        <SelectInput
          label="Rounding"
          value={editable.rounding ?? "ceil"}
          options={[
            { value: "ceil", label: "Ceil" },
            { value: "round", label: "Round" },
            { value: "floor", label: "Floor" },
          ]}
          onChange={(rounding) => onChange({ ...editable, rounding: rounding as "floor" | "ceil" | "round" })}
        />
      )}
      {editable.type === "movementMultiplier" && (
        <SelectInput
          label="Rounding"
          value={editable.rounding ?? "round"}
          options={[
            { value: "round", label: "Round" },
            { value: "ceil", label: "Ceil" },
            { value: "floor", label: "Floor" },
          ]}
          onChange={(rounding) => onChange({ ...editable, rounding: rounding as "floor" | "ceil" | "round" })}
        />
      )}
      {editable.type === "diceBias" && (
        <NumberInput label="Chance change percent" value={editable.chanceDeltaPercent} onChange={(chanceDeltaPercent) => onChange({ ...editable, chanceDeltaPercent })} />
      )}
      {editable.type === "offlineAction" && (
        <SelectInput
          label="Offline action"
          value={editable.action}
          options={[
            { value: "takeShot", label: "Take shot" },
            { value: "custom", label: "Custom" },
          ]}
          onChange={(offlineAction) => onChange({ ...editable, action: offlineAction as "takeShot" | "custom" })}
        />
      )}
      {editable.type === "swapPositions" && <TargetSelect label="Swap with" target={editable.withTarget} players={players} onChange={(withTarget) => onChange({ ...editable, withTarget })} />}
      {editable.type === "moveToNearest" && (
        <SelectInput
          label="Direction"
          value={editable.direction}
          options={[
            { value: "ahead", label: "Ahead" },
            { value: "behind", label: "Behind" },
          ]}
          onChange={(direction) => onChange({ ...editable, direction: direction as "ahead" | "behind" })}
        />
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <ArtifactTargetSelect action={editable} players={players} onChange={onChange} />
        {editable.type !== "applyEffect" && (
          <SelectInput
            label="Timing"
            value={timingMode}
            disabled={isPersistentModifier(editable)}
            options={[
              { value: "now", label: "Resolve on use" },
              { value: "attached", label: "Attach timed effect" },
            ]}
            onChange={(mode) => onChange(setArtifactActionTimingMode(editable, mode as "now" | "attached"))}
          />
        )}
      </div>
      {editable.type !== "applyEffect" && timingMode === "attached" && (
        <div className="mt-3 rounded-md border border-cyan-200/15 bg-cyan-300/10 p-2">
          <SelectInput
            label="Runs"
            value={hookValueForAction(editable)}
            disabled={isPersistentModifier(editable)}
            options={hookOptionsForAction(editable)}
            onChange={(hook) => onChange({ ...editable, hook: hook as EffectLifecycleHook })}
          />
          <DurationEditor duration={editable.duration ?? { mode: "uses", value: 1 }} onChange={(duration) => onChange({ ...editable, duration })} />
        </div>
      )}
      <TextInput label="Display text" value={editable.text ?? ""} onChange={(text) => onChange(updateActionText(editable, text))} />
      <details className="mt-3 rounded-md border border-white/10 bg-black/20 p-2">
        <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.12em] text-slate-300">Advanced JSON</summary>
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-black/25 p-2 text-[0.65rem] text-slate-300">{JSON.stringify(editable, null, 2)}</pre>
      </details>
    </div>
  );
}

function ArtifactTargetSelect({ action, players, onChange }: { action: EventAction; players: GameContent["players"]; onChange: (action: EventAction) => void }) {
  const target = "target" in action ? action.target : undefined;
  return (
    <div>
      <SelectInput
        label="Target"
        value={target ? targetSelectValue(target) : "artifactTarget"}
        options={[
          { value: "artifactTarget", label: "Artifact target" },
          { value: "acting", label: "User" },
          { value: "target", label: "Chosen target" },
          { value: "everyone", label: "Everyone" },
          { value: "player", label: "Specific player" },
          { value: "coinRichest", label: "Most coins" },
          { value: "coinPoorest", label: "Least coins" },
          { value: "coinRank", label: "Coin rank" },
          { value: "coinRankRange", label: "Coin rank range" },
          { value: "nearestAhead", label: "Nearest ahead" },
          { value: "nearestBehind", label: "Nearest behind" },
        ]}
        onChange={(value) => {
          if (value === "artifactTarget") {
            const { target: _target, ...rest } = action as EventAction & { target?: EventActionTarget };
            onChange(rest as EventAction);
            return;
          }
          onChange({ ...action, target: targetForValue(value, players, target ?? "target") } as EventAction);
        }}
      />
      {target && <TargetDetails target={target} players={players} onChange={(nextTarget) => onChange({ ...action, target: nextTarget } as EventAction)} />}
    </div>
  );
}

function TargetSelect({ label, target, players, onChange }: { label: string; target: EventActionTarget; players: GameContent["players"]; onChange: (target: EventActionTarget) => void }) {
  return (
    <div className="mt-3 rounded-md border border-white/10 bg-black/15 p-2">
      <SelectInput
        label={label}
        value={targetSelectValue(target)}
        options={[
          { value: "acting", label: "User" },
          { value: "target", label: "Chosen target" },
          { value: "everyone", label: "Everyone" },
          { value: "player", label: "Specific player" },
          { value: "coinRichest", label: "Most coins" },
          { value: "coinPoorest", label: "Least coins" },
          { value: "coinRank", label: "Coin rank" },
          { value: "coinRankRange", label: "Coin rank range" },
          { value: "nearestAhead", label: "Nearest ahead" },
          { value: "nearestBehind", label: "Nearest behind" },
        ]}
        onChange={(value) => onChange(targetForValue(value, players, target))}
      />
      <TargetDetails target={target} players={players} onChange={onChange} />
    </div>
  );
}

function TargetDetails({ target, players, onChange }: { target: EventActionTarget; players: GameContent["players"]; onChange: (target: EventActionTarget) => void }) {
  if (typeof target !== "string" && "playerId" in target) {
    return (
      <SelectInput
        label="Player"
        value={target.playerId}
        options={players.map((player) => ({ value: player.id, label: player.name }))}
        onChange={(playerId) => onChange({ playerId })}
      />
    );
  }
  if (typeof target !== "string" && "coinRank" in target) {
    return <NumberInput label="Coin rank" value={target.coinRank} onChange={(coinRank) => onChange({ coinRank: Math.max(1, Math.round(coinRank)) })} />;
  }
  if (typeof target !== "string" && "coinRankFrom" in target) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <NumberInput label="From coin rank" value={target.coinRankFrom} onChange={(coinRankFrom) => onChange({ coinRankFrom: Math.max(1, Math.round(coinRankFrom)), coinRankTo: target.coinRankTo })} />
        <NumberInput label="To coin rank" value={target.coinRankTo} onChange={(coinRankTo) => onChange({ coinRankFrom: target.coinRankFrom, coinRankTo: Math.max(1, Math.round(coinRankTo)) })} />
      </div>
    );
  }
  return null;
}

function PanelHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p>
        <h2 className="text-base font-black text-white">{title}</h2>
      </div>
      <button type="button" onClick={action} className="builder-button preview h-9 w-9 p-0" aria-label="Create artifact">
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function RaritySettingsPanel({
  rarities,
  onUpdate,
  onAdd,
  onDelete,
}: {
  rarities: Record<string, ArtifactRarityDef>;
  onUpdate: (id: ArtifactRarity, patch: Partial<ArtifactRarityDef>) => void;
  onAdd: () => void;
  onDelete: (id: ArtifactRarity) => void;
}) {
  const entries = Object.values(rarities);
  const total = entries.reduce((sum, rarity) => sum + rarity.weight, 0);
  const totalOk = Math.abs(total - 100) <= 0.001;
  return (
    <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-white">Rarity types</h2>
          <p className="mt-1 text-xs font-bold leading-4 text-slate-500">Shop rolls use these percentages. Individual artifacts do not have their own probability override.</p>
        </div>
        <button type="button" onClick={onAdd} className="builder-button compact preview gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>
      <p className={`mt-3 rounded-md border px-2 py-1.5 text-[0.68rem] font-black ${totalOk ? "border-emerald-200/20 bg-emerald-300/10 text-emerald-100" : "border-rose-200/25 bg-rose-300/10 text-rose-100"}`}>
        Total chance: {formatNumber(total)} / 100
      </p>
      <div className="mt-3 grid gap-2">
        {entries.map((rarity) => (
          <div key={rarity.id} className="rounded-md border border-white/10 bg-black/15 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="size-4 shrink-0 rounded-sm border border-white/20" style={{ backgroundColor: rarity.color }} />
                <span className="truncate font-mono text-[0.62rem] font-black uppercase tracking-wider text-slate-500">{rarity.id}</span>
              </div>
              <button type="button" disabled={entries.length <= 1} onClick={() => onDelete(rarity.id)} className="builder-button danger compact disabled:opacity-40">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid gap-2">
              <TextInput label="Name" value={rarity.name} onChange={(name) => onUpdate(rarity.id, { name })} />
              <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
                <ColorInput label="Color" value={rarity.color} onChange={(color) => onUpdate(rarity.id, { color })} />
                <NumberInput label="%" value={rarity.weight} onChange={(weight) => onUpdate(rarity.id, { weight })} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-[0.62rem] font-black uppercase tracking-wider text-slate-400">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#0b1118] px-3 text-sm font-bold normal-case text-slate-100 outline-none focus:border-emerald-300/60" />
    </label>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const color = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#34d399";
  return (
    <label className="block text-[0.62rem] font-black uppercase tracking-wider text-slate-400">
      {label}
      <span className="mt-1 grid h-10 grid-cols-[2.25rem_minmax(0,1fr)] overflow-hidden rounded-md border border-white/10 bg-[#0b1118]">
        <input type="color" value={color} onChange={(event) => onChange(event.target.value)} className="h-10 w-full cursor-pointer border-0 bg-transparent p-1" />
        <input value={value} onChange={(event) => onChange(event.target.value)} className="min-w-0 bg-transparent px-3 text-sm font-bold normal-case text-slate-100 outline-none focus:text-emerald-100" />
      </span>
    </label>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block text-[0.62rem] font-black uppercase tracking-wider text-slate-400">
      {label}
      <input type="number" value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#0b1118] px-3 text-sm font-bold normal-case text-slate-100 outline-none focus:border-emerald-300/60" />
    </label>
  );
}

type SelectOption = string | { value: string; label: string };

function SelectInput({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-[0.62rem] font-black uppercase tracking-wider text-slate-400">
      {label}
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#0b1118] px-3 text-sm font-bold normal-case text-slate-100 outline-none focus:border-emerald-300/60 disabled:opacity-45"
      >
        {options.map((option) => {
          const normalized = typeof option === "string" ? { value: option, label: option } : option;
          return (
          <option key={normalized.value} value={normalized.value} className="bg-[#0b1118] text-slate-100">
            {normalized.label}
          </option>
          );
        })}
      </select>
    </label>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mt-3 block text-[0.62rem] font-black uppercase tracking-wider text-slate-400">
      {label}
      <textarea value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-24 w-full rounded-md border border-white/10 bg-[#0b1118] px-3 py-2 text-sm font-bold normal-case leading-5 text-slate-100 outline-none focus:border-emerald-300/60" />
    </label>
  );
}

const KNOWN_ARTIFACT_VISUALS: SelectOption[] = [
  { value: "", label: "No visual" },
  { value: "backpack", label: "Backpack" },
  { value: "hockey-stick", label: "Hockey stick" },
  { value: "smoke-puff", label: "Smoke puff" },
];

const ANCHOR_OPTIONS: Record<CosmeticAnchorType, string[]> = {
  face: [...FACE_COSMETIC_ANCHORS],
  body: [...BODY_COSMETIC_ANCHORS],
  token: ["center"],
};

function rarityOptions(rarities: Record<string, ArtifactRarityDef>, selectedRarity: string): SelectOption[] {
  const options = Object.values(rarities).map((rarity) => ({
    value: rarity.id,
    label: `${rarity.name} (${formatNumber(rarity.weight)}%)`,
  }));
  if (selectedRarity && !rarities[selectedRarity]) options.push({ value: selectedRarity, label: `Missing: ${selectedRarity}` });
  return options;
}

function artifactVisualAssetOptions(artifact: ArtifactDef): SelectOption[] {
  const current = artifact.visual?.assetId ?? artifact.visualAssetId ?? "";
  const options = [...KNOWN_ARTIFACT_VISUALS];
  if (current && !options.some((option) => typeof option !== "string" && option.value === current)) {
    options.push({ value: current, label: `Custom: ${current}` });
  }
  return options;
}

function anchorOptions(anchorType: CosmeticAnchorType, currentAnchorId: string): SelectOption[] {
  const ids = ANCHOR_OPTIONS[anchorType] ?? ANCHOR_OPTIONS.body;
  const options = ids.map((id) => ({ value: id, label: tokenAnchorLabel(id) }));
  if (currentAnchorId && !ids.includes(currentAnchorId)) options.push({ value: currentAnchorId, label: `Custom: ${currentAnchorId}` });
  return options;
}

function defaultAnchorId(anchorType: CosmeticAnchorType): string {
  return (ANCHOR_OPTIONS[anchorType] ?? ANCHOR_OPTIONS.body)[0] ?? "chest";
}

function withVisualPatch(artifact: ArtifactDef, patch: NonNullable<ArtifactDef["visual"]>): ArtifactDef {
  const visual = { ...(artifact.visual ?? {}), ...patch };
  const cleaned = {
    ...visual,
    assetId: visual.assetId || undefined,
    anchorId: visual.anchorId || undefined,
    label: visual.label || undefined,
    color: visual.color || undefined,
  };
  const hasVisual = Boolean(cleaned.assetId || cleaned.anchorType || cleaned.anchorId || cleaned.label || cleaned.color);
  return {
    ...artifact,
    visual: hasVisual ? cleaned : undefined,
    visualAssetId: undefined,
  };
}

function tokenAnchorLabel(id: string): string {
  if (id === "leftEye") return "Left eye";
  if (id === "rightEye") return "Right eye";
  if (id === "leftHand") return "Left hand";
  if (id === "rightHand") return "Right hand";
  if (id === "center") return "Token center";
  return titleFromId(id);
}

function titleFromId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ") || "Rarity";
}

function colorForIndex(index: number): string {
  const palette = ["#34d399", "#60a5fa", "#d946ef", "#fbbf24", "#fb7185", "#a78bfa"];
  return palette[index % palette.length] ?? "#34d399";
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\\.0$/, "");
}

const artifactHookOptions: { value: EffectLifecycleHook; label: string }[] = [
  { value: "onTurnEnd", label: "Turn end" },
  { value: "beforeRoll", label: "Before roll" },
  { value: "afterRoll", label: "After roll" },
  { value: "beforeMovement", label: "Before movement" },
  { value: "afterMovement", label: "After movement" },
  { value: "onCellEnter", label: "Cell enter" },
  { value: "onActivityResult", label: "Activity result" },
];

function DurationEditor({ duration, onChange }: { duration: EffectDuration; onChange: (duration: EffectDuration) => void }) {
  const needsCount = duration.mode === "turns" || duration.mode === "rounds" || duration.mode === "uses";
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_6rem]">
      <SelectInput
        label="Duration"
        value={duration.mode}
        options={[
          { value: "uses", label: "Uses" },
          { value: "rounds", label: "Rounds" },
          { value: "turns", label: "Turns" },
          { value: "game", label: "Whole game" },
        ]}
        onChange={(mode) => onChange(durationForMode(mode as EffectDuration["mode"], duration))}
      />
      {needsCount ? <NumberInput label="Count" value={duration.value} onChange={(value) => onChange({ ...duration, value: Math.max(1, Math.round(value)) } as EffectDuration)} /> : <div />}
    </div>
  );
}

function artifactActionTypeOptions(effectOptions: NonNullable<GameContent["effects"]>[string][]): SelectOption[] {
  return [
    { value: "coins", label: "Coins" },
    { value: "coinTransfer", label: "Coin transfer" },
    { value: "coinRedistribute", label: "Coin redistribution" },
    { value: "move", label: "Move" },
    { value: "moveTo", label: "Move to cell" },
    { value: "skipTurn", label: "Skip turn" },
    { value: "extraTurn", label: "Extra turn" },
    { value: "halfMovement", label: "Half movement" },
    { value: "movementMultiplier", label: "Movement multiplier" },
    { value: "diceBias", label: "Dice bias" },
    { value: "swapPositions", label: "Swap positions" },
    { value: "moveToNearest", label: "Move to nearest" },
    { value: "offlineAction", label: "Offline action" },
    ...(effectOptions.length ? [{ value: "applyEffect", label: "Apply effect" }] : []),
  ];
}

function effectSelectOptions(effectOptions: NonNullable<GameContent["effects"]>[string][], selectedEffectId: string): SelectOption[] {
  const options: SelectOption[] = effectOptions.map((effect) => ({ value: effect.id, label: effect.name }));
  if (selectedEffectId && !effectOptions.some((effect) => effect.id === selectedEffectId)) {
    options.push({ value: selectedEffectId, label: `Missing: ${selectedEffectId}` });
  }
  return options.length ? options : [{ value: "", label: "No effects" }];
}

function editableArtifactAction(action: EventAction, fallbackEffectId: string): EventAction {
  if (action.type === "text") return { type: "coins", value: 1, text: action.text };
  if (action.type === "applyEffect" && !action.effectId) return { ...action, effectId: fallbackEffectId };
  return isPersistentModifier(action) ? ensureModifierTiming(action) : action;
}

function convertArtifactActionType(action: EventAction, type: Exclude<EventAction["type"], "text">, fallbackEffectId: string): EventAction {
  const text = "text" in action ? action.text : undefined;
  const target = "target" in action ? action.target : undefined;
  const icon = action.icon;
  const amount = action.type === "coins" ? action.value : action.type === "move" ? action.delta : action.type === "coinTransfer" || action.type === "coinRedistribute" ? action.amount : 1;
  const base = { ...(target ? { target } : {}), ...(text ? { text } : {}), ...(icon ? { icon } : {}), ...timingPatch(action) };
  if (type === "coins") return withCanonicalAction({ type, value: amount, ...base });
  if (type === "coinTransfer") return withCanonicalAction({ type, amount: Math.abs(amount), from: "target", ...base });
  if (type === "coinRedistribute") return withCanonicalAction({ type, amount: Math.abs(amount), from: "everyone", ...base });
  if (type === "move") return withCanonicalAction({ type, delta: amount, ...base });
  if (type === "moveTo") return withCanonicalAction({ type, tileId: 1, ...base });
  if (type === "skipTurn") return withCanonicalAction({ type, ...base });
  if (type === "extraTurn") return withCanonicalAction({ type, ...base });
  if (type === "offlineAction") return withCanonicalAction({ type, action: "custom", ...base });
  if (type === "halfMovement") return ensureModifierTiming({ type, hook: "beforeMovement", rounding: "ceil", ...base });
  if (type === "movementMultiplier") return ensureModifierTiming({ type, hook: "beforeMovement", multiplier: 0.5, rounding: "ceil", ...base });
  if (type === "diceBias") return ensureModifierTiming({ type, hook: "beforeRoll", face: 5, chanceDeltaPercent: 10, ...base });
  if (type === "swapPositions") return withCanonicalAction({ type, withTarget: "target", ...base });
  if (type === "moveToNearest") return withCanonicalAction({ type, direction: "ahead", ...base });
  return { type, effectId: fallbackEffectId, ...(target ? { target } : {}), ...(text ? { text } : {}), ...(icon ? { icon } : {}) };
}

function updateActionAmount(action: Extract<EventAction, { type: "coins" | "move" }>, amount: number): EventAction {
  if (action.type === "coins") return { ...action, value: amount };
  return { ...action, delta: amount };
}

function updateActionText(action: EventAction, text: string): EventAction {
  if (action.type === "text") return { ...action, text };
  return { ...action, text: text || undefined };
}

function artifactActionTimingMode(action: EventAction): "now" | "attached" {
  return action.duration || isPersistentModifier(action) ? "attached" : "now";
}

function setArtifactActionTimingMode(action: EventAction, mode: "now" | "attached"): EventAction {
  if (isPersistentModifier(action)) return ensureModifierTiming(action);
  if (mode === "attached") {
    return {
      ...action,
      hook: action.hook ?? defaultHookForConsequence(action.type),
      duration: action.duration ?? { mode: "uses", value: 1 },
    } as EventAction;
  }
  const { duration: _duration, hook: _hook, ...rest } = action;
  return rest as EventAction;
}

function hookValueForAction(action: EventAction): NonNullable<EventAction["hook"]> {
  return isPersistentModifier(action) ? defaultHookForConsequence(action.type) : action.hook ?? defaultHookForConsequence(action.type);
}

function hookOptionsForAction(action: EventAction): { value: EffectLifecycleHook; label: string }[] {
  if (!isPersistentModifier(action)) return artifactHookOptions;
  const hook = defaultHookForConsequence(action.type);
  return artifactHookOptions.filter((option) => option.value === hook);
}

function withCanonicalAction(action: EventAction): EventAction {
  return isPersistentModifier(action) ? ensureModifierTiming(action) : action;
}

function isPersistentModifier(action: EventAction): boolean {
  return action.type === "halfMovement" || action.type === "movementMultiplier" || action.type === "diceBias";
}

function ensureModifierTiming(action: EventAction): EventAction {
  if (!isPersistentModifier(action)) return action;
  return { ...action, hook: defaultHookForConsequence(action.type) } as EventAction;
}

function timingPatch(action: EventAction): {
  hook?: EventAction["hook"];
  duration?: EffectDuration;
  expiresOnTrigger?: boolean;
} {
  return {
    ...(action.hook ? { hook: action.hook } : {}),
    ...(action.duration ? { duration: action.duration } : {}),
    ...(action.expiresOnTrigger !== undefined ? { expiresOnTrigger: action.expiresOnTrigger } : {}),
  };
}

function targetSelectValue(target: EventActionTarget): string {
  if (target === "acting" || target === "target" || target === "everyone") return target;
  if (target === "landing") return "acting";
  if (target === "winner" || target === "loser") return "target";
  if (typeof target !== "string" && "playerId" in target) return "player";
  if (typeof target !== "string" && "coinSelector" in target) return target.coinSelector === "richest" ? "coinRichest" : "coinPoorest";
  if (typeof target !== "string" && "coinRank" in target) return "coinRank";
  if (typeof target !== "string" && "coinRankFrom" in target) return "coinRankRange";
  if (typeof target !== "string" && "nearest" in target) return target.nearest === "ahead" ? "nearestAhead" : "nearestBehind";
  return "target";
}

function targetForValue(value: string, players: GameContent["players"], previous: EventActionTarget): EventActionTarget {
  if (value === "acting" || value === "target" || value === "everyone") return value;
  if (value === "nearestAhead") return { nearest: "ahead", from: "acting" };
  if (value === "nearestBehind") return { nearest: "behind", from: "acting" };
  if (value === "coinRichest") return { coinSelector: "richest" };
  if (value === "coinPoorest") return { coinSelector: "poorest" };
  if (value === "coinRank") return { coinRank: typeof previous !== "string" && "coinRank" in previous ? previous.coinRank : 1 };
  if (value === "coinRankRange") {
    return typeof previous !== "string" && "coinRankFrom" in previous
      ? { coinRankFrom: previous.coinRankFrom, coinRankTo: previous.coinRankTo }
      : { coinRankFrom: 1, coinRankTo: 2 };
  }
  if (value === "player") return { playerId: typeof previous !== "string" && "playerId" in previous ? previous.playerId : players[0]?.id ?? "" };
  return "target";
}

function durationForMode(mode: EffectDuration["mode"], previous: EffectDuration): EffectDuration {
  if (mode === "turns" || mode === "rounds" || mode === "uses") return { mode, value: durationValue(previous) };
  return { mode };
}

function durationValue(duration: EffectDuration): number {
  return duration.mode === "turns" || duration.mode === "rounds" || duration.mode === "uses" ? duration.value : 1;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
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
        aria-labelledby="artifact-json-modal-title"
        className="grid max-h-[90dvh] w-[min(60rem,calc(100vw-2rem))] grid-cols-1 overflow-hidden rounded-lg border border-white/15 bg-[#101923] shadow-2xl lg:grid-cols-2"
      >
        <h2 id="artifact-json-modal-title" className="sr-only">Import and export artifact JSON</h2>
        <div className="min-h-0 p-4">
          <h2 className="text-lg font-black text-white">Export JSON</h2>
          <textarea aria-label="Artifact export JSON" readOnly value={exportJson} className="mt-3 h-[56dvh] w-full rounded-md border border-white/10 bg-[#071018] p-3 font-mono text-xs text-slate-200" />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={onCopy} className="builder-button preview gap-2"><Copy className="h-4 w-4" />Copy</button>
            <button type="button" onClick={onDownload} className="builder-button gap-2"><Download className="h-4 w-4" />Download</button>
          </div>
        </div>
        <div className="min-h-0 border-t border-white/10 p-4 lg:border-l lg:border-t-0">
          <h2 className="text-lg font-black text-white">Import JSON</h2>
          <textarea aria-label="Artifact import JSON" value={importText} onChange={(event) => setImportText(event.target.value)} className="mt-3 h-[56dvh] w-full rounded-md border border-white/10 bg-[#071018] p-3 font-mono text-xs text-slate-200" />
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

function EmptyState({ label }: { label: string }) {
  return (
    <div className="grid min-h-64 place-items-center rounded-md border border-dashed border-white/15 bg-white/[0.025] p-6 text-center text-sm font-bold text-slate-500">
      {label}
    </div>
  );
}

function emptyArtifact(id: string): ArtifactDef {
  return {
    id,
    name: "New artifact",
    description: "Gameplay item for a shop visit.",
    price: 3,
    rarity: "common",
    targetMode: "choosePlayer",
    useFlow: "targeted",
    consequences: [],
    effects: [],
    visual: { anchorType: "body", anchorId: "chest" },
  };
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

function nextAvailableId(baseId: string, catalog: Record<string, unknown>): string {
  let index = 2;
  let id = `${baseId}-${index}`;
  while (catalog[id]) {
    index += 1;
    id = `${baseId}-${index}`;
  }
  return id;
}

function idFromName(value: string): string {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return id || "artifact";
}

function isFullContent(value: unknown): value is GameContent {
  return !!value && typeof value === "object" && "board" in value && "players" in value;
}

function loadInitialBuilderState(): { content: GameContent; selectedArtifactId: string } {
  return baseArtifactBuilderState();
}

function loadSavedBuilderState(): { content: GameContent; selectedArtifactId: string } | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    const content = contentFromSavedDraft(parsed);
    return {
      content,
      selectedArtifactId: selectedArtifactIdFromSavedDraft(parsed, content),
    };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function baseArtifactBuilderState(): { content: GameContent; selectedArtifactId: string } {
  const content = normalizeContentSchema(BASE_CONTENT);
  return { content, selectedArtifactId: Object.keys(content.artifacts ?? {})[0] ?? "" };
}

function artifactDraftFromContent(content: GameContent, selectedArtifactId: string): ArtifactBuilderDraft {
  return {
    artifactRarities: content.artifactRarities,
    artifactRarityRates: content.artifactRarityRates,
    artifacts: content.artifacts ?? {},
    selectedArtifactId: content.artifacts?.[selectedArtifactId] ? selectedArtifactId : Object.keys(content.artifacts ?? {})[0],
  };
}

function contentFromSavedDraft(value: unknown): GameContent {
  if (isFullContent(value)) return normalizeContentSchema(value);
  if (!isRecord(value)) return normalizeContentSchema(BASE_CONTENT);
  return normalizeContentSchema({
    ...BASE_CONTENT,
    artifactRarities: isRecord(value.artifactRarities) ? value.artifactRarities : BASE_CONTENT.artifactRarities,
    artifactRarityRates: isRecord(value.artifactRarityRates) ? value.artifactRarityRates : BASE_CONTENT.artifactRarityRates,
    artifacts: isRecord(value.artifacts) ? value.artifacts : BASE_CONTENT.artifacts,
  });
}

function selectedArtifactIdFromSavedDraft(value: unknown, content: GameContent): string {
  const artifactIds = Object.keys(content.artifacts ?? {});
  if (!artifactIds.length) return "";
  const selected = isRecord(value) && typeof value.selectedArtifactId === "string" ? value.selectedArtifactId : "";
  return selected && content.artifacts?.[selected] ? selected : artifactIds[0];
}

function persistDraft(draftJson: string): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, draftJson);
    return true;
  } catch (error) {
    console.warn("Unable to persist artifact builder draft", error);
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
