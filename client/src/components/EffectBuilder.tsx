import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Save, Upload, Wrench } from "lucide-react";
import type { EffectDef, GameContent } from "@essence/shared";
import { normalizeContentSchema, validateGameContent } from "@essence/shared/contentValidation";
import seedContent from "@shared/content.json";
import { saveContentJsonToDisk } from "../lib/contentDiskSave";
import { sameOriginReturnRoute } from "../effectBuilderRoute";
import {
  EffectBuilderSurface,
  defaultCustomEffect,
  migrateEffectDraft,
  nextEffectId,
  removeEffectFromContent,
} from "./EffectBuilderSurface";

const BASE_CONTENT = migrateEffectDraft(normalizeContentSchema(seedContent));
const STORAGE_KEY = "essence:effect-builder:draft:v1";

type EffectBuilderDraft = Pick<GameContent, "effects"> & { selectedEffectId?: string };

export default function EffectBuilder() {
  const [initialState] = useState(() => loadInitialBuilderState());
  const [content, setContent] = useState<GameContent>(initialState.content);
  const effectIds = useMemo(() => Object.keys(content.effects ?? {}), [content.effects]);
  const [selectedEffectId, setSelectedEffectId] = useState(initialState.selectedEffectId);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const exportJson = useMemo(() => JSON.stringify(normalizeContentSchema(content), null, 2), [content]);
  const draftJson = useMemo(() => JSON.stringify(effectDraftFromContent(content, selectedEffectId), null, 2), [content.effects, selectedEffectId]);
  const validation = useMemo(() => validateGameContent(content), [content]);

  useEffect(() => {
    if (selectedEffectId && effectIds.includes(selectedEffectId)) return;
    setSelectedEffectId(effectIds[0] ?? "");
  }, [effectIds, selectedEffectId]);

  useEffect(() => {
    if (!saveStatus) return;
    const timeout = window.setTimeout(() => setSaveStatus(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [saveStatus]);

  const updateEffect = (effectId: string, updater: (effect: EffectDef) => EffectDef) => {
    setContent((current) => {
      const existing = current.effects?.[effectId] ?? defaultCustomEffect(effectId);
      return {
        ...current,
        effects: {
          ...(current.effects ?? {}),
          [effectId]: normalizeEditableEffect(updater(existing), effectId),
        },
      };
    });
  };

  const createEffect = () => {
    const id = nextEffectId(content.effects ?? {});
    setContent((current) => ({
      ...current,
      effects: {
        ...(current.effects ?? {}),
        [id]: defaultCustomEffect(id),
      },
    }));
    setSelectedEffectId(id);
    setSaveStatus("Effect created");
  };

  const duplicateEffect = (effectId: string) => {
    const effect = content.effects?.[effectId];
    if (!effect) return;
    const id = nextEffectId(content.effects ?? {});
    setContent((current) => ({
      ...current,
      effects: {
        ...(current.effects ?? {}),
        [id]: {
          ...JSON.parse(JSON.stringify(effect)),
          id,
          name: `${effect.name} copy`,
        },
      },
    }));
    setSelectedEffectId(id);
    setSaveStatus("Duplicated");
  };

  const deleteEffect = (effectId: string) => {
    const effect = content.effects?.[effectId];
    if (!effect) return;
    if (!window.confirm(`Delete "${effect.name}"? Events, artifacts, and traits using it will be cleaned up.`)) return;
    setContent((current) => removeEffectFromContent(current, effectId));
    setSelectedEffectId(effectIds.filter((id) => id !== effectId)[0] ?? "");
    setSaveStatus("Deleted");
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
    anchor.download = "content.effect-builder.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setSaveStatus("Downloaded");
  };

  const importJson = () => {
    try {
      const parsed = JSON.parse(importText);
      const next = migrateEffectDraft(normalizeContentSchema(isFullContent(parsed) ? parsed : { ...BASE_CONTENT, ...parsed }));
      setContent(next);
      setSelectedEffectId(Object.keys(next.effects ?? {})[0] ?? "");
      setImportText("");
      setJsonOpen(false);
      setSaveStatus("Imported");
    } catch {
      window.alert("Invalid JSON");
    }
  };

  const resetDraft = () => {
    const saved = loadSavedBuilderState();
    const next = saved ?? baseBuilderState();
    setContent(next.content);
    setSelectedEffectId(next.selectedEffectId);
    setImportText("");
    setJsonOpen(false);
    setSaveStatus(saved ? "Recovered browser draft" : "Loaded content.json");
  };

  const goBack = () => {
    const from = fromRoute();
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = from ?? "/tools";
  };

  return (
    <main data-effect-builder="true" className="flex min-h-dvh flex-col bg-[#0d141b] text-slate-100 lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <header className="flex flex-none flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#121a24]/98 px-4 py-3 shadow-lg shadow-black/25">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={goBack} className="builder-button compact gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="min-w-0">
            <p className="text-[0.58rem] font-black uppercase tracking-[0.2em] text-cyan-200">Essence tools</p>
            <h1 className="truncate text-xl font-black tracking-normal text-white">Effect builder</h1>
          </div>
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
          <span className="min-w-20 text-center text-xs font-black text-cyan-200">{saveStatus}</span>
          <a href="/tools" className="builder-button gap-2">
            <Wrench className="h-4 w-4" />
            Tools
          </a>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <EffectBuilderSurface
          effects={content.effects ?? {}}
          artifacts={content.artifacts ?? {}}
          selectedEffectId={selectedEffectId}
          players={content.players}
          onSelectEffect={setSelectedEffectId}
          onCreateEffect={createEffect}
          onDuplicateEffect={duplicateEffect}
          onDeleteEffect={deleteEffect}
          onUpdateEffect={updateEffect}
        />
        <div className="flex flex-none flex-wrap items-center gap-2 border-t border-white/10 bg-[#101722] px-4 py-2 text-xs font-bold text-slate-400">
          {validation.ok ? (
            <span className="text-emerald-200">Content validates.</span>
          ) : (
            validation.errors.slice(0, 3).map((error) => (
              <span key={error} className="rounded-sm border border-rose-300/20 bg-rose-400/10 px-2 py-1 text-rose-100">
                {error}
              </span>
            ))
          )}
        </div>
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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
      <section className="w-[min(58rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-white/15 bg-[#151922] text-slate-100 shadow-2xl shadow-black/45">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-black uppercase tracking-[0.16em] text-slate-300">Import / export effects</h2>
          <button type="button" onClick={onClose} className="builder-button compact">
            Close
          </button>
        </header>
        <div className="grid max-h-[calc(100dvh-8rem)] gap-3 overflow-auto p-4 lg:grid-cols-2">
          <div>
            <label className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">
              Import JSON
              <textarea
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                placeholder="Paste full content JSON or { effects }"
                className="mt-2 h-72 w-full resize-none rounded-md border border-white/15 bg-[#10131a] p-3 font-mono text-xs text-slate-100 outline-none focus:border-cyan-300"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={onImport} disabled={!importText.trim()} className="builder-button preview gap-2 disabled:opacity-40">
                <Upload className="h-4 w-4" />
                Import
              </button>
              <button type="button" onClick={onReset} className="builder-button danger">
                Recover browser draft
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">
              Current export
              <textarea readOnly value={exportJson} className="mt-2 h-72 w-full resize-none rounded-md border border-white/15 bg-black/30 p-3 font-mono text-[0.65rem] text-slate-200" />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={onCopy} className="builder-button preview gap-2">
                Copy
              </button>
              <button type="button" onClick={onDownload} className="builder-button gap-2">
                <Download className="h-4 w-4" />
                Download
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function loadInitialBuilderState(): { content: GameContent; selectedEffectId: string } {
  const base = baseBuilderState();
  const requestedEffectId = requestedEffectIdFromUrl();
  if (requestedEffectId && base.content.effects?.[requestedEffectId]) return { ...base, selectedEffectId: requestedEffectId };
  return base;
}

function baseBuilderState(): { content: GameContent; selectedEffectId: string } {
  const saved = loadSavedBuilderState();
  if (saved) return saved;
  return {
    content: BASE_CONTENT,
    selectedEffectId: requestedEffectIdFromUrl() ?? Object.keys(BASE_CONTENT.effects ?? {})[0] ?? "",
  };
}

function loadSavedBuilderState(): { content: GameContent; selectedEffectId: string } | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as EffectBuilderDraft;
    const content = migrateEffectDraft(normalizeContentSchema({ ...BASE_CONTENT, effects: parsed.effects ?? BASE_CONTENT.effects }));
    const requestedEffectId = requestedEffectIdFromUrl();
    return {
      content,
      selectedEffectId: requestedEffectId && content.effects?.[requestedEffectId] ? requestedEffectId : parsed.selectedEffectId ?? Object.keys(content.effects ?? {})[0] ?? "",
    };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function persistDraft(draftJson: string): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, draftJson);
    return true;
  } catch (error) {
    console.warn("Unable to persist effect builder browser draft", error);
    return false;
  }
}

function effectDraftFromContent(content: GameContent, selectedEffectId: string): EffectBuilderDraft {
  return {
    effects: content.effects,
    selectedEffectId,
  };
}

function requestedEffectIdFromUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get("effectId") ?? undefined;
}

function fromRoute(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const from = new URLSearchParams(window.location.search).get("from");
  return sameOriginReturnRoute(from, window.location.origin);
}

function isFullContent(value: unknown): value is GameContent {
  return Boolean(value && typeof value === "object" && "players" in value && "board" in value);
}

function normalizeEditableEffect(effect: EffectDef, fallbackId: string): EffectDef {
  return {
    ...effect,
    id: fallbackId,
    name: effect.name || "New effect",
    duration: effect.duration ?? { mode: "uses", value: 1 },
  };
}
