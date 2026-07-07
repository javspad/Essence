import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Crosshair, Download, Home, ImagePlus, Plus, Rotate3D, RotateCcw, Trash2, Upload, Wrench } from "lucide-react";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { CharacterDef, CharacterSetDef, CosmeticDef, FaceAnchor, FacePhotoAlignment, GameContent } from "@essence/shared";
import { characterDisplayName } from "@essence/shared/characters";
import { normalizeContentSchema } from "@essence/shared/contentValidation";
import seedContent from "@shared/content.json";
import {
  TOKEN_PREVIEW_GROUP_POSITION,
  TOKEN_PREVIEW_GROUP_SCALE,
  defaultTokenAnchor,
  tokenAnchorSurface,
  type TokenAnchorHandle,
} from "../characterTokenRig";
import { PlayerTokenPawn } from "./Board3DShell";

const EXAMPLE_COSMETICS: Record<string, CosmeticDef> = {
  "party-goggles": {
    id: "party-goggles",
    name: "Party goggles",
    description: "Round party goggles mounted to the eye anchors.",
    assetId: "goggles",
    anchor: "leftEye",
  },
  "big-mustache": {
    id: "big-mustache",
    name: "Big mustache",
    description: "A bold mustache mounted to the mouth anchor.",
    assetId: "mustache",
    anchor: "mouth",
  },
  "party-hat": {
    id: "party-hat",
    name: "Party hat",
    description: "A cone hat mounted to the head anchor.",
    assetId: "hat",
    anchor: "head",
  },
  "mustache-handlebar": {
    id: "mustache-handlebar",
    name: "Bigote manubrio",
    description: "Bigote con las puntas paraditas.",
    anchor: "mouth",
  },
  "mustache-pencil": {
    id: "mustache-pencil",
    name: "Bigote finito",
    description: "Bigote fino tipo lápiz.",
    anchor: "mouth",
  },
  "top-hat": {
    id: "top-hat",
    name: "Galera",
    description: "Galera negra elegante.",
    anchor: "head",
  },
  "cap": {
    id: "cap",
    name: "Gorra",
    description: "Gorra con visera.",
    anchor: "head",
  },
  "field-hat": {
    id: "field-hat",
    name: "Sombrero de campo",
    description: "Sombrero de ala ancha.",
    anchor: "head",
  },
  "coin-crown": {
    id: "coin-crown",
    name: "Corona de monedas",
    description: "Corona dorada de monedas.",
    anchor: "head",
  },
  "gold-chain": {
    id: "gold-chain",
    name: "Cadena de oro",
    description: "Cadena de oro al cuello.",
    anchor: "chest",
  },
  "dice-necklace": {
    id: "dice-necklace",
    name: "Collar de dados",
    description: "Collar con un dado colgante.",
    anchor: "chest",
  },
  "wristwatch": {
    id: "wristwatch",
    name: "Reloj de muñeca",
    description: "Reloj en la muñeca.",
    anchor: "rightHand",
  },
  "tuxedo": {
    id: "tuxedo",
    name: "Smoking",
    description: "Traje de smoking negro con moño.",
    anchor: "chest",
  },
  "pet-dog": {
    id: "pet-dog",
    name: "Perrito",
    description: "Perrito que salta al lado tuyo.",
    anchor: "back",
  },
  "pet-cat": {
    id: "pet-cat",
    name: "Gatito",
    description: "Gatito que salta al lado tuyo.",
    anchor: "back",
  },
};

const BASE_CONTENT = withExampleCosmetics(normalizeContentSchema(seedContent));
const STORAGE_KEY = "essence:character-builder:draft:v1";
const FACE_ANCHORS = ["leftEye", "rightEye", "mouth"] as const;
const BODY_ANCHORS = ["head", "chest", "leftHand", "rightHand", "back"] as const;
const DEFAULT_FACE_ALIGNMENT: FacePhotoAlignment = { x: 0.5, y: 0.5, scale: 1.08, angle: 0 };
const DEFAULT_PREVIEW_ROTATION = { yaw: 0, pitch: 0 };
const PREVIEW_VIEWS = [
  { id: "front", label: "Front", yaw: 0, pitch: 0 },
  { id: "left", label: "Left", yaw: Math.PI / 2, pitch: 0 },
  { id: "back", label: "Back", yaw: Math.PI, pitch: 0 },
  { id: "right", label: "Right", yaw: -Math.PI / 2, pitch: 0 },
] as const;
const ANCHOR_COLORS: Record<string, string> = {
  leftEye: "#38bdf8",
  rightEye: "#38bdf8",
  mouth: "#fb7185",
  head: "#f5d547",
  chest: "#34d399",
  leftHand: "#a78bfa",
  rightHand: "#a78bfa",
  back: "#f59e0b",
};

type AnchorScope = "face" | "body";
type PreviewRotation = typeof DEFAULT_PREVIEW_ROTATION;
type PreviewTool = "view" | "anchors";

interface AnchorHandle extends TokenAnchorHandle {
  id: string;
  label: string;
  scope: AnchorScope;
}

interface ProjectedAnchor {
  x: number;
  y: number;
  visible: boolean;
}

const ANCHOR_HANDLES: AnchorHandle[] = [
  ...FACE_ANCHORS.map((id) => ({ id, label: anchorLabel(id), scope: "face" as const })),
  ...BODY_ANCHORS.map((id) => ({ id, label: anchorLabel(id), scope: "body" as const })),
];

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
      const next = withExampleCosmetics(normalizeContentSchema(isFullContent(parsed) ? parsed : { ...BASE_CONTENT, ...parsed }));
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

  const toggleCharacterInSelectedSet = (characterId: string) => {
    if (!selectedSet) return;
    updateSet(selectedSet.id, (current) => {
      const characterIds = current.characterIds.includes(characterId)
        ? current.characterIds.filter((id) => id !== characterId)
        : [...current.characterIds, characterId];
      return { ...current, characterIds };
    });
  };

  return (
    <main className="flex min-h-dvh flex-col bg-[#10151d] text-slate-100 lg:h-dvh lg:min-h-0 lg:overflow-hidden">
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

      <div className="grid flex-1 grid-cols-1 lg:min-h-0 lg:overflow-hidden lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="flex flex-col border-b border-white/10 bg-[#101722] p-3 lg:min-h-0 lg:border-b-0 lg:border-r">
          <PanelHeader eyebrow={`${characterIds.length} characters`} title="Characters" action={createCharacter} />
          {selectedSet && (
            <section className="mt-3 rounded-md border border-cyan-200/20 bg-cyan-300/[0.055] p-2">
              <div className="flex items-center gap-2">
                <select
                  aria-label="Character set"
                  value={selectedSetId}
                  onChange={(event) => setSelectedSetId(event.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-white/10 bg-[#151922] px-2 py-1.5 text-xs font-black text-white outline-none focus:border-cyan-300"
                >
                  {setIds.map((id) => (
                    <option key={id} value={id}>
                      {content.characterSets?.[id]?.name ?? id}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={createSet} className="builder-button compact" aria-label="Create character set">
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteSet(selectedSet.id)}
                  disabled={setIds.length <= 1}
                  className="builder-button danger compact disabled:opacity-40"
                  aria-label="Delete character set"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                aria-label="Set name"
                value={selectedSet.name}
                onChange={(event) => updateSet(selectedSet.id, (current) => ({ ...current, name: event.target.value }))}
                className="mt-2 w-full rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-xs font-black text-white outline-none focus:border-cyan-300"
              />
            </section>
          )}
          <div className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto pr-1 lg:min-h-0 lg:max-h-none lg:flex-1">
            {characterIds.map((id) => {
              const character = content.characters?.[id];
              if (!character) return null;
              const inSelectedSet = Boolean(selectedSet?.characterIds.includes(id));
              return (
                <div
                  key={id}
                  className={`grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md border p-2 transition ${
                    id === selectedCharacterId ? "border-amber-200/70 bg-amber-300/12" : "border-white/10 bg-white/[0.035] hover:bg-white/[0.06]"
                  }`}
                >
                  <input
                    aria-label={`${characterDisplayName(character)} in selected set`}
                    type="checkbox"
                    checked={inSelectedSet}
                    disabled={!selectedSet}
                    onChange={() => toggleCharacterInSelectedSet(id)}
                    className="size-4 accent-cyan-300 disabled:opacity-40"
                  />
                  <button
                    type="button"
                    onClick={() => setSelectedCharacterId(id)}
                    className="grid min-w-0 grid-cols-[0.85rem_minmax(0,1fr)_auto] items-center gap-2 text-left"
                  >
                    <span className="size-3 rounded-[2px] border border-black/35" style={{ background: character.color ?? "#888888" }} />
                    <span className="min-w-0 truncate text-sm font-black text-white">{characterDisplayName(character)}</span>
                    {character.groom && <span className="text-[0.58rem] font-black uppercase text-amber-200">Groom</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteCharacter(id)}
                    className="builder-button danger compact opacity-75 hover:opacity-100"
                    aria-label={`Delete ${characterDisplayName(character)}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="bg-[#151c27] p-3 lg:min-h-0 lg:overflow-y-auto">
          {selectedCharacter ? (
            <CharacterEditor
              character={selectedCharacter}
              cosmetics={content.cosmetics ?? {}}
              onChange={(updater) => updateCharacter(selectedCharacter.id, updater)}
              onDelete={() => deleteCharacter(selectedCharacter.id)}
            />
          ) : (
            <EmptyState label="Create a character to start editing." />
          )}
        </section>
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
  cosmetics,
  onChange,
  onDelete,
}: {
  character: CharacterDef;
  cosmetics: Record<string, CosmeticDef>;
  onChange: (updater: (character: CharacterDef) => CharacterDef) => void;
  onDelete: () => void;
}) {
  const [selectedAnchorId, setSelectedAnchorId] = useState("leftEye");
  const update = (patch: Partial<CharacterDef>) => onChange((current) => ({ ...current, ...patch }));
  const uploadFacePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      update({
        facePhoto: typeof reader.result === "string" ? reader.result : undefined,
        facePhotoAlignment: character.facePhotoAlignment ?? DEFAULT_FACE_ALIGNMENT,
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-3">
      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Character name"
            value={character.displayName}
            onChange={(event) => update({ displayName: event.target.value })}
            className="min-w-[12rem] flex-1 rounded-md border border-transparent bg-transparent px-1 py-1 text-2xl font-black text-white outline-none transition focus:border-amber-300/60 focus:bg-black/15"
          />
          <input
            type="color"
            aria-label="Character color"
            value={character.color ?? "#888888"}
            onChange={(event) => update({ color: event.target.value })}
            className="h-10 w-12 rounded-md border border-white/15 bg-[#151922] p-1"
          />
          <label className="flex h-10 items-center gap-2 rounded-md border border-white/10 bg-black/15 px-3 text-[0.68rem] font-black uppercase tracking-[0.1em] text-slate-300">
            <input
              type="checkbox"
              checked={Boolean(character.groom)}
              onChange={(event) => update({ groom: event.target.checked || undefined })}
              className="size-4 accent-amber-300"
            />
            Groom
          </label>
          <span className="rounded-md border border-white/10 bg-black/15 px-3 py-2 font-mono text-xs font-black text-slate-400">{character.id}</span>
          <button type="button" onClick={onDelete} className="builder-button danger compact" aria-label={`Delete ${characterDisplayName(character)}`}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </section>

      <section className="rounded-md border border-white/10 bg-white/[0.035] p-4">
        <CharacterPreviewer
          character={character}
          cosmetics={cosmetics}
          selectedAnchorId={selectedAnchorId}
          onSelectAnchor={setSelectedAnchorId}
          onFacePhotoUpload={uploadFacePhoto}
          onChange={update}
        />
      </section>

      <section className="rounded-md border border-white/10 bg-white/[0.035] p-4">
        <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-fuchsia-200">Defaults</p>
        <div className="mt-3 grid gap-3">
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

function CharacterPreviewer({
  character,
  cosmetics,
  selectedAnchorId,
  onSelectAnchor,
  onFacePhotoUpload,
  onChange,
}: {
  character: CharacterDef;
  cosmetics: Record<string, CosmeticDef>;
  selectedAnchorId: string;
  onSelectAnchor: (id: string) => void;
  onFacePhotoUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onChange: (patch: Partial<CharacterDef>) => void;
}) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const cropRef = useRef<HTMLDivElement | null>(null);
  const [sourceDraft, setSourceDraft] = useState("");
  const [previewRotation, setPreviewRotation] = useState<PreviewRotation>(DEFAULT_PREVIEW_ROTATION);
  const [previewTool, setPreviewTool] = useState<PreviewTool>("view");
  const [projectedAnchors, setProjectedAnchors] = useState<Record<string, ProjectedAnchor>>({});
  const [drag, setDrag] = useState<
    | { type: "image"; pointerId: number; startX: number; startY: number; alignment: FacePhotoAlignment }
    | { type: "anchor"; pointerId: number; anchor: AnchorHandle; startX: number; startY: number; anchorStart: FaceAnchor }
    | { type: "view"; pointerId: number; startX: number; startY: number; rotation: PreviewRotation }
    | null
  >(null);
  const alignment = character.facePhotoAlignment ?? DEFAULT_FACE_ALIGNMENT;
  const selectedHandle = ANCHOR_HANDLES.find((handle) => handle.id === selectedAnchorId) ?? ANCHOR_HANDLES[0];
  const selectedAnchor = anchorFor(character, selectedHandle);
  const uploadId = `face-photo-upload-${character.id}`;
  const hasFacePhoto = Boolean(character.facePhoto);
  const cosmeticEntries = useMemo(() => Object.values(cosmetics).sort((a, b) => a.name.localeCompare(b.name)), [cosmetics]);
  const selectedCosmeticIds = character.defaultLoadout?.cosmeticIds ?? [];
  const anchorProjectionInput = useMemo(
    () =>
      ANCHOR_HANDLES.map((handle) => ({
        handle,
        anchor: anchorFor(character, handle),
      })),
    [character.faceAnchors, character.bodyAnchors]
  );
  const updateProjectedAnchors = useCallback((next: Record<string, ProjectedAnchor>) => {
    setProjectedAnchors((current) => (sameProjectedAnchors(current, next) ? current : next));
  }, []);

  useEffect(() => {
    if (character.facePhoto) setSourceDraft("");
  }, [character.facePhoto]);

  const updateAlignment = (patch: Partial<FacePhotoAlignment>) => {
    onChange({ facePhotoAlignment: clampAlignment({ ...alignment, ...patch }) });
  };

  const updateAnchor = (handle: AnchorHandle, anchor: FaceAnchor) => {
    if (handle.scope === "face") {
      onChange({ faceAnchors: { ...(character.faceAnchors ?? {}), [handle.id]: clampAnchor(anchor) } });
      return;
    }
    onChange({ bodyAnchors: { ...(character.bodyAnchors ?? {}), [handle.id]: clampAnchor(anchor) } });
  };

  const beginImageDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!character.facePhoto) return;
    event.preventDefault();
    cropRef.current?.setPointerCapture(event.pointerId);
    setDrag({
      type: "image",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      alignment,
    });
  };

  const beginAnchorDrag = (event: ReactPointerEvent<HTMLButtonElement>, handle: AnchorHandle) => {
    if (previewTool !== "anchors") return;
    event.preventDefault();
    event.stopPropagation();
    setPreviewTool("anchors");
    onSelectAnchor(handle.id);
    previewRef.current?.setPointerCapture(event.pointerId);
    setDrag({
      type: "anchor",
      pointerId: event.pointerId,
      anchor: handle,
      startX: event.clientX,
      startY: event.clientY,
      anchorStart: anchorFor(character, handle),
    });
  };

  const beginPreviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    previewRef.current?.setPointerCapture(event.pointerId);
    setDrag({
      type: "view",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rotation: previewRotation,
    });
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = (drag.type === "image" ? cropRef.current : previewRef.current)?.getBoundingClientRect();
    if (!rect) return;
    if (drag.type === "image") {
      updateAlignment({
        x: drag.alignment.x + (event.clientX - drag.startX) / rect.width,
        y: drag.alignment.y + (event.clientY - drag.startY) / rect.height,
      });
      return;
    }
    if (drag.type === "view") {
      setPreviewRotation({
        yaw: drag.rotation.yaw + (event.clientX - drag.startX) * 0.012,
        pitch: clamp(drag.rotation.pitch + (event.clientY - drag.startY) * 0.008, -0.55, 0.55),
      });
      return;
    }
    updateAnchor(drag.anchor, {
      ...drag.anchorStart,
      x: drag.anchorStart.x + (event.clientX - drag.startX) / rect.width,
      y: drag.anchorStart.y + (event.clientY - drag.startY) / rect.height,
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const target = drag.type === "image" ? cropRef.current : previewRef.current;
    if (target?.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    setDrag(null);
  };

  const applySourceDraft = () => {
    const facePhoto = sourceDraft.trim();
    if (!facePhoto) return;
    onChange({ facePhoto, facePhotoAlignment: character.facePhotoAlignment ?? DEFAULT_FACE_ALIGNMENT });
  };

  const toggleCosmetic = (cosmeticId: string) => {
    const selected = new Set(selectedCosmeticIds);
    if (selected.has(cosmeticId)) selected.delete(cosmeticId);
    else selected.add(cosmeticId);
    onChange({
      defaultLoadout: {
        ...(character.defaultLoadout ?? {}),
        cosmeticIds: [...selected],
      },
      defaultCosmetics: undefined,
    });
  };

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(28rem,1fr)_21rem]">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-cyan-200">Preview</p>
            <h3 className="mt-1 text-lg font-black text-white">3D token</h3>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex overflow-hidden rounded-md border border-white/10 bg-black/20">
              <button
                type="button"
                data-preview-tool="view"
                onClick={() => setPreviewTool("view")}
                className={`flex items-center gap-1 border-r border-white/10 px-2 py-1 text-[0.58rem] font-black uppercase tracking-[0.1em] transition ${
                  previewTool === "view" ? "bg-cyan-300/16 text-cyan-100" : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Rotate3D className="h-3.5 w-3.5" />
                Move
              </button>
              <button
                type="button"
                data-preview-tool="anchors"
                onClick={() => setPreviewTool("anchors")}
                className={`flex items-center gap-1 px-2 py-1 text-[0.58rem] font-black uppercase tracking-[0.1em] transition ${
                  previewTool === "anchors" ? "bg-cyan-300/16 text-cyan-100" : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Crosshair className="h-3.5 w-3.5" />
                Anchors
              </button>
            </div>
            <div className="flex overflow-hidden rounded-md border border-white/10 bg-black/20">
              {PREVIEW_VIEWS.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  data-preview-view={view.id}
                  onClick={() => {
                    setPreviewTool("view");
                    setPreviewRotation({ yaw: view.yaw, pitch: view.pitch });
                  }}
                  className="border-r border-white/10 px-2 py-1 text-[0.58rem] font-black uppercase tracking-[0.1em] text-slate-300 transition last:border-r-0 hover:bg-white/10 hover:text-white"
                >
                  {view.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setPreviewTool("view");
                setPreviewRotation(DEFAULT_PREVIEW_ROTATION);
              }}
              className="builder-button compact"
              aria-label="Reset preview rotation"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div
          ref={previewRef}
          data-character-preview="true"
          onPointerDown={beginPreviewDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={`relative mt-3 h-[32rem] cursor-grab overflow-hidden rounded-md border border-white/15 bg-[radial-gradient(circle_at_50%_20%,rgba(103,232,249,0.14),rgba(15,23,42,0.95)_48%,rgba(2,6,23,1))] touch-none active:cursor-grabbing lg:h-[36rem] ${
            drag?.type === "anchor" ? "cursor-default active:cursor-default" : ""
          }`}
        >
          <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[0.58rem] font-black uppercase tracking-[0.12em] text-slate-300">
            <Rotate3D className="h-3.5 w-3.5 text-cyan-200" />
            {previewTool === "view" ? "Move" : selectedHandle.label}
          </div>

          <CharacterTokenCanvas
            character={character}
            previewRotation={previewRotation}
            anchorProjectionInput={anchorProjectionInput}
            onAnchorsProjected={updateProjectedAnchors}
          />

          {ANCHOR_HANDLES.map((handle) => {
            const anchor = anchorFor(character, handle);
            const projected = projectedAnchors[handle.id];
            const selected = handle.id === selectedHandle.id;
            return (
              <button
                key={handle.id}
                type="button"
                data-anchor-handle="true"
                data-anchor-id={handle.id}
                onPointerDown={(event) => beginAnchorDrag(event, handle)}
                className={`absolute z-10 grid size-7 place-items-center rounded-full border-2 text-[0.56rem] font-black text-slate-950 shadow-lg shadow-black/40 transition ${
                  selected ? "scale-110 border-white" : "border-black/45 hover:scale-105"
                } ${previewTool === "view" ? "pointer-events-none opacity-60" : ""}`}
                style={{
                  left: `${projected?.x ?? anchor.x * 100}%`,
                  top: `${projected?.y ?? anchor.y * 100}%`,
                  opacity: projected?.visible === false ? 0 : undefined,
                  pointerEvents: projected?.visible === false ? "none" : undefined,
                  background: ANCHOR_COLORS[handle.id] ?? "#f5d547",
                  transform: `translate(-50%, -50%) rotate(${anchor.angle ?? 0}deg)`,
                }}
                aria-label={handle.label}
              >
                <Crosshair className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <section className="rounded-md border border-white/10 bg-black/15 p-3">
          <input id={uploadId} type="file" accept="image/*" className="sr-only" onChange={onFacePhotoUpload} />
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-[0.62rem] font-black uppercase tracking-[0.18em] text-amber-200">Face photo</p>
            <label htmlFor={uploadId} className="builder-button gap-2">
              <ImagePlus className="h-4 w-4" />
              Upload
            </label>
            {!hasFacePhoto && (
              <>
                <input
                  aria-label="Image source"
                  value={sourceDraft}
                  placeholder="Paste URL"
                  onChange={(event) => setSourceDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applySourceDraft();
                  }}
                  className="h-8 min-w-0 flex-1 rounded-md border border-white/10 bg-[#151922] px-2 text-xs font-black text-white outline-none focus:border-amber-300"
                />
                <button type="button" onClick={applySourceDraft} disabled={!sourceDraft.trim()} className="builder-button compact disabled:opacity-40">
                  Use
                </button>
              </>
            )}
            {hasFacePhoto && (
              <span className="min-w-0 flex-1 truncate rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-xs font-black text-slate-300">
                Image loaded
              </span>
            )}
            <button
              type="button"
              disabled={!hasFacePhoto}
              onClick={() => onChange({ facePhoto: undefined, facePhotoAlignment: DEFAULT_FACE_ALIGNMENT })}
              className="builder-button danger disabled:opacity-40"
            >
              Clear
            </button>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-[7.5rem_minmax(0,1fr)] xl:grid-cols-1">
            <div
              ref={cropRef}
              data-face-crop="true"
              onPointerDown={beginImageDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className="relative aspect-square overflow-hidden rounded-md border border-white/10 bg-[#0d1218] touch-none"
            >
              {character.facePhoto ? (
                <img
                  src={character.facePhoto}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute max-w-none select-none object-contain"
                  style={{
                    left: `${alignment.x * 100}%`,
                    top: `${alignment.y * 100}%`,
                    width: `${alignment.scale * 100}%`,
                    transform: `translate(-50%, -50%) rotate(${alignment.angle ?? 0}deg)`,
                    transformOrigin: "center",
                  }}
                />
              ) : (
                <div className="grid h-full place-items-center px-3 text-center text-[0.62rem] font-black uppercase tracking-[0.14em] text-slate-600">
                  Upload face
                </div>
              )}
              <div className="pointer-events-none absolute inset-4 rounded-full border-2 border-dashed border-cyan-200/65 shadow-[0_0_0_999px_rgba(2,6,23,0.34)]" />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-cyan-200">Crop</p>
                <button type="button" onClick={() => onChange({ facePhotoAlignment: DEFAULT_FACE_ALIGNMENT })} className="builder-button compact gap-2">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </button>
              </div>
              <RangeInput label="Scale" min={0.35} max={2.4} step={0.01} value={alignment.scale} onChange={(scale) => updateAlignment({ scale })} />
              <RangeInput label="Rotation" min={-180} max={180} step={1} value={alignment.angle ?? 0} onChange={(angle) => updateAlignment({ angle })} />
              <div className="grid grid-cols-2 gap-2">
                <NumberInput label="X" value={alignment.x} step={0.01} onChange={(x) => updateAlignment({ x })} />
                <NumberInput label="Y" value={alignment.y} step={0.01} onChange={(y) => updateAlignment({ y })} />
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-md border border-white/10 bg-black/15 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-emerald-200">Anchors</p>
            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[0.58rem] font-black uppercase tracking-[0.1em] text-slate-400">
              {selectedHandle.label}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {ANCHOR_HANDLES.map((handle) => (
              <button
                key={handle.id}
                type="button"
                onClick={() => {
                  setPreviewTool("anchors");
                  onSelectAnchor(handle.id);
                }}
                className={`rounded-md border px-2 py-1.5 text-left text-[0.68rem] font-black transition ${
                  handle.id === selectedHandle.id
                    ? "border-white bg-white/16 text-white"
                    : "border-white/10 bg-white/[0.035] text-slate-300 hover:bg-white/[0.07]"
                }`}
              >
                {handle.label}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <NumberInput label="X" value={selectedAnchor.x} step={0.01} onChange={(x) => updateAnchor(selectedHandle, { ...selectedAnchor, x })} />
            <NumberInput label="Y" value={selectedAnchor.y} step={0.01} onChange={(y) => updateAnchor(selectedHandle, { ...selectedAnchor, y })} />
            <NumberInput
              label="Angle"
              value={selectedAnchor.angle ?? 0}
              step={1}
              onChange={(angle) => updateAnchor(selectedHandle, { ...selectedAnchor, angle })}
            />
          </div>
        </section>

        <section className="rounded-md border border-white/10 bg-black/15 p-3">
          <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-fuchsia-200">Accessories</p>
          <div className="mt-3 grid gap-2">
            {cosmeticEntries.map((cosmetic) => {
              const active = selectedCosmeticIds.includes(cosmetic.id);
              return (
                <button
                  key={cosmetic.id}
                  type="button"
                  onClick={() => toggleCosmetic(cosmetic.id)}
                  className={`rounded-md border px-2 py-1.5 text-left text-[0.68rem] font-black transition ${
                    active ? "border-fuchsia-200/80 bg-fuchsia-300/16 text-white" : "border-white/10 bg-white/[0.035] text-slate-300 hover:bg-white/[0.07]"
                  }`}
                >
                  <span className="block">{cosmetic.name}</span>
                  <span className="mt-0.5 block truncate text-[0.56rem] uppercase tracking-[0.08em] text-slate-500">
                    {cosmetic.anchor ?? cosmetic.assetId ?? cosmetic.id}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function CharacterTokenCanvas({
  character,
  previewRotation,
  anchorProjectionInput,
  onAnchorsProjected,
}: {
  character: CharacterDef;
  previewRotation: PreviewRotation;
  anchorProjectionInput: Array<{ handle: AnchorHandle; anchor: FaceAnchor }>;
  onAnchorsProjected: (anchors: Record<string, ProjectedAnchor>) => void;
}) {
  const tokenCharacter = useMemo(
    () => ({
      id: character.id,
      name: characterDisplayName(character),
      color: character.color ?? "#888888",
      groom: Boolean(character.groom),
    }),
    [character.color, character.groom, character.id, character.displayName, character.name]
  );

  return (
    <Canvas
      camera={{ position: [0, 1.05, 3.4], fov: 32, near: 0.1, far: 20 }}
      className="pointer-events-none absolute inset-0"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      shadows
    >
      <PreviewCamera />
      <ambientLight intensity={0.72} color="#fff8e1" />
      <directionalLight position={[3, 5, 4]} intensity={2.7} castShadow />
      <directionalLight position={[-3, 2, -3]} intensity={0.65} color="#b3d4ff" />
      <PreviewAnchorProjector
        anchors={anchorProjectionInput}
        previewRotation={previewRotation}
        onProject={onAnchorsProjected}
      />
      <group
        position={TOKEN_PREVIEW_GROUP_POSITION}
        rotation={[previewRotation.pitch, previewRotation.yaw, 0]}
        scale={TOKEN_PREVIEW_GROUP_SCALE}
      >
        <PlayerTokenPawn
          character={tokenCharacter}
          facePhoto={character.facePhoto}
          facePhotoAlignment={character.facePhotoAlignment ?? DEFAULT_FACE_ALIGNMENT}
          faceAnchors={character.faceAnchors}
          bodyAnchors={character.bodyAnchors}
          cosmeticIds={character.defaultLoadout?.cosmeticIds}
          focused
        />
      </group>
      <mesh position={[0, -0.84, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[1.24, 56]} />
        <meshStandardMaterial color="#0f172a" roughness={0.72} transparent opacity={0.58} />
      </mesh>
    </Canvas>
  );
}

function PreviewAnchorProjector({
  anchors,
  previewRotation,
  onProject,
}: {
  anchors: Array<{ handle: AnchorHandle; anchor: FaceAnchor }>;
  previewRotation: PreviewRotation;
  onProject: (anchors: Record<string, ProjectedAnchor>) => void;
}) {
  const { camera } = useThree();
  const anchorKey = useMemo(
    () => anchors.map(({ handle, anchor }) => `${handle.id}:${anchor.x}:${anchor.y}:${anchor.angle ?? 0}`).join("|"),
    [anchors]
  );

  useEffect(() => {
    camera.updateMatrixWorld();
    const rotation = new Euler(previewRotation.pitch, previewRotation.yaw, 0);
    const rotationQuaternion = new Quaternion().setFromEuler(rotation);
    const tokenMatrix = new Matrix4().compose(
      new Vector3(...TOKEN_PREVIEW_GROUP_POSITION),
      rotationQuaternion,
      new Vector3(TOKEN_PREVIEW_GROUP_SCALE, TOKEN_PREVIEW_GROUP_SCALE, TOKEN_PREVIEW_GROUP_SCALE)
    );
    const projected: Record<string, ProjectedAnchor> = {};

    for (const { handle, anchor } of anchors) {
      const surface = tokenAnchorSurface(handle, anchor);
      const worldPoint = new Vector3(...surface.position).applyMatrix4(tokenMatrix);
      const normal = new Vector3(...surface.normal).applyQuaternion(rotationQuaternion).normalize();
      const viewDirection = new Vector3().subVectors(camera.position, worldPoint).normalize();
      const clipPoint = worldPoint.clone().project(camera);
      projected[handle.id] = {
        x: ((clipPoint.x + 1) / 2) * 100,
        y: ((1 - clipPoint.y) / 2) * 100,
        visible: clipPoint.z >= -1 && clipPoint.z <= 1 && normal.dot(viewDirection) > -0.05,
      };
    }

    onProject(projected);
  }, [anchorKey, anchors, camera, onProject, previewRotation.pitch, previewRotation.yaw]);

  return null;
}

function PreviewCamera() {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, 1.05, 3.4);
    camera.lookAt(0, 0.16, 0);
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
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

function RangeInput({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mt-3 block text-[0.58rem] font-black uppercase tracking-[0.1em] text-slate-500">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <span className="font-mono text-slate-300">{Number.isFinite(value) ? value.toFixed(step < 1 ? 2 : 0) : "0"}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : min}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full accent-cyan-300"
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
    return withExampleCosmetics(normalizeContentSchema(JSON.parse(saved)));
  } catch {
    return BASE_CONTENT;
  }
}

function withExampleCosmetics(content: GameContent): GameContent {
  return {
    ...content,
    cosmetics: {
      ...EXAMPLE_COSMETICS,
      ...(content.cosmetics ?? {}),
    },
  };
}

function emptyCharacter(id: string): CharacterDef {
  return {
    id,
    displayName: "New character",
    color: "#f5d547",
    facePhotoAlignment: DEFAULT_FACE_ALIGNMENT,
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

function anchorFor(character: CharacterDef, handle: AnchorHandle): FaceAnchor {
  const anchors = handle.scope === "face" ? character.faceAnchors : character.bodyAnchors;
  return anchors?.[handle.id] ?? defaultAnchorFor(handle.id);
}

function defaultAnchorFor(id: string): FaceAnchor {
  return defaultTokenAnchor(id);
}

function clampAnchor(anchor: FaceAnchor): FaceAnchor {
  return {
    x: clamp(anchor.x, 0, 1),
    y: clamp(anchor.y, 0, 1),
    angle: Number.isFinite(anchor.angle ?? 0) ? anchor.angle : 0,
  };
}

function clampAlignment(alignment: FacePhotoAlignment): FacePhotoAlignment {
  return {
    x: clamp(alignment.x, -0.5, 1.5),
    y: clamp(alignment.y, -0.5, 1.5),
    scale: clamp(alignment.scale, 0.35, 2.4),
    angle: Number.isFinite(alignment.angle ?? 0) ? alignment.angle : 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function sameProjectedAnchors(a: Record<string, ProjectedAnchor>, b: Record<string, ProjectedAnchor>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return bKeys.every((key) => {
    const left = a[key];
    const right = b[key];
    return Boolean(
      left &&
        Math.abs(left.x - right.x) < 0.05 &&
        Math.abs(left.y - right.y) < 0.05 &&
        left.visible === right.visible
    );
  });
}
