import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, ImagePlus, Images, Save, Search, Trash2, X } from "lucide-react";
import type { ContentMediaAssetDef, GameContent } from "@essence/shared";
import seedContent from "@shared/content.json";
import { normalizeContentSchema } from "@essence/shared/contentValidation";
import { saveContentJsonToDisk } from "../lib/contentDiskSave";
import { ActivityMediaFigure } from "./ActivityMedia";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const STORAGE_KEY = "essence:event-builder:draft:v1";

export function mediaAssetName(asset: ContentMediaAssetDef | undefined, fallbackId = "Untitled image"): string {
  return asset?.alt?.trim() || asset?.caption?.trim() || fallbackId;
}

export function MediaAssetPickerModal({
  assets,
  onChoose,
  onUpload,
  onClose,
}: {
  assets?: Record<string, ContentMediaAssetDef>;
  onChoose: (assetId: string) => void;
  onUpload: (file: File) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const uploadId = useId();
  const entries = useMemo(
    () =>
      Object.entries(assets ?? {}).filter(([id, asset]) => {
        const haystack = `${id} ${asset.alt ?? ""} ${asset.caption ?? ""}`.toLocaleLowerCase();
        return haystack.includes(query.trim().toLocaleLowerCase());
      }),
    [assets, query]
  );

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const addFiles = (files: File[]) => {
    const imageFiles = files.filter(isImageFile);
    imageFiles.forEach(onUpload);
    if (imageFiles.length) onClose();
  };
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = filesFromDataTransfer(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const files = filesFromDataTransfer(event.dataTransfer);
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="asset-picker-title" className="flex max-h-[min(46rem,calc(100dvh-1.5rem))] w-[min(58rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-white/10 bg-[#111722] shadow-2xl shadow-black/60">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#161b26] px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Image catalog</p>
            <h2 id="asset-picker-title" className="mt-1 truncate text-lg font-black text-white">Choose an image</h2>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close image catalog" title="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="min-h-0 overflow-y-auto p-4">
          <div
            tabIndex={0}
            onPaste={onPaste}
            onDrop={onDrop}
            onDragOver={(event) => event.preventDefault()}
            className="grid gap-3 border border-dashed border-cyan-200/45 bg-cyan-300/10 p-3 outline-none focus:border-cyan-200 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          >
            <div>
              <p className="text-sm font-black text-white">Add a new image</p>
              <p className="mt-1 text-xs font-bold leading-5 text-cyan-100/80">Paste or drop an image here. It is added to the library and attached to this event.</p>
            </div>
            <div>
              <input id={uploadId} type="file" accept="image/*" multiple className="sr-only" onChange={onFileChange} />
              <Button asChild type="button" variant="outline" size="sm">
                <label htmlFor={uploadId} className="cursor-pointer">
                  <ImagePlus />
                  Upload image
                </label>
              </Button>
            </div>
          </div>

          <label className="mt-4 block">
            <span className="sr-only">Search image catalog</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search images" className="h-10 border-[#52466a] bg-[#0d121b] pl-10 text-sm text-white placeholder:text-slate-500" />
            </div>
          </label>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map(([id, asset]) => (
              <button key={id} type="button" onClick={() => onChoose(id)} className="group overflow-hidden border border-white/10 bg-black/20 text-left transition hover:border-cyan-200/70 hover:bg-cyan-300/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">
                <ActivityMediaFigure asset={asset} refDef={{ assetId: id }} compact surface="tool" />
                <span className="block truncate px-3 py-2 text-sm font-black text-white">{mediaAssetName(asset, id)}</span>
              </button>
            ))}
          </div>
          {entries.length === 0 && <p className="mt-4 border border-dashed border-white/10 p-5 text-center text-sm font-bold text-slate-400">No images match that search.</p>}
        </div>
      </section>
    </div>
  );
}

export default function MediaAssetLibrary() {
  const [content, setContent] = useState<GameContent>(() => loadInitialContent());
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const uploadId = useId();
  const assetEntries = useMemo(
    () =>
      Object.entries(content.mediaAssets ?? {}).filter(([id, asset]) => {
        const haystack = `${id} ${asset.alt ?? ""} ${asset.caption ?? ""}`.toLocaleLowerCase();
        return haystack.includes(query.trim().toLocaleLowerCase());
      }),
    [content.mediaAssets, query]
  );
  const selected = content.mediaAssets?.[selectedId];
  const selectedUsage = selectedId ? mediaAssetUsageCount(content, selectedId) : 0;

  useEffect(() => {
    const ids = Object.keys(content.mediaAssets ?? {});
    if (selectedId && ids.includes(selectedId)) return;
    setSelectedId(ids[0] ?? "");
  }, [content.mediaAssets, selectedId]);

  useEffect(() => {
    if (!saveStatus) return;
    const timeout = window.setTimeout(() => setSaveStatus(""), 1800);
    return () => window.clearTimeout(timeout);
  }, [saveStatus]);

  const updateAsset = (assetId: string, patch: Partial<ContentMediaAssetDef>) => {
    setContent((current) => {
      const asset = current.mediaAssets?.[assetId];
      if (!asset) return current;
      return {
        ...current,
        mediaAssets: {
          ...(current.mediaAssets ?? {}),
          [assetId]: { ...asset, ...patch, crop: patch.crop ?? asset.crop },
        },
      };
    });
  };

  const addFiles = (files: File[]) => {
    files.filter(isImageFile).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const src = typeof reader.result === "string" ? reader.result : "";
        if (!src) return;
        setContent((current) => {
          const id = nextMediaAssetId(current.mediaAssets ?? {}, file.name);
          setSelectedId(id);
          return {
            ...current,
            mediaAssets: {
              ...(current.mediaAssets ?? {}),
              [id]: { id, type: "image", src, alt: readableFileName(file.name), fit: "cover", crop: defaultCrop() },
            },
          };
        });
      };
      reader.readAsDataURL(file);
    });
  };
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };
  const deleteAsset = () => {
    if (!selected || selectedUsage) return;
    if (!window.confirm(`Delete "${mediaAssetName(selected, selectedId)}"?`)) return;
    setContent((current) => {
      const { [selectedId]: _deleted, ...mediaAssets } = current.mediaAssets ?? {};
      return { ...current, mediaAssets };
    });
    setSaveStatus("Image deleted");
  };
  const save = async () => {
    const json = JSON.stringify(normalizeContentSchema(content), null, 2);
    const stored = persistDraft(json);
    setSaveStatus(stored ? "Saving..." : "Storage full; saving...");
    try {
      await saveContentJsonToDisk(json);
      setSaveStatus("Saved to content.json");
    } catch (error) {
      console.error("Unable to save content.json", error);
      setSaveStatus(stored ? "Browser backup only" : "Save failed");
    }
  };

  return (
    <main className="flex min-h-dvh flex-col bg-[#0f131c] text-slate-100 lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <header className="flex flex-none flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#151922] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild type="button" variant="ghost" size="icon" aria-label="Back to event builder" title="Back to Event builder">
            <a href="/event-builder"><ArrowLeft /></a>
          </Button>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Essence tools</p>
            <h1 className="truncate text-xl font-black text-white">Asset library</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs font-medium text-cyan-100 sm:block">{saveStatus}</span>
          <Button type="button" onClick={save} size="sm">
            <Save />
            Save
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[18rem_minmax(0,1fr)_22rem]">
        <aside className="flex min-h-0 flex-col border-b border-white/10 bg-[#111722] p-3 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">{Object.keys(content.mediaAssets ?? {}).length} images</p>
              <h2 className="mt-1 text-base font-black text-white">Catalog</h2>
            </div>
            <Images className="h-5 w-5 text-cyan-200" aria-hidden="true" />
          </div>
          <label className="mt-3 block">
            <span className="sr-only">Search image catalog</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search images" className="h-10 border-[#52466a] bg-[#0d121b] pl-10 text-sm text-white placeholder:text-slate-500" />
            </div>
          </label>
          <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {assetEntries.map(([id, asset]) => (
              <button key={id} type="button" onClick={() => setSelectedId(id)} className={`grid w-full grid-cols-[3.75rem_minmax(0,1fr)] gap-2 border p-2 text-left transition ${id === selectedId ? "border-cyan-200/75 bg-cyan-300/12" : "border-white/10 bg-black/15 hover:border-white/25"}`}>
                <div className="overflow-hidden border border-white/10 bg-black/25">
                  <img src={asset.src} alt="" className="h-12 w-full object-cover" />
                </div>
                <span className="min-w-0 self-center">
                  <span className="block truncate text-sm font-semibold text-white">{mediaAssetName(asset, id)}</span>
                  <span className="mt-1 block truncate text-xs text-slate-500">{id}</span>
                </span>
              </button>
            ))}
            {assetEntries.length === 0 && <p className="border border-dashed border-white/10 p-3 text-sm font-bold text-slate-400">No images yet.</p>}
          </div>
        </aside>

        <section className="min-h-0 overflow-y-auto bg-[#141b25] p-4">
          {selected ? (
            <div className="mx-auto grid max-w-3xl gap-5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Selected image</p>
                  <h2 className="mt-1 truncate text-2xl font-black text-white">{mediaAssetName(selected, selectedId)}</h2>
                </div>
                <span className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-xs font-medium text-slate-400">{selectedUsage} attachment{selectedUsage === 1 ? "" : "s"}</span>
              </div>
              <AssetCropCanvas asset={selected} onUpdate={(crop) => updateAsset(selectedId, { crop })} />
            </div>
          ) : (
            <div className="grid min-h-64 place-items-center border border-dashed border-white/10 p-6 text-center">
              <div>
                <Images className="mx-auto h-8 w-8 text-slate-500" />
                <p className="mt-3 text-sm font-black text-white">Choose an image to edit it.</p>
              </div>
            </div>
          )}
        </section>

        <aside className="min-h-0 overflow-y-auto border-t border-white/10 bg-[#111722] p-3 lg:border-l lg:border-t-0">
          <section className="border border-cyan-200/30 bg-cyan-300/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-100">Add image</p>
            <p className="mt-2 text-xs font-medium leading-5 text-cyan-100/80">Upload an image to reuse it from any event. Captions stay in this catalog; play screens keep the artwork clean.</p>
            <input id={uploadId} type="file" accept="image/*" multiple className="sr-only" onChange={onFileChange} />
            <Button asChild type="button" variant="outline" size="sm" className="mt-3">
              <label htmlFor={uploadId} className="cursor-pointer"><ImagePlus />Upload image</label>
            </Button>
          </section>
          {selected && (
            <AssetInspector
              asset={selected}
              assetId={selectedId}
              usageCount={selectedUsage}
              onUpdate={(patch) => updateAsset(selectedId, patch)}
              onDelete={deleteAsset}
            />
          )}
        </aside>
      </div>
    </main>
  );
}

function AssetInspector({
  asset,
  assetId,
  usageCount,
  onUpdate,
  onDelete,
}: {
  asset: ContentMediaAssetDef;
  assetId: string;
  usageCount: number;
  onUpdate: (patch: Partial<ContentMediaAssetDef>) => void;
  onDelete: () => void;
}) {
  return (
    <section className="mt-3 border border-white/10 bg-black/15 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Image details</p>
          <h2 className="mt-1 text-base font-black text-white">Edit asset</h2>
        </div>
        <Button type="button" variant="destructive" size="icon-sm" onClick={onDelete} disabled={usageCount > 0} aria-label="Delete image" title={usageCount ? "Remove event attachments before deleting" : "Delete image"}>
          <Trash2 />
        </Button>
      </div>
      <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-400">
        Name
        <Input value={asset.alt ?? ""} onChange={(event) => onUpdate({ alt: event.target.value || undefined })} className="mt-2 h-10 border-white/15 bg-[#151922] text-sm font-medium text-white" placeholder={assetId} />
      </label>
      <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-400">
        Caption
        <textarea value={asset.caption ?? ""} onChange={(event) => onUpdate({ caption: event.target.value || undefined })} className="mt-2 h-20 w-full resize-none rounded-md border border-white/15 bg-[#151922] p-3 text-sm font-medium text-white outline-none focus:border-cyan-300" />
      </label>
      <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-400">
        Image fit
        <select value={asset.fit ?? "cover"} onChange={(event) => onUpdate({ fit: event.target.value as ContentMediaAssetDef["fit"] })} className="mt-2 h-10 w-full rounded-md border border-white/15 bg-[#151922] px-3 text-sm font-medium text-white outline-none focus:border-cyan-300">
          <option value="cover">Cover frame</option>
          <option value="contain">Keep whole image</option>
        </select>
      </label>
      <p className="mt-4 border-t border-white/10 pt-3 text-xs font-medium leading-5 text-slate-400">Crop directly on the image: drag inside the frame to reposition it, or drag a corner to resize it.</p>
      {usageCount > 0 && <p className="mt-3 text-xs font-medium leading-5 text-slate-400">This image is in use. Remove it from its event before deleting it.</p>}
    </section>
  );
}

type CropDefinition = NonNullable<ContentMediaAssetDef["crop"]>;
type CropDragMode = "move" | "northWest" | "northEast" | "southWest" | "southEast";

interface CropDragState {
  mode: CropDragMode;
  pointerX: number;
  pointerY: number;
  crop: CropDefinition;
}

function AssetCropCanvas({ asset, onUpdate }: { asset: ContentMediaAssetDef; onUpdate: (crop: CropDefinition) => void }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<CropDragState | null>(null);
  const crop = asset.crop ?? defaultCrop();

  const startDrag = (event: ReactPointerEvent<HTMLElement>, mode: CropDragMode) => {
    event.preventDefault();
    event.stopPropagation();
    surfaceRef.current?.setPointerCapture(event.pointerId);
    setDrag({ mode, pointerX: event.clientX, pointerY: event.clientY, crop });
  };

  const continueDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return;
    const offsetX = (event.clientX - drag.pointerX) / bounds.width;
    const offsetY = (event.clientY - drag.pointerY) / bounds.height;
    onUpdate(cropForDrag(drag.crop, drag.mode, offsetX, offsetY));
  };

  const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    if (surfaceRef.current?.hasPointerCapture(event.pointerId)) surfaceRef.current.releasePointerCapture(event.pointerId);
    setDrag(null);
  };

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Crop</p>
          <p className="mt-1 text-xs text-slate-400">Drag the frame or its corners. The dimmed area is excluded.</p>
        </div>
        <span className="rounded-md border border-white/10 bg-black/20 px-2 py-1 font-mono text-xs text-slate-400">{Math.round(crop.width * 100)} x {Math.round(crop.height * 100)}%</span>
      </div>
      <div className="mt-4 flex min-h-64 items-center justify-center overflow-hidden rounded-md bg-[#0b1018] p-3">
        <div ref={surfaceRef} className="relative w-full touch-none select-none" onPointerMove={continueDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
          <img src={asset.src} alt="" draggable={false} className="block h-auto w-full rounded-sm" />
          <div className="pointer-events-none absolute inset-0 bg-black/55" />
          <div
            className="absolute border-2 border-cyan-300 bg-cyan-200/10 shadow-[0_0_0_1px_rgb(8_47_73)]"
            style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}
            onPointerDown={(event) => startDrag(event, "move")}
          >
            <div className="absolute inset-0 cursor-grab active:cursor-grabbing" />
            <CropHandle corner="northWest" onPointerDown={startDrag} />
            <CropHandle corner="northEast" onPointerDown={startDrag} />
            <CropHandle corner="southWest" onPointerDown={startDrag} />
            <CropHandle corner="southEast" onPointerDown={startDrag} />
          </div>
        </div>
      </div>
    </div>
  );
}

function CropHandle({ corner, onPointerDown }: { corner: Exclude<CropDragMode, "move">; onPointerDown: (event: ReactPointerEvent<HTMLElement>, mode: CropDragMode) => void }) {
  const positions: Record<Exclude<CropDragMode, "move">, string> = {
    northWest: "-left-2 -top-2 cursor-nwse-resize",
    northEast: "-right-2 -top-2 cursor-nesw-resize",
    southWest: "-bottom-2 -left-2 cursor-nesw-resize",
    southEast: "-bottom-2 -right-2 cursor-nwse-resize",
  };
  return <button type="button" aria-label={`Resize crop from ${corner}`} className={`absolute z-10 size-4 rounded-sm border-2 border-[#082f49] bg-cyan-200 shadow ${positions[corner]}`} onPointerDown={(event) => onPointerDown(event, corner)} />;
}

function cropForDrag(crop: CropDefinition, mode: CropDragMode, offsetX: number, offsetY: number): CropDefinition {
  const minSize = 0.04;
  const right = crop.x + crop.width;
  const bottom = crop.y + crop.height;

  if (mode === "move") {
    return normalizeCrop({
      ...crop,
      x: clampPercent(crop.x + offsetX, 0, 1 - crop.width),
      y: clampPercent(crop.y + offsetY, 0, 1 - crop.height),
    });
  }

  const nextLeft = mode === "northWest" || mode === "southWest" ? clampPercent(crop.x + offsetX, 0, right - minSize) : crop.x;
  const nextTop = mode === "northWest" || mode === "northEast" ? clampPercent(crop.y + offsetY, 0, bottom - minSize) : crop.y;
  const nextRight = mode === "northEast" || mode === "southEast" ? clampPercent(right + offsetX, crop.x + minSize, 1) : right;
  const nextBottom = mode === "southWest" || mode === "southEast" ? clampPercent(bottom + offsetY, crop.y + minSize, 1) : bottom;

  return normalizeCrop({ x: nextLeft, y: nextTop, width: nextRight - nextLeft, height: nextBottom - nextTop });
}

function loadInitialContent(): GameContent {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeContentSchema(JSON.parse(saved));
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return normalizeContentSchema(seedContent);
}

function persistDraft(json: string): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, json);
    return true;
  } catch (error) {
    console.warn("Unable to persist image library draft", error);
    return false;
  }
}

function mediaAssetUsageCount(content: GameContent, assetId: string): number {
  const countRefs = (refs: { assetId: string }[] | undefined) => refs?.filter((ref) => ref.assetId === assetId).length ?? 0;
  const eventCount = Object.values(content.events).reduce((count, event) => count + countRefs(event.media) + countRefs(event.activity?.media), 0);
  const overrideCount = Object.values(content.playerStories ?? {}).reduce(
    (count, bank) => count + Object.values(bank).reduce((total, override) => total + countRefs(override.media) + countRefs(override.activity?.media), 0),
    0
  );
  return eventCount + overrideCount;
}

function defaultCrop(): NonNullable<ContentMediaAssetDef["crop"]> {
  return { x: 0, y: 0, width: 1, height: 1 };
}

function normalizeCrop(crop: NonNullable<ContentMediaAssetDef["crop"]>): NonNullable<ContentMediaAssetDef["crop"]> {
  const x = clampPercent(crop.x, 0, 0.99);
  const y = clampPercent(crop.y, 0, 0.99);
  return {
    x,
    y,
    width: clampPercent(crop.width, 0.01, 1 - x),
    height: clampPercent(crop.height, 0.01, 1 - y),
  };
}

function clampPercent(value: number, min = 0, max = 1): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value * 1000) / 1000)) : min;
}

function nextMediaAssetId(existing: Record<string, ContentMediaAssetDef>, fileName: string): string {
  const base = readableFileName(fileName).toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "image";
  let id = base;
  let index = 2;
  while (existing[id]) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
}

function readableFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "New image";
}

function filesFromDataTransfer(data: DataTransfer): File[] {
  return Array.from(data.files ?? []).filter(isImageFile);
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}
