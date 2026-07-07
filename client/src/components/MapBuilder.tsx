import { useEffect, useMemo, useReducer, useRef, useState, type Dispatch, type PointerEvent } from "react";
import type {
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
} from "@essence/shared";
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
  eventFieldForType,
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
  TILE_TYPES,
  validateMap,
  type BuilderSelection,
  type BuilderTool,
  type MapBuilderState,
  type TerraceCorner,
} from "../mapBuilder";
import { normalizeContentSchema } from "@essence/shared/contentValidation";
import { eventIdsForTile, eventTitle, resolveTileEventForPlayer } from "@essence/shared/events";
import Board3DShell from "./Board3DShell";
import CosmeticGalleryOverlay from "./CosmeticGalleryOverlay";

const BASE_CONTENT = normalizeContentSchema(seedContent);
const STORAGE_KEY = "essence:map-builder:draft";

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
  const [cosmeticsOpen, setCosmeticsOpen] = useState(false);
  const exportContent = useMemo(() => builderContentToGameContent(BASE_CONTENT, state.content), [state.content]);
  const exportJson = useMemo(() => JSON.stringify(exportContent, null, 2), [exportContent]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.content));
  }, [state.content]);

  useEffect(() => {
    if (activeMap.board.some((tile) => tile.id === testCellId)) return;
    setTestCellId(activeMap.board[0]?.id ?? 0);
  }, [activeMap, testCellId]);

  const copyJson = async () => {
    await navigator.clipboard?.writeText(exportJson);
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
      const parsed = JSON.parse(importText);
      dispatch({ type: "replace_content", content: normalizeBuilderContent(parsed) });
      setImportText("");
      setJsonModalOpen(false);
    } catch {
      window.alert("JSON inválido");
    }
  };

  const resetDraft = () => {
    localStorage.removeItem(STORAGE_KEY);
    dispatch({ type: "replace_content", content: normalizeBuilderContent(BASE_CONTENT) });
  };

  const open3DPlaytest = () => {
    setTestMode(true);
    setPlaytest3DOpen(true);
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
          onEdit={() => setMapDetailsOpen(true)}
          onImport={() => setJsonModalOpen(true)}
          onCopy={copyJson}
          onDownload={downloadJson}
          onReset={resetDraft}
          onOpen3D={open3DPlaytest}
          onOpenGallery={() => setGalleryOpen(true)}
          onOpenCosmetics={() => setCosmeticsOpen(true)}
          testMode={testMode}
          onToggleTest={() => setTestMode((value) => !value)}
        />
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem]">
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
            />

            {/* Mientras un overlay 3D a pantalla completa está abierto (playtest, galería
                de props o de cosméticos), desmontamos el preview chico: un solo canvas WebGL. */}
            {!playtest3DOpen && !galleryOpen && !cosmeticsOpen && (
              <Floating3DPreview
                map={activeMap}
                assetCatalog={state.content.assetCatalog}
                players={previewPlayers}
                testMode={testMode}
                testCellId={testCellId}
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
        <Playtest3DOverlay
          map={activeMap}
          assetCatalog={state.content.assetCatalog}
          cellId={testCellId}
          players={previewPlayers}
          onCellChange={setTestCellId}
          onClose={() => setPlaytest3DOpen(false)}
        />
      )}

      {galleryOpen && (
        <PropGalleryOverlay
          assetCatalog={state.content.assetCatalog}
          initialAssetId={assetId}
          onPlace={placePropFromGallery}
          onClose={() => setGalleryOpen(false)}
        />
      )}

      {cosmeticsOpen && (
        <CosmeticGalleryOverlay
          cosmetics={Object.values(BASE_CONTENT.cosmetics ?? {})}
          characters={BASE_CONTENT.characters ?? {}}
          onClose={() => setCosmeticsOpen(false)}
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
  onEdit,
  onImport,
  onCopy,
  onDownload,
  onReset,
  onOpen3D,
  onOpenGallery,
  onOpenCosmetics,
  testMode,
  onToggleTest,
}: {
  state: MapBuilderState;
  dispatch: Dispatch<any>;
  onCreate: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onImport: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onReset: () => void;
  onOpen3D: () => void;
  onOpenGallery: () => void;
  onOpenCosmetics: () => void;
  testMode: boolean;
  onToggleTest: () => void;
}) {
  return (
    <section className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.035] p-1.5">
      <select
        value={state.activeMapId}
        onChange={(event) => dispatch({ type: "select_map", mapId: event.target.value })}
        aria-label="Active map"
        className="min-w-[12rem] flex-1 rounded-md border border-white/10 bg-[#0a100b] px-3 py-1.5 text-xs font-black text-white outline-none focus:border-emerald-300"
      >
        {state.content.maps.map((map) => (
          <option key={map.id} value={map.id}>
            {map.name}
          </option>
        ))}
      </select>
      <button type="button" onClick={onEdit} className="builder-button">
        Edit
      </button>
      <button type="button" onClick={onCreate} className="builder-button">
        New
      </button>
      <button type="button" onClick={onDuplicate} className="builder-button">
        Duplicate
      </button>
      <button type="button" onClick={onImport} data-json-open="true" className="builder-button">
        Import
      </button>
      <button type="button" onClick={onCopy} className="builder-button">
        Copy
      </button>
      <button type="button" onClick={onDownload} className="builder-button">
        Download
      </button>
      <button type="button" onClick={onReset} className="builder-button danger">
        Reset
      </button>
      <ViewsMenu
        items={[
          { label: "🎮 3D playtest", onClick: onOpen3D },
          { label: "🧱 Props 3D", onClick: onOpenGallery },
          { label: "🧢 Cosméticos 3D", onClick: onOpenCosmetics },
        ]}
      />
      <button type="button" onClick={onToggleTest} className={`builder-button ${testMode ? "active" : ""}`}>
        {testMode ? "Stop test" : "Test map"}
      </button>
      <a href="/tools" className="builder-button">
        Tools
      </a>
      <a href="/" className="builder-button">
        Game
      </a>
    </section>
  );
}

/** Desplegable que agrupa las vistas 3D para que la barra no se desborde. */
function ViewsMenu({ items }: { items: { label: string; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="builder-button preview">
        Vistas 3D ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 min-w-[11rem] rounded-md border border-white/15 bg-[#141b12] p-1 shadow-2xl shadow-black/45">
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  item.onClick();
                  setOpen(false);
                }}
                className="block w-full rounded px-3 py-2 text-left text-xs font-black text-white transition hover:bg-white/10"
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TestPanel({
  map,
  enabled,
  cellId,
  onToggle,
  onCellChange,
  onOpen3D,
}: {
  map: MapDefinition;
  enabled: boolean;
  cellId: number;
  onToggle: () => void;
  onCellChange: (id: number) => void;
  onOpen3D: () => void;
}) {
  const current = map.board.find((tile) => tile.id === cellId) ?? map.board[0];
  const outgoing = current
    ? map.routes.filter((route) => route.from === current.id || (route.bidirectional && route.to === current.id))
    : [];

  return (
    <section className={`mb-4 rounded-lg border p-3 ${enabled ? "border-emerald-300/45 bg-emerald-300/10" : "border-white/10 bg-white/[0.03]"}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-black uppercase tracking-[0.18em] text-slate-300">Test mode</h2>
        <div className="flex gap-1">
          <button type="button" onClick={onOpen3D} className="builder-button compact">
            3D
          </button>
          <button type="button" onClick={onToggle} className={`builder-button compact ${enabled ? "active" : ""}`}>
            {enabled ? "Stop" : "Play"}
          </button>
        </div>
      </div>

      <label className="block text-xs font-bold text-slate-300">
        Cell
        <select
          value={String(current?.id ?? "")}
          disabled={!enabled || map.board.length === 0}
          onChange={(event) => onCellChange(Number(event.target.value))}
          className="mt-1 w-full rounded-md border border-white/10 bg-[#0d120d] px-3 py-2 text-sm text-white outline-none focus:border-emerald-300 disabled:opacity-50"
        >
          {map.board.map((tile) => (
            <option key={tile.id} value={tile.id}>
              {tile.id} · {tile.label ?? TILE_LABEL[tile.type]}
            </option>
          ))}
        </select>
      </label>

      {current && (
        <div className="mt-2 rounded-md border border-white/10 bg-black/20 px-2 py-2 text-xs font-bold text-slate-200">
          <span className="text-emerald-200">{TILE_LABEL[current.type]}</span>
          {current.eventIds?.length ? <span className="ml-1 text-slate-400">· {current.eventIds.length} events</span> : null}
          {current.eventId && <span className="ml-1 text-slate-400">· {current.eventId}</span>}
          {current.minigameId && <span className="ml-1 text-slate-400">· {current.minigameId}</span>}
          {current.dareId && <span className="ml-1 text-slate-400">· {current.dareId}</span>}
          {current.fateId && <span className="ml-1 text-slate-400">· {current.fateId}</span>}
        </div>
      )}

      <div className="mt-3 grid gap-2">
        {outgoing.map((route) => {
          const destination = route.from === current?.id ? route.to : route.from;
          return (
            <button
              key={route.id}
              type="button"
              disabled={!enabled}
              onClick={() => onCellChange(destination)}
              className="builder-route-button disabled:opacity-45"
            >
              <span>{route.choiceLabel || route.label || `Go to ${destination}`}</span>
              <span style={{ backgroundColor: TERRAIN_COLOR[route.terrain] }}>{route.terrain}</span>
            </button>
          );
        })}
        {outgoing.length === 0 && <p className="text-xs font-bold text-slate-500">No outgoing routes</p>}
      </div>
    </section>
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
}: {
  state: MapBuilderState;
  dispatch: Dispatch<any>;
  assetCatalog: MapAssetDef[];
  assetId: string;
  setAssetId: (id: string) => void;
  tileType: TileType;
  setTileType: (type: TileType) => void;
}) {
  return (
    <section data-map-builder-toolbar="true" className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-3">
      <div className="pointer-events-auto relative rounded-lg border border-slate-900/15 bg-slate-950/82 p-2 shadow-2xl shadow-black/30 backdrop-blur-md">
        {(state.tool === "artifact" || state.tool === "cell") && (
          <div className="absolute bottom-[calc(100%+0.5rem)] left-1/2 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-white/15 bg-slate-950/92 p-3 text-white shadow-2xl shadow-black/30 backdrop-blur-md">
            {state.tool === "artifact" && (
              <label className="block text-xs font-bold text-slate-300">
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
  onOpen,
}: {
  map: MapDefinition;
  assetCatalog: MapAssetDef[];
  players: Player[];
  testMode: boolean;
  testCellId: number;
  onOpen: () => void;
}) {
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
        className="absolute inset-0 overflow-hidden bg-[radial-gradient(ellipse_at_50%_-10%,#f2d8a7_0%,#dfa96b_34%,#96602c_66%,#38200c_100%)]"
      />
      <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-white/10 bg-black/35 px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-white/80 backdrop-blur">
        {testMode ? `Test cell ${testCellId}` : "3D preview"}
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

function ExportPanel({
  active,
  exportJson,
  importText,
  setImportText,
  onCopy,
  onDownload,
  onImport,
  onReset,
}: {
  active: boolean;
  exportJson: string;
  importText: string;
  setImportText: (value: string) => void;
  onCopy: () => void;
  onDownload: () => void;
  onImport: () => void;
  onReset: () => void;
}) {
  return (
    <section className={active ? "" : "opacity-80"}>
      <h2 className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-slate-400">JSON</h2>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCopy} className="builder-button">
          Copy
        </button>
        <button type="button" onClick={onDownload} className="builder-button">
          Download
        </button>
      </div>
      <textarea
        value={importText}
        onChange={(event) => setImportText(event.target.value)}
        placeholder="Pegá un content.json para importar"
        className="mt-2 h-28 w-full resize-none rounded-md border border-white/10 bg-[#0d120d] p-2 font-mono text-xs text-slate-100 outline-none focus:border-emerald-300"
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" onClick={onImport} disabled={!importText.trim()} className="builder-button disabled:opacity-40">
          Import
        </button>
        <button type="button" onClick={onReset} className="builder-button danger">
          Reset
        </button>
      </div>
      {active && (
        <textarea
          readOnly
          value={exportJson}
          className="mt-2 h-40 w-full resize-none rounded-md border border-white/10 bg-black/30 p-2 font-mono text-[0.65rem] text-slate-200"
        />
      )}
    </section>
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
}: {
  state: MapBuilderState;
  map: MapDefinition;
  dispatch: Dispatch<any>;
  assetId: string;
  tileType: TileType;
  testMode: boolean;
  testCellId: number;
  onTestCellChange: (id: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<DragTarget | null>(null);
  const [terraceDraft, setTerraceDraft] = useState<{ start: MapGridPoint; current: MapGridPoint } | null>(null);
  const bounds = useMemo(() => canvasBounds(map), [map]);
  const gridLines = useMemo(() => buildGrid(bounds), [bounds]);
  const terraceToolActive = state.tool === "terrace" && !testMode;

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
  dispatch: Dispatch<any>;
  onTestCellChange: (id: number) => void;
  onDragStart: () => void;
}) {
  const layout = tile.layout ?? { x: 0, y: 0 };
  return (
    <g
      transform={`translate(${layout.x} ${layout.y}) rotate(${layout.rot ?? 0})`}
      filter="url(#nodeShadow)"
      className="cursor-pointer"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
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

function Playtest3DOverlay({
  map,
  assetCatalog,
  cellId,
  players,
  onCellChange,
  onClose,
}: {
  map: MapDefinition;
  assetCatalog: MapAssetDef[];
  cellId: number;
  players: Player[];
  onCellChange: (id: number) => void;
  onClose: () => void;
}) {
  const current = map.board.find((tile) => tile.id === cellId) ?? map.board[0];
  const outgoing = current ? outgoingRoutes(map, current.id) : [];
  const start = map.board.find((tile) => tile.type === "start") ?? map.board[0];
  const finish = map.board.find((tile) => tile.type === "finish") ?? map.board[map.board.length - 1];
  const [freeCamera, setFreeCamera] = useState(false);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#101510]">
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
        freeCamera={freeCamera}
        className="absolute inset-0 overflow-hidden bg-[radial-gradient(ellipse_at_50%_-10%,#f2d8a7_0%,#dfa96b_34%,#96602c_66%,#38200c_100%)]"
      />

      <div className="pointer-events-none absolute inset-0 z-10 flex min-h-0 flex-col justify-between p-3 sm:p-5">
        <header className="pointer-events-auto flex flex-wrap items-start justify-between gap-3">
          <div className="rounded-lg border border-white/15 bg-slate-950/60 px-4 py-3 shadow-2xl shadow-black/30 backdrop-blur-md">
            <p className="text-[0.65rem] font-black uppercase tracking-[0.24em] text-cyan-200">3D playtest</p>
            <h2 className="mt-1 text-2xl font-black text-white">{map.name}</h2>
            <p className="mt-1 text-sm font-bold text-emerald-100/85">{current ? cellSummary(current) : "No cells"}</p>
            {freeCamera && (
              <p className="mt-2 text-xs font-bold text-cyan-100/80">Arrastrá para orbitar · rueda para zoom · click derecho o Shift+arrastrar para desplazar</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={() => setFreeCamera((value) => !value)}
              aria-pressed={freeCamera}
              className={`rounded-md border px-4 py-3 text-sm font-black shadow-2xl backdrop-blur-md transition ${
                freeCamera
                  ? "border-cyan-300/60 bg-cyan-400/20 text-cyan-100 hover:bg-cyan-400/30"
                  : "border-white/20 bg-slate-950/60 text-white hover:bg-white/10"
              }`}
            >
              {freeCamera ? "🎥 Cámara libre: ON" : "🎥 Cámara libre"}
            </button>
            <button type="button" onClick={onClose} className="rounded-md border border-white/20 bg-slate-950/60 px-4 py-3 text-sm font-black text-white shadow-2xl backdrop-blur-md transition hover:bg-white/10">
              Close
            </button>
          </div>
        </header>

        <section className="pointer-events-auto ml-auto w-[min(25rem,calc(100vw-1.5rem))] rounded-lg border border-white/15 bg-slate-950/65 p-3 shadow-2xl shadow-black/35 backdrop-blur-md">
          <div className="grid grid-cols-[1fr_auto_auto] gap-2">
            <label className="text-xs font-bold text-slate-300">
              Jump to cell
              <select
                value={String(current?.id ?? "")}
                onChange={(event) => onCellChange(Number(event.target.value))}
                className="mt-1 w-full rounded-md border border-white/10 bg-[#0d120d] px-3 py-2 text-sm font-black text-white outline-none focus:border-emerald-300"
              >
                {map.board.map((tile) => (
                  <option key={tile.id} value={tile.id}>
                    {tile.id} · {tile.label ?? TILE_LABEL[tile.type]}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => start && onCellChange(start.id)} className="builder-button mt-5">
              Start
            </button>
            <button type="button" onClick={() => finish && onCellChange(finish.id)} className="builder-button mt-5">
              Finish
            </button>
          </div>

          {current && (
            <div className="mt-3 rounded-md border border-white/10 bg-white/[0.04] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-lg font-black text-white">Cell {current.id}</p>
                <span className="rounded-full px-2 py-1 text-xs font-black text-slate-950" style={{ backgroundColor: TILE_COLOR[current.type] }}>
                  {TILE_LABEL[current.type]}
                </span>
              </div>
              <p className="mt-2 text-sm font-bold text-slate-300">{tileEventLabel(current)}</p>
            </div>
          )}

          <div className="mt-3 grid gap-2">
            {outgoing.map(({ route, destination }) => (
              <button key={route.id} type="button" onClick={() => onCellChange(destination)} className="builder-route-button">
                <span>{route.choiceLabel || route.label || `Go to ${destination}`}</span>
                <span style={{ backgroundColor: TERRAIN_COLOR[route.terrain] }}>{route.terrain}</span>
              </button>
            ))}
            {outgoing.length === 0 && <p className="rounded-md border border-white/10 bg-black/25 p-3 text-sm font-bold text-slate-400">No outgoing routes from this cell.</p>}
          </div>
        </section>
      </div>
    </div>
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
  const selectedIndex = Math.max(0, assetCatalog.findIndex((asset) => asset.id === selectedId));
  const selectedAsset = assetCatalog[selectedIndex];
  const [scale, setScale] = useState(selectedAsset?.defaultScale ?? 1);
  const [catalogOpen, setCatalogOpen] = useState(true);
  const preview = useMemo(() => buildPropPreviewMap(selectedAsset?.id ?? "", selectedAsset, scale), [selectedAsset, scale]);

  // Cambiar de prop resetea el tamaño al por defecto de ese prop.
  const selectProp = (id: string) => {
    setSelectedId(id);
    setScale(assetCatalog.find((asset) => asset.id === id)?.defaultScale ?? 1);
  };

  const step = (delta: number) => {
    if (!assetCatalog.length) return;
    const next = (selectedIndex + delta + assetCatalog.length) % assetCatalog.length;
    selectProp(assetCatalog[next].id);
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
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => step(-1)} className="builder-button compact" aria-label="Prop anterior">◀</button>
              <span className="min-w-[4rem] text-center text-xs font-bold text-slate-300">{assetCatalog.length ? selectedIndex + 1 : 0} / {assetCatalog.length}</span>
              <button type="button" onClick={() => step(1)} className="builder-button compact" aria-label="Prop siguiente">▶</button>
              <button
                type="button"
                onClick={() => setCatalogOpen((open) => !open)}
                className="builder-button compact"
                aria-expanded={catalogOpen}
              >
                {catalogOpen ? "Catálogo ▾" : "Catálogo ▸"}
              </button>
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
            {assetCatalog.map((asset) => (
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
}) {
  return (
    <div className="grid gap-4">
      {selectedNode && <NodeInspector tile={selectedNode} dispatch={dispatch} />}
      {selectedRoute && <RouteInspector route={selectedRoute} board={map.board} dispatch={dispatch} />}
      {selectedArtifact && <ArtifactInspector artifact={selectedArtifact} assetCatalog={assetCatalog} dispatch={dispatch} />}
      {selectedTerrace && <TerraceInspector terrace={selectedTerrace} dispatch={dispatch} />}
      {!selectedNode && !selectedRoute && !selectedArtifact && !selectedTerrace && (
        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm text-slate-300">
          <p className="font-bold text-white">No selection</p>
          <p className="mt-1">Use Select to inspect nodes, routes, and props. Route mode connects two clicked cells.</p>
        </section>
      )}

      <BoardShapeInspector boardShape={map.boardShape} dispatch={dispatch} />

      <section>
        <h2 className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Validation</h2>
        {validation.length === 0 ? (
          <p className="rounded-md border border-emerald-300/20 bg-emerald-300/10 p-2 text-sm font-bold text-emerald-100">Map graph is valid.</p>
        ) : (
          <ul className="grid gap-1 text-sm text-rose-200">
            {validation.map((error) => (
              <li key={error} className="rounded-md border border-rose-300/20 bg-rose-300/10 p-2">
                {error}
              </li>
            ))}
          </ul>
        )}
      </section>

      {state.selection && (
        <button type="button" onClick={() => dispatch({ type: "delete_selected" })} className="builder-button danger">
          Delete selected
        </button>
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

function NodeInspector({ tile, dispatch }: { tile: Tile; dispatch: Dispatch<any> }) {
  const layout = tile.layout ?? { x: 0, y: 0 };
  const [previewPlayerId, setPreviewPlayerId] = useState(BASE_CONTENT.players[0]?.id ?? "");
  const previewPlayer = BASE_CONTENT.players.find((player) => player.id === previewPlayerId) ?? BASE_CONTENT.players[0];
  const tileEventIds = eventIdsForTile(tile);
  const resolvedEvent = previewPlayer ? resolveTileEventForPlayer(BASE_CONTENT, tile, previewPlayer) : null;
  const updateStoryParam = (key: string, value: string) => {
    const next = { ...(tile.storyParams ?? {}) };
    if (value.trim()) next[key] = value;
    else delete next[key];
    dispatch({ type: "update_node", id: tile.id, patch: { storyParams: Object.keys(next).length ? next : undefined } });
  };

  return (
    <section>
      <h2 className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Cell {tile.id}</h2>
      <SelectInput
        label="Type"
        value={tile.type}
        options={TILE_TYPES.map((type) => ({ value: type, label: TILE_LABEL[type] }))}
        onChange={(type) => dispatch({ type: "update_node", id: tile.id, patch: { type: type as TileType } })}
      />
      <TextInput label="Label" value={tile.label ?? ""} onChange={(label) => dispatch({ type: "update_node", id: tile.id, patch: { label: label || undefined } })} />
      <SelectInput
        label="Event"
        value={tile.eventId ?? ""}
        options={[{ value: "", label: "None" }, ...Object.keys(BASE_CONTENT.events ?? {}).map((id) => ({ value: id, label: eventTitle(BASE_CONTENT.events![id]) }))]}
        onChange={(eventId) => dispatch({ type: "update_node", id: tile.id, patch: { eventId: eventId || undefined } })}
      />
      {tileEventIds.length > 0 && (
        <div className="mt-3 rounded-md border border-cyan-300/20 bg-cyan-300/10 p-3">
          <SelectInput
            label="Preview player"
            value={previewPlayerId}
            options={BASE_CONTENT.players.map((player) => ({ value: player.id, label: player.name }))}
            onChange={setPreviewPlayerId}
          />
          {tileEventIds.length > 1 && <p className="mt-3 text-xs font-black uppercase tracking-[0.12em] text-cyan-200">{tileEventIds.length} candidate events</p>}
          <p className="mt-3 text-sm font-black text-white">{resolvedEvent ? eventTitle(resolvedEvent) : tileEventIds[0]}</p>
          {resolvedEvent?.story.prompt && <p className="mt-1 text-xs font-bold leading-5 text-cyan-100">{resolvedEvent.story.prompt}</p>}
          {resolvedEvent?.activity && <p className="mt-2 text-xs font-black uppercase tracking-[0.12em] text-cyan-200">{activityLabel(resolvedEvent.activity.type)}</p>}
          {!resolvedEvent && <p className="mt-1 text-xs font-bold leading-5 text-cyan-100">No event matches this preview player.</p>}
        </div>
      )}
      {eventFieldForType(tile.type, "minigame") && (
        <SelectInput
          label="Legacy minigame"
          value={tile.minigameId ?? ""}
          options={[{ value: "", label: "None" }, ...Object.keys(BASE_CONTENT.minigames).map((id) => ({ value: id, label: id }))]}
          onChange={(minigameId) => dispatch({ type: "update_node", id: tile.id, patch: { minigameId: minigameId || undefined } })}
        />
      )}
      <div className="mt-3" data-story-params="true">
        <h3 className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Story parameters</h3>
        <TextInput label="Setup" value={tile.storyParams?.setup ?? ""} onChange={(value) => updateStoryParam("setup", value)} />
        <TextInput label="Prompt" value={tile.storyParams?.prompt ?? ""} onChange={(value) => updateStoryParam("prompt", value)} />
        <TextInput label="Reward beat" value={tile.storyParams?.reward ?? ""} onChange={(value) => updateStoryParam("reward", value)} />
      </div>
      {eventFieldForType(tile.type, "dare") && (
        <SelectInput
          label="Legacy dare"
          value={tile.dareId ?? ""}
          options={[{ value: "", label: "None" }, ...Object.keys(BASE_CONTENT.dares).map((id) => ({ value: id, label: id }))]}
          onChange={(dareId) => dispatch({ type: "update_node", id: tile.id, patch: { dareId: dareId || undefined } })}
        />
      )}
      {eventFieldForType(tile.type, "fate") && (
        <SelectInput
          label="Legacy fate"
          value={tile.fateId ?? ""}
          options={[{ value: "", label: "None" }, ...Object.keys(BASE_CONTENT.fates).map((id) => ({ value: id, label: id }))]}
          onChange={(fateId) => dispatch({ type: "update_node", id: tile.id, patch: { fateId: fateId || undefined } })}
        />
      )}
      <CoordinateInputs
        layout={layout}
        onChange={(next) => dispatch({ type: "update_node", id: tile.id, patch: { layout: next } })}
      />
    </section>
  );
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
      <TextInput label="Tint" value={artifact.tint ?? ""} onChange={(tint) => dispatch({ type: "update_artifact", id: artifact.id, patch: { tint: tint || undefined } })} />
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
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const content = JSON.parse(raw);
      if (content?.maps?.length) {
        const base = createInitialMapBuilderState(BASE_CONTENT);
        const migratedContent = normalizeBuilderContent({
          ...BASE_CONTENT,
          ...content,
          assetCatalog: mergeAssetCatalog(content.assetCatalog, BASE_CONTENT.assetCatalog),
        });
        return {
          ...base,
          content: migratedContent,
          activeMapId: migratedContent.activeMapId,
          selection: migratedContent.maps[0]?.board[0] ? { kind: "node", id: migratedContent.maps[0].board[0].id } : null,
          message: "Borrador local cargado y actualizado",
        };
      }
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return createInitialMapBuilderState(BASE_CONTENT);
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

function outgoingRoutes(map: MapDefinition, cellId: number): { route: MapRoute; destination: number }[] {
  return map.routes.flatMap((route) => {
    if (route.from === cellId) return [{ route, destination: route.to }];
    if (route.bidirectional && route.to === cellId) return [{ route, destination: route.from }];
    return [];
  });
}

function cellSummary(tile: Tile): string {
  const event = tileEventLabel(tile);
  return `Cell ${tile.id} · ${TILE_LABEL[tile.type]}${event ? ` · ${event}` : ""}`;
}

function tileEventLabel(tile: Tile): string {
  if (tile.eventIds?.length) return tile.eventIds.length === 1 ? `Event: ${tile.eventIds[0]}` : `Events: ${tile.eventIds.length}`;
  if (tile.eventId) return `Event: ${tile.eventId}`;
  if (tile.minigameId) return `Minigame: ${tile.minigameId}`;
  if (tile.dareId) return `Dare: ${tile.dareId}`;
  if (tile.fateId) return `Fate: ${tile.fateId}`;
  return tile.label ?? "No event assigned";
}

function activityLabel(type: string): string {
  if (type === "prompt") return "Prompt";
  if (type === "hostPick") return "Host pick";
  if (type === "selfTap") return "Self tap";
  if (type === "vote") return "Vote";
  if (type === "judge") return "Judge";
  if (type === "timing") return "Timing";
  if (type === "reaction") return "Reaction";
  if (type === "buzzer") return "Buzzer";
  if (type === "estimate") return "Estimate";
  if (type === "whack") return "Whack";
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
