import { useEffect, useMemo, useState } from "react";
import { Download, Home, Plus, Trash2, Upload, Wrench } from "lucide-react";
import type { CharacterDef, CharacterSetDef, FaceAnchor, GameContent } from "@essence/shared";
import { characterDisplayName } from "@essence/shared/characters";
import { normalizeContentSchema } from "@essence/shared/contentValidation";
import seedContent from "@shared/content.json";

const BASE_CONTENT = normalizeContentSchema(seedContent);
const STORAGE_KEY = "essence:character-builder:draft:v1";
const FACE_ANCHORS = ["leftEye", "rightEye", "mouth"] as const;
const BODY_ANCHORS = ["head", "chest", "leftHand", "rightHand", "back"] as const;

export default function CharacterBuilder() {
  const [content, setContent] = useState<GameContent>(() => loadInitialContent());
  const characterIds = useMemo(() => Object.keys(content.characters ?? {}), [content.characters]);
  const setIds = useMemo(() => Object.keys(content.characterSets ?? {}), [content.characterSets]);
  const [selectedCharacterId, setSelectedCharacterId] = useState(characterIds[0] ?? "");
  const [selectedSetId, setSelectedSetId] = useState(setIds[0] ?? "");
  const [jsonModalOpen, setJsonModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [saveStatus, setSaveStatus] = useState("");

  const selectedCharacter = selectedCharacterId ? content.characters?.[selectedCharacterId] : undefined;
  const selectedSet = selectedSetId ? content.characterSets?.[selectedSetId] : undefined;
  const exportJson = useMemo(() => JSON.stringify(normalizeContentSchema(content), null, 2), [content]);

  useEffect(() => {
    if (selectedCharacterId && characterIds.includes(selectedCharacterId)) return;
    setSelectedCharacterId(characterIds[0] ?? "");
  }, [characterIds, selectedCharacterId]);

  useEffect(() => {
    if (selectedSetId && setIds.includes(selectedSetId)) return;
    setSelectedSetId(setIds[0] ?? "");
  }, [selectedSetId, setIds]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, exportJson);
  }, [exportJson]);

  useEffect(() => {
    if (!saveStatus) return;
    const timeout = window.setTimeout(() => setSaveStatus(""), 1600);
    return () => window.clearTimeout(timeout);
  }, [saveStatus]);

  const updateCharacter = (id: string, updater: (character: CharacterDef) => CharacterDef) => {
    setContent((current) => ({
      ...current,
      characters: {
        ...(current.characters ?? {}),
        [id]: updater(current.characters?.[id] ?? emptyCharacter(id)),
      },
    }));
  };

  const updateSet = (id: string, updater: (set: CharacterSetDef) => CharacterSetDef) => {
    setContent((current) => ({
      ...current,
      characterSets: {
        ...(current.characterSets ?? {}),
        [id]: updater(current.characterSets?.[id] ?? emptySet(id)),
      },
    }));
  };

  const createCharacter = () => {
    const id = nextId("character", content.characters ?? {});
    setContent((current) => ({
      ...current,
      characters: {
        ...(current.characters ?? {}),
        [id]: emptyCharacter(id),
      },
    }));
    setSelectedCharacterId(id);
    setSaveStatus("Created");
  };

  const deleteCharacter = (id: string) => {
    const character = content.characters?.[id];
    if (!character) return;
    if (!window.confirm(`Delete "${characterDisplayName(character)}"?`)) return;
    setContent((current) => {
      const { [id]: _deleted, ...characters } = current.characters ?? {};
      return {
        ...current,
        characters,
        characterSets: Object.fromEntries(
          Object.entries(current.characterSets ?? {}).map(([setId, set]) => [
            setId,
            { ...set, characterIds: set.characterIds.filter((characterId) => characterId !== id) },
          ])
        ),
      };
    });
    setSaveStatus("Deleted");
  };

  const createSet = () => {
    const id = nextId("set", content.characterSets ?? {});
    setContent((current) => ({
      ...current,
      characterSets: {
        ...(current.characterSets ?? {}),
        [id]: { id, name: "New character set", characterIds: Object.keys(current.characters ?? {}).slice(0, 4) },
      },
    }));
    setSelectedSetId(id);
    setSaveStatus("Created");
  };

  const deleteSet = (id: string) => {
    if (setIds.length <= 1) return;
    const set = content.characterSets?.[id];
    if (!set) return;
    if (!window.confirm(`Delete "${set.name}"?`)) return;
    setContent((current) => {
      const { [id]: _deleted, ...characterSets } = current.characterSets ?? {};
      return { ...current, characterSets };
    });
    setSaveStatus("Deleted");
  };

  const copyJson = async () => {
    await navigator.clipboard?.writeText(exportJson);
    setSaveStatus("Copied");
  };

  const downloadJson = () => {
    const blob = new Blob([exportJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "content.character-builder.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setSaveStatus("Downloaded");
  };

  const importJson = () => {
    try {
      const parsed = JSON.parse(importText);
      const next = normalizeContentSchema(isFullContent(parsed) ? parsed : { ...BASE_CONTENT, ...parsed });
      setContent(next);
      setSelectedCharacterId(Object.keys(next.characters ?? {})[0] ?? "");
      setSelectedSetId(Object.keys(next.characterSets ?? {})[0] ?? "");
      setImportText("");
      setJsonModalOpen(false);
      setSaveStatus("Imported");
    } catch {
      window.alert("JSON invalido");
    }
  };

  const resetDraft = () => {
    localStorage.removeItem(STORAGE_KEY);
    setContent(BASE_CONTENT);
    setSelectedCharacterId(Object.keys(BASE_CONTENT.characters ?? {})[0] ?? "");
    setSelectedSetId(Object.keys(BASE_CONTENT.characterSets ?? {})[0] ?? "");
    setImportText("");
    setJsonModalOpen(false);
    setSaveStatus("Reset");
  };

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#10151d] text-slate-100">
      <header className="flex flex-none flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#141b25]/98 px-4 py-3 shadow-lg shadow-black/25">
        <div className="min-w-0">
          <p className="text-[0.58rem] font-black uppercase tracking-[0.2em] text-amber-200">Essence tools</p>
          <h1 className="truncate text-xl font-black tracking-normal text-white">Character builder</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button onClick={() => setJsonModalOpen(true)} className="builder-button preview gap-2">
            <Upload className="h-4 w-4" />
            Import/export
          </button>
          <button onClick={downloadJson} className="builder-button gap-2">
            <Download className="h-4 w-4" />
            Download
          </button>
          <span className="min-w-16 text-center text-xs font-black text-amber-200">{saveStatus}</span>
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

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[18rem_minmax(0,1fr)_20rem]">
        <aside className="flex min-h-0 flex-col border-b border-white/10 bg-[#101722] p-3 lg:border-b-0 lg:border-r">
          <PanelHeader eyebrow={`${characterIds.length} characters`} title="Characters" action={createCharacter} />
          <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
            {characterIds.map((id) => {
              const character = content.characters?.[id];
              if (!character) return null;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedCharacterId(id)}
                  className={`grid grid-cols-[0.9rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md border p-2 text-left transition ${
                    id === selectedCharacterId ? "border-amber-200/70 bg-amber-300/12" : "border-white/10 bg-white/[0.035] hover:bg-white/[0.06]"
                  }`}
                >
                  <span className="size-3 rounded-[2px] border border-black/35" style={{ background: character.color ?? "#888888" }} />
                  <span className="min-w-0 truncate text-sm font-black text-white">{characterDisplayName(character)}</span>
                  {character.groom && <span className="text-[0.58rem] font-black uppercase text-amber-200">Groom</span>}
                </button>
              );
            })}
          </div>
        </aside>

        <section className="min-h-0 overflow-y-auto bg-[#151c27] p-3">
          {selectedCharacter ? (
            <CharacterEditor
              character={selectedCharacter}
              onChange={(updater) => updateCharacter(selectedCharacter.id, updater)}
              onDelete={() => deleteCharacter(selectedCharacter.id)}
            />
          ) : (
            <EmptyState label="Create a character to start editing." />
          )}
        </section>

        <aside className="min-h-0 overflow-y-auto border-t border-white/10 bg-[#101722] p-3 lg:border-l lg:border-t-0">
          <PanelHeader eyebrow={`${setIds.length} sets`} title="Character sets" action={createSet} />
          <div className="mt-3 space-y-2">
            {setIds.map((id) => {
              const set = content.characterSets?.[id];
              if (!set) return null;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedSetId(id)}
                  className={`w-full rounded-md border p-3 text-left transition ${
                    id === selectedSetId ? "border-cyan-200/70 bg-cyan-300/12" : "border-white/10 bg-white/[0.035] hover:bg-white/[0.06]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-black text-white">{set.name}</span>
                    <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[0.62rem] font-black text-cyan-100">
                      {set.characterIds.length}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          {selectedSet && (
            <SetEditor
              set={selectedSet}
              characters={content.characters ?? {}}
              canDelete={setIds.length > 1}
              onChange={(updater) => updateSet(selectedSet.id, updater)}
              onDelete={() => deleteSet(selectedSet.id)}
            />
          )}
        </aside>
      </div>

      {jsonModalOpen && (
        <JsonModal
          exportJson={exportJson}
          importText={importText}
          setImportText={setImportText}
          onCopy={copyJson}
          onDownload={downloadJson}
          onImport={importJson}
          onReset={resetDraft}
          onClose={() => setJsonModalOpen(false)}
        />
      )}
    </main>
  );
}

function CharacterEditor({
  character,
  onChange,
  onDelete,
}: {
  character: CharacterDef;
  onChange: (updater: (character: CharacterDef) => CharacterDef) => void;
  onDelete: () => void;
}) {
  const update = (patch: Partial<CharacterDef>) => onChange((current) => ({ ...current, ...patch }));
  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <section className="rounded-md border border-white/10 bg-white/[0.035] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-amber-200">Identity</p>
            <h2 className="mt-1 text-2xl font-black text-white">{characterDisplayName(character)}</h2>
          </div>
          <button onClick={onDelete} className="builder-button danger gap-2">
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <TextInput label="Id" value={character.id} disabled onChange={() => undefined} />
          <TextInput label="Display name" value={character.displayName} onChange={(displayName) => update({ displayName })} />
          <ColorInput label="Color" value={character.color ?? "#888888"} onChange={(color) => update({ color })} />
          <TextInput label="Face photo" value={character.facePhoto ?? ""} onChange={(facePhoto) => update({ facePhoto: facePhoto || undefined })} />
          <label className="mt-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-slate-400">
            <input
              type="checkbox"
              checked={Boolean(character.groom)}
              onChange={(event) => update({ groom: event.target.checked || undefined })}
              className="size-4 accent-amber-300"
            />
            Groom flag
          </label>
        </div>
      </section>

      <section className="rounded-md border border-white/10 bg-white/[0.035] p-4">
        <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-cyan-200">Face anchors</p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {FACE_ANCHORS.map((id) => (
            <AnchorEditor
              key={id}
              label={anchorLabel(id)}
              value={character.faceAnchors?.[id]}
              onChange={(anchor) =>
                update({
                  faceAnchors: {
                    ...(character.faceAnchors ?? {}),
                    [id]: anchor,
                  },
                })
              }
            />
          ))}
        </div>
      </section>

      <section className="rounded-md border border-white/10 bg-white/[0.035] p-4">
        <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-emerald-200">Body anchors</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {BODY_ANCHORS.map((id) => (
            <AnchorEditor
              key={id}
              label={anchorLabel(id)}
              value={character.bodyAnchors?.[id]}
              onChange={(anchor) =>
                update({
                  bodyAnchors: {
                    ...(character.bodyAnchors ?? {}),
                    [id]: anchor,
                  },
                })
              }
            />
          ))}
        </div>
      </section>

      <section className="rounded-md border border-white/10 bg-white/[0.035] p-4">
        <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-fuchsia-200">Defaults</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <TextInput
            label="Default cosmetics"
            value={(character.defaultLoadout?.cosmeticIds ?? []).join(", ")}
            onChange={(value) =>
              update({
                defaultLoadout: {
                  ...(character.defaultLoadout ?? {}),
                  cosmeticIds: csv(value),
                },
                defaultCosmetics: undefined,
              })
            }
          />
          <TextInput
            label="Default traits"
            value={(character.defaultTraits ?? []).join(", ")}
            onChange={(value) => update({ defaultTraits: csv(value) })}
          />
        </div>
      </section>
    </div>
  );
}

function SetEditor({
  set,
  characters,
  canDelete,
  onChange,
  onDelete,
}: {
  set: CharacterSetDef;
  characters: Record<string, CharacterDef>;
  canDelete: boolean;
  onChange: (updater: (set: CharacterSetDef) => CharacterSetDef) => void;
  onDelete: () => void;
}) {
  const update = (patch: Partial<CharacterSetDef>) => onChange((current) => ({ ...current, ...patch }));
  const toggleCharacter = (characterId: string) => {
    const nextIds = set.characterIds.includes(characterId)
      ? set.characterIds.filter((id) => id !== characterId)
      : [...set.characterIds, characterId];
    update({ characterIds: nextIds });
  };

  return (
    <section className="mt-4 rounded-md border border-white/10 bg-white/[0.035] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[0.58rem] font-black uppercase tracking-[0.16em] text-cyan-200">Selected set</p>
          <h2 className="truncate text-lg font-black text-white">{set.name}</h2>
        </div>
        <button onClick={onDelete} disabled={!canDelete} className="builder-button danger compact gap-2 disabled:opacity-40">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <TextInput label="Set name" value={set.name} onChange={(name) => update({ name })} />
      <div className="mt-3 space-y-2">
        {Object.values(characters).map((character) => (
          <label
            key={character.id}
            className="grid grid-cols-[1rem_0.8rem_minmax(0,1fr)] items-center gap-2 rounded-md border border-white/10 bg-black/15 p-2 text-sm font-black text-white"
          >
            <input
              type="checkbox"
              checked={set.characterIds.includes(character.id)}
              onChange={() => toggleCharacter(character.id)}
              className="size-4 accent-cyan-300"
            />
            <span className="size-3 rounded-[2px] border border-black/35" style={{ background: character.color ?? "#888888" }} />
            <span className="min-w-0 truncate">{characterDisplayName(character)}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

function AnchorEditor({ label, value, onChange }: { label: string; value?: FaceAnchor; onChange: (value: FaceAnchor) => void }) {
  const anchor = value ?? { x: 0.5, y: 0.5, angle: 0 };
  const update = (patch: Partial<FaceAnchor>) => onChange({ ...anchor, ...patch });
  return (
    <div className="rounded-md border border-white/10 bg-black/15 p-3">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-300">{label}</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <NumberInput label="X" value={anchor.x} step={0.01} onChange={(x) => update({ x })} />
        <NumberInput label="Y" value={anchor.y} step={0.01} onChange={(y) => update({ y })} />
        <NumberInput label="A" value={anchor.angle ?? 0} step={1} onChange={(angle) => update({ angle })} />
      </div>
    </div>
  );
}

function PanelHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p>
        <h2 className="truncate text-base font-black text-white">{title}</h2>
      </div>
      <button onClick={action} className="builder-button compact gap-2">
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function TextInput({
  label,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mt-3 block text-xs font-black uppercase tracking-[0.12em] text-slate-400">
      {label}
      <input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-md border border-white/15 bg-[#151922] px-3 py-2 text-sm font-bold text-white outline-none focus:border-amber-300 disabled:opacity-55"
      />
    </label>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mt-3 block text-xs font-black uppercase tracking-[0.12em] text-slate-400">
      {label}
      <span className="mt-2 grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-md border border-white/15 bg-[#151922]" />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-md border border-white/15 bg-[#151922] px-3 py-2 text-sm font-bold text-white outline-none focus:border-amber-300"
        />
      </span>
    </label>
  );
}

function NumberInput({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-[0.58rem] font-black uppercase tracking-[0.1em] text-slate-500">
      {label}
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded-md border border-white/10 bg-[#151922] px-2 py-1.5 text-xs font-black text-white outline-none focus:border-cyan-300"
      />
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
  return (
    <div data-json-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
      <section className="w-[min(58rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-white/15 bg-[#121923] text-slate-100 shadow-2xl shadow-black/45">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-slate-300">Character JSON</h2>
          <button type="button" onClick={onClose} className="builder-button compact">
            Close
          </button>
        </header>
        <div className="grid max-h-[calc(100dvh-8rem)] gap-3 overflow-auto p-4 lg:grid-cols-2">
          <div>
            <label className="block text-xs font-bold text-slate-300">
              Import content
              <textarea
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                placeholder="Paste a content JSON or a characters/characterSets fragment"
                className="mt-1 h-72 w-full resize-none rounded-md border border-white/10 bg-[#0d1218] p-2 font-mono text-xs text-slate-100 outline-none focus:border-amber-300"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={onImport} disabled={!importText.trim()} className="builder-button gap-2 disabled:opacity-40">
                <Upload className="h-4 w-4" />
                Import
              </button>
              <button type="button" onClick={onReset} className="builder-button danger">
                Reset draft
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-300">
              Current export
              <textarea
                readOnly
                value={exportJson}
                className="mt-1 h-72 w-full resize-none rounded-md border border-white/10 bg-black/30 p-2 font-mono text-[0.65rem] text-slate-200"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={onCopy} className="builder-button">
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

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-full items-center justify-center">
      <p className="rounded-md border border-dashed border-white/10 p-4 text-sm font-black text-slate-400">{label}</p>
    </div>
  );
}

function loadInitialContent(): GameContent {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return BASE_CONTENT;
    return normalizeContentSchema(JSON.parse(saved));
  } catch {
    return BASE_CONTENT;
  }
}

function emptyCharacter(id: string): CharacterDef {
  return {
    id,
    displayName: "New character",
    color: "#f5d547",
    faceAnchors: {
      leftEye: { x: 0.42, y: 0.38, angle: 0 },
      rightEye: { x: 0.58, y: 0.38, angle: 0 },
      mouth: { x: 0.5, y: 0.62, angle: 0 },
    },
    bodyAnchors: {
      head: { x: 0.5, y: 0.16, angle: 0 },
      chest: { x: 0.5, y: 0.44, angle: 0 },
      leftHand: { x: 0.28, y: 0.46, angle: 0 },
      rightHand: { x: 0.72, y: 0.46, angle: 0 },
      back: { x: 0.5, y: 0.48, angle: 0 },
    },
    defaultLoadout: { cosmeticIds: [] },
    defaultTraits: [],
  };
}

function emptySet(id: string): CharacterSetDef {
  return { id, name: "New character set", characterIds: [] };
}

function nextId(prefix: string, records: Record<string, unknown>): string {
  let index = Object.keys(records).length + 1;
  let id = `${prefix}-${index}`;
  while (records[id]) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

function csv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function anchorLabel(id: string): string {
  return id.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function isFullContent(value: unknown): value is GameContent {
  return Boolean(value && typeof value === "object" && "board" in value && "players" in value);
}
