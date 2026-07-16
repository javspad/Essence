import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const contentPath = path.join(root, "shared/content.json");

const MAP_ID = "map-2";
const SHOP_CELLS = new Set([7, 17, 28, 38, 47, 53, 57]);
const FINALE_EVENT_CELL = 58;
const FINALE_EVENT_IDS = ["event-098", "event-101", "event-102"];
const PINNED_EVENTS = new Map([
  [3, { eventId: "event-050", label: "COLEGIO DE NOCHE", propAssetId: "school-locker-hiding" }],
  [9, { eventId: "event-037", label: "LABORATORIO CHAGAS", propAssetId: "vinchuca-jar" }],
  [14, { eventId: "event-021", label: "UKELELE 2017", propAssetId: "ukulele" }],
  [21, { eventId: "event-068", label: "TAXI SOSPECHOSO", propAssetId: "steamy-taxi" }],
  [25, { eventId: "event-078", label: "EXAMEN VOLADOR", propAssetId: "crumpled-exam-ausente" }],
  [32, { eventId: "event-090", label: "EL MEJOR ARQUERO", propAssetId: "football-ball" }],
  [40, { eventId: "event-071", label: "COMIDA PELIGROSA", propAssetId: "vomiting-person" }],
  [46, { eventId: "event-064", label: "NATACIÓN", propAssetId: "silly-pool-float" }],
  [52, { eventId: "event-099", label: "REFUGIO JAKOB", propAssetId: "rain-tent" }],
  [56, { eventId: "event-100", label: "ESSENCE BY L'FRANG", propAssetId: "billboard" }],
]);

const OPEN_CELL_SEQUENCE = [
  "prompt", "cardVote", "prompt", "vote", "maze", "prompt", "buzzer",
  "prompt", "cardVote", "timing", "judge", "flappy", "prompt", "vote",
  "prompt", "buzzer", "prompt", "cardVote", "snake", "prompt", "timing",
  "prompt", "reaction", "prompt", "reaction", "horserace", "prompt", "buzzer",
  "prompt", "cardVote", "prompt", "judge", "redlight", "prompt", "whack",
  "prompt", "flappy", "prompt", "snake", "prompt",
  // Final runway after Kiosco 7: every roll must land on one activity before the finish.
  "timing", "prompt", "vote", "whack", "prompt",
];

const FINALE_LAYOUT = {
  54: { x: 13.05, y: 14.0 },
  55: { x: 12.65, y: 14.75 },
  56: { x: 11.6, y: 15.25 },
  57: { x: 10.4, y: 15.65 },
  58: { x: 9.3, y: 15.95 },
  59: { x: 8.2, y: 16.15 },
  60: { x: 7.4, y: 16.65 },
  61: { x: 8.2, y: 17.1 },
  62: { x: 9.3, y: 17.3 },
  63: { x: 10.4, y: 17.1 },
  64: { x: 11.1, y: 16.5 },
};

const PROMPT_TILE_TYPES = ["dare", "fate", "groom", "estimate"];
const CAMERA_PRESETS = {
  opening: { id: "opening", focus: "cell", yaw: -52, pitch: 30, distance: 8.2, fov: 38, focusOffset: { x: 0.75, y: 0.2, z: 0.15 } },
  "story-east": { id: "story-east", focus: "activePlayer", yaw: -52, pitch: 24, distance: 6.2, fov: 36, focusOffset: { x: 0.35, y: 0.1, z: 0 } },
  "story-west": { id: "story-west", focus: "activePlayer", yaw: 128, pitch: 24, distance: 6.4, fov: 36, focusOffset: { x: -0.35, y: 0.1, z: 0 } },
  "story-turn": { id: "story-turn", focus: "cell", yaw: 4, pitch: 32, distance: 7.4, fov: 38, focusOffset: { x: 0, y: 0.15, z: 0.35 } },
  "story-finale": { id: "story-finale", focus: "cell", yaw: -38, pitch: 28, distance: 6.8, fov: 36, focusOffset: { x: -0.25, y: 0.25, z: 0.2 } },
  "activity-east": { id: "activity-east", focus: "cell", yaw: -48, pitch: 34, distance: 8, fov: 40, focusOffset: { x: 0.35, y: 0.1, z: 0 } },
  "activity-west": { id: "activity-west", focus: "cell", yaw: 132, pitch: 34, distance: 8, fov: 40, focusOffset: { x: -0.35, y: 0.1, z: 0 } },
  "activity-turn": { id: "activity-turn", focus: "cell", yaw: 0, pitch: 38, distance: 8.8, fov: 41, focusOffset: { x: 0, y: 0.1, z: 0.3 } },
  "activity-finale": { id: "activity-finale", focus: "cell", yaw: -42, pitch: 34, distance: 7.8, fov: 39, focusOffset: { x: -0.25, y: 0.2, z: 0.15 } },
  "trivia-east": { id: "trivia-east", focus: "activePlayer", yaw: -58, pitch: 26, distance: 6.6, fov: 36, focusOffset: { x: 0.3, y: 0.15, z: 0 } },
  "trivia-west": { id: "trivia-west", focus: "activePlayer", yaw: 125, pitch: 26, distance: 6.6, fov: 36, focusOffset: { x: -0.3, y: 0.15, z: 0 } },
  "trivia-turn": { id: "trivia-turn", focus: "cell", yaw: 0, pitch: 34, distance: 7.5, fov: 38, focusOffset: { x: 0, y: 0.15, z: 0.25 } },
  "trivia-finale": { id: "trivia-finale", focus: "cell", yaw: -35, pitch: 29, distance: 7, fov: 37, focusOffset: { x: -0.2, y: 0.2, z: 0.15 } },
  finale: { id: "finale", focus: "cell", yaw: -30, pitch: 31, distance: 8.2, fov: 38, focusOffset: { x: -0.3, y: 0.55, z: 0.2 } },
};

const SPECIAL_PROP_OFFSETS = new Map([
  [3, { x: 0.05, y: -1.05, rot: 8 }],
  [9, { x: 0.15, y: 1.0, rot: -12 }],
  [14, { x: -0.1, y: -1.0, rot: 14 }],
  [21, { x: -1.05, y: -0.15, rot: 92 }],
  [25, { x: 0.15, y: 1.05, rot: -8 }],
  [32, { x: 0.05, y: -1.05, rot: 0 }],
  [40, { x: -0.05, y: 1.05, rot: 12 }],
  [46, { x: 0.05, y: -1.05, rot: -18 }],
  [52, { x: 0.05, y: 1.05, rot: 8 }],
  [56, { x: 0.8, y: 0.75, rot: -32 }],
]);

const SHOP_PROP_OFFSETS = new Map([
  [7, { x: 0, y: 1.9, rot: -8 }],
  [17, { x: 0.05, y: -1.2, rot: 176 }],
  [28, { x: -0.05, y: 1.18, rot: 4 }],
  [38, { x: 0.05, y: -1.15, rot: 178 }],
  [47, { x: 1.15, y: -1.05, rot: 168 }],
  [53, { x: 0.05, y: 1.2, rot: -6 }],
  [57, { x: 1.28, y: 0.7, rot: -28 }],
]);

const AUTHORED_SCENE_PROPS = {
  // Acto 1: un patio escolar legible, con un acceso claro y un único rincón de caos UPD.
  "club-house": sceneProp("upd-gate", -1.75, -1.55, 6, 0.82, "anchor"),
  "start-sign": sceneProp("upd-gate", -0.45, 0.95, -6, 1, "foreground"),
  backpack: sceneProp("upd-gate", 3.2, -1.5, -12, 0.9, "detail"),
  fence: sceneProp("upd-gate", 0.65, -1.18, 90, 0.9, "frame"),
  "cut-branch-oak": sceneProp("upd-gate", -2.25, 0.55, 18, 0.78, "frame"),
  "locker-row": sceneProp("upd-corridor", 5.95, -1.55, 4, 0.78, "anchor"),
  "school-desk-pupitre": sceneProp("upd-chaos", 7.25, -1.5, -8, 0.92, "detail"),
  "teacher-figures": sceneProp("upd-chaos", 8.3, -1.5, 8, 0.88, "character"),
  "desk-chair-tower": sceneProp("upd-chaos", 9.45, -1.5, -6, 0.88, "anchor"),
  "broken-window-frame": sceneProp("upd-chaos", 10.55, -1.5, 4, 0.92, "backdrop"),
  "flying-chair": sceneProp("upd-chaos", 11.65, -1.5, -12, 0.9, "action"),
  "jony-duck-window": sceneProp("upd-chaos", 12.75, -1.5, 6, 0.9, "detail"),
  "classroom-giant-log": sceneProp("upd-chaos", 6.65, 1.15, -12, 0.92, "anchor"),
  "bleach-sound-bomb": sceneProp("upd-chaos", 7.72, 1.15, 10, 0.88, "detail"),
  "firecracker-box": sceneProp("upd-chaos", 11.05, 1.2, -8, 0.88, "detail"),
  "upd-noose-chair": sceneProp("upd-chaos", 9.84, 1.15, 7, 0.88, "detail"),

  // Acto 2: una avenida nocturna, con edificios al fondo y restos de la previa adelante.
  "glass-building": sceneProp("belgrano-skyline", 12.85, 4.28, -4, 0.82, "backdrop"),
  bus: sceneProp("belgrano-transit", 11.1, 2.02, 2, 0.88, "anchor"),
  "party-van": sceneProp("belgrano-transit", 7.75, 4.32, 178, 0.95, "anchor"),
  "city-barricade-peed": sceneProp("belgrano-sidewalk", 4.45, 4.3, 4, 0.92, "detail"),
  "blue-ikea-bag": sceneProp("belgrano-sidewalk", 6.5, 4.3, -10, 0.92, "detail"),
  "kiosk-bag-nofui": sceneProp("belgrano-sidewalk", 5.48, 4.3, 8, 0.92, "detail"),
  "fallen-fernet": sceneProp("belgrano-aftermath", 10.05, 4.3, 12, 0.9, "detail"),
  "banana-peel-trap": sceneProp("belgrano-aftermath", 9.15, 4.3, -18, 0.88, "detail"),
  "botherlands-disc": sceneProp("belgrano-memories", 3.38, 4.3, -8, 0.86, "detail"),
  "hoodie-log": sceneProp("belgrano-memories", 2.36, 4.3, 10, 0.88, "detail"),
  "condom-bolas": sceneProp("belgrano-memories", 1.3, 4.3, -5, 0.86, "detail"),
  "just-dance-kinect": sceneProp("belgrano-nightlife", 3.02, 2.02, -6, 0.9, "anchor"),
  "tongue-toy": sceneProp("belgrano-nightlife", 5.0, 2.02, 8, 0.86, "detail"),
  "lucky-sock": sceneProp("belgrano-nightlife", -1.2, 2.2, -12, 0.84, "detail"),
  streetlamp: sceneProp("belgrano-boulevard", 6.15, 2.02, 0, 0.92, "frame"),
  bench: sceneProp("belgrano-boulevard", 7.18, 2.02, 178, 0.9, "frame"),

  // Acto 3: campus abierto; edificios fuertes en los extremos y utilería académica agrupada.
  "uade-building": sceneProp("faculty-campus", -1.95, 7.25, 6, 0.76, "backdrop"),
  "uba-building": sceneProp("faculty-campus", 0.25, 5.28, -4, 0.76, "backdrop"),
  "giant-pencil": sceneProp("faculty-exam", 2.55, 5.28, -8, 0.9, "anchor"),
  "cursed-calculator": sceneProp("faculty-exam", 1.72, 7.55, 12, 0.88, "detail"),
  "mini-court": sceneProp("faculty-sports", 10.05, 7.28, -4, 0.82, "anchor"),
  "rugby-ball": sceneProp("faculty-sports", 10.75, 5.3, 8, 0.9, "detail"),
  basketball: sceneProp("faculty-sports", 11.7, 7.5, -8, 0.9, "detail"),
  "martina-impact-ball": sceneProp("faculty-sports", 12.8, 5.3, 10, 0.9, "action"),

  // Acto 4: parque deportivo, picnic desastroso y bosque en los extremos.
  "oak-tree": sceneProp("park-woods", -1.95, 8.62, -8, 0.9, "frame"),
  rock: sceneProp("park-woods", -1.6, 10.72, 12, 0.88, "frame"),
  "split-tree-trunk": sceneProp("park-woods", -0.35, 10.72, -8, 0.88, "anchor"),
  "hockey-stick": sceneProp("park-sports", 11.78, 8.55, -12, 0.9, "detail"),
  "giant-groin-cup": sceneProp("park-sports", 12.78, 8.55, 8, 0.9, "detail"),
  megaphone: sceneProp("park-sports", 8.5, 10.72, 10, 0.88, "detail"),
  stopwatch: sceneProp("park-sports", 7.55, 10.72, -8, 0.86, "detail"),
  "tiny-trophy": sceneProp("park-sports", 9.48, 10.72, -5, 0.88, "reward"),
  fountain: sceneProp("park-plaza", 7.0, 8.5, 0, 0.84, "anchor"),
  "flower-bed": sceneProp("park-plaza", 5.85, 10.72, 0, 0.86, "frame"),
  croissant: sceneProp("park-picnic", 4.72, 10.72, -8, 0.9, "food"),
  "tuna-can": sceneProp("park-picnic", 3.75, 10.72, 8, 0.9, "food"),
  "jardinera-can": sceneProp("park-picnic", 4.65, 8.55, -8, 0.9, "food"),

  // Acto 5: lago a la izquierda, playa a la derecha y una silueta montañosa en los bordes.
  "mountain-cluster": sceneProp("coast-backdrop", -2.2, 11.82, 6, 0.76, "backdrop"),
  pond: sceneProp("coast-lagoon", -0.1, 14.02, 0, 0.72, "anchor"),
  river: sceneProp("coast-lagoon", 4.25, 14.12, 0, 0.62, "backdrop"),
  waterfall: sceneProp("coast-lagoon", -2.15, 13.7, 178, 0.9, "anchor"),
  sailboat: sceneProp("coast-lagoon", 3.05, 14.08, -14, 0.9, "detail"),
  "palm-tree": sceneProp("coast-beach", 8.0, 14.1, 12, 0.9, "frame"),
  "beach-set": sceneProp("coast-beach", 10.15, 14.05, -8, 0.76, "anchor"),
  sunscreen: sceneProp("coast-beach", 8.25, 11.7, 8, 0.9, "detail"),
  "vodka-bottle": sceneProp("coast-beach", 9.18, 11.7, -8, 0.9, "detail"),
  "sleeping-bag": sceneProp("coast-camp", 11.45, 11.7, -8, 0.88, "detail"),
  "broken-umbrella": sceneProp("coast-camp", 12.42, 11.7, 12, 0.9, "detail"),

  // Acto 6: un altar compacto y simétrico, con la META como remate visual.
  plaza: sceneProp("farewell-stage", 13.75, 17.0, 0, 0.64, "backdrop"),
  "wedding-arch": sceneProp("farewell-stage", 7.3, 16.15, -4, 0.9, "anchor"),
  "finish-sign": sceneProp("farewell-stage", 11.2, 16.45, -4, 1, "foreground"),
  "wedding-ring": sceneProp("farewell-keepsakes", 9.15, 17.02, 8, 0.9, "detail"),
  "sticker-suitcase": sceneProp("farewell-keepsakes", 10.18, 17.02, -8, 0.9, "detail"),
  "world-cup-trophy": sceneProp("farewell-keepsakes", 11.22, 17.02, 5, 0.88, "reward"),
};

const SCENE_DRESSING = [
  // Patio: pocos elementos que enmarcan la entrada, sin tapar el primer tramo.
  dressing("upd-tree-left", "oak-tree", "upd-gate", -2.3, -0.55, -8, 0.82),
  dressing("upd-tree-right", "oak-tree", "upd-chaos", 13.7, -0.55, 12, 0.8),
  dressing("upd-fence-2", "fence", "upd-gate", 1.6, -1.18, 90, 0.86),
  dressing("upd-fence-3", "fence", "upd-gate", 2.55, -1.18, 90, 0.86),

  // Boulevard: repetición rítmica de faroles y dos pequeñas islas para sentarse.
  dressing("belgrano-lamp-1", "streetlamp", "belgrano-boulevard", 0.35, 2.02, 0, 0.9),
  dressing("belgrano-lamp-2", "streetlamp", "belgrano-boulevard", 2.0, 2.02, 0, 0.9),
  dressing("belgrano-lamp-3", "streetlamp", "belgrano-boulevard", 9.0, 2.02, 0, 0.9),
  dressing("belgrano-lamp-4", "streetlamp", "belgrano-boulevard", 12.25, 2.02, 0, 0.9),
  dressing("belgrano-bench-2", "bench", "belgrano-boulevard", -0.05, 4.28, 4, 0.84),
  dressing("belgrano-flower-1", "flower-bed", "belgrano-skyline", 11.75, 4.28, 0, 0.78),

  // Campus: vegetación baja enmarca los edificios y deja el centro respirando.
  dressing("faculty-tree-1", "oak-tree", "faculty-campus", 3.55, 5.3, 8, 0.82),
  dressing("faculty-tree-2", "oak-tree", "faculty-campus", 6.4, 5.3, -8, 0.84),
  dressing("faculty-bench-1", "bench", "faculty-campus", 4.75, 7.55, 0, 0.84),
  dressing("faculty-flower-1", "flower-bed", "faculty-campus", 5.9, 7.55, 0, 0.76),

  // Parque: árboles en grupos impares, no una grilla; bancos orientados a la fuente.
  dressing("park-tree-1", "oak-tree", "park-woods", 0.85, 8.55, 12, 0.86),
  dressing("park-tree-2", "oak-tree", "park-woods", 1.8, 10.72, -8, 0.82),
  dressing("park-tree-3", "oak-tree", "park-plaza", 6.75, 10.72, 8, 0.84),
  dressing("park-rock-1", "rock", "park-woods", 0.65, 10.72, 12, 0.78),
  dressing("park-rock-2", "rock", "park-sports", 13.75, 10.65, -8, 0.76),
  dressing("park-bench-1", "bench", "park-plaza", 7.95, 8.55, 178, 0.84),
  dressing("park-flower-1", "flower-bed", "park-plaza", 3.8, 8.55, 0, 0.78),

  // Costa: una línea de palmeras y montañas de borde crea profundidad.
  dressing("coast-palm-2", "palm-tree", "coast-beach", 13.75, 13.0, -12, 0.84),
  dressing("coast-palm-3", "palm-tree", "coast-beach", 6.9, 14.2, 16, 0.86),
  dressing("coast-rock-1", "rock", "coast-beach", 7.35, 11.72, -8, 0.74),
  dressing("coast-mountain-right", "mountain-cluster", "coast-backdrop", 14.05, 11.8, -8, 0.72),
  dressing("coast-boat-2", "sailboat", "coast-lagoon", 5.8, 14.08, 18, 0.82),

  // Despedida: marco floral simple y faroles simétricos hacia la meta.
  dressing("farewell-flower-left", "flower-bed", "farewell-stage", 7.35, 15.0, 0, 0.8),
  dressing("farewell-flower-right", "flower-bed", "farewell-stage", 12.4, 16.95, 0, 0.8),
  dressing("farewell-lamp-left", "streetlamp", "farewell-stage", 8.65, 14.75, 0, 0.88),
  dressing("farewell-lamp-right", "streetlamp", "farewell-stage", 14.25, 15.5, 0, 0.88),
];

export function authorDespedidaMap(content) {
  const source = content.maps?.find((map) => map.id === MAP_ID) ?? content.maps?.find((map) => map.name === "Despedida");
  if (!source) throw new Error("The Despedida map (map-2) does not exist");

  const board = buildBoard(content.events);
  const routes = buildRoutes(board);
  const mapProps = buildMapProps(content.assetCatalog ?? [], board);
  const map = {
    ...source,
    id: MAP_ID,
    name: "Despedida",
    description: "Recorrido cinematográfico de 65 casilleros en seis actos: UPD, noche porteña, facultad, parque, costa y despedida. Usa colas compartidas por actividad, eventos cinematográficos anclados, siete shops y una pasarela final que garantiza un último evento antes de la meta.",
    theme: { base: "#4f9f63", path: "#f2d49b", accent: "#53d4dc", sky: "#21162f" },
    board,
    routes,
    mapProps,
    artifacts: mapProps.map(cloneProp),
    terraces: buildTerraces(),
    boardShape: {
      minX: -3.15,
      minY: -3,
      maxX: 15.15,
      maxY: 18.1,
      blockedCells: [],
      borderEdges: [],
    },
    defaultCamera: { focus: "activePlayer", yaw: -42, pitch: 27, distance: 6.8, fov: 38, focusOffset: { x: 0.2, y: 0.1, z: 0 } },
    cameraPresets: CAMERA_PRESETS,
  };

  const covered = new Set(board.flatMap((tile) => [tile.eventId, ...(tile.eventIds ?? [])]).filter(Boolean));
  const queuedTypes = new Set(board.flatMap((tile) => tile.eventQueue?.activityTypes ?? []));
  const missingEvents = Object.entries(content.events).filter(([id, event]) => !covered.has(id) && !queuedTypes.has(event.activity?.type ?? "prompt")).map(([id]) => id);
  const unknownEvents = [...covered].filter((id) => !content.events[id]);
  if (missingEvents.length || unknownEvents.length) {
    throw new Error(`Despedida event coverage failed. Missing: ${missingEvents.join(", ") || "none"}. Unknown: ${unknownEvents.join(", ") || "none"}.`);
  }
  if (board.filter((tile) => tile.type === "shop").length !== 7) throw new Error("Despedida must contain exactly seven shops");

  const placedAssetIds = new Set(mapProps.map((prop) => prop.assetId));
  const missingAssets = (content.assetCatalog ?? []).map((asset) => asset.id).filter((id) => !placedAssetIds.has(id));
  if (missingAssets.length) throw new Error(`Despedida is missing map assets: ${missingAssets.join(", ")}`);

  content.maps = (content.maps ?? []).map((candidate) => candidate.id === MAP_ID ? map : candidate);
  content.activeMapId = MAP_ID;
  return map;
}

function buildBoard(events) {
  const board = Array.from({ length: 65 }, (_, id) => ({ id, type: "dare", layout: layoutForCell(id) }));
  board[0] = { ...board[0], type: "start", label: "ARRANCA EL UPD", cameraPresetId: "opening" };
  board[64] = { ...board[64], type: "finish", label: "DESPEDIDA DE JAVI", cameraPresetId: "finale" };

  for (const id of SHOP_CELLS) {
    board[id] = {
      ...board[id],
      type: "shop",
      label: `KIOSCO ${[...SHOP_CELLS].indexOf(id) + 1}/7`,
      camera: propCamera(id, SHOP_PROP_OFFSETS.get(id), 6.8),
    };
  }

  const pinnedIds = new Set([...PINNED_EVENTS.values()].map((entry) => entry.eventId));
  for (const [cellId, entry] of PINNED_EVENTS) {
    const event = events[entry.eventId];
    if (!event) throw new Error(`Pinned event ${entry.eventId} is missing`);
    board[cellId] = {
      ...board[cellId],
      type: tileTypeForActivity(event.activity?.type ?? "prompt", cellId),
      label: entry.label,
      eventId: entry.eventId,
      eventQueue: { activityTypes: [event.activity?.type ?? "prompt"] },
      tags: ["cinematic", `prop:${entry.propAssetId}`, `zone:${zoneForCell(cellId) + 1}`],
      camera: heroCamera(cellId),
    };
  }

  for (const eventId of FINALE_EVENT_IDS) {
    if (!events[eventId]) throw new Error(`Finale event ${eventId} is missing`);
    pinnedIds.add(eventId);
  }
  board[FINALE_EVENT_CELL] = {
    ...board[FINALE_EVENT_CELL],
    type: "groom",
    label: "DESPEDIDA · RECUERDOS FINALES",
    eventIds: [...FINALE_EVENT_IDS],
    eventQueue: { activityTypes: ["prompt"] },
    tags: ["event-queue", "finale-core", "activity:prompt", "zone:6"],
    cameraPresetId: "story-finale",
  };

  const openCells = board.filter((tile) => tile.id !== 0 && tile.id !== 64 && tile.id !== FINALE_EVENT_CELL && !SHOP_CELLS.has(tile.id) && !PINNED_EVENTS.has(tile.id));
  if (openCells.length !== OPEN_CELL_SEQUENCE.length) throw new Error(`Expected ${OPEN_CELL_SEQUENCE.length} open event cells, found ${openCells.length}`);
  openCells.forEach((tile, index) => {
    const activityType = OPEN_CELL_SEQUENCE[index];
    if (!Object.entries(events).some(([eventId, event]) => (event.activity?.type ?? "prompt") === activityType && !pinnedIds.has(eventId))) {
      throw new Error(`Missing shared events for ${activityType} at cell ${tile.id}`);
    }
    tile.type = tileTypeForActivity(activityType, tile.id);
    tile.label = queueLabel(activityType, zoneForCell(tile.id));
    tile.eventQueue = { activityTypes: [activityType] };
    tile.tags = ["event-queue", "shared-queue", `activity:${activityType}`, `zone:${zoneForCell(tile.id) + 1}`];
    tile.cameraPresetId = cameraPresetForActivity(activityType, tile.id);
  });
  for (const cellId of [60, 63]) {
    board[cellId].eventIds = [...FINALE_EVENT_IDS];
    board[cellId].tags = [...(board[cellId].tags ?? []), "finale-core"];
  }
  return board;
}

function tileTypeForActivity(activityType, cellId) {
  if (activityType === "prompt") return PROMPT_TILE_TYPES[cellId % PROMPT_TILE_TYPES.length];
  if (activityType === "vote") return "vote";
  if (activityType === "buzzer") return "trivia";
  if (activityType === "judge") return "judge";
  if (activityType === "reaction" || activityType === "timing") return "reaction";
  return "minigame";
}

function cameraPresetForActivity(activityType, cellId) {
  const family = activityType === "prompt" ? "story" : activityType === "buzzer" ? "trivia" : "activity";
  return `${family}-${directionForCell(cellId)}`;
}

function queueLabel(activityType, zone) {
  const zoneNames = ["UPD", "BELGRANO", "FACULTAD", "PARQUE", "COSTA", "DESPEDIDA"];
  const activityNames = {
    prompt: "HISTORIAS",
    vote: "VOTACIÓN",
    cardVote: "AMIGOS DE MIERDA",
    buzzer: "TRIVIA",
    judge: "JURADO",
    timing: "TIMING",
    reaction: "REACCIÓN",
    whack: "WHACK",
    maze: "ARCADE MAZE",
    flappy: "ARCADE FLAPPY",
    snake: "ARCADE SNAKE",
    horserace: "ARCADE CARRERA DE CABALLOS",
    redlight: "ARCADE LUZ ROJA",
  };
  return `${zoneNames[zone]} · ${activityNames[activityType] ?? activityType.toUpperCase()}`;
}

function layoutForCell(id) {
  let x;
  let y;
  if (id <= 9) {
    x = -0.25 + id * 1.4;
    y = 0.05 + Math.sin(id * 0.8) * 0.11;
  } else if (id === 10) {
    x = 13.05;
    y = 1.5;
  } else if (id <= 20) {
    x = 12.35 - (id - 11) * 1.4;
    y = 3.2 + Math.sin(id * 0.75) * 0.1;
  } else if (id === 21) {
    x = -1.05;
    y = 4.75;
  } else if (id <= 31) {
    x = -0.25 + (id - 22) * 1.4;
    y = 6.4 + Math.sin(id * 0.7) * 0.11;
  } else if (id === 32) {
    x = 13.05;
    y = 7.95;
  } else if (id <= 42) {
    x = 12.35 - (id - 33) * 1.4;
    y = 9.6 + Math.sin(id * 0.72) * 0.1;
  } else if (id === 43) {
    x = -1.05;
    y = 11.1;
  } else if (id <= 53) {
    x = -0.25 + (id - 44) * 1.4;
    y = 12.8 + Math.sin(id * 0.68) * 0.1;
  } else {
    ({ x, y } = FINALE_LAYOUT[id]);
  }
  const next = id < 64 ? rawNextPoint(id + 1) : { x: x - 1, y };
  const rot = Math.round((Math.atan2(next.y - y, next.x - x) * 180) / Math.PI);
  return { x: round(x), y: round(y), rot };
}

function rawNextPoint(id) {
  if (id <= 9) return { x: -0.25 + id * 1.4, y: 0.05 + Math.sin(id * 0.8) * 0.11 };
  if (id === 10) return { x: 13.05, y: 1.5 };
  if (id <= 20) return { x: 12.35 - (id - 11) * 1.4, y: 3.2 + Math.sin(id * 0.75) * 0.1 };
  if (id === 21) return { x: -1.05, y: 4.75 };
  if (id <= 31) return { x: -0.25 + (id - 22) * 1.4, y: 6.4 + Math.sin(id * 0.7) * 0.11 };
  if (id === 32) return { x: 13.05, y: 7.95 };
  if (id <= 42) return { x: 12.35 - (id - 33) * 1.4, y: 9.6 + Math.sin(id * 0.72) * 0.1 };
  if (id === 43) return { x: -1.05, y: 11.1 };
  if (id <= 53) return { x: -0.25 + (id - 44) * 1.4, y: 12.8 + Math.sin(id * 0.68) * 0.1 };
  return FINALE_LAYOUT[id];
}

function buildRoutes(board) {
  return board.slice(0, -1).map((tile, index) => {
    const next = board[index + 1];
    const terrain = terrainForRoute(tile.id);
    const route = { id: `despedida-${tile.id}-${next.id}`, from: tile.id, to: next.id, terrain, label: routeLabel(tile.id) };
    if ([9, 10, 20, 21, 31, 32, 42, 43, 53, 54].includes(tile.id)) {
      route.points = [{
        x: round((tile.layout.x + next.layout.x) / 2 + (tile.id % 2 ? -0.15 : 0.15)),
        y: round((tile.layout.y + next.layout.y) / 2),
      }];
    }
    return route;
  });
}

function terrainForRoute(id) {
  if (id < 10) return "stone";
  if (id < 21) return "asphalt";
  if (id < 32) return "stone";
  if (id < 43) return "grass";
  if (id < 49) return "water";
  if (id < 54) return "sand";
  return "magic";
}

function routeLabel(id) {
  return ({ 0: "El UPD empieza", 10: "Rumbo a Belgrano", 21: "De vuelta a clase", 32: "Tarde en el parque", 43: "Bajamos a la costa", 54: "Última subida" })[id];
}

function buildMapProps(assetCatalog, board) {
  const assets = new Map(assetCatalog.map((asset) => [asset.id, asset]));
  const props = [];
  const usedAssetIds = new Set();

  for (const [cellId, entry] of PINNED_EVENTS) {
    const tile = board[cellId];
    const offset = SPECIAL_PROP_OFFSETS.get(cellId);
    addProp(props, assets, usedAssetIds, {
      id: `hero-${entry.eventId}`,
      assetId: entry.propAssetId,
      label: `${entry.label} · prop narrativo`,
      position: { x: round(tile.layout.x + offset.x), y: round(tile.layout.y + offset.y), rot: offset.rot },
      scale: propScale(assets.get(entry.propAssetId), true),
      data: { linkedEventId: entry.eventId, role: "event-hero" },
    });
  }

  [...SHOP_CELLS].forEach((cellId, index) => {
    const tile = board[cellId];
    const offset = SHOP_PROP_OFFSETS.get(cellId);
    addProp(props, assets, usedAssetIds, {
      id: `despedida-shop-${index + 1}`,
      assetId: "kiosco-24hs",
      label: `Kiosco de artefactos ${index + 1}`,
      position: { x: round(tile.layout.x + offset.x), y: round(tile.layout.y + offset.y), rot: offset.rot },
      scale: 0.92,
      data: { linkedCellId: cellId, role: "shop", scene: `shop-${index + 1}`, layer: "anchor" },
    });
  });

  for (const asset of assetCatalog) {
    if (usedAssetIds.has(asset.id)) continue;
    const placement = AUTHORED_SCENE_PROPS[asset.id];
    if (!placement) throw new Error(`Map asset ${asset.id} has no authored Despedida scene placement`);
    addProp(props, assets, usedAssetIds, {
      id: `despedida-${slug(asset.id)}`,
      assetId: asset.id,
      label: `${asset.name} · ${sceneLabel(placement.scene)}`,
      position: { x: placement.x, y: placement.y, rot: placement.rot },
      scale: placement.scale ?? propScale(asset),
      data: { role: "scene-prop", scene: placement.scene, layer: placement.layer },
    });
  }

  for (const placement of SCENE_DRESSING) {
    if (!assets.has(placement.assetId)) throw new Error(`Scene dressing ${placement.id} references missing asset ${placement.assetId}`);
    props.push({
      id: placement.id,
      assetId: placement.assetId,
      position: { x: placement.x, y: placement.y, rot: placement.rot },
      scale: placement.scale,
      data: { role: "scene-dressing", scene: placement.scene, layer: "frame" },
    });
  }
  validateSceneComposition(props);
  return props;
}

function addProp(props, assets, usedAssetIds, prop) {
  if (!assets.has(prop.assetId)) throw new Error(`Map prop ${prop.id} references missing asset ${prop.assetId}`);
  props.push(prop);
  usedAssetIds.add(prop.assetId);
}

function validateSceneComposition(props) {
  const ids = new Set();
  for (const prop of props) {
    if (ids.has(prop.id)) throw new Error(`Despedida scene prop id is duplicated: ${prop.id}`);
    ids.add(prop.id);
  }
}

function propScale(asset, hero = false) {
  const base = asset?.defaultScale ?? 1;
  const large = ["house", "vehicle", "mountain", "plaza", "water"].includes(asset?.kind);
  return round(Math.min(hero ? 1.15 : 1.05, base * (large ? 0.78 : hero ? 1.08 : 0.92)));
}

function heroCamera(cellId) {
  return propCamera(cellId, SPECIAL_PROP_OFFSETS.get(cellId), 6.4);
}

function propCamera(cellId, offset, distance) {
  const direction = directionForCell(cellId);
  const yaw = direction === "east" ? -50 : direction === "west" ? 50 : direction === "finale" ? -34 : offset.x < 0 ? 18 : -18;
  return {
    focus: "activePlayer",
    yaw,
    pitch: direction === "turn" ? 30 : 26,
    distance,
    fov: 36,
    focusOffset: {
      x: round(offset.x * 1.35 * 0.48),
      y: 0.2,
      z: round(offset.y * 1.35 * 0.48),
    },
  };
}

function sceneProp(scene, x, y, rot, scale, layer) {
  return { scene, x, y, rot, scale, layer };
}

function dressing(id, assetId, scene, x, y, rot, scale) {
  return { id, assetId, scene, x, y, rot, scale };
}

function sceneLabel(scene) {
  return scene.replaceAll("-", " ");
}

function buildTerraces() {
  return [
    { id: "acto-1-upd", minX: -3, minY: -2.85, maxX: 14.4, maxY: 1.7, elevation: 0.08, surface: "stone", label: "Acto 1 · Patio del UPD" },
    { id: "acto-2-belgrano", minX: -3, minY: 1.65, maxX: 14.4, maxY: 4.95, elevation: 0.28, surface: "plaza", label: "Acto 2 · Noche en Belgrano" },
    { id: "acto-3-facultad", minX: -3, minY: 4.9, maxX: 14.4, maxY: 8.2, elevation: 0.5, surface: "stone", label: "Acto 3 · Facultad y oficinas" },
    { id: "acto-4-parque", minX: -3, minY: 8.15, maxX: 14.4, maxY: 11.4, elevation: 0.72, surface: "grass", label: "Acto 4 · Parque de los desafíos" },
    { id: "acto-5-costa", minX: -3, minY: 11.35, maxX: 14.4, maxY: 14.7, elevation: 0.94, surface: "sand", label: "Acto 5 · Costa y playa" },
    { id: "acto-5-lago", minX: -1.4, minY: 11.55, maxX: 7.4, maxY: 14.45, elevation: 0.98, surface: "water", label: "Laguna de la previa" },
    { id: "acto-6-despedida", minX: 7, minY: 14.1, maxX: 15, maxY: 17.9, elevation: 1.32, surface: "plaza", color: "#df9fb8", label: "Acto 6 · Despedida" },
    { id: "meta-mirador", minX: 7, minY: 15.15, maxX: 12.1, maxY: 17.65, elevation: 1.66, surface: "plaza", color: "#f0b6c9", label: "Mirador final" },
  ];
}

function zoneForCell(id) {
  if (id <= 10) return 0;
  if (id <= 21) return 1;
  if (id <= 32) return 2;
  if (id <= 43) return 3;
  if (id <= 54) return 4;
  return 5;
}

function directionForCell(id) {
  if (id <= 9 || (id >= 22 && id <= 31) || (id >= 44 && id <= 53)) return "east";
  if ((id >= 11 && id <= 20) || (id >= 33 && id <= 42)) return "west";
  if (id >= 54) return "finale";
  return "turn";
}

function cloneProp(prop) {
  return { ...prop, position: { ...prop.position }, data: prop.data ? { ...prop.data } : undefined };
}

function slug(value) {
  return String(value).replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function round(value) {
  return Math.round(value * 100) / 100;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const content = JSON.parse(fs.readFileSync(contentPath, "utf8"));
  const map = authorDespedidaMap(content);
  fs.writeFileSync(contentPath, `${JSON.stringify(content, null, 2)}\n`);
  console.log(JSON.stringify({
    mapId: map.id,
    cells: map.board.length,
    eventCells: map.board.filter((tile) => tile.eventId || tile.eventIds?.length || tile.eventQueue).length,
    anchoredEvents: new Set(map.board.flatMap((tile) => [tile.eventId, ...(tile.eventIds ?? [])]).filter(Boolean)).size,
    sharedQueueCells: map.board.filter((tile) => tile.eventQueue).length,
    shops: map.board.filter((tile) => tile.type === "shop").length,
    props: map.mapProps.length,
    uniqueAssets: new Set(map.mapProps.map((prop) => prop.assetId)).size,
    terraces: map.terraces.length,
  }, null, 2));
}
