import { useEffect, useMemo, useState } from "react";
import type { ArtifactDef, ArtifactRarity, ArtifactTargetMode, ArtifactUseFlow, EventAction, GameContent } from "@essence/shared";
import { ARTIFACT_RARITIES, DEFAULT_ARTIFACT_RARITY_RATES, artifactActionsForUse, rollArtifactShopOffers } from "@essence/shared/artifacts";
import { consequenceLabel } from "@essence/shared/consequences";
import { normalizeContentSchema, validateGameContent } from "@essence/shared/contentValidation";
import seedContent from "@shared/content.json";
import { Copy, Download, Home, Plus, Save, Sparkles, Trash2, Upload, Wrench } from "lucide-react";
import { saveContentJsonToDisk } from "../lib/contentDiskSave";

const STORAGE_KEY = "essence:artifact-builder:draft:v1";
const BASE_CONTENT = normalizeContentSchema(seedContent);
type ArtifactBuilderDraft = Pick<GameContent, "artifactRarityRates" | "artifacts"> & { selectedArtifactId?: string };

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
  const effectOptions = useMemo(() => Object.values(content.effects ?? {}).sort((a, b) => a.name.localeCompare(b.name)), [content.effects]);
  const exportJson = useMemo(() => JSON.stringify(normalizeContentSchema(content), null, 2), [content]);
  const draftJson = useMemo(
    () => JSON.stringify(artifactDraftFromContent(content, selectedArtifactId), null, 2),
    [content.artifactRarityRates, content.artifacts, selectedArtifactId]
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

  const updateRates = (rarity: ArtifactRarity, value: number) => {
    setContent((current) => ({
      ...current,
      artifactRarityRates: {
        ...(current.artifactRarityRates ?? DEFAULT_ARTIFACT_RARITY_RATES),
        [rarity]: Math.max(0, Math.round(value)),
      },
    }));
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
          <a href="/" className="builder-button gap-2">
            <Home className="h-4 w-4" />
            Home
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
              onChange={(updater) => updateArtifact(selectedArtifact.id, updater)}
              onDelete={() => deleteArtifact(selectedArtifact.id)}
            />
          ) : (
            <EmptyState label="Create an artifact to start editing." />
          )}
        </section>

        <aside className="border-t border-white/10 bg-[#0f1722] p-3 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
            <h2 className="text-sm font-black text-white">Rarity rates</h2>
            <div className="mt-3 grid gap-2">
              {ARTIFACT_RARITIES.map((rarity) => (
                <NumberInput
                  key={rarity}
                  label={rarity}
                  value={(content.artifactRarityRates ?? DEFAULT_ARTIFACT_RARITY_RATES)[rarity]}
                  onChange={(value) => updateRates(rarity, value)}
                />
              ))}
            </div>
          </section>

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
  onChange,
  onDelete,
}: {
  artifact: ArtifactDef;
  effectOptions: NonNullable<GameContent["effects"]>[string][];
  onChange: (updater: (artifact: ArtifactDef) => ArtifactDef) => void;
  onDelete: () => void;
}) {
  const effectIds = artifact.effects ?? [];
  const actions = artifactActionsForUse(artifact);
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
            options={ARTIFACT_RARITIES}
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
        <h3 className="text-sm font-black text-white">Effects and consequences</h3>
        <label className="mt-3 block text-[0.62rem] font-black uppercase tracking-wider text-slate-400">
          Effects
          <select
            multiple
            value={effectIds}
            onChange={(event) => {
              const next = Array.from(event.currentTarget.selectedOptions).map((option) => option.value);
              onChange((current) => ({ ...current, effects: next }));
            }}
            className="mt-1 min-h-24 w-full rounded-md border border-white/10 bg-[#0b1118] px-2 py-2 text-sm font-bold normal-case text-slate-100 outline-none focus:border-emerald-300/60"
          >
            {effectOptions.map((effect) => (
              <option key={effect.id} value={effect.id}>
                {effect.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-[0.62rem] font-black uppercase tracking-wider text-slate-400">
          Consequences JSON
          <textarea
            key={artifact.id}
            defaultValue={JSON.stringify(artifact.consequences ?? [], null, 2)}
            onBlur={(event) => {
              try {
                const parsed = JSON.parse(event.currentTarget.value) as EventAction[];
                onChange((current) => ({ ...current, consequences: Array.isArray(parsed) ? parsed : [] }));
              } catch {
                window.alert("Invalid consequences JSON");
              }
            }}
            className="mt-1 min-h-40 w-full rounded-md border border-white/10 bg-[#0b1118] px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-emerald-300/60"
          />
        </label>
        <div className="mt-3 grid gap-1">
          {actions.map((action, index) => (
            <p key={`${action.type}-${index}`} className="rounded-sm border border-emerald-200/15 bg-emerald-300/10 px-2 py-1 text-xs font-bold text-emerald-50">
              {consequenceLabel(action)}
            </p>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <h3 className="text-sm font-black text-white">Visuals and roll weight</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <TextInput label="Visual asset" value={artifact.visual?.assetId ?? artifact.visualAssetId ?? ""} onChange={(assetId) => onChange((current) => ({ ...current, visual: { ...(current.visual ?? {}), assetId } }))} />
          <TextInput label="Anchor id" value={artifact.visual?.anchorId ?? ""} onChange={(anchorId) => onChange((current) => ({ ...current, visual: { ...(current.visual ?? {}), anchorId } }))} />
          <TextInput label="Incoming animation" value={artifact.animations?.incoming ?? ""} onChange={(incoming) => onChange((current) => ({ ...current, animations: { ...(current.animations ?? {}), incoming } }))} />
          <NumberInput label="Shop weight" value={artifact.weightOverrides?.shop ?? artifact.shopWeight ?? 1} onChange={(shop) => onChange((current) => ({ ...current, weightOverrides: { ...(current.weightOverrides ?? {}), shop: Math.max(0, shop) } }))} />
        </div>
      </section>
    </div>
  );
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

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-[0.62rem] font-black uppercase tracking-wider text-slate-400">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#0b1118] px-3 text-sm font-bold normal-case text-slate-100 outline-none focus:border-emerald-300/60" />
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

function SelectInput({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="block text-[0.62rem] font-black uppercase tracking-wider text-slate-400">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#0b1118] px-3 text-sm font-bold normal-case text-slate-100 outline-none focus:border-emerald-300/60"
      >
        {options.map((option) => (
          <option key={option} value={option} className="bg-[#0b1118] text-slate-100">
            {option}
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
      <textarea value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-24 w-full rounded-md border border-white/10 bg-[#0b1118] px-3 py-2 text-sm font-bold normal-case leading-5 text-slate-100 outline-none focus:border-emerald-300/60" />
    </label>
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
    animations: {},
    weightOverrides: { shop: 1 },
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
    artifactRarityRates: content.artifactRarityRates ?? DEFAULT_ARTIFACT_RARITY_RATES,
    artifacts: content.artifacts ?? {},
    selectedArtifactId: content.artifacts?.[selectedArtifactId] ? selectedArtifactId : Object.keys(content.artifacts ?? {})[0],
  };
}

function contentFromSavedDraft(value: unknown): GameContent {
  if (isFullContent(value)) return normalizeContentSchema(value);
  if (!isRecord(value)) return normalizeContentSchema(BASE_CONTENT);
  return normalizeContentSchema({
    ...BASE_CONTENT,
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
