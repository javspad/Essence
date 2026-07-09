import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Crosshair, Download, Home, Plus, Rotate3D, Save, Trash2, Upload, Wrench } from "lucide-react";
import type {
  CharacterDef,
  CosmeticAnchorRef,
  CosmeticAnchorType,
  CosmeticDef,
  CosmeticTransform,
  FaceAnchor,
  FacePhotoAlignment,
  GameContent,
} from "@essence/shared";
import { characterDisplayName } from "@essence/shared/characters";
import {
  BODY_COSMETIC_ANCHORS,
  FACE_COSMETIC_ANCHORS,
  cosmeticAnchorRefs,
  cosmeticAssetKind,
  defaultCosmeticAnchorsForKind,
  normalizeCosmeticDef,
} from "@essence/shared/cosmetics";
import { normalizeContentSchema } from "@essence/shared/contentValidation";
import seedContent from "@shared/content.json";
import {
  TokenPreviewCanvas,
  TokenPreviewMoveBadge,
  TokenPreviewViewControls,
  sameProjectedTokenAnchors,
  tokenPreviewAnchorForCharacter,
  tokenPreviewAnchorLabel,
  useTokenPreviewRotation,
  type ProjectedTokenAnchor,
  type TokenPreviewAnchorHandle,
} from "./TokenPreviewer";
import { contentWithCharacterList } from "./builderContent";
import { saveContentJsonToDisk } from "../lib/contentDiskSave";
import CosmeticGalleryOverlay from "./CosmeticGalleryOverlay";

const STORAGE_KEY = "essence:cosmetic-builder:draft:v1";
const KNOWN_BASE_COSMETICS_STORAGE_KEY = "essence:cosmetic-builder:known-base-cosmetics:v1";
const BASE_CONTENT = normalizeContentSchema(seedContent);
const DEFAULT_FACE_ALIGNMENT: FacePhotoAlignment = { x: 0.5, y: 0.5, scale: 1.08, angle: 0 };
const DEFAULT_ASSET_KINDS = [
  "goggles",
  "mustache",
  "mustache-handlebar",
  "mustache-pencil",
  "mustache-chaplin",
  "hat",
  "top-hat",
  "cap",
  "field-hat",
  "coin-crown",
  "beard",
  "piercing",
  "tattoo",
  "badge",
  "gold-chain",
  "dice-necklace",
  "wristwatch",
  "tuxedo",
  "pet-dog",
  "pet-cat",
  "custom",
] as const;
const ANCHOR_OPTIONS: Record<CosmeticAnchorType, string[]> = {
  face: [...FACE_COSMETIC_ANCHORS],
  body: [...BODY_COSMETIC_ANCHORS],
  token: ["center"],
};
export default function CosmeticBuilder() {
  const [content, setContent] = useState<GameContent>(() => loadInitialContent());
  const cosmeticIds = useMemo(() => Object.keys(content.cosmetics ?? {}), [content.cosmetics]);
  const characterIds = useMemo(() => Object.keys(content.characters ?? {}), [content.characters]);
  const assetKindOptions = useMemo(
    () => uniqueStrings([...DEFAULT_ASSET_KINDS, ...Object.values(content.cosmetics ?? {}).map((cosmetic) => cosmeticAssetKind(cosmetic))]),
    [content.cosmetics]
  );
  const [selectedCosmeticId, setSelectedCosmeticId] = useState(cosmeticIds[0] ?? "");
  const [selectedCharacterId, setSelectedCharacterId] = useState(characterIds[0] ?? "");
  const [jsonOpen, setJsonOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const selectedCosmetic = selectedCosmeticId ? content.cosmetics?.[selectedCosmeticId] : undefined;
  const selectedCharacter = selectedCharacterId ? content.characters?.[selectedCharacterId] : undefined;
  const exportJson = useMemo(() => JSON.stringify(normalizeContentSchema(content), null, 2), [content]);

  useEffect(() => {
    if (selectedCosmeticId && cosmeticIds.includes(selectedCosmeticId)) return;
    setSelectedCosmeticId(cosmeticIds[0] ?? "");
  }, [cosmeticIds, selectedCosmeticId]);

  useEffect(() => {
    if (selectedCharacterId && characterIds.includes(selectedCharacterId)) return;
    setSelectedCharacterId(characterIds[0] ?? "");
  }, [characterIds, selectedCharacterId]);

  useEffect(() => {
    rememberBaseCosmeticIds();
  }, []);

  useEffect(() => {
    if (!saveStatus) return;
    const timeout = window.setTimeout(() => setSaveStatus(""), 1600);
    return () => window.clearTimeout(timeout);
  }, [saveStatus]);

  const updateCosmetic = (id: string, updater: (cosmetic: CosmeticDef) => CosmeticDef) => {
    setContent((current) => {
      const currentCosmetic = current.cosmetics?.[id] ?? emptyCosmetic(id);
      const next = normalizeCosmeticDef(updater(currentCosmetic), id);
      return {
        ...current,
        cosmetics: {
          ...(current.cosmetics ?? {}),
          [id]: next,
        },
      };
    });
  };

  const createCosmetic = () => {
    const id = nextId("cosmetic", content.cosmetics ?? {});
    setContent((current) => ({
      ...current,
      cosmetics: {
        ...(current.cosmetics ?? {}),
        [id]: emptyCosmetic(id),
      },
    }));
    setSelectedCosmeticId(id);
    setSaveStatus("Created");
  };

  const deleteCosmetic = (id: string) => {
    const cosmetic = content.cosmetics?.[id];
    if (!cosmetic) return;
    if (!window.confirm(`Delete "${cosmetic.name}"?`)) return;
    setContent((current) => {
      const { [id]: _deleted, ...cosmetics } = current.cosmetics ?? {};
      const characters = Object.fromEntries(
        Object.entries(current.characters ?? {}).map(([characterId, character]) => [
          characterId,
          removeDefaultCosmetic(character, id),
        ])
      );
      return { ...current, cosmetics, characters };
    });
    setSaveStatus("Deleted");
  };

  const importJson = () => {
    try {
      const parsed = JSON.parse(importText);
      const next = cosmeticBuilderContentFrom(isFullContent(parsed) ? parsed : { ...BASE_CONTENT, ...parsed });
      setContent(next);
      setSelectedCosmeticId(Object.keys(next.cosmetics ?? {})[0] ?? "");
      setSelectedCharacterId(Object.keys(next.characters ?? {})[0] ?? "");
      setImportText("");
      setJsonOpen(false);
      setSaveStatus("Imported");
    } catch {
      window.alert("JSON invalido");
    }
  };

  const resetDraft = () => {
    const saved = loadSavedCosmeticContent();
    const next = saved ?? cosmeticBuilderContentFrom(BASE_CONTENT);
    rememberBaseCosmeticIds();
    setContent(next);
    setSelectedCosmeticId(Object.keys(next.cosmetics ?? {})[0] ?? "");
    setSelectedCharacterId(Object.keys(next.characters ?? {})[0] ?? "");
    setImportText("");
    setJsonOpen(false);
    setSaveStatus(saved ? "Recovered browser draft" : "Loaded content.json");
  };

  const copyJson = async () => {
    await navigator.clipboard?.writeText(exportJson);
    setSaveStatus("Copied");
  };

  const saveDraft = async () => {
    const stored = persistCosmeticDraft(exportJson);
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
    anchor.download = "content.cosmetic-builder.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setSaveStatus("Downloaded");
  };

  return (
    <main data-cosmetic-builder="true" className="flex min-h-dvh flex-col bg-[#0d141b] text-slate-100 lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <header className="flex flex-none flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#121a24]/98 px-4 py-3 shadow-lg shadow-black/25">
        <div className="min-w-0">
          <p className="text-[0.58rem] font-black uppercase tracking-[0.2em] text-cyan-200">Essence tools</p>
          <h1 className="truncate text-xl font-black tracking-normal text-white">Cosmetic builder</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button onClick={saveDraft} className="builder-button preview gap-2">
            <Save className="h-4 w-4" />
            Save
          </button>
          <button onClick={() => setJsonOpen(true)} className="builder-button preview gap-2">
            <Upload className="h-4 w-4" />
            Import/export
          </button>
          <button onClick={downloadJson} className="builder-button gap-2">
            <Download className="h-4 w-4" />
            Download
          </button>
          <button onClick={() => setGalleryOpen(true)} className="builder-button preview gap-2">
            <Rotate3D className="h-4 w-4" />
            3D gallery
          </button>
          <span className="min-w-16 text-center text-xs font-black text-cyan-200">{saveStatus}</span>
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
        <aside className="flex flex-col border-b border-white/10 bg-[#0f1722] p-3 lg:min-h-0 lg:border-b-0 lg:border-r">
          <PanelHeader eyebrow={`${cosmeticIds.length} cosmetics`} title="Catalog" action={createCosmetic} />
          <div className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto pr-1 lg:min-h-0 lg:max-h-none lg:flex-1">
            {cosmeticIds.map((id) => {
              const cosmetic = content.cosmetics?.[id];
              if (!cosmetic) return null;
              return (
                <button
                  key={id}
                  type="button"
                  data-cosmetic-id={id}
                  onClick={() => setSelectedCosmeticId(id)}
                  className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md border p-2 text-left transition ${
                    id === selectedCosmeticId ? "border-cyan-200/70 bg-cyan-300/12" : "border-white/10 bg-white/[0.035] hover:bg-white/[0.06]"
                  }`}
                >
                  <CosmeticSwatch cosmetic={cosmetic} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black text-white">{cosmetic.name}</span>
                    <span className="block truncate text-[0.56rem] font-black uppercase tracking-[0.08em] text-slate-500">
                      {cosmeticAnchorSummary(cosmetic)}
                    </span>
                  </span>
                  <span className="font-mono text-[0.62rem] font-black text-amber-200">{cosmetic.price}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="bg-[#141d29] p-3 lg:min-h-0 lg:overflow-y-auto">
          {selectedCosmetic ? (
            <CosmeticEditor
              content={content}
              cosmetic={selectedCosmetic}
              selectedCharacterId={selectedCharacterId}
              setSelectedCharacterId={setSelectedCharacterId}
              previewCharacter={selectedCharacter}
              assetKindOptions={assetKindOptions}
              onChange={(updater) => updateCosmetic(selectedCosmetic.id, updater)}
              onDelete={() => deleteCosmetic(selectedCosmetic.id)}
            />
          ) : (
            <EmptyState label="Create a cosmetic to start editing." />
          )}
        </section>
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

      {galleryOpen && (
        <CosmeticGalleryOverlay
          cosmetics={Object.values(content.cosmetics ?? {})}
          characters={content.characters ?? {}}
          selectedCosmeticId={selectedCosmeticId}
          selectedCharacterId={selectedCharacterId}
          onSelectCosmetic={setSelectedCosmeticId}
          onSelectCharacter={setSelectedCharacterId}
          onClose={() => setGalleryOpen(false)}
        />
      )}
    </main>
  );
}

function CosmeticEditor({
  content,
  cosmetic,
  selectedCharacterId,
  setSelectedCharacterId,
  previewCharacter,
  assetKindOptions,
  onChange,
  onDelete,
}: {
  content: GameContent;
  cosmetic: CosmeticDef;
  selectedCharacterId: string;
  setSelectedCharacterId: (id: string) => void;
  previewCharacter?: CharacterDef;
  assetKindOptions: readonly string[];
  onChange: (updater: (cosmetic: CosmeticDef) => CosmeticDef) => void;
  onDelete: () => void;
}) {
  const { previewRef, previewRotation, setPreviewRotation, beginPreviewDrag, movePreviewDrag, endPreviewDrag } = useTokenPreviewRotation();
  const characterIds = Object.keys(content.characters ?? {});
  const [showAnchors, setShowAnchors] = useState(true);
  const [projectedAnchors, setProjectedAnchors] = useState<Record<string, ProjectedTokenAnchor>>({});
  const anchors = cosmeticAnchorRefs(cosmetic);
  const primaryAnchor = anchors[0] ?? { anchorType: "body" as const, anchorId: "chest" };
  const secondaryAnchor = anchors[1];
  const cosmeticAnchorProjectionInput = useMemo(
    () => (previewCharacter ? cosmeticAnchorProjectionAnchors(previewCharacter, anchors) : []),
    [anchors, previewCharacter]
  );
  const updateProjectedAnchors = useCallback((next: Record<string, ProjectedTokenAnchor>) => {
    setProjectedAnchors((current) => (sameProjectedTokenAnchors(current, next) ? current : next));
  }, []);
  const update = (patch: Partial<CosmeticDef>) => onChange((current) => normalizeCosmeticDef({ ...current, ...patch }, current.id));
  const updateTransform = (patch: Partial<CosmeticTransform>) => update({ transform: { ...(cosmetic.transform ?? {}), ...patch } });
  const updateAssetKind = (kind: string) => {
    const asset = typeof cosmetic.asset === "string" ? { kind } : { ...cosmetic.asset, kind };
    const nextAnchors = defaultCosmeticAnchorsForKind(kind);
    const nextPrimary = nextAnchors[0] ?? primaryAnchor;
    update({ asset, assetId: kind, anchors: nextAnchors, anchorType: nextPrimary.anchorType, anchorId: nextPrimary.anchorId, anchor: nextPrimary.anchorId });
  };
  const updateAnchorList = (nextAnchors: CosmeticAnchorRef[]) => {
    const nextPrimary = nextAnchors[0] ?? primaryAnchor;
    update({ anchors: nextAnchors, anchorType: nextPrimary.anchorType, anchorId: nextPrimary.anchorId, anchor: nextPrimary.anchorId });
  };
  const updateAnchorAt = (index: number, patch: Partial<CosmeticAnchorRef>) => {
    const current = anchors[index] ?? defaultAnchorForIndex(cosmeticAssetKind(cosmetic), index, primaryAnchor);
    const nextType = patch.anchorType ?? current.anchorType;
    const nextAnchorId = patch.anchorId ?? (patch.anchorType ? defaultAnchorId(nextType, current.anchorId) : current.anchorId);
    const nextAnchors = [...anchors];
    nextAnchors[index] = { ...current, ...patch, anchorType: nextType, anchorId: nextAnchorId };
    updateAnchorList(nextAnchors.slice(0, Math.max(1, anchors.length, index + 1)));
  };
  const toggleSecondAnchor = (enabled: boolean) => {
    if (!enabled) {
      updateAnchorList([primaryAnchor]);
      return;
    }
    updateAnchorList([primaryAnchor, secondaryAnchor ?? defaultAnchorForIndex(cosmeticAssetKind(cosmetic), 1, primaryAnchor)]);
  };
  const toggleCompatibleCharacter = (characterId: string) => {
    const current = new Set(cosmetic.compatibility?.characterIds ?? []);
    if (current.has(characterId)) current.delete(characterId);
    else current.add(characterId);
    update({
      compatibility: {
        ...(cosmetic.compatibility ?? {}),
        characterIds: current.size ? [...current] : undefined,
      },
    });
  };

  return (
    <div className="mx-auto grid max-w-7xl gap-3 xl:grid-cols-[minmax(28rem,1fr)_25rem]">
      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Cosmetic name"
            value={cosmetic.name}
            onChange={(event) => update({ name: event.target.value })}
            className="min-w-[12rem] flex-1 rounded-md border border-transparent bg-transparent px-1 py-1 text-2xl font-black text-white outline-none transition focus:border-cyan-300/60 focus:bg-black/15"
          />
          <span className="rounded-md border border-white/10 bg-black/15 px-3 py-2 font-mono text-xs font-black text-slate-400">{cosmetic.id}</span>
          <button type="button" onClick={onDelete} className="builder-button danger compact" aria-label={`Delete ${cosmetic.name}`}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <TextInput label="Description" value={cosmetic.description ?? ""} onChange={(description) => update({ description })} />
          <NumberInput label="Price" value={cosmetic.price} step={1} onChange={(price) => update({ price: Math.max(0, price) })} />
          <SelectInput label="Asset" value={cosmeticAssetKind(cosmetic)} options={assetKindOptions} onChange={updateAssetKind} />
          <TextInput label="Tags" value={(cosmetic.tags ?? []).join(", ")} onChange={(value) => update({ tags: csv(value) })} />
          <SelectInput
            label="Anchor A type"
            value={primaryAnchor.anchorType}
            options={["face", "body", "token"]}
            onChange={(value) => updateAnchorAt(0, { anchorType: value as CosmeticAnchorType })}
          />
          <SelectInput
            label="Anchor A"
            value={primaryAnchor.anchorId}
            options={ANCHOR_OPTIONS[primaryAnchor.anchorType] ?? ANCHOR_OPTIONS.body}
            onChange={(anchorId) => updateAnchorAt(0, { anchorId })}
          />
          <label className="flex min-h-16 items-center gap-2 rounded-md border border-white/10 bg-[#151922] px-2 py-1.5 text-[0.58rem] font-black uppercase tracking-[0.1em] text-slate-300">
            <input type="checkbox" checked={Boolean(secondaryAnchor)} onChange={(event) => toggleSecondAnchor(event.target.checked)} className="size-4 accent-cyan-300" />
            <span>Second anchor</span>
          </label>
          {secondaryAnchor ? (
            <>
              <SelectInput
                label="Anchor B type"
                value={secondaryAnchor.anchorType}
                options={["face", "body", "token"]}
                onChange={(value) => updateAnchorAt(1, { anchorType: value as CosmeticAnchorType })}
              />
              <SelectInput
                label="Anchor B"
                value={secondaryAnchor.anchorId}
                options={ANCHOR_OPTIONS[secondaryAnchor.anchorType] ?? ANCHOR_OPTIONS.body}
                onChange={(anchorId) => updateAnchorAt(1, { anchorId })}
              />
            </>
          ) : null}
          <ColorInput
            label="Primary"
            value={cosmetic.preview?.color ?? assetColor(cosmetic, "color") ?? "#f5d547"}
            onChange={(color) => update({ preview: { ...(cosmetic.preview ?? {}), color } })}
          />
          <ColorInput
            label="Secondary"
            value={cosmetic.preview?.secondaryColor ?? assetColor(cosmetic, "secondaryColor") ?? "#67e8f9"}
            onChange={(secondaryColor) => update({ preview: { ...(cosmetic.preview ?? {}), secondaryColor } })}
          />
        </div>
      </section>

      <section className="row-span-3 rounded-md border border-white/10 bg-white/[0.035] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-cyan-200">Preview</p>
            <h2 className="mt-1 text-lg font-black text-white">Anchored token</h2>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <TokenPreviewViewControls setPreviewRotation={setPreviewRotation} />
            <button
              type="button"
              aria-pressed={showAnchors}
              onClick={() => setShowAnchors((value) => !value)}
              className={`builder-button compact gap-2 ${showAnchors ? "preview" : ""}`}
            >
              <Crosshair className="h-3.5 w-3.5" />
              Anchors
            </button>
            <select
              aria-label="Preview character"
              value={selectedCharacterId}
              onChange={(event) => setSelectedCharacterId(event.target.value)}
              className="rounded-md border border-white/10 bg-[#151922] px-2 py-1.5 text-xs font-black text-white outline-none focus:border-cyan-300"
            >
              {characterIds.map((id) => (
                <option key={id} value={id}>
                  {characterDisplayName(content.characters?.[id] ?? { id, displayName: id })}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div
          ref={previewRef}
          data-cosmetic-preview="true"
          onPointerDown={beginPreviewDrag}
          onPointerMove={movePreviewDrag}
          onPointerUp={endPreviewDrag}
          onPointerCancel={endPreviewDrag}
          className="relative mt-3 h-[32rem] cursor-grab overflow-hidden rounded-md border border-white/15 bg-[radial-gradient(circle_at_50%_20%,rgba(34,211,238,0.13),rgba(15,23,42,0.95)_48%,rgba(2,6,23,1))] touch-none active:cursor-grabbing"
        >
          <TokenPreviewMoveBadge />
          {previewCharacter ? (
            <TokenPreviewCanvas
              character={previewCharacter}
              cosmetics={content.cosmetics ?? {}}
              cosmeticIds={[cosmetic.id]}
              previewRotation={previewRotation}
              facePhotoAlignmentFallback={DEFAULT_FACE_ALIGNMENT}
              anchorProjectionInput={showAnchors ? cosmeticAnchorProjectionInput : []}
              onAnchorsProjected={updateProjectedAnchors}
            />
          ) : null}
          {showAnchors
            ? cosmeticAnchorProjectionInput.map((anchor, index) => {
                const projected = projectedAnchors[anchor.handle.id];
                return (
                  <span
                    key={`${anchor.handle.scope}:${anchor.handle.id}:${index}`}
                    data-cosmetic-anchor-marker="true"
                    className="pointer-events-none absolute z-10 grid size-7 place-items-center rounded-full border-2 border-[#0f172a] text-[0.56rem] font-black text-[#0f172a] shadow-lg shadow-black/40"
                    style={{
                      left: `${projected?.x ?? anchor.anchor.x * 100}%`,
                      top: `${projected?.y ?? anchor.anchor.y * 100}%`,
                      opacity: projected?.visible === false ? 0 : 0.9,
                      background: index === 0 ? "#ff3ea5" : "#facc15",
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    {index + 1}
                  </span>
                );
              })
            : null}
        </div>
      </section>

      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-emerald-200">Anchor placement</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <NumberInput label="Offset X" value={cosmetic.transform?.x ?? 0} step={0.01} onChange={(x) => updateTransform({ x })} />
          <NumberInput label="Offset Y" value={cosmetic.transform?.y ?? 0} step={0.01} onChange={(y) => updateTransform({ y })} />
          <NumberInput label="Depth" value={cosmetic.transform?.z ?? 0} step={0.01} onChange={(z) => updateTransform({ z })} />
          <NumberInput label="Scale" value={cosmetic.transform?.scale ?? 1} step={0.05} onChange={(scale) => updateTransform({ scale: Math.max(0.05, scale) })} />
          <NumberInput label="Stretch X" value={cosmetic.transform?.scaleX ?? 1} step={0.05} onChange={(scaleX) => updateTransform({ scaleX: Math.max(0.05, scaleX) })} />
          <NumberInput label="Stretch Y" value={cosmetic.transform?.scaleY ?? 1} step={0.05} onChange={(scaleY) => updateTransform({ scaleY: Math.max(0.05, scaleY) })} />
          <NumberInput label="Rotation" value={cosmetic.transform?.rotation ?? 0} step={1} onChange={(rotation) => updateTransform({ rotation })} />
        </div>
      </section>

      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-amber-200">Compatibility</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {characterIds.map((id) => {
            const character = content.characters?.[id];
            const checked = cosmetic.compatibility?.characterIds?.includes(id) ?? false;
            return (
              <label key={id} className="flex items-center gap-2 rounded-md border border-white/10 bg-black/15 px-2 py-1.5 text-xs font-black text-slate-300">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleCompatibleCharacter(id)}
                  className="size-4 accent-cyan-300"
                />
                <span className="min-w-0 truncate">{character ? characterDisplayName(character) : id}</span>
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function cosmeticAnchorProjectionAnchors(
  character: CharacterDef,
  anchors: CosmeticAnchorRef[]
): Array<{ handle: TokenPreviewAnchorHandle; anchor: FaceAnchor }> {
  return anchors.flatMap((anchor) => {
    if (anchor.anchorType === "token") return [];
    const handle: TokenPreviewAnchorHandle = {
      id: anchor.anchorId,
      label: anchor.label ?? tokenPreviewAnchorLabel(anchor.anchorId),
      scope: anchor.anchorType,
    };
    return [{ handle, anchor: tokenPreviewAnchorForCharacter(character, handle) }];
  });
}

function defaultAnchorForIndex(kind: string, index: number, primary: CosmeticAnchorRef): CosmeticAnchorRef {
  const defaults = defaultCosmeticAnchorsForKind(kind);
  const defaultAnchor = defaults[index] ?? defaults.find((anchor) => !sameAnchorRef(anchor, primary));
  if (defaultAnchor) return { ...defaultAnchor };
  const options = ANCHOR_OPTIONS[primary.anchorType] ?? ANCHOR_OPTIONS.body;
  return { anchorType: primary.anchorType, anchorId: options.find((anchorId) => anchorId !== primary.anchorId) ?? primary.anchorId };
}

function defaultAnchorId(anchorType: CosmeticAnchorType, currentAnchorId: string): string {
  const options = ANCHOR_OPTIONS[anchorType] ?? ANCHOR_OPTIONS.body;
  return options.includes(currentAnchorId) ? currentAnchorId : options[0] ?? "chest";
}

function cosmeticAnchorSummary(cosmetic: CosmeticDef): string {
  return cosmeticAnchorRefs(cosmetic)
    .map((anchor) => `${anchor.anchorType}:${anchor.anchorId}`)
    .join(" + ");
}

function sameAnchorRef(a: CosmeticAnchorRef, b: CosmeticAnchorRef): boolean {
  return a.anchorType === b.anchorType && a.anchorId === b.anchorId;
}

function PanelHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p>
        <h2 className="truncate text-base font-black text-white">{title}</h2>
      </div>
      <button onClick={action} className="builder-button compact gap-2" aria-label={`Create ${title}`}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-[0.58rem] font-black uppercase tracking-[0.1em] text-slate-500">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-white/10 bg-[#151922] px-2 py-1.5 text-xs font-black normal-case tracking-normal text-white outline-none focus:border-cyan-300"
      />
    </label>
  );
}

function NumberInput({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (value: number) => void }) {
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

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-[0.58rem] font-black uppercase tracking-[0.1em] text-slate-500">
      {label}
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#151922] p-1"
      />
    </label>
  );
}

function SelectInput({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-[0.58rem] font-black uppercase tracking-[0.1em] text-slate-500">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-white/10 bg-[#151922] px-2 py-1.5 text-xs font-black text-white outline-none focus:border-cyan-300"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
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
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-slate-300">Cosmetic JSON</h2>
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
                placeholder="Paste a content JSON or a cosmetics fragment"
                className="mt-1 h-72 w-full resize-none rounded-md border border-white/10 bg-[#0d1218] p-2 font-mono text-xs text-slate-100 outline-none focus:border-cyan-300"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={onImport} disabled={!importText.trim()} className="builder-button gap-2 disabled:opacity-40">
                <Upload className="h-4 w-4" />
                Import
              </button>
              <button type="button" onClick={onReset} className="builder-button danger">
                Recover browser draft
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
              <button type="button" onClick={onCopy} className="builder-button gap-2">
                <Copy className="h-4 w-4" />
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

function CosmeticSwatch({ cosmetic }: { cosmetic: CosmeticDef }) {
  const primary = cosmetic.preview?.color ?? assetColor(cosmetic, "color") ?? "#f5d547";
  const secondary = cosmetic.preview?.secondaryColor ?? assetColor(cosmetic, "secondaryColor") ?? "#67e8f9";
  return (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 place-items-center rounded-sm border border-white/15 text-[0.55rem] font-black uppercase text-[#0d141b]"
      style={{ background: `linear-gradient(135deg, ${primary}, ${secondary})` }}
    >
      {cosmeticAssetKind(cosmetic).slice(0, 2)}
    </span>
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
  return cosmeticBuilderContentFrom(BASE_CONTENT);
}

function loadSavedCosmeticContent(): GameContent | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? cosmeticBuilderContentFrom(JSON.parse(saved), { hydrateMissingBaseCosmetics: true }) : null;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function persistCosmeticDraft(exportJson: string): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, exportJson);
    return true;
  } catch (error) {
    console.warn("Unable to persist cosmetic builder browser draft", error);
    return false;
  }
}

function cosmeticBuilderContentFrom(input: unknown, options: { hydrateMissingBaseCosmetics?: boolean } = {}): GameContent {
  const imported = normalizeContentSchema(input);
  const characterContent = currentCharacterContent();
  const characters = characterContent.characters ?? {};
  const characterIds = new Set(Object.keys(characters));
  const importedCosmetics = options.hydrateMissingBaseCosmetics
    ? hydrateMissingBaseCosmetics(imported.cosmetics ?? {})
    : imported.cosmetics ?? {};
  const cosmetics = cosmeticsForCurrentCharacters(importedCosmetics, characterIds);
  return normalizeContentSchema({
    ...BASE_CONTENT,
    players: characterContent.players ?? BASE_CONTENT.players,
    characters: charactersForCosmetics(characters, cosmetics),
    cosmetics,
  });
}

function hydrateMissingBaseCosmetics(cosmetics: Record<string, CosmeticDef>): Record<string, CosmeticDef> {
  const knownBaseIds = readKnownBaseCosmeticIds();
  const next = { ...cosmetics };
  for (const [id, cosmetic] of Object.entries(BASE_CONTENT.cosmetics ?? {})) {
    if (next[id] || knownBaseIds.has(id)) continue;
    next[id] = cosmetic;
  }
  return next;
}

function readKnownBaseCosmeticIds(): Set<string> {
  try {
    const saved = localStorage.getItem(KNOWN_BASE_COSMETICS_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function rememberBaseCosmeticIds() {
  try {
    localStorage.setItem(KNOWN_BASE_COSMETICS_STORAGE_KEY, JSON.stringify(Object.keys(BASE_CONTENT.cosmetics ?? {})));
  } catch {
    // The builder still works without the migration marker; old drafts may hydrate again.
  }
}

function currentCharacterContent(): GameContent {
  return contentWithCharacterList(BASE_CONTENT, BASE_CONTENT);
}

function cosmeticsForCurrentCharacters(
  cosmetics: Record<string, CosmeticDef>,
  characterIds: Set<string>
): Record<string, CosmeticDef> {
  return Object.fromEntries(
    Object.entries(cosmetics).map(([id, cosmetic]) => {
      const compatibleIds = cosmetic.compatibility?.characterIds?.filter((characterId) => characterIds.has(characterId));
      const excludedIds = cosmetic.compatibility?.excludeCharacterIds?.filter((characterId) => characterIds.has(characterId));
      const tags = cosmetic.compatibility?.tags;
      const compatibility =
        compatibleIds?.length || excludedIds?.length || tags?.length
          ? {
              ...(cosmetic.compatibility ?? {}),
              characterIds: compatibleIds?.length ? compatibleIds : undefined,
              excludeCharacterIds: excludedIds?.length ? excludedIds : undefined,
            }
          : undefined;
      return [id, normalizeCosmeticDef({ ...cosmetic, compatibility }, id)];
    })
  );
}

function charactersForCosmetics(
  characters: Record<string, CharacterDef>,
  cosmetics: Record<string, CosmeticDef>
): Record<string, CharacterDef> {
  const cosmeticIds = new Set(Object.keys(cosmetics));
  return Object.fromEntries(
    Object.entries(characters).map(([id, character]) => [
      id,
      {
        ...character,
        defaultLoadout: character.defaultLoadout
          ? {
              ...character.defaultLoadout,
              cosmeticIds: (character.defaultLoadout.cosmeticIds ?? []).filter((cosmeticId) => cosmeticIds.has(cosmeticId)),
            }
          : undefined,
        defaultCosmetics: character.defaultCosmetics?.filter((cosmeticId) => cosmeticIds.has(cosmeticId)),
      },
    ])
  );
}

function emptyCosmetic(id: string): CosmeticDef {
  return {
    id,
    name: "New cosmetic",
    description: "",
    price: 0,
    asset: { kind: "badge", color: "#f5d547", secondaryColor: "#67e8f9" },
    anchors: [{ anchorType: "body", anchorId: "chest" }],
    anchorType: "body",
    anchorId: "chest",
    transform: { z: 0.04, scale: 1 },
    preview: { color: "#f5d547", secondaryColor: "#67e8f9", order: 100 },
    tags: [],
  };
}

function removeDefaultCosmetic(character: CharacterDef, cosmeticId: string): CharacterDef {
  const cosmeticIds = (character.defaultLoadout?.cosmeticIds ?? []).filter((id) => id !== cosmeticId);
  return {
    ...character,
    defaultLoadout: {
      ...(character.defaultLoadout ?? {}),
      cosmeticIds,
    },
    defaultCosmetics: undefined,
  };
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

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function assetColor(cosmetic: CosmeticDef, key: "color" | "secondaryColor"): string | undefined {
  return typeof cosmetic.asset === "string" ? undefined : cosmetic.asset[key];
}

function csv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isFullContent(value: unknown): value is GameContent {
  return Boolean(value && typeof value === "object" && "board" in value && "players" in value);
}
