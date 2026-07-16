import { useEffect, useMemo, useReducer, useRef, useState, type ComponentType, type Dispatch, type PointerEvent, type ReactNode } from "react";
import { Activity, Camera, Copy, Map as MapIcon, MapPin, MousePointer2, Pencil, Plus, RotateCcw, Save, Target, Trash2, User, X } from "lucide-react";
import type {
  CameraFramingDef,
  GameContent,
  MapArtifact,
  MapAssetDef,
  MapBoardShape,
  MapDefinition,
  MapGridPoint,
  MapRoute,
  MapTerrace,
  MapTerraceSurface,
  MapTerrain,
  Player,
  Tile,
  TileLayout,
  TileType,
  EventActivityType,
} from "@essence/shared";
import { TILE_TYPES } from "@essence/shared";
import seedContent from "@shared/content.json";
import {
  assetProjectionRadius,
  assetRotateHandlePoint,
  assetScaleHandlePoint,
  projectArtifactFootprint,
  svgPathFromPlanePoints,
} from "../artifactProjection";
import {
  builderContentToGameContent,
  createInitialMapBuilderState,
  getActiveMap,
  getSelectedArtifact,
  getSelectedNode,
  getSelectedRoute,
  getSelectedTerrace,
  mapBuilderReducer,
  normalizeBuilderContent,
  TERRACE_ELEVATION_PRESETS,
  TERRACE_SURFACES,
  TERRAIN_TYPES,
  validateMap,
  type BuilderContent,
  type BuilderSelection,
  type BuilderTool,
  type MapBuilderState,
  type TerraceCorner,
} from "../mapBuilder";
import { assertValidGameContent, normalizeContentSchema } from "@essence/shared/contentValidation";
import { eventTitle, resolveTileEventForPlayer, sharedEventIdsForTile } from "@essence/shared/events";
import { saveContentJsonToDisk } from "../lib/contentDiskSave";
import { DEFAULT_CAMERA_FRAMING, resolveTileCamera } from "../board3d";
import Board3DShell from "./Board3DShell";
import MapPlaytest from "./MapPlaytest";
import MapSimulationPanel from "./MapSimulationPanel";
import type { MapSimulationResult, SimulationCellStats } from "../mapSimulation";

const BASE_CONTENT = normalizeContentSchema(seedContent);
const STORAGE_KEY = "essence:map-builder:draft";
type DraftSaveStatus = "saved" | "dirty" | "saving" | "browser" | "error";
type InspectorTab = "selection" | "camera" | "map" | "simulation";
type CameraAuthoringScope = "default" | "cell";

const TILE_LABEL: Record<TileType, string> = {
  start: "Start",
  finish: "Final",
  minigame: "Minijuego",
  trivia: "Trivia",
  vote: "Voto",
  judge: "Juez",
  dare: "Prenda",
  fate: "Destino",
  groom: "Novio",
  reaction: "Reacción",
  estimate: "Estimación",
  shop: "Shop",
};

const TILE_COLOR: Record<TileType, string> = {
  start: "#cbd5e1",
  finish: "#f59e0b",
  minigame: "#6366f1",
  trivia: "#38bdf8",
  vote: "#8b5cf6",
  judge: "#ec4899",
  dare: "#f43f5e",
  fate: "#d946ef",
  groom: "#facc15",
  reaction: "#22c55e",
  estimate: "#06b6d4",
  shop: "#10b981",
};

const TERRAIN_COLOR: Record<MapTerrain, string> = {
  stone: "#d8c28a",
  grass: "#78c65a",
  sand: "#efbd69",
  water: "#56c7f0",
  asphalt: "#8b95a3",
  magic: "#c084fc",
};

const TERRACE_FILL: Record<MapTerraceSurface, string> = {
  grass: "#a5d6a7",
  sand: "#f0d9a8",
  water: "#90d8f0",
  stone: "#d5cdc0",
  plaza: "#e8c8d8",
};

const TERRACE_SURFACE_LABEL: Record<MapTerraceSurface, string> = {
  grass: "Pasto",
  sand: "Arena",
  water: "Agua",
  stone: "Piedra",
  plaza: "Plaza",
};

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const COLOR_INPUT_HEX_RE = /^#[0-9a-fA-F]{6}$/;

function optionsWithOrphan(value: string, options: { value: string; label: string }[]) {
  if (value && !options.some((option) => option.value === value)) {
    return [{ value, label: `Falta: ${value}` }, ...options];
  }
  return options;
}

const ASSET_EMOJI: Record<string, string> = {
  "oak-tree": "🌲",
  "club-house": "🏫",
  "party-van": "🚐",
  "pond": "💧",
  "start-sign": "🪧",
  "finish-sign": "🏁",
  "glass-building": "🏢",
  "mini-court": "🏀",
  "mountain-cluster": "🏔️",
  "river": "🌊",
  "plaza": "🏛️",
  "fountain": "⛲",
  "bench": "🪑",
  "palm-tree": "🌴",
  "flower-bed": "🌸",
  "beach-set": "⛱️",
  "sailboat": "⛵",
  "waterfall": "🌊",
  "wedding-arch": "💒",
  "fence": "🚧",
  "streetlamp": "💡",
  "rock": "🪨",
  "billboard": "🖥️",
  "bus": "🚌",
  "fallen-fernet": "🥃",
  "vomiting-person": "🤢",
  "blue-ikea-bag": "🛍️",
  "hockey-stick": "🏑",
  "condom-bolas": "💩",
  "botherlands-disc": "💿",
  "hoodie-log": "🪵",
  "cut-branch-oak": "🌳",
  "uade-building": "🏢",
  "uba-building": "🏚️",
  "desk-chair-tower": "🪑",
  "croissant": "🥐",
  "wedding-ring": "💍",
  "ukulele": "🪕",
  "rugby-ball": "🏉",
  "basketball": "🏀",
  "football-ball": "⚽",
  "tuna-can": "🥫",
  "jardinera-can": "🥫",
  "sunscreen": "🧴",
  "vodka-bottle": "🍾",
  "classroom-giant-log": "🪵",
  "split-tree-trunk": "🪵",
  "bleach-sound-bomb": "🧪",
  "firecracker-box": "🧨",
  "upd-noose-chair": "🪑",
  "vinchuca-jar": "🫙",
  "broken-window-frame": "🪟",
  "school-locker-hiding": "🚪",
  "locker-row": "🗄️",
  "steamy-taxi": "🚕",
  "just-dance-kinect": "💃",
  "school-desk-pupitre": "🪑",
  "city-barricade-peed": "🚧",
  "crumpled-exam-ausente": "📄",
  "martina-impact-ball": "⚽",
  "teacher-figures": "👩‍🏫",
  "giant-groin-cup": "🛡️",
  "sleeping-bag": "🛌",
  "tongue-toy": "👅",
  "jony-duck-window": "🪟",
  "flying-chair": "🪑",
  "kiosco-24hs": "🏪",
  "kiosk-bag-nofui": "🛍️",
  "tiny-trophy": "🏆",
  "silly-pool-float": "🦩",
  "broken-umbrella": "☂️",
  "megaphone": "📣",
  "stopwatch": "⏱️",
  "lucky-sock": "🧦",
  "cursed-calculator": "🔮",
  "giant-pencil": "✏️",
  "sticker-suitcase": "🧳",
  "banana-peel-trap": "🍌",
  "world-cup-trophy": "🏆",
  "rain-tent": "⛺",
};

const KIND_EMOJI: Record<MapAssetDef["kind"], string> = {
  tree: "🌳",
  house: "🏠",
  court: "🏀",
  vehicle: "🚗",
  mountain: "⛰️",
  water: "💧",
  sign: "🪧",
  plaza: "⛲",
  decor: "🌸",
  custom: "📦",
};

const TOOL_CONFIG: { tool: BuilderTool; icon: string; label: string; title: string }[] = [
  { tool: "select", icon: "⌖", label: "Select", title: "Seleccionar y arrastrar" },
  { tool: "cell", icon: "●", label: "Cells", title: "Crear casilleros" },
  { tool: "route", icon: "⇄", label: "Routes", title: "Conectar casilleros" },
  { tool: "artifact", icon: "◆", label: "Props", title: "Colocar map props" },
  { tool: "terrace", icon: "⛰", label: "Terreno", title: "Dibujar mesetas de terreno" },
];

type DragTarget =
  | { kind: "node"; id: number }
  | { kind: "artifact"; id: string }
  | { kind: "artifact-scale"; id: string }
  | { kind: "artifact-rotate"; id: string }
  | { kind: "route-point"; id: string; index: number }
  | { kind: "border-point"; point: MapGridPoint }
  | { kind: "terrace"; id: string; offsetX: number; offsetY: number }
  | { kind: "terrace-resize"; id: string; corner: TerraceCorner };

export default function MapBuilder() {
  const [state, dispatch] = useReducer(mapBuilderReducer, undefined, loadInitialState);
  const activeMap = getActiveMap(state);
  const selectedNode = getSelectedNode(activeMap, state.selection);
  const selectedRoute = getSelectedRoute(activeMap, state.selection);
  const selectedArtifact = getSelectedArtifact(activeMap, state.selection);
  const selectedTerrace = getSelectedTerrace(activeMap, state.selection);
  const initial3DPlaytest = readInitial3DPlaytest();
  const [testMode, setTestMode] = useState(initial3DPlaytest);
  const [playtest3DOpen, setPlaytest3DOpen] = useState(initial3DPlaytest);
  const [testCellId, setTestCellId] = useState(() => activeMap.board[0]?.id ?? 0);
  const previewPosition = testMode ? testCellId : selectedNode?.id ?? activeMap.board[Math.floor(activeMap.board.length / 2)]?.id ?? 0;
  const previewPlayers = useMemo<Player[]>(
    () => [
      {
        id: "test-player",
        name: testMode ? "Test" : "Preview",
        socketId: null,
        connected: true,
        position: previewPosition,
        coins: 0,
        isHost: false,
        groom: false,
        color: testMode ? "#34d399" : "#fef3c7",
      },
    ],
    [previewPosition, testMode]
  );
  const validation = useMemo(() => validateMap(activeMap), [activeMap]);
  const [assetId, setAssetId] = useState(state.content.assetCatalog[0]?.id ?? "oak-tree");
  const [tileType, setTileType] = useState<TileType>("minigame");
  const [importText, setImportText] = useState("");
  const [jsonModalOpen, setJsonModalOpen] = useState(false);
  const [mapDetailsOpen, setMapDetailsOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<DraftSaveStatus>("saved");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("selection");
  const [cameraScope, setCameraScope] = useState<CameraAuthoringScope>("default");
  const [simulationResult, setSimulationResult] = useState<MapSimulationResult | null>(null);
  const exportContent = useMemo(() => builderContentToGameContent(BASE_CONTENT, state.content), [state.content]);
  const exportJson = useMemo(() => JSON.stringify(exportContent, null, 2), [exportContent]);
  const draftJson = useMemo(() => JSON.stringify(state.content), [state.content]);
  const savedDraftRef = useRef<string | null>(null);
  const diskSavedDraftRef = useRef<string | null>(null);

  if (savedDraftRef.current === null) savedDraftRef.current = draftJson;
  if (diskSavedDraftRef.current === null) diskSavedDraftRef.current = draftJson;

  useEffect(() => {
    if (savedDraftRef.current !== draftJson) setSaveStatus((current) => (current === "error" ? "error" : "dirty"));
  }, [draftJson]);

  useEffect(() => {
    if (activeMap.board.some((tile) => tile.id === testCellId)) return;
    setTestCellId(activeMap.board[0]?.id ?? 0);
  }, [activeMap, testCellId]);

  useEffect(() => {
    if (!selectedNode && cameraScope === "cell") setCameraScope("default");
  }, [cameraScope, selectedNode]);

  useEffect(() => {
    setSimulationResult(null);
  }, [activeMap.id, draftJson]);

  const simulationCells = useMemo(() => {
    if (inspectorTab !== "simulation" || !simulationResult) return undefined;
    return new Map(simulationResult.cells.map((cell) => [cell.tileId, cell]));
  }, [inspectorTab, simulationResult]);

  const inspectorPreviewCamera = useMemo(() => {
    if (inspectorTab !== "camera") return undefined;
    if (cameraScope === "default") return activeMap.defaultCamera ?? DEFAULT_CAMERA_FRAMING;
    return resolveTileCamera(selectedNode ?? undefined, activeMap.cameraPresets) ?? activeMap.defaultCamera ?? DEFAULT_CAMERA_FRAMING;
  }, [activeMap.cameraPresets, activeMap.defaultCamera, cameraScope, inspectorTab, selectedNode]);

  const inspectorPreviewLabel =
    inspectorTab === "camera"
      ? cameraScope === "cell" && selectedNode
        ? `Editing cell ${selectedNode.id} camera`
        : "Editing board camera"
      : undefined;

  const changeInspectorTab = (tab: InspectorTab) => {
    setInspectorTab(tab);
  };

  const copyJson = async () => {
    await navigator.clipboard?.writeText(exportJson);
  };

  const saveDraft = async () => {
    let stored = false;
    try {
      localStorage.setItem(STORAGE_KEY, draftJson);
      stored = true;
      savedDraftRef.current = draftJson;
    } catch (error) {
      console.warn("Unable to persist map builder browser draft", error);
    }

    setSaveStatus("saving");
    try {
      await saveContentJsonToDisk(exportJson);
      savedDraftRef.current = draftJson;
      diskSavedDraftRef.current = draftJson;
      setSaveStatus("saved");
    } catch (error) {
      console.error("Unable to save content.json", error);
      setSaveStatus(stored ? "browser" : "error");
    }
  };

  const downloadJson = () => {
    const blob = new Blob([exportJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "content.map-builder.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importJson = () => {
    try {
      const parsed = assertValidGameContent(JSON.parse(importText), "Imported content");
      dispatch({ type: "replace_content", content: normalizeBuilderContent(parsed) });
      setImportText("");
      setJsonModalOpen(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "JSON inválido");
    }
  };

  const resetDraft = () => {
    const savedContent = loadSavedBuilderContent();
    const content = savedContent ?? normalizeBuilderContent(BASE_CONTENT);
    const restoredDraftJson = JSON.stringify(content);
    savedDraftRef.current = restoredDraftJson;
    setSaveStatus(savedContent && diskSavedDraftRef.current !== restoredDraftJson ? "browser" : "saved");
    dispatch({ type: "replace_content", content });
  };

  const open3DPlaytest = () => {
    setTestMode(true);
    setPlaytest3DOpen(true);
  };

  const close3DPlaytest = () => {
    setPlaytest3DOpen(false);
    setTestMode(false);
  };

  // Coloca en el mapa el prop que se estaba viendo en la galería 3D, con el tamaño
  // elegido, y lo deja seleccionado.
  const placePropFromGallery = (galleryAssetId: string, galleryScale: number) => {
    dispatch({ type: "add_artifact", assetId: galleryAssetId, point: mapCenterPoint(activeMap), scale: galleryScale });
    setAssetId(galleryAssetId);
    setGalleryOpen(false);
  };

  const createMap = () => {
    dispatch({ type: "create_map" });
    setMapDetailsOpen(true);
  };

  const duplicateMap = () => {
    dispatch({ type: "duplicate_map" });
    setMapDetailsOpen(true);
  };

  const deleteMap = () => {
    if (state.content.maps.length <= 1) return;
    if (!window.confirm(`Delete map "${activeMap.name}"?`)) return;
    dispatch({ type: "delete_map" });
  };

  return (
    <main className="map-builder-shell flex h-dvh min-h-0 flex-col overflow-hidden bg-[#0d140e] text-slate-100">
      <header className="flex flex-none items-center gap-2 border-b border-white/10 bg-[#101810]/98 px-3 py-2 shadow-lg shadow-black/20">
        <div className="w-28 shrink-0">
          <p className="text-[0.52rem] font-black uppercase tracking-[0.2em] text-emerald-300">Essence tools</p>
          <h1 className="text-base font-black leading-none tracking-normal text-white">Map builder</h1>
        </div>

        <MapTopBar
          state={state}
          dispatch={dispatch}
          onCreate={createMap}
          onDuplicate={duplicateMap}
          onDelete={deleteMap}
          onEdit={() => setMapDetailsOpen(true)}
          onImport={() => setJsonModalOpen(true)}
          onSave={saveDraft}
          saveStatus={saveStatus}
          testMode={testMode}
          onToggleTest={() => (testMode ? close3DPlaytest() : open3DPlaytest())}
        />
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_23rem]">
        <section className="min-h-0 min-w-0 bg-[#172218] p-2">
          <div className="relative h-full min-h-0 overflow-hidden rounded-md border border-white/10 bg-[#e8e1c6] text-slate-900 shadow-2xl shadow-black/30">
            <MapCanvas
              state={state}
              map={activeMap}
              dispatch={dispatch}
              assetId={assetId}
              tileType={tileType}
              testMode={testMode}
              testCellId={testCellId}
              onTestCellChange={setTestCellId}
              simulationCells={simulationCells}
            />

            {/* Mientras un overlay 3D a pantalla completa está abierto, desmontamos
                el preview chico: un solo canvas WebGL. */}
            {!playtest3DOpen && !galleryOpen && inspectorTab !== "simulation" && (
              <Floating3DPreview
                map={activeMap}
                assetCatalog={state.content.assetCatalog}
                players={previewPlayers}
                testMode={testMode}
                testCellId={testCellId}
                cameraOverride={inspectorPreviewCamera}
                previewLabel={inspectorPreviewLabel}
                onOpen={open3DPlaytest}
              />
            )}

            <FloatingToolBar
              state={state}
              dispatch={dispatch}
              assetCatalog={state.content.assetCatalog}
              assetId={assetId}
              setAssetId={setAssetId}
              tileType={tileType}
              setTileType={setTileType}
              onOpenGallery={() => setGalleryOpen(true)}
            />
          </div>
        </section>

        <aside className="min-h-0 overflow-y-auto overscroll-contain border-t border-white/10 bg-[#111811] p-3 lg:border-l lg:border-t-0">
          <Inspector
            state={state}
            map={activeMap}
            selectedNode={selectedNode}
            selectedRoute={selectedRoute}
            selectedArtifact={selectedArtifact}
            selectedTerrace={selectedTerrace}
            dispatch={dispatch}
            assetCatalog={state.content.assetCatalog}
            validation={validation}
            activeTab={inspectorTab}
            onTabChange={changeInspectorTab}
            cameraScope={cameraScope}
            onCameraScopeChange={setCameraScope}
            content={exportContent}
            simulationResult={simulationResult}
            onSimulationResult={setSimulationResult}
            onSelectSimulationCell={(tileId) => {
              setTestCellId(tileId);
              dispatch({ type: "select", selection: { kind: "node", id: tileId } });
            }}
          />
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

      {mapDetailsOpen && (
        <MapDetailsModal map={activeMap} dispatch={dispatch} onClose={() => setMapDetailsOpen(false)} />
      )}

      {playtest3DOpen && (
        <MapPlaytest content={exportContent} mapId={activeMap.id} onClose={close3DPlaytest} />
      )}

      {galleryOpen && (
        <PropGalleryOverlay
          assetCatalog={state.content.assetCatalog}
          initialAssetId={assetId}
          onPlace={placePropFromGallery}
          onClose={() => setGalleryOpen(false)}
        />
      )}

    </main>
  );
}

function MapTopBar({
  state,
  dispatch,
  onCreate,
  onDuplicate,
  onDelete,
  onEdit,
  onImport,
  onSave,
  saveStatus,
  testMode,
  onToggleTest,
}: {
  state: MapBuilderState;
  dispatch: Dispatch<any>;
  onCreate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onImport: () => void;
  onSave: () => void;
  saveStatus: DraftSaveStatus;
  testMode: boolean;
  onToggleTest: () => void;
}) {
  const saveLabel =
    saveStatus === "saved"
      ? "Saved to shared/content.json"
      : saveStatus === "saving"
        ? "Saving shared/content.json"
        : saveStatus === "browser"
          ? "Browser draft only; save to shared/content.json"
          : saveStatus === "error"
            ? "Retry saving shared/content.json"
            : "Save to shared/content.json";
  const saveClass = saveStatus === "dirty" || saveStatus === "saving" ? "active" : saveStatus === "error" || saveStatus === "browser" ? "danger" : "";
  const canDeleteMap = state.content.maps.length > 1;

  return (
    <section className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[0.035] p-1.5">
      <div className="flex min-w-[min(100%,34rem)] flex-1 flex-wrap items-center gap-1.5">
        <select
          value={state.activeMapId}
          onChange={(event) => dispatch({ type: "select_map", mapId: event.target.value })}
          aria-label="Map"
          className="w-full min-w-[12rem] rounded-md border border-white/10 bg-[#0a100b] px-3 py-1.5 text-xs font-black text-white outline-none focus:border-emerald-300 sm:w-64 lg:w-72"
        >
          {state.content.maps.map((map) => (
            <option key={map.id} value={map.id}>
              {map.name}
            </option>
          ))}
        </select>
        <MapIconButton label={saveLabel} icon={Save} onClick={onSave} className={saveClass} live />
        <MapIconButton label="Edit map details" icon={Pencil} onClick={onEdit} />
        <MapIconButton label="New map" icon={Plus} onClick={onCreate} />
        <MapIconButton label="Duplicate map" icon={Copy} onClick={onDuplicate} />
        <MapIconButton
          label={canDeleteMap ? "Delete map" : "Cannot delete last map"}
          icon={Trash2}
          onClick={onDelete}
          className="danger"
          disabled={!canDeleteMap}
        />
      </div>
      <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5 border-white/10 lg:border-l lg:pl-2">
        <button type="button" onClick={onImport} data-json-open="true" className="builder-button" aria-label="Import or export JSON">
          JSON
        </button>
        <button
          type="button"
          onClick={onToggleTest}
          className={`builder-button ${testMode ? "active" : ""}`}
          aria-label={testMode ? "Stop playtest" : "Open playtest"}
        >
          {testMode ? "Stop" : "Playtest"}
        </button>
        <a href="/tools" className="builder-button">
          Tools
        </a>
      </div>
    </section>
  );
}

function MapIconButton({
  label,
  icon: Icon,
  onClick,
  className = "",
  disabled = false,
  live = false,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
  live?: boolean;
}) {
  return (
    <span className="builder-tooltip" data-tooltip={label}>
      <button
        type="button"
        onClick={disabled ? undefined : onClick}
        aria-disabled={disabled || undefined}
        aria-label={label}
        aria-live={live ? "polite" : undefined}
        title={label}
        className={`builder-button icon ${className} ${disabled ? "is-disabled" : ""}`}
      >
        <Icon className="h-4 w-4" />
      </button>
    </span>
  );
}

function FloatingToolBar({
  state,
  dispatch,
  assetCatalog,
  assetId,
  setAssetId,
  tileType,
  setTileType,
  onOpenGallery,
}: {
  state: MapBuilderState;
  dispatch: Dispatch<any>;
  assetCatalog: MapAssetDef[];
  assetId: string;
  setAssetId: (id: string) => void;
  tileType: TileType;
  setTileType: (type: TileType) => void;
  onOpenGallery: () => void;
}) {
  return (
    <section data-map-builder-toolbar="true" className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-3">
      <div className="pointer-events-auto relative rounded-lg border border-slate-900/15 bg-slate-950/82 p-2 shadow-2xl shadow-black/30 backdrop-blur-md">
        {(state.tool === "artifact" || state.tool === "cell") && (
          <div className="absolute bottom-[calc(100%+0.5rem)] left-1/2 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-white/15 bg-slate-950/92 p-3 text-white shadow-2xl shadow-black/30 backdrop-blur-md">
            {state.tool === "artifact" && (
              <div className="flex items-end gap-2">
                <label className="block min-w-0 flex-1 text-xs font-bold text-slate-300">
                  Asset
                  <select
                    value={assetId}
                    onChange={(event) => setAssetId(event.target.value)}
                    className="mt-1 w-full rounded-md border border-white/10 bg-[#0d120d] px-3 py-2 text-sm text-white outline-none focus:border-emerald-300"
                  >
                    {assetCatalog.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {assetOptionLabel(asset)}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={onOpenGallery} className="builder-button preview h-[2.35rem]" aria-label="Open prop 3D viewer">
                  View 3D
                </button>
              </div>
            )}
            {state.tool === "cell" && (
              <label className="block text-xs font-bold text-slate-300">
                Cell type
                <select
                  value={tileType}
                  onChange={(event) => setTileType(event.target.value as TileType)}
                  className="mt-1 w-full rounded-md border border-white/10 bg-[#0d120d] px-3 py-2 text-sm text-white outline-none focus:border-emerald-300"
                >
                  {TILE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {TILE_LABEL[type]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
        <div className="grid grid-cols-5 gap-1">
        {TOOL_CONFIG.map((tool) => (
          <button
            key={tool.tool}
            type="button"
            title={tool.title}
            aria-label={tool.title}
            onClick={() => dispatch({ type: "select_tool", tool: tool.tool })}
            className={`flex aspect-square flex-col items-center justify-center rounded-md border text-xs font-black transition ${
              state.tool === tool.tool
                ? "border-emerald-300 bg-emerald-300 text-emerald-950"
                : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
            }`}
          >
            <span className="text-base leading-none">{tool.icon}</span>
            <span className="mt-1 text-[0.58rem]">{tool.label}</span>
          </button>
        ))}
      </div>
      </div>
    </section>
  );
}

function Floating3DPreview({
  map,
  assetCatalog,
  players,
  testMode,
  testCellId,
  cameraOverride,
  previewLabel,
  onOpen,
}: {
  map: MapDefinition;
  assetCatalog: MapAssetDef[];
  players: Player[];
  testMode: boolean;
  testCellId: number;
  cameraOverride?: CameraFramingDef;
  previewLabel?: string;
  onOpen: () => void;
}) {
  const previewCell = map.board.find((tile) => tile.id === players[0]?.position) ?? map.board.find((tile) => tile.id === testCellId);
  const presentationCamera = cameraOverride ?? resolveTileCamera(previewCell, map.cameraPresets);
  return (
    <section data-map-builder-preview="true" className="absolute right-4 top-4 z-20 h-44 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-950/20 bg-[#172114] text-white shadow-2xl shadow-black/35">
      <Board3DShell
        tiles={map.board}
        routes={map.routes}
        artifacts={map.artifacts}
        terraces={map.terraces}
        assetCatalog={assetCatalog}
        boardShape={map.boardShape}
        players={players}
        activeId="test-player"
        interactive
        defaultCamera={map.defaultCamera}
        presentationCamera={presentationCamera}
        className="absolute inset-0 overflow-hidden bg-[radial-gradient(ellipse_at_50%_-10%,#f2d8a7_0%,#dfa96b_34%,#96602c_66%,#38200c_100%)]"
      />
      <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-white/10 bg-black/35 px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-white/80 backdrop-blur">
        {previewLabel ?? (testMode ? `Test cell ${testCellId}` : "3D preview")}
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="absolute bottom-3 right-3 rounded-md border border-white/20 bg-slate-950/70 px-3 py-2 text-xs font-black text-white backdrop-blur transition hover:bg-white/10"
      >
        Open
      </button>
    </section>
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
      <section className="w-[min(56rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-white/15 bg-[#121812] text-slate-100 shadow-2xl shadow-black/45">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-slate-300">Import / export JSON</h2>
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
                placeholder="Pegá un content.json para importar"
                className="mt-1 h-72 w-full resize-none rounded-md border border-white/10 bg-[#0d120d] p-2 font-mono text-xs text-slate-100 outline-none focus:border-emerald-300"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={onImport} disabled={!importText.trim()} className="builder-button disabled:opacity-40">
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
              <button type="button" onClick={onCopy} className="builder-button">
                Copy
              </button>
              <button type="button" onClick={onDownload} className="builder-button">
                Download
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function MapDetailsModal({ map, dispatch, onClose }: { map: MapDefinition; dispatch: Dispatch<any>; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
      <section className="w-[min(34rem,calc(100vw-1.5rem))] rounded-lg border border-white/15 bg-[#121812] p-4 text-slate-100 shadow-2xl shadow-black/45">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.65rem] font-black uppercase tracking-[0.2em] text-emerald-300">Map details</p>
            <h2 className="text-xl font-black text-white">{map.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="builder-button compact">
            Done
          </button>
        </div>
        <TextInput label="Name" value={map.name} onChange={(name) => dispatch({ type: "update_map", patch: { name } })} />
        <TextArea label="Description" value={map.description ?? ""} onChange={(description) => dispatch({ type: "update_map", patch: { description } })} />
      </section>
    </div>
  );
}

function MapCanvas({
  state,
  map,
  dispatch,
  assetId,
  tileType,
  testMode,
  testCellId,
  onTestCellChange,
  simulationCells,
}: {
  state: MapBuilderState;
  map: MapDefinition;
  dispatch: Dispatch<any>;
  assetId: string;
  tileType: TileType;
  testMode: boolean;
  testCellId: number;
  onTestCellChange: (id: number) => void;
  simulationCells?: ReadonlyMap<number, SimulationCellStats>;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<DragTarget | null>(null);
  const [terraceDraft, setTerraceDraft] = useState<{ start: MapGridPoint; current: MapGridPoint } | null>(null);
  const bounds = useMemo(() => canvasBounds(map), [map]);
  const gridLines = useMemo(() => buildGrid(bounds), [bounds]);
  const terraceToolActive = state.tool === "terrace" && !testMode;
  const simulationHeatMax = useMemo(
    () => Math.max(0, ...[...(simulationCells?.values() ?? [])].map((cell) => cell.landings)),
    [simulationCells]
  );

  const pointFromEvent = (event: PointerEvent<SVGElement>): TileLayout => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const transformed = point.matrixTransform(matrix.inverse());
    return { x: roundToQuarter(transformed.x), y: roundToQuarter(transformed.y) };
  };

  const handleCanvasPointerDown = (event: PointerEvent<SVGRectElement>) => {
    if (testMode) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    if (state.tool === "cell") {
      dispatch({ type: "add_node", point, tileType });
      return;
    }
    if (state.tool === "artifact") {
      dispatch({ type: "add_artifact", assetId, point });
      return;
    }
    if (state.tool === "terrace") {
      const start = { x: roundToStep(point.x, 0.5), y: roundToStep(point.y, 0.5) };
      setTerraceDraft({ start, current: start });
      return;
    }
    dispatch({ type: "select", selection: null });
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (testMode) return;
    if (terraceDraft) {
      const point = pointFromEvent(event);
      setTerraceDraft((draft) =>
        draft ? { ...draft, current: { x: roundToStep(point.x, 0.5), y: roundToStep(point.y, 0.5) } } : draft
      );
      return;
    }
    if (!drag.current) return;
    const point = pointFromEvent(event);
    if (drag.current.kind === "node") dispatch({ type: "move_node", id: drag.current.id, point });
    if (drag.current.kind === "artifact") dispatch({ type: "move_artifact", id: drag.current.id, point });
    if (drag.current.kind === "artifact-scale") {
      const target = drag.current;
      const artifact = map.artifacts.find((candidate) => candidate.id === target.id);
      const asset = state.content.assetCatalog.find((candidate) => candidate.id === artifact?.assetId);
      if (artifact) {
        const dx = point.x - artifact.position.x;
        const dy = point.y - artifact.position.y;
        const baseRadius = assetProjectionRadius(asset);
        const scale = Math.max(0.25, roundToStep(Math.hypot(dx, dy) / Math.max(0.1, baseRadius), 0.05));
        dispatch({ type: "update_artifact", id: artifact.id, patch: { scale } });
      }
    }
    if (drag.current.kind === "artifact-rotate") {
      const target = drag.current;
      const artifact = map.artifacts.find((candidate) => candidate.id === target.id);
      if (artifact) {
        const dx = point.x - artifact.position.x;
        const dy = point.y - artifact.position.y;
        const rot = roundToStep((Math.atan2(-dx, -dy) * 180) / Math.PI, 5);
        dispatch({ type: "update_artifact", id: artifact.id, patch: { position: { ...artifact.position, rot } } });
      }
    }
    if (drag.current.kind === "route-point") {
      dispatch({ type: "update_route_point", id: drag.current.id, index: drag.current.index, point });
    }
    if (drag.current.kind === "border-point") {
      const nextPoint = { x: roundToStep(point.x, 1), y: roundToStep(point.y, 1) };
      dispatch({ type: "move_border_point", from: drag.current.point, to: nextPoint });
      drag.current = { kind: "border-point", point: nextPoint };
    }
    if (drag.current.kind === "terrace") {
      dispatch({
        type: "move_terrace",
        id: drag.current.id,
        minX: roundToStep(point.x - drag.current.offsetX, 0.5),
        minY: roundToStep(point.y - drag.current.offsetY, 0.5),
      });
    }
    if (drag.current.kind === "terrace-resize") {
      dispatch({
        type: "resize_terrace",
        id: drag.current.id,
        corner: drag.current.corner,
        point: { x: roundToStep(point.x, 0.5), y: roundToStep(point.y, 0.5) },
      });
    }
  };

  const stopDrag = () => {
    drag.current = null;
    if (terraceDraft) {
      const rect = terraceRectFromDraft(terraceDraft);
      setTerraceDraft(null);
      dispatch({ type: "add_terrace", rect });
    }
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full touch-none select-none"
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      role="img"
      aria-label={`Editor visual de ${map.name}`}
    >
      <defs>
        <filter id="nodeShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.12" stdDeviation="0.08" floodColor="#132017" floodOpacity="0.35" />
        </filter>
      </defs>
      <rect x={bounds.minX} y={bounds.minY} width={bounds.width} height={bounds.height} fill="#e8e1c6" onPointerDown={handleCanvasPointerDown} />
      {map.boardShape && (
        <BoardShapeOverlay
          boardShape={map.boardShape}
          testMode={testMode}
          onPointDragStart={(event, point) => {
            event.preventDefault();
            event.stopPropagation();
            if (testMode) return;
            drag.current = { kind: "border-point", point };
          }}
          onSplitEdge={(edgeId, point) => dispatch({ type: "split_border_edge", id: edgeId, point })}
        />
      )}
      {gridLines.map((line) => (
        <line key={line.key} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="#87916f" strokeWidth="0.015" opacity="0.35" />
      ))}

      {/* Mesetas debajo de rutas, casilleros y props; interactivas solo con la herramienta Terreno. */}
      {[...(map.terraces ?? [])]
        .sort((a, b) => a.elevation - b.elevation)
        .map((terrace) => (
          <TerraceShape
            key={terrace.id}
            terrace={terrace}
            selected={isSelected(state.selection, "terrace", terrace.id)}
            interactive={terraceToolActive}
            onBodyPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const point = pointFromEvent(event);
              drag.current = { kind: "terrace", id: terrace.id, offsetX: point.x - terrace.minX, offsetY: point.y - terrace.minY };
              dispatch({ type: "select", selection: { kind: "terrace", id: terrace.id } });
            }}
            onCornerPointerDown={(event, corner) => {
              event.preventDefault();
              event.stopPropagation();
              drag.current = { kind: "terrace-resize", id: terrace.id, corner };
              dispatch({ type: "select", selection: { kind: "terrace", id: terrace.id } });
            }}
          />
        ))}

      {terraceDraft && <TerraceDraftShape rect={terraceRectFromDraft(terraceDraft)} />}

      <g pointerEvents={terraceToolActive ? "none" : undefined}>
      {map.routes.map((route) => (
        <RouteShape key={route.id} route={route} map={map} selected={isSelected(state.selection, "route", route.id)} dispatch={dispatch} />
      ))}

      {map.artifacts.map((artifact) => (
        <ArtifactShape
          key={artifact.id}
          artifact={artifact}
          asset={state.content.assetCatalog.find((candidate) => candidate.id === artifact.assetId)}
          selected={isSelected(state.selection, "artifact", artifact.id)}
          onSelect={() => dispatch({ type: "select", selection: { kind: "artifact", id: artifact.id } })}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (testMode) return;
            drag.current = { kind: "artifact", id: artifact.id };
            dispatch({ type: "select", selection: { kind: "artifact", id: artifact.id } });
          }}
          onScaleStart={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (testMode) return;
            drag.current = { kind: "artifact-scale", id: artifact.id };
            dispatch({ type: "select", selection: { kind: "artifact", id: artifact.id } });
          }}
          onRotateStart={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (testMode) return;
            drag.current = { kind: "artifact-rotate", id: artifact.id };
            dispatch({ type: "select", selection: { kind: "artifact", id: artifact.id } });
          }}
        />
      ))}

      {map.board.map((tile) => (
        <NodeShape
          key={tile.id}
          tile={tile}
          selected={isSelected(state.selection, "node", tile.id)}
          testActive={testMode && testCellId === tile.id}
          pending={state.pendingRouteFrom === tile.id}
          dispatch={dispatch}
          tool={state.tool}
          pendingRouteFrom={state.pendingRouteFrom}
          testMode={testMode}
          simulationStats={simulationCells?.get(tile.id)}
          simulationHeatMax={simulationHeatMax}
          onTestCellChange={onTestCellChange}
          onDragStart={() => {
            drag.current = { kind: "node", id: tile.id };
          }}
        />
      ))}
      </g>

      {state.selection?.kind === "route" &&
        (map.routes.find((route) => route.id === state.selection?.id)?.points ?? []).map((point, index) => (
          <circle
            key={`${state.selection?.id}-${index}`}
            cx={point.x}
            cy={point.y}
            r="0.13"
            fill="#111827"
            stroke="#fef3c7"
            strokeWidth="0.05"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (testMode) return;
              if (state.selection?.kind === "route") drag.current = { kind: "route-point", id: state.selection.id, index };
            }}
          />
        ))}
    </svg>
  );
}

function BoardShapeOverlay({
  boardShape,
  testMode,
  onPointDragStart,
  onSplitEdge,
}: {
  boardShape: MapBoardShape;
  testMode: boolean;
  onPointDragStart: (event: PointerEvent<SVGCircleElement>, point: MapGridPoint) => void;
  onSplitEdge: (edgeId: string, point: MapGridPoint) => void;
}) {
  const borderEdges = boardShape.borderEdges ?? [];
  const borderPoints = uniqueBorderPoints(borderEdges);

  return (
    <g>
      <rect
        x={boardShape.minX}
        y={boardShape.minY}
        width={boardShape.maxX - boardShape.minX}
        height={boardShape.maxY - boardShape.minY}
        fill="none"
        stroke="#334155"
        strokeWidth="0.05"
        strokeDasharray="0.18 0.12"
        opacity="0.75"
      />
      {(boardShape.blockedCells ?? []).map((cell) => (
        <g key={`${cell.x}-${cell.y}`} opacity="0.75">
          <rect x={cell.x - 0.5} y={cell.y - 0.5} width="1" height="1" fill="#78350f" opacity="0.18" />
          <path d={`M${cell.x - 0.42},${cell.y - 0.42} L${cell.x + 0.42},${cell.y + 0.42} M${cell.x + 0.42},${cell.y - 0.42} L${cell.x - 0.42},${cell.y + 0.42}`} stroke="#92400e" strokeWidth="0.04" strokeLinecap="round" />
        </g>
      ))}
      {(boardShape.borderEdges ?? []).map((edge) => (
        <line
          key={edge.id}
          x1={edge.from.x}
          y1={edge.from.y}
          x2={edge.to.x}
          y2={edge.to.y}
          stroke={edge.terrain ? TERRAIN_COLOR[edge.terrain] : "#111827"}
          strokeWidth="0.13"
          strokeLinecap="round"
          opacity="0.82"
        />
      ))}
      {borderEdges.map((edge) => {
        const midpoint = {
          x: roundToStep((edge.from.x + edge.to.x) / 2, 1),
          y: roundToStep((edge.from.y + edge.to.y) / 2, 1),
        };
        const canSplit = !samePoint(midpoint, edge.from) && !samePoint(midpoint, edge.to);
        if (!canSplit) return null;
        return (
          <g
            key={`${edge.id}-split`}
            className={testMode ? "" : "cursor-copy"}
            opacity={testMode ? 0.35 : 0.86}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!testMode) onSplitEdge(edge.id, midpoint);
            }}
          >
            <circle cx={midpoint.x} cy={midpoint.y} r="0.13" fill="#0f172a" stroke="#67e8f9" strokeWidth="0.045" />
            <path
              d={`M${midpoint.x - 0.055},${midpoint.y} H${midpoint.x + 0.055} M${midpoint.x},${midpoint.y - 0.055} V${midpoint.y + 0.055}`}
              stroke="#a7f3d0"
              strokeWidth="0.035"
              strokeLinecap="round"
            />
          </g>
        );
      })}
      {borderPoints.map((point) => (
        <circle
          key={pointKey(point)}
          cx={point.x}
          cy={point.y}
          r="0.16"
          fill="#34d399"
          stroke="#052e16"
          strokeWidth="0.055"
          className={testMode ? "" : "cursor-grab"}
          opacity={testMode ? 0.42 : 0.96}
          onPointerDown={(event) => onPointDragStart(event, point)}
        />
      ))}
    </g>
  );
}

const TERRACE_CORNERS: TerraceCorner[] = ["nw", "ne", "sw", "se"];

function TerraceShape({
  terrace,
  selected,
  interactive,
  onBodyPointerDown,
  onCornerPointerDown,
}: {
  terrace: MapTerrace;
  selected: boolean;
  interactive: boolean;
  onBodyPointerDown: (event: PointerEvent<SVGRectElement>) => void;
  onCornerPointerDown: (event: PointerEvent<SVGRectElement>, corner: TerraceCorner) => void;
}) {
  const width = Math.max(0.1, terrace.maxX - terrace.minX);
  const height = Math.max(0.1, terrace.maxY - terrace.minY);
  const fill = terrace.color ?? TERRACE_FILL[terrace.surface ?? "grass"];
  const stroke = darkenHex(fill, 0.68);
  const strokeWidth = 0.035 + Math.max(0, terrace.elevation) * 0.025;
  const chipLabel = `▲ ${formatElevation(terrace.elevation)}`;
  const chipWidth = 0.34 + chipLabel.length * 0.09;
  return (
    <g data-terrace-id={terrace.id} pointerEvents={interactive ? undefined : "none"}>
      <rect
        x={terrace.minX}
        y={terrace.minY}
        width={width}
        height={height}
        rx="0.18"
        fill={fill}
        opacity="0.45"
        stroke={stroke}
        strokeWidth={strokeWidth}
        className={interactive ? "cursor-move" : undefined}
        onPointerDown={onBodyPointerDown}
      />
      <g pointerEvents="none">
        <rect x={terrace.minX + 0.1} y={terrace.minY + 0.1} width={chipWidth} height="0.3" rx="0.09" fill="#0f172a" opacity="0.72" />
        <text x={terrace.minX + 0.1 + chipWidth / 2} y={terrace.minY + 0.32} textAnchor="middle" className="fill-amber-100 text-[0.16px] font-black">
          {chipLabel}
        </text>
        {terrace.label && (
          <text x={terrace.minX + width / 2} y={terrace.maxY - 0.14} textAnchor="middle" opacity="0.75" className="fill-slate-800 text-[0.16px] font-black">
            {terrace.label}
          </text>
        )}
      </g>
      {selected && (
        <g>
          <rect
            x={terrace.minX}
            y={terrace.minY}
            width={width}
            height={height}
            rx="0.18"
            fill="none"
            stroke="#34d399"
            strokeWidth="0.06"
            strokeDasharray="0.16 0.1"
            pointerEvents="none"
          />
          {TERRACE_CORNERS.map((corner) => {
            const x = corner === "nw" || corner === "sw" ? terrace.minX : terrace.maxX;
            const y = corner === "nw" || corner === "ne" ? terrace.minY : terrace.maxY;
            const diagonal = corner === "nw" || corner === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize";
            return (
              <rect
                key={corner}
                data-terrace-handle={corner}
                x={x - 0.12}
                y={y - 0.12}
                width="0.24"
                height="0.24"
                rx="0.05"
                fill="#ecfdf5"
                stroke="#065f46"
                strokeWidth="0.04"
                className={interactive ? diagonal : undefined}
                onPointerDown={(event) => onCornerPointerDown(event, corner)}
              />
            );
          })}
        </g>
      )}
    </g>
  );
}

function TerraceDraftShape({ rect }: { rect: { minX: number; minY: number; maxX: number; maxY: number } }) {
  return (
    <rect
      x={rect.minX}
      y={rect.minY}
      width={Math.max(0.1, rect.maxX - rect.minX)}
      height={Math.max(0.1, rect.maxY - rect.minY)}
      rx="0.18"
      fill="#34d399"
      opacity="0.22"
      stroke="#059669"
      strokeWidth="0.05"
      strokeDasharray="0.18 0.12"
      pointerEvents="none"
    />
  );
}

function RouteShape({
  route,
  map,
  selected,
  dispatch,
}: {
  route: MapRoute;
  map: MapDefinition;
  selected: boolean;
  dispatch: Dispatch<any>;
}) {
  const points = routePoints(map, route);
  if (points.length < 2) return null;
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  return (
    <g>
      <polyline
        points={polyline}
        fill="none"
        stroke="#172018"
        strokeWidth={selected ? "0.32" : "0.26"}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.28"
      />
      <polyline
        points={polyline}
        fill="none"
        stroke={TERRAIN_COLOR[route.terrain]}
        strokeWidth={selected ? "0.22" : "0.16"}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={route.terrain === "water" ? "0.15 0.12" : undefined}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          dispatch({ type: "select", selection: { kind: "route", id: route.id } });
        }}
      />
      {route.choiceLabel && (
        <text x={(points[0].x + points[points.length - 1].x) / 2} y={(points[0].y + points[points.length - 1].y) / 2 - 0.18} className="fill-slate-800 text-[0.22px] font-black">
          {route.choiceLabel}
        </text>
      )}
    </g>
  );
}

function NodeShape({
  tile,
  selected,
  testActive,
  pending,
  tool,
  pendingRouteFrom,
  testMode,
  simulationStats,
  simulationHeatMax,
  dispatch,
  onTestCellChange,
  onDragStart,
}: {
  tile: Tile;
  selected: boolean;
  testActive: boolean;
  pending: boolean;
  tool: BuilderTool;
  pendingRouteFrom: number | null;
  testMode: boolean;
  simulationStats?: SimulationCellStats;
  simulationHeatMax: number;
  dispatch: Dispatch<any>;
  onTestCellChange: (id: number) => void;
  onDragStart: () => void;
}) {
  const layout = tile.layout ?? { x: 0, y: 0 };
  const heat = simulationStats && simulationHeatMax > 0 ? simulationStats.landings / simulationHeatMax : 0;
  return (
    <g
      data-map-cell-id={tile.id}
      data-selected={selected ? "true" : "false"}
      transform={`translate(${layout.x} ${layout.y}) rotate(${layout.rot ?? 0})`}
      filter="url(#nodeShadow)"
      className="cursor-pointer"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (simulationStats) {
          onTestCellChange(tile.id);
          dispatch({ type: "select", selection: { kind: "node", id: tile.id } });
          return;
        }
        if (testMode) {
          onTestCellChange(tile.id);
          dispatch({ type: "select", selection: { kind: "node", id: tile.id } });
          return;
        }
        if (tool === "route") {
          if (pendingRouteFrom === null) dispatch({ type: "start_route", from: tile.id });
          else dispatch({ type: "finish_route", to: tile.id });
          return;
        }
        dispatch({ type: "select", selection: { kind: "node", id: tile.id } });
        onDragStart();
      }}
    >
      {simulationStats && (
        <circle
          data-heat-cell-id={tile.id}
          cx="0"
          cy="0"
          r={0.48 + heat * 0.22}
          fill={heat > 0.66 ? "#fb7185" : heat > 0.33 ? "#fb923c" : "#facc15"}
          fillOpacity={0.12 + heat * 0.48}
          stroke="#fff7d6"
          strokeOpacity={0.24 + heat * 0.46}
          strokeWidth="0.035"
          pointerEvents="none"
        >
          <title>{`Cell ${tile.id}: ${simulationStats.landings.toLocaleString()} trigger landings (${simulationStats.landingsPerGame.toFixed(2)} per game), ${simulationStats.passThroughs.toLocaleString()} pass-throughs, ${simulationStats.consequenceArrivals.toLocaleString()} consequence arrivals.`}</title>
        </circle>
      )}
      <rect
        x="-0.36"
        y="-0.28"
        width="0.72"
        height="0.56"
        rx="0.08"
        fill={TILE_COLOR[tile.type]}
        stroke={testActive ? "#34d399" : pending ? "#111827" : selected ? "#ffffff" : "#1f2937"}
        strokeWidth={testActive || selected || pending ? "0.07" : "0.035"}
      />
      {testActive && (
        <circle cx="0" cy="-0.48" r="0.13" fill="#34d399" stroke="#064e3b" strokeWidth="0.04" />
      )}
      <text x="0" y="-0.04" textAnchor="middle" className="pointer-events-none fill-slate-950 text-[0.22px] font-black">
        {tile.id}
      </text>
      <text x="0" y="0.17" textAnchor="middle" className="pointer-events-none fill-slate-950 text-[0.12px] font-bold">
        {shortType(tile.type)}
      </text>
    </g>
  );
}

function ArtifactShape({
  artifact,
  asset,
  selected,
  onSelect,
  onPointerDown,
  onScaleStart,
  onRotateStart,
}: {
  artifact: MapArtifact;
  asset?: MapAssetDef;
  selected: boolean;
  onSelect: () => void;
  onPointerDown: (event: PointerEvent<SVGGElement>) => void;
  onScaleStart: (event: PointerEvent<SVGCircleElement>) => void;
  onRotateStart: (event: PointerEvent<SVGCircleElement>) => void;
}) {
  const pos = artifact.position;
  const projection = projectArtifactFootprint(artifact, asset);
  const path = svgPathFromPlanePoints(projection.points);
  const rotateHandle = assetRotateHandlePoint(artifact, asset);
  const scaleHandle = assetScaleHandlePoint(artifact, asset);
  const labelX = (projection.bounds.minX + projection.bounds.maxX) / 2;
  const labelY = projection.bounds.maxY + 0.22;
  return (
    <g
      data-artifact-id={artifact.id}
      className="cursor-pointer"
      onPointerDown={onPointerDown}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect();
      }}
    >
      <path d={path} fill="transparent" stroke="transparent" strokeWidth="0.24" />
      <path
        d={path}
        fill={artifact.tint ?? asset?.color ?? artifactColor(asset?.kind)}
        stroke={selected ? "#111827" : "#ffffff"}
        strokeWidth="0.035"
        opacity={artifact.visible === false ? 0.35 : 0.9}
      />
      <circle cx={pos.x} cy={pos.y} r="0.055" fill="#f8fafc" stroke="#111827" strokeWidth="0.025" opacity="0.82" />
      {selected && (
        <g>
          <rect
            x={projection.bounds.minX}
            y={projection.bounds.minY}
            width={projection.width}
            height={projection.height}
            fill="none"
            stroke="#111827"
            strokeWidth="0.04"
            strokeDasharray="0.12 0.08"
          />
          <circle data-artifact-scale-handle="true" cx={scaleHandle.x} cy={scaleHandle.y} r="0.12" fill="#fef3c7" stroke="#111827" strokeWidth="0.04" className="cursor-nwse-resize" onPointerDown={onScaleStart} />
          <line x1={pos.x} y1={pos.y} x2={rotateHandle.x} y2={rotateHandle.y} stroke="#111827" strokeWidth="0.035" />
          <circle data-artifact-rotate-handle="true" cx={rotateHandle.x} cy={rotateHandle.y} r="0.11" fill="#bfdbfe" stroke="#111827" strokeWidth="0.04" className="cursor-grab" onPointerDown={onRotateStart} />
        </g>
      )}
      <text x={labelX} y={labelY} textAnchor="middle" className="pointer-events-none fill-slate-900 text-[0.13px] font-black">
        {artifact.label ?? asset?.name ?? artifact.assetId}
      </text>
    </g>
  );
}

/** Mini-mapa de un solo prop centrado, para mostrarlo aislado en el visor 3D.
 *  El piso se dimensiona según el tamaño del prop (auto-fit): props chicos quedan
 *  sobre un piso chico y se ven grandes; los grandes reciben más lugar. */
function buildPropPreviewMap(assetId: string, asset: MapAssetDef | undefined, scale: number): {
  board: Tile[];
  artifacts: MapArtifact[];
  boardShape: MapBoardShape;
} {
  const radius = (asset ? assetProjectionRadius(asset) : 0.6) * scale;
  const half = Math.min(4.5, Math.max(0.85, radius * 1.7));
  const boardShape: MapBoardShape = {
    minX: -half,
    minY: -half,
    maxX: half,
    maxY: half,
    blockedCells: [],
    borderEdges: [],
  };
  const artifacts: MapArtifact[] = assetId
    ? [{ id: "prop-preview", assetId, position: { x: 0, y: 0 }, scale }]
    : [];
  return { board: [], artifacts, boardShape };
}

/** Punto central del mapa activo, usado para dejar caer ahí el prop elegido en la galería. */
function mapCenterPoint(map: MapDefinition): TileLayout {
  const shape = map.boardShape;
  if (shape) return { x: (shape.minX + shape.maxX) / 2, y: (shape.minY + shape.maxY) / 2 };
  const layouts = map.board.map((tile) => tile.layout).filter((layout): layout is TileLayout => Boolean(layout));
  if (!layouts.length) return { x: 0, y: 0 };
  const sum = layouts.reduce((acc, layout) => ({ x: acc.x + layout.x, y: acc.y + layout.y }), { x: 0, y: 0 });
  return { x: sum.x / layouts.length, y: sum.y / layouts.length };
}

/**
 * Visor 3D de props: muestra un prop a la vez, aislado y en grande sobre un piso,
 * con cámara libre para girarlo/acercarlo. Se puede recorrer todo el catálogo y
 * colocar en el mapa el que se está viendo.
 */
function PropGalleryOverlay({
  assetCatalog,
  initialAssetId,
  onPlace,
  onClose,
}: {
  assetCatalog: MapAssetDef[];
  initialAssetId: string;
  onPlace: (assetId: string, scale: number) => void;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState(
    assetCatalog.some((asset) => asset.id === initialAssetId) ? initialAssetId : assetCatalog[0]?.id ?? ""
  );
  const [scale, setScale] = useState(() => assetCatalog.find((asset) => asset.id === initialAssetId)?.defaultScale ?? assetCatalog[0]?.defaultScale ?? 1);
  const [catalogOpen, setCatalogOpen] = useState(true);
  const [searchText, setSearchText] = useState("");
  const searchTerm = searchText.trim().toLowerCase();
  const filteredAssets = useMemo(() => {
    if (!searchTerm) return assetCatalog;
    return assetCatalog.filter((asset) => propSearchText(asset).includes(searchTerm));
  }, [assetCatalog, searchTerm]);
  const selectedIndex = filteredAssets.findIndex((asset) => asset.id === selectedId);
  const selectedAsset = selectedIndex >= 0 ? filteredAssets[selectedIndex] : undefined;
  const preview = useMemo(() => buildPropPreviewMap(selectedAsset?.id ?? "", selectedAsset, scale), [selectedAsset, scale]);

  useEffect(() => {
    if (selectedAsset || !filteredAssets.length) return;
    const next = filteredAssets[0];
    setSelectedId(next.id);
    setScale(next.defaultScale ?? 1);
  }, [filteredAssets, selectedAsset]);

  // Cambiar de prop resetea el tamaño al por defecto de ese prop.
  const selectProp = (id: string) => {
    setSelectedId(id);
    setScale(assetCatalog.find((asset) => asset.id === id)?.defaultScale ?? 1);
  };

  const step = (delta: number) => {
    if (!filteredAssets.length) return;
    const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const next = (currentIndex + delta + filteredAssets.length) % filteredAssets.length;
    selectProp(filteredAssets[next].id);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#101510]">
      <Board3DShell
        tiles={preview.board}
        routes={[]}
        artifacts={preview.artifacts}
        terraces={[]}
        assetCatalog={assetCatalog}
        boardShape={preview.boardShape}
        players={[]}
        freeCamera
        freeCameraRefit
        interactive
        className="absolute inset-0 overflow-hidden bg-[radial-gradient(ellipse_at_50%_-10%,#f2d8a7_0%,#dfa96b_34%,#96602c_66%,#38200c_100%)]"
      />

      <div className="pointer-events-none absolute inset-0 z-10 flex min-h-0 flex-col justify-between p-3 sm:p-5">
        <header className="pointer-events-auto flex flex-wrap items-start justify-between gap-3">
          <div className="rounded-lg border border-white/15 bg-slate-950/60 px-4 py-3 shadow-2xl shadow-black/30 backdrop-blur-md">
            <p className="text-[0.65rem] font-black uppercase tracking-[0.24em] text-cyan-200">Galería de props</p>
            <h2 className="mt-1 text-2xl font-black text-white">{selectedAsset ? assetOptionLabel(selectedAsset) : "Sin props"}</h2>
            <p className="mt-2 text-xs font-bold text-cyan-100/80">Arrastrá para orbitar · rueda para zoom · click derecho o Shift+arrastrar para desplazar</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-white/20 bg-slate-950/60 px-4 py-3 text-sm font-black text-white shadow-2xl backdrop-blur-md transition hover:bg-white/10">
            Close
          </button>
        </header>

        <section className="pointer-events-auto w-full rounded-lg border border-white/15 bg-slate-950/65 p-3 shadow-2xl shadow-black/35 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => step(-1)} disabled={!filteredAssets.length} className="builder-button compact disabled:opacity-40" aria-label="Prop anterior">◀</button>
              <span className="min-w-[4rem] text-center text-xs font-bold text-slate-300">{filteredAssets.length ? Math.max(selectedIndex, 0) + 1 : 0} / {filteredAssets.length}</span>
              <button type="button" onClick={() => step(1)} disabled={!filteredAssets.length} className="builder-button compact disabled:opacity-40" aria-label="Prop siguiente">▶</button>
              <button
                type="button"
                onClick={() => setCatalogOpen((open) => !open)}
                className="builder-button compact"
                aria-expanded={catalogOpen}
              >
                {catalogOpen ? "Catálogo ▾" : "Catálogo ▸"}
              </button>
              <label className="flex min-w-[13rem] items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-300">
                Buscar
                <input
                  type="search"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Nombre, tipo o id"
                  className="h-[1.9rem] min-w-0 flex-1 rounded-md border border-white/10 bg-[#0d120d] px-2 text-xs font-bold normal-case tracking-normal text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-300">Tamaño</span>
              <input
                type="range"
                min={0.3}
                max={3}
                step={0.05}
                value={scale}
                onChange={(event) => setScale(Number(event.target.value))}
                aria-label="Tamaño del prop"
                className="w-36 accent-cyan-400 sm:w-48"
              />
              <span className="w-12 text-right text-xs font-black text-cyan-100">{scale.toFixed(2)}×</span>
              <button
                type="button"
                onClick={() => setScale(selectedAsset?.defaultScale ?? 1)}
                className="builder-button compact"
                aria-label="Restablecer tamaño"
              >
                Reset
              </button>
            </div>
            <button
              type="button"
              onClick={() => selectedAsset && onPlace(selectedAsset.id, scale)}
              disabled={!selectedAsset}
              className="rounded-md border border-emerald-300/60 bg-emerald-400/20 px-4 py-2 text-sm font-black text-emerald-100 transition hover:bg-emerald-400/30 disabled:opacity-40"
            >
              Colocar en el mapa
            </button>
          </div>
          {catalogOpen && (
            <div className="mt-3 grid max-h-[30vh] grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2 overflow-y-auto overscroll-contain pr-1">
              {filteredAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => selectProp(asset.id)}
                  aria-pressed={asset.id === selectedId}
                  className={`flex items-center gap-2 rounded-md border px-2 py-2 text-left text-xs font-bold transition ${
                    asset.id === selectedId
                      ? "border-cyan-300/70 bg-cyan-400/20 text-cyan-100"
                      : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10"
                  }`}
                >
                  <span className="text-base leading-none">{ASSET_EMOJI[asset.id] ?? KIND_EMOJI[asset.kind] ?? KIND_EMOJI.custom}</span>
                  <span className="truncate">{asset.name}</span>
                </button>
              ))}
              {!filteredAssets.length && (
                <p className="col-span-full rounded-md border border-white/10 bg-black/25 px-3 py-4 text-center text-xs font-bold text-slate-300">
                  No props match that search.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Inspector({
  state,
  map,
  selectedNode,
  selectedRoute,
  selectedArtifact,
  selectedTerrace,
  dispatch,
  assetCatalog,
  validation,
  activeTab,
  onTabChange,
  cameraScope,
  onCameraScopeChange,
  content,
  simulationResult,
  onSimulationResult,
  onSelectSimulationCell,
}: {
  state: MapBuilderState;
  map: MapDefinition;
  selectedNode: Tile | null;
  selectedRoute: MapRoute | null;
  selectedArtifact: MapArtifact | null;
  selectedTerrace: MapTerrace | null;
  dispatch: Dispatch<any>;
  assetCatalog: MapAssetDef[];
  validation: string[];
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  cameraScope: CameraAuthoringScope;
  onCameraScopeChange: (scope: CameraAuthoringScope) => void;
  content: GameContent;
  simulationResult: MapSimulationResult | null;
  onSimulationResult: (result: MapSimulationResult) => void;
  onSelectSimulationCell: (tileId: number) => void;
}) {
  const selectionLabel = selectedNode
    ? `Cell ${selectedNode.id} · ${TILE_LABEL[selectedNode.type]}`
    : selectedRoute
      ? `Route ${selectedRoute.id}`
      : selectedArtifact
        ? selectedArtifact.label ?? selectedArtifact.assetId
        : selectedTerrace
          ? `Terrain ${selectedTerrace.label ?? selectedTerrace.id}`
          : "Nothing selected";
  const tabs: { id: InspectorTab; label: string; icon: ComponentType<{ className?: string }> }[] = [
    { id: "selection", label: "Selection", icon: MousePointer2 },
    { id: "camera", label: "Camera", icon: Camera },
    { id: "map", label: "Map", icon: MapIcon },
    { id: "simulation", label: "Simulation", icon: Activity },
  ];

  return (
    <div className="min-h-full">
      <div className="sticky -top-3 z-20 -mx-3 -mt-3 mb-4 border-b border-white/10 bg-[#111811]/95 px-3 pb-3 pt-3 shadow-lg shadow-black/15 backdrop-blur-md">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-emerald-300">Inspector</p>
            <p className="mt-1 truncate text-sm font-black text-white">{selectionLabel}</p>
          </div>
          <span
            className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${validation.length ? "bg-rose-400" : "bg-emerald-300"}`}
            title={validation.length ? `${validation.length} validation issue${validation.length === 1 ? "" : "s"}` : "Map is valid"}
          />
        </div>
        <div role="tablist" aria-label="Map inspector" className="grid grid-cols-4 rounded-md border border-white/10 bg-black/20 p-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => onTabChange(id)}
              className={`flex min-h-10 items-center justify-center gap-1.5 rounded-sm px-2 text-[0.68rem] font-black transition ${
                activeTab === id
                  ? "bg-emerald-300 text-emerald-950 shadow-sm"
                  : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "selection" && (
        <div className="grid gap-4">
          {selectedNode && <NodeInspector tile={selectedNode} map={map} content={content} dispatch={dispatch} />}
          {selectedRoute && <RouteInspector route={selectedRoute} board={map.board} dispatch={dispatch} />}
          {selectedArtifact && <ArtifactInspector artifact={selectedArtifact} assetCatalog={assetCatalog} dispatch={dispatch} />}
          {selectedTerrace && <TerraceInspector terrace={selectedTerrace} dispatch={dispatch} />}
          {!selectedNode && !selectedRoute && !selectedArtifact && !selectedTerrace && (
            <section className="rounded-md border border-dashed border-white/15 bg-white/[0.025] p-4 text-sm text-slate-300">
              <MousePointer2 className="h-5 w-5 text-emerald-300" />
              <p className="mt-3 font-black text-white">Select something on the map</p>
              <p className="mt-1 leading-5 text-slate-400">Cells, routes, props, and terrain expose their settings here.</p>
            </section>
          )}

          {state.selection && (
            <button type="button" onClick={() => dispatch({ type: "delete_selected" })} className="builder-button danger w-full">
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete selected
            </button>
          )}
        </div>
      )}

      {activeTab === "camera" && (
        <CameraInspector map={map} tile={selectedNode} dispatch={dispatch} scope={cameraScope} onScopeChange={onCameraScopeChange} />
      )}

      {activeTab === "map" && (
        <div className="grid gap-5">
          <BoardShapeInspector boardShape={map.boardShape} dispatch={dispatch} />
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-xs font-black uppercase tracking-[0.16em] text-slate-300">Validation</h2>
              <span className={`text-[0.62rem] font-black uppercase ${validation.length ? "text-rose-300" : "text-emerald-300"}`}>
                {validation.length ? `${validation.length} issue${validation.length === 1 ? "" : "s"}` : "Ready"}
              </span>
            </div>
            {validation.length === 0 ? (
              <p className="rounded-md border border-emerald-300/20 bg-emerald-300/10 p-3 text-sm font-bold text-emerald-100">Map graph is valid.</p>
            ) : (
              <ul className="grid gap-1.5 text-sm text-rose-200">
                {validation.map((error) => (
                  <li key={error} className="rounded-md border border-rose-300/20 bg-rose-300/10 p-2.5">
                    {error}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {activeTab === "simulation" && (
        <MapSimulationPanel
          key={map.id}
          content={content}
          map={map}
          result={simulationResult}
          onResult={onSimulationResult}
          selectedCellId={selectedNode?.id}
          onSelectCell={onSelectSimulationCell}
          onEditSelected={() => onTabChange("selection")}
        />
      )}
    </div>
  );
}

function BoardShapeInspector({ boardShape, dispatch }: { boardShape?: MapBoardShape; dispatch: Dispatch<any> }) {
  const shape = boardShape ?? { minX: 0, minY: 0, maxX: 8, maxY: 6, blockedCells: [], borderEdges: [] };
  const [blockedPoint, setBlockedPoint] = useState<MapGridPoint>({ x: shape.minX, y: shape.minY });

  return (
    <section data-board-shape-inspector="true">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Board shape</h2>
        <button type="button" onClick={() => dispatch({ type: "reset_border_edges" })} className="builder-button compact">
          Reset outline
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberInput label="Min X" value={shape.minX} step={1} onChange={(minX) => dispatch({ type: "update_board_shape", patch: { minX } })} />
        <NumberInput label="Min Y" value={shape.minY} step={1} onChange={(minY) => dispatch({ type: "update_board_shape", patch: { minY } })} />
        <NumberInput label="Max X" value={shape.maxX} step={1} onChange={(maxX) => dispatch({ type: "update_board_shape", patch: { maxX } })} />
        <NumberInput label="Max Y" value={shape.maxY} step={1} onChange={(maxY) => dispatch({ type: "update_board_shape", patch: { maxY } })} />
      </div>

      <div className="mt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Odd shape cells</h3>
          <button type="button" onClick={() => dispatch({ type: "toggle_blocked_cell", point: blockedPoint })} className="builder-button compact">
            Toggle
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="Block X" value={blockedPoint.x} step={1} onChange={(x) => setBlockedPoint((point) => ({ ...point, x }))} />
          <NumberInput label="Block Y" value={blockedPoint.y} step={1} onChange={(y) => setBlockedPoint((point) => ({ ...point, y }))} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {(shape.blockedCells ?? []).map((cell) => (
            <button
              key={`${cell.x}-${cell.y}`}
              type="button"
              onClick={() => dispatch({ type: "toggle_blocked_cell", point: cell })}
              className="rounded-md border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-xs font-black text-amber-100"
            >
              {cell.x},{cell.y}
            </button>
          ))}
          {(shape.blockedCells ?? []).length === 0 && <p className="text-xs font-bold text-slate-500">No blocked cells</p>}
        </div>
      </div>
    </section>
  );
}

function CameraInspector({
  map,
  tile,
  dispatch,
  scope,
  onScopeChange,
}: {
  map: MapDefinition;
  tile: Tile | null;
  dispatch: Dispatch<any>;
  scope: CameraAuthoringScope;
  onScopeChange: (scope: CameraAuthoringScope) => void;
}) {
  const defaultCamera = map.defaultCamera ?? DEFAULT_CAMERA_FRAMING;
  const hasCellCamera = Boolean(tile?.cameraPresetId || tile?.camera);
  const cellCamera = tile ? resolveTileCamera(tile, map.cameraPresets) ?? defaultCamera : defaultCamera;

  const setCellCamera = (camera: CameraFramingDef) => {
    if (!tile) return;
    const presetId = tile.cameraPresetId || cameraPresetIdForTile(tile);
    dispatch({
      type: "update_map",
      patch: {
        cameraPresets: {
          ...(map.cameraPresets ?? {}),
          [presetId]: { ...camera, id: presetId },
        },
      },
    });
    dispatch({ type: "update_node", id: tile.id, patch: { cameraPresetId: presetId, camera: undefined } });
  };

  const clearCellCamera = () => {
    if (!tile) return;
    const presetId = tile.cameraPresetId;
    if (presetId) {
      const cameraPresets = { ...(map.cameraPresets ?? {}) };
      const usedElsewhere = map.board.some((candidate) => candidate.id !== tile.id && candidate.cameraPresetId === presetId);
      if (!usedElsewhere) delete cameraPresets[presetId];
      dispatch({ type: "update_map", patch: { cameraPresets: Object.keys(cameraPresets).length ? cameraPresets : undefined } });
    }
    dispatch({ type: "update_node", id: tile.id, patch: { cameraPresetId: undefined, camera: undefined } });
  };

  return (
    <div className="grid gap-4" data-camera-inspector="true">
      <header>
        <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-cyan-300">Presentation</p>
        <h2 className="mt-1 text-lg font-black text-white">Camera framing</h2>
        <p className="mt-1 text-xs font-bold leading-5 text-slate-400">Choose which shot you are editing. The floating 3D preview follows this selection.</p>
      </header>

      <div role="radiogroup" aria-label="Camera scope" className="grid grid-cols-2 rounded-md border border-cyan-200/15 bg-cyan-300/[0.045] p-1">
        <button
          type="button"
          aria-pressed={scope === "default"}
          onClick={() => onScopeChange("default")}
          className={`min-w-0 rounded-sm px-3 py-2.5 text-left transition ${
            scope === "default" ? "bg-cyan-300 text-cyan-950 shadow-sm" : "text-cyan-100 hover:bg-white/[0.05]"
          }`}
        >
          <span className="flex items-center gap-2 text-xs font-black"><Camera className="h-3.5 w-3.5" />Board default</span>
          <span className={`mt-1 block truncate text-[0.62rem] font-bold ${scope === "default" ? "text-cyan-900/70" : "text-slate-500"}`}>Fallback shot</span>
        </button>
        <button
          type="button"
          aria-pressed={scope === "cell"}
          disabled={!tile}
          onClick={() => tile && onScopeChange("cell")}
          className={`min-w-0 rounded-sm px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
            scope === "cell" ? "bg-cyan-300 text-cyan-950 shadow-sm" : "text-cyan-100 hover:bg-white/[0.05]"
          }`}
        >
          <span className="flex items-center gap-2 text-xs font-black"><MapPin className="h-3.5 w-3.5" />{tile ? `Cell ${tile.id}` : "Select a cell"}</span>
          <span className={`mt-1 block truncate text-[0.62rem] font-bold ${scope === "cell" ? "text-cyan-900/70" : "text-slate-500"}`}>
            {tile ? (hasCellCamera ? "Custom shot" : "Uses board default") : "No cell selected"}
          </span>
        </button>
      </div>

      {scope === "cell" && tile && !hasCellCamera ? (
        <section className="rounded-md border border-cyan-200/20 bg-cyan-300/[0.06] p-4" data-camera-inherited="true">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-cyan-300/15 text-cyan-200">
              <Copy className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black text-white">Cell {tile.id} inherits the board camera</h3>
              <p className="mt-1 text-xs font-bold leading-5 text-slate-400">Board-camera changes continue to affect this cell until you create a custom shot.</p>
            </div>
          </div>
          <CameraReadout camera={cellCamera} />
          <button type="button" onClick={() => setCellCamera(cellCamera)} className="builder-button preview mt-4 w-full">
            <Camera className="mr-1.5 h-3.5 w-3.5" />
            Customize this cell
          </button>
        </section>
      ) : (
        <CameraEditor
          title={scope === "cell" && tile ? `Cell ${tile.id} camera` : "Board default camera"}
          eyebrow={scope === "cell" && tile ? tile.cameraPresetId ?? "Custom framing" : map.defaultCamera ? "Authored default" : "Built-in baseline"}
          description={
            scope === "cell" && tile
              ? "Used temporarily when this cell presents an event, shop, minigame, or reveal."
              : "Used across the board whenever a cell does not have its own shot."
          }
          camera={scope === "cell" ? cellCamera : defaultCamera}
          onChange={scope === "cell" ? setCellCamera : (camera) => dispatch({ type: "update_map", patch: { defaultCamera: camera } })}
          onClear={scope === "cell" ? clearCellCamera : () => dispatch({ type: "update_map", patch: { defaultCamera: undefined } })}
          resetLabel={scope === "cell" ? "Use board default" : "Restore baseline"}
          canReset={scope === "cell" ? hasCellCamera : Boolean(map.defaultCamera)}
        />
      )}
    </div>
  );
}

function CameraReadout({ camera }: { camera: CameraFramingDef }) {
  const focus = camera.focus === "activePlayer" ? "Player" : camera.focus === "cell" ? "Cell" : "Target";
  return (
    <dl className="mt-4 grid grid-cols-3 gap-x-3 gap-y-2 border-t border-white/10 pt-3 text-xs">
      <div><dt className="text-[0.6rem] font-black uppercase text-slate-500">Focus</dt><dd className="mt-1 font-black text-slate-200">{focus}</dd></div>
      <div><dt className="text-[0.6rem] font-black uppercase text-slate-500">Direction</dt><dd className="mt-1 font-black text-slate-200">{camera.yaw}°</dd></div>
      <div><dt className="text-[0.6rem] font-black uppercase text-slate-500">Distance</dt><dd className="mt-1 font-black text-slate-200">{camera.distance}</dd></div>
      <div><dt className="text-[0.6rem] font-black uppercase text-slate-500">Tilt</dt><dd className="mt-1 font-black text-slate-200">{camera.pitch}°</dd></div>
      <div><dt className="text-[0.6rem] font-black uppercase text-slate-500">FOV</dt><dd className="mt-1 font-black text-slate-200">{camera.fov ?? 42}°</dd></div>
    </dl>
  );
}

function NodeInspector({ tile, map, content, dispatch }: { tile: Tile; map: MapDefinition; content: GameContent; dispatch: Dispatch<any> }) {
  const layout = tile.layout ?? { x: 0, y: 0 };
  const previewContent = useMemo(() => ({ ...content, board: map.board }), [content, map.board]);
  const [previewPlayerId, setPreviewPlayerId] = useState(() => content.players[0]?.id ?? "");
  const previewPlayer = content.players.find((player) => player.id === previewPlayerId) ?? content.players[0];
  const resolvedEvent = previewPlayer ? resolveTileEventForPlayer(previewContent, tile, previewPlayer) : null;
  const eventOptions = [{ value: "", label: "None" }, ...Object.keys(content.events).map((id) => ({ value: id, label: eventTitle(content.events[id]) }))];
  const queueActivityTypes = useMemo(
    () => [...new Set(Object.values(content.events).map((event) => event.activity?.type ?? "prompt"))] as EventActivityType[],
    [content.events]
  );
  const queueType = tile.eventQueue?.activityTypes[0] ?? "";
  const sharedPoolSize = sharedEventIdsForTile(previewContent, tile).length;

  return (
    <div className="grid gap-4">
      <InspectorGroup title="Cell setup" description="What this space is and how it appears on the board.">
        <SelectInput
          label="Type"
          value={tile.type}
          options={TILE_TYPES.map((type) => ({ value: type, label: TILE_LABEL[type] }))}
          onChange={(type) => dispatch({ type: "update_node", id: tile.id, patch: { type: type as TileType } })}
        />
        <TextInput label="Label" value={tile.label ?? ""} onChange={(label) => dispatch({ type: "update_node", id: tile.id, patch: { label: label || undefined } })} />
      </InspectorGroup>

      <InspectorGroup title="Content" description="Anchor a cinematic event, draw from a shared activity queue, or combine both.">
        <SelectInput
          label="Anchored event"
          value={tile.eventId ?? ""}
          options={optionsWithOrphan(tile.eventId ?? "", eventOptions)}
          onChange={(eventId) => dispatch({ type: "update_node", id: tile.id, patch: { eventId: eventId || undefined, eventIds: undefined } })}
        />
        <div className="mt-3">
          <SelectInput
            label="Shared activity queue"
            value={queueType}
            options={[
              { value: "", label: "None" },
              ...queueActivityTypes.map((type) => ({ value: type, label: activityLabel(type) })),
            ]}
            onChange={(activityType) => dispatch({
              type: "update_node",
              id: tile.id,
              patch: { eventQueue: activityType ? { activityTypes: [activityType as EventActivityType] } : undefined },
            })}
          />
        </div>
        {(tile.eventIds?.length ?? 0) > 0 && (
          <p className="mt-2 rounded-md border border-white/10 bg-black/20 px-2.5 py-2 text-[0.68rem] font-bold leading-4 text-slate-400">
            This cell also has a local authored pool of {tile.eventIds!.length} events. It runs before the shared queue.
          </p>
        )}
        {tile.eventQueue && (
          <p className="mt-2 rounded-md border border-amber-300/20 bg-amber-300/[0.07] px-2.5 py-2 text-[0.68rem] font-bold leading-4 text-amber-100/80">
            {sharedPoolSize} unanchored {activityLabel(queueType)} events share one no-repeat queue across the map.
            {tile.eventId || tile.eventIds?.length ? " The anchored or local event plays first on this cell." : ""}
          </p>
        )}
        {(tile.eventId || tile.eventIds?.length || tile.eventQueue) && (
          <div className="mt-3 rounded-md border border-cyan-300/20 bg-cyan-300/[0.07] p-3">
            <SelectInput
              label="Preview as"
              value={previewPlayerId}
              options={content.players.map((player) => ({ value: player.id, label: player.name }))}
              onChange={setPreviewPlayerId}
            />
            <p className="mt-2 text-sm font-black leading-5 text-white">{resolvedEvent ? eventTitle(resolvedEvent) : tile.eventId ?? "No eligible event"}</p>
            {resolvedEvent?.story.prompt && <p className="mt-1 text-xs font-bold leading-5 text-cyan-100/80">{resolvedEvent.story.prompt}</p>}
            {resolvedEvent?.activity && <p className="mt-2 text-[0.62rem] font-black uppercase tracking-[0.12em] text-cyan-200">{activityLabel(resolvedEvent.activity.type)}</p>}
            {!resolvedEvent && <p className="mt-1 text-xs font-bold leading-5 text-cyan-100">No event matches this player.</p>}
          </div>
        )}
      </InspectorGroup>

      <InspectorGroup title="Placement" description="Fine-tune the cell after positioning it on the canvas.">
        <CoordinateInputs
          layout={layout}
          onChange={(next) => dispatch({ type: "update_node", id: tile.id, patch: { layout: next } })}
        />
      </InspectorGroup>
    </div>
  );
}

function InspectorGroup({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="border-b border-white/10 pb-4 last:border-b-0 last:pb-0">
      <h2 className="text-xs font-black uppercase tracking-[0.15em] text-slate-300">{title}</h2>
      <p className="mt-1 text-[0.68rem] font-bold leading-4 text-slate-500">{description}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function CameraEditor({
  title,
  eyebrow,
  description,
  camera,
  onChange,
  onClear,
  resetLabel,
  canReset,
}: {
  title: string;
  eyebrow: string;
  description: string;
  camera: CameraFramingDef;
  onChange: (camera: CameraFramingDef) => void;
  onClear: () => void;
  resetLabel: string;
  canReset: boolean;
}) {
  const focusOffset = camera.focusOffset ?? { x: 0, y: 0, z: 0 };
  const activeYaw = ((Math.round(camera.yaw) % 360) + 360) % 360;
  const patch = (next: Partial<CameraFramingDef>) => onChange(normalizeCamera({ ...camera, ...next }));
  const patchOffset = (next: Partial<NonNullable<CameraFramingDef["focusOffset"]>>) => {
    const offset = { ...focusOffset, ...next };
    patch({
      focusOffset: offset.x || offset.y || offset.z ? offset : undefined,
    });
  };

  return (
    <section data-camera-editor="true" className="rounded-md border border-cyan-200/15 bg-cyan-300/[0.045] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[0.58rem] font-black uppercase tracking-[0.16em] text-cyan-300/75">{eyebrow}</p>
          <h2 className="mt-1 text-base font-black text-white">{title}</h2>
          <p className="mt-1 text-xs font-bold leading-5 text-slate-400">{description}</p>
        </div>
        <button
          type="button"
          onClick={canReset ? onClear : undefined}
          aria-disabled={!canReset || undefined}
          className={`builder-button compact shrink-0 ${canReset ? "" : "is-disabled"}`}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          {resetLabel}
        </button>
      </div>

      <div className="mt-4 border-t border-white/10 pt-4">
        <CameraFocusControl value={camera.focus} onChange={(focus) => patch({ focus })} />
      </div>

      <div className="mt-4 border-t border-white/10 pt-4">
        <CameraGroupHeading title="Angle" description="Choose the viewing direction, then fine-tune it." />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <NumberInput label="Direction (yaw)" value={camera.yaw} step={5} onChange={(yaw) => patch({ yaw })} />
          <NumberInput label="Tilt (pitch)" value={camera.pitch} step={1} onChange={(pitch) => patch({ pitch })} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {[
            { yaw: 0, label: "Front" },
            { yaw: 90, label: "Right" },
            { yaw: 180, label: "Back" },
            { yaw: 270, label: "Left" },
          ].map((angle) => (
            <button
              key={angle.yaw}
              type="button"
              aria-pressed={activeYaw === angle.yaw}
              onClick={() => patch({ yaw: angle.yaw })}
              className={`flex min-h-9 items-center justify-between rounded-md border px-2.5 text-xs font-black transition ${
                activeYaw === angle.yaw
                  ? "border-cyan-200/60 bg-cyan-300/20 text-cyan-100"
                  : "border-white/10 bg-white/[0.035] text-slate-300 hover:bg-white/[0.07]"
              }`}
            >
              <span>{angle.label}</span>
              <span className="text-[0.62rem] opacity-70">{angle.yaw}°</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 border-t border-white/10 pt-4">
        <CameraGroupHeading title="Lens" description="Distance changes how close the shot feels; FOV changes how wide it is." />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <NumberInput label="Distance" value={camera.distance} step={0.25} onChange={(distance) => patch({ distance })} />
          <NumberInput label="Field of view" value={camera.fov ?? DEFAULT_CAMERA_FRAMING.fov ?? 42} step={1} onChange={(fov) => patch({ fov })} />
        </div>
      </div>

      <div className="mt-4 border-t border-white/10 pt-4">
        <CameraGroupHeading title="Target offset" description="Nudge the point kept in frame without moving the map or player." />
        <div className="mt-3 grid grid-cols-3 gap-2">
          <NumberInput label="X" value={focusOffset.x} step={0.25} onChange={(x) => patchOffset({ x })} />
          <NumberInput label="Y" value={focusOffset.y ?? 0} step={0.25} onChange={(y) => patchOffset({ y })} />
          <NumberInput label="Z" value={focusOffset.z} step={0.25} onChange={(z) => patchOffset({ z })} />
        </div>
      </div>
    </section>
  );
}

function CameraFocusControl({ value, onChange }: { value: CameraFramingDef["focus"]; onChange: (focus: CameraFramingDef["focus"]) => void }) {
  const options: { value: CameraFramingDef["focus"]; label: string; help: string; icon: ComponentType<{ className?: string }> }[] = [
    { value: "activePlayer", label: "Player", help: "Follows the player taking the turn.", icon: User },
    { value: "cell", label: "Cell", help: "Keeps the selected cell center in frame.", icon: MapPin },
    { value: "targetPlayer", label: "Target", help: "Frames the targeted player when the flow has one.", icon: Target },
  ];
  const active = options.find((option) => option.value === value) ?? options[0];

  return (
    <div>
      <CameraGroupHeading title="Keep in frame" description={active.help} />
      <div role="radiogroup" aria-label="Camera focus" className="mt-3 grid grid-cols-3 gap-1.5">
        {options.map(({ value: optionValue, label, icon: Icon }) => (
          <button
            key={optionValue}
            type="button"
            aria-pressed={value === optionValue}
            onClick={() => onChange(optionValue)}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-md border px-2 text-[0.68rem] font-black transition ${
              value === optionValue
                ? "border-cyan-200/60 bg-cyan-300/20 text-cyan-100"
                : "border-white/10 bg-white/[0.035] text-slate-300 hover:bg-white/[0.07]"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CameraGroupHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-[0.65rem] font-black uppercase tracking-[0.14em] text-slate-300">{title}</h3>
      <p className="mt-1 text-[0.68rem] font-bold leading-4 text-slate-500">{description}</p>
    </div>
  );
}

function cameraPresetIdForTile(tile: Pick<Tile, "id">): string {
  return `cell-${tile.id}-camera`;
}

function normalizeCamera(camera: CameraFramingDef): CameraFramingDef {
  return {
    ...camera,
    pitch: clampNumber(camera.pitch, -85, 85),
    distance: clampNumber(camera.distance, 0.8, 80),
    fov: camera.fov === undefined ? undefined : clampNumber(camera.fov, 18, 80),
    focusOffset: camera.focusOffset
      ? {
          x: roundToStep(camera.focusOffset.x, 0.01),
          y: camera.focusOffset.y === undefined ? undefined : roundToStep(camera.focusOffset.y, 0.01),
          z: roundToStep(camera.focusOffset.z, 0.01),
        }
      : undefined,
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function RouteInspector({ route, board, dispatch }: { route: MapRoute; board: Tile[]; dispatch: Dispatch<any> }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Route {route.id}</h2>
      <div className="grid grid-cols-2 gap-2">
        <SelectInput
          label="From"
          value={String(route.from)}
          options={board.map((tile) => ({ value: String(tile.id), label: `${tile.id} ${tile.label ?? tile.type}` }))}
          onChange={(from) => dispatch({ type: "update_route", id: route.id, patch: { from: Number(from) } })}
        />
        <SelectInput
          label="To"
          value={String(route.to)}
          options={board.map((tile) => ({ value: String(tile.id), label: `${tile.id} ${tile.label ?? tile.type}` }))}
          onChange={(to) => dispatch({ type: "update_route", id: route.id, patch: { to: Number(to) } })}
        />
      </div>
      <SelectInput
        label="Terrain"
        value={route.terrain}
        options={TERRAIN_TYPES.map((terrain) => ({ value: terrain, label: terrain }))}
        onChange={(terrain) => dispatch({ type: "update_route", id: route.id, patch: { terrain: terrain as MapTerrain } })}
      />
      <TextInput
        label="Choice label"
        value={route.choiceLabel ?? ""}
        onChange={(choiceLabel) => dispatch({ type: "update_route", id: route.id, patch: { choiceLabel: choiceLabel || undefined } })}
      />
      <label className="mt-2 flex items-center gap-2 text-sm font-bold text-slate-300">
        <input
          type="checkbox"
          checked={!!route.bidirectional}
          onChange={(event) => dispatch({ type: "update_route", id: route.id, patch: { bidirectional: event.target.checked || undefined } })}
        />
        Bidirectional
      </label>
      <div className="mt-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Shape points</h3>
          <button type="button" onClick={() => dispatch({ type: "add_route_point", id: route.id })} className="builder-button compact">
            Add
          </button>
        </div>
        {(route.points ?? []).map((point, index) => (
          <div key={index} className="mb-2 grid grid-cols-[1fr_1fr_2rem] gap-2">
            <NumberInput label={`x${index + 1}`} value={point.x} onChange={(x) => dispatch({ type: "update_route_point", id: route.id, index, point: { ...point, x } })} />
            <NumberInput label={`y${index + 1}`} value={point.y} onChange={(y) => dispatch({ type: "update_route_point", id: route.id, index, point: { ...point, y } })} />
            <button type="button" onClick={() => dispatch({ type: "remove_route_point", id: route.id, index })} className="builder-button danger compact mt-5">
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function ArtifactInspector({ artifact, assetCatalog, dispatch }: { artifact: MapArtifact; assetCatalog: MapAssetDef[]; dispatch: Dispatch<any> }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Map prop</h2>
      <SelectInput
        label="Asset"
        value={artifact.assetId}
        options={assetCatalog.map((asset) => ({ value: asset.id, label: assetOptionLabel(asset) }))}
        onChange={(assetId) => dispatch({ type: "update_artifact", id: artifact.id, patch: { assetId } })}
      />
      <TextInput label="Label" value={artifact.label ?? ""} onChange={(label) => dispatch({ type: "update_artifact", id: artifact.id, patch: { label: label || undefined } })} />
      <CoordinateInputs
        layout={artifact.position}
        onChange={(position) => dispatch({ type: "update_artifact", id: artifact.id, patch: { position } })}
      />
      <NumberInput label="Scale" value={artifact.scale ?? 1} step={0.1} onChange={(scale) => dispatch({ type: "update_artifact", id: artifact.id, patch: { scale } })} />
      <ColorInput label="Tint" value={artifact.tint} onChange={(tint) => dispatch({ type: "update_artifact", id: artifact.id, patch: { tint } })} />
      <label className="mt-2 flex items-center gap-2 text-sm font-bold text-slate-300">
        <input
          type="checkbox"
          checked={artifact.visible !== false}
          onChange={(event) => dispatch({ type: "update_artifact", id: artifact.id, patch: { visible: event.target.checked || false } })}
        />
        Visible
      </label>
    </section>
  );
}

function TerraceInspector({ terrace, dispatch }: { terrace: MapTerrace; dispatch: Dispatch<any> }) {
  const patch = (value: Partial<Omit<MapTerrace, "id">>) => dispatch({ type: "update_terrace", id: terrace.id, patch: value });
  return (
    <section data-terrace-inspector="true">
      <h2 className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Meseta {terrace.id}</h2>
      <div className="grid grid-cols-2 gap-2">
        <NumberInput label="Min X" value={terrace.minX} step={0.5} onChange={(minX) => patch({ minX })} />
        <NumberInput label="Min Y" value={terrace.minY} step={0.5} onChange={(minY) => patch({ minY })} />
        <NumberInput label="Max X" value={terrace.maxX} step={0.5} onChange={(maxX) => patch({ maxX })} />
        <NumberInput label="Max Y" value={terrace.maxY} step={0.5} onChange={(maxY) => patch({ maxY })} />
      </div>
      <div className="mt-2">
        <NumberInput label="Elevación" value={terrace.elevation} step={0.05} onChange={(elevation) => patch({ elevation })} />
        <div className="mt-1 flex flex-wrap gap-1">
          {TERRACE_ELEVATION_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => patch({ elevation: preset })}
              className={`rounded-md border px-2 py-1 text-xs font-black transition ${
                terrace.elevation === preset
                  ? "border-emerald-300 bg-emerald-300 text-emerald-950"
                  : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
              }`}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2">
        <SelectInput
          label="Superficie"
          value={terrace.surface ?? "grass"}
          options={TERRACE_SURFACES.map((surface) => ({ value: surface, label: TERRACE_SURFACE_LABEL[surface] }))}
          onChange={(surface) => patch({ surface: surface as MapTerraceSurface })}
        />
      </div>
      <TextInput
        label="Color (hex, opcional)"
        value={terrace.color ?? ""}
        onChange={(color) => patch({ color: color.trim() || undefined })}
      />
      <TextInput label="Etiqueta" value={terrace.label ?? ""} onChange={(label) => patch({ label: label || undefined })} />
      <button type="button" onClick={() => dispatch({ type: "delete_selected" })} className="builder-button danger mt-2 w-full">
        Eliminar meseta
      </button>
    </section>
  );
}

function CoordinateInputs({ layout, onChange }: { layout: TileLayout; onChange: (layout: TileLayout) => void }) {
  return (
    <div className="mt-2">
      <div className="grid grid-cols-2 gap-2">
        <NumberInput label="X" value={layout.x} onChange={(x) => onChange({ ...layout, x })} />
        <NumberInput label="Y" value={layout.y} onChange={(y) => onChange({ ...layout, y })} />
        <NumberInput label="Alt. extra" value={layout.z ?? 0} step={0.05} onChange={(z) => onChange({ ...layout, z })} />
        <NumberInput label="Rot" value={layout.rot ?? 0} step={5} onChange={(rot) => onChange({ ...layout, rot })} />
      </div>
      <p className="mt-1 text-[0.62rem] font-bold leading-4 text-slate-500">
        La altura del terreno ahora la dan las mesetas (herramienta Terreno); “Alt. extra” se suma encima.
      </p>
    </div>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mb-2 block text-xs font-bold text-slate-300">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-white/10 bg-[#0d120d] px-3 py-2 text-sm text-white outline-none focus:border-emerald-300" />
    </label>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value?: string; onChange: (value: string | undefined) => void }) {
  const valid = value ? HEX_COLOR_RE.test(value) : true;
  const colorValue = value && COLOR_INPUT_HEX_RE.test(value) ? value : "#ffffff";

  return (
    <label className="mb-2 block text-xs font-bold text-slate-300">
      {label}
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          value={colorValue}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-white/10 bg-[#0d120d]"
          aria-label={`${label} color`}
        />
        <input
          value={value ?? ""}
          placeholder="#rrggbb"
          onChange={(event) => onChange(event.target.value || undefined)}
          className="w-full rounded-md border border-white/10 bg-[#0d120d] px-3 py-2 text-sm text-white outline-none focus:border-emerald-300"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            aria-label={`Clear ${label}`}
            className="shrink-0 rounded-md border border-white/10 px-2 py-2 text-xs text-slate-300 hover:border-white/30"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {value && !valid ? <span className="mt-1 block text-[0.7rem] font-bold text-amber-400">Hex invalido (ej. #a855f7)</span> : null}
    </label>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mb-2 block text-xs font-bold text-slate-300">
      {label}
      <textarea value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-20 w-full resize-none rounded-md border border-white/10 bg-[#0d120d] px-3 py-2 text-sm text-white outline-none focus:border-emerald-300" />
    </label>
  );
}

function NumberInput({ label, value, onChange, step = 0.25 }: { label: string; value: number; onChange: (value: number) => void; step?: number }) {
  return (
    <label className="block text-xs font-bold text-slate-300">
      {label}
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded-md border border-white/10 bg-[#0d120d] px-2 py-2 text-sm text-white outline-none focus:border-emerald-300"
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
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="mb-2 block text-xs font-bold text-slate-300">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-white/10 bg-[#0d120d] px-3 py-2 text-sm text-white outline-none focus:border-emerald-300">
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function loadInitialState(): MapBuilderState {
  return createInitialMapBuilderState(BASE_CONTENT);
}

function loadSavedBuilderContent(): BuilderContent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const content = JSON.parse(raw);
      if (content?.maps?.length) {
        return normalizeBuilderContent({
          ...BASE_CONTENT,
          ...content,
          assetCatalog: mergeAssetCatalog(content.assetCatalog, BASE_CONTENT.assetCatalog),
        });
      }
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return null;
}

function mergeAssetCatalog(localCatalog: MapAssetDef[] | undefined, baseCatalog: MapAssetDef[] | undefined): MapAssetDef[] {
  const assets = new Map<string, MapAssetDef>();
  for (const asset of baseCatalog ?? []) assets.set(asset.id, asset);
  for (const asset of localCatalog ?? []) assets.set(asset.id, asset);
  return [...assets.values()];
}

function readInitial3DPlaytest(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).has("playtest3d");
}

function canvasBounds(map: MapDefinition) {
  if (map.boardShape) {
    const minX = Math.floor(map.boardShape.minX - 1);
    const minY = Math.floor(map.boardShape.minY - 1);
    const maxX = Math.ceil(map.boardShape.maxX + 1);
    const maxY = Math.ceil(map.boardShape.maxY + 1);
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }
  const layouts = [
    ...map.board.map((tile) => tile.layout ?? { x: 0, y: 0 }),
    ...map.routes.flatMap((route) => route.points ?? []),
    ...map.artifacts.map((artifact) => artifact.position),
    ...(map.terraces ?? []).flatMap((terrace) => [
      { x: terrace.minX, y: terrace.minY },
      { x: terrace.maxX, y: terrace.maxY },
    ]),
  ];
  const minX = Math.floor(Math.min(0, ...layouts.map((layout) => layout.x)) - 1);
  const minY = Math.floor(Math.min(0, ...layouts.map((layout) => layout.y)) - 1);
  const maxX = Math.ceil(Math.max(8, ...layouts.map((layout) => layout.x)) + 1);
  const maxY = Math.ceil(Math.max(6, ...layouts.map((layout) => layout.y)) + 1);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function buildGrid(bounds: ReturnType<typeof canvasBounds>) {
  const lines: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let x = bounds.minX; x <= bounds.maxX; x += 1) lines.push({ key: `x-${x}`, x1: x, y1: bounds.minY, x2: x, y2: bounds.maxY });
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) lines.push({ key: `y-${y}`, x1: bounds.minX, y1: y, x2: bounds.maxX, y2: y });
  return lines;
}

function uniqueBorderPoints(edges: NonNullable<MapBoardShape["borderEdges"]>): MapGridPoint[] {
  const points = new Map<string, MapGridPoint>();
  for (const edge of edges) {
    points.set(pointKey(edge.from), edge.from);
    points.set(pointKey(edge.to), edge.to);
  }
  return [...points.values()];
}

function pointKey(point: MapGridPoint): string {
  return `${point.x}:${point.y}`;
}

function samePoint(a: MapGridPoint, b: MapGridPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function routePoints(map: MapDefinition, route: MapRoute): TileLayout[] {
  const from = map.board.find((tile) => tile.id === route.from)?.layout;
  const to = map.board.find((tile) => tile.id === route.to)?.layout;
  if (!from || !to) return [];
  return [from, ...(route.points ?? []), to];
}

function activityLabel(type: string): string {
  if (type === "prompt") return "Prompt";
  if (type === "hostPick") return "Host pick";
  if (type === "selfTap") return "Self tap";
  if (type === "vote") return "Vote";
  if (type === "cardVote") return "Card vote";
  if (type === "judge") return "Judge";
  if (type === "timing") return "Timing";
  if (type === "reaction") return "Reaction";
  if (type === "buzzer") return "Buzzer";
  if (type === "estimate") return "Estimate";
  if (type === "whack") return "Whack";
  if (type === "maze") return "Laberinto";
  if (type === "flappy") return "Flappy bird";
  if (type === "snake") return "Snake";
  if (type === "horserace") return "Carrera de caballos";
  if (type === "redlight") return "Luz roja, luz verde";
  return type;
}

function isSelected(selection: BuilderSelection, kind: "node", id: number): boolean;
function isSelected(selection: BuilderSelection, kind: "route" | "artifact" | "terrace", id: string): boolean;
function isSelected(selection: BuilderSelection, kind: "node" | "route" | "artifact" | "terrace", id: number | string): boolean {
  return selection?.kind === kind && selection.id === id;
}

function shortType(type: TileType): string {
  const labels: Record<TileType, string> = {
    start: "ST",
    finish: "END",
    minigame: "MG",
    trivia: "TR",
    vote: "VO",
    judge: "JD",
    dare: "DR",
    fate: "FT",
    groom: "GR",
    reaction: "RX",
    estimate: "ES",
    shop: "SH",
  };
  return labels[type];
}

function artifactColor(kind?: MapAssetDef["kind"]): string {
  if (kind === "tree") return "#267141";
  if (kind === "water") return "#2aa8d8";
  if (kind === "vehicle") return "#f8fafc";
  if (kind === "mountain") return "#78716c";
  if (kind === "court") return "#79c86d";
  if (kind === "sign") return "#475569";
  if (kind === "plaza") return "#e6bc6a";
  if (kind === "decor") return "#e2a3c7";
  return "#b35a37";
}

function assetOptionLabel(asset: MapAssetDef): string {
  const emoji = ASSET_EMOJI[asset.id] ?? KIND_EMOJI[asset.kind] ?? KIND_EMOJI.custom;
  return `${emoji} ${asset.name}`;
}

function propSearchText(asset: MapAssetDef): string {
  return [asset.name, asset.id, asset.kind, assetOptionLabel(asset)].join(" ").toLowerCase();
}

function terraceRectFromDraft(draft: { start: MapGridPoint; current: MapGridPoint }): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const minX = Math.min(draft.start.x, draft.current.x);
  const minY = Math.min(draft.start.y, draft.current.y);
  let maxX = Math.max(draft.start.x, draft.current.x);
  let maxY = Math.max(draft.start.y, draft.current.y);
  // Un click sin arrastre crea una meseta mínima de 1x1 para que sea visible/editable.
  if (maxX - minX < 0.5) maxX = minX + 1;
  if (maxY - minY < 0.5) maxY = minY + 1;
  return { minX, minY, maxX, maxY };
}

/** Oscurece un color hex (#rgb o #rrggbb) multiplicando sus canales. */
function darkenHex(hex: string, factor: number): string {
  const raw = hex.replace("#", "");
  const size = raw.length === 3 ? 1 : 2;
  if (raw.length !== 3 && raw.length !== 6) return "#4b5563";
  const channels = [0, 1, 2].map((index) => {
    const value = parseInt(raw.slice(index * size, index * size + size), 16);
    const expanded = size === 1 ? value * 17 : value;
    if (Number.isNaN(expanded)) return 75;
    return Math.max(0, Math.min(255, Math.round(expanded * factor)));
  });
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function formatElevation(elevation: number): string {
  return String(Math.round(elevation * 100) / 100);
}

function roundToQuarter(value: number): number {
  return Math.round(value * 4) / 4;
}

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}
