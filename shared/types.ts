// ============================================================================
// Contrato compartido entre server y clientes.
// El server es la fuente de verdad; los clientes espejan el GameState.
// ============================================================================

// ---------------------------------------------------------------------------
// Tablero / contenido
// ---------------------------------------------------------------------------

export type TileType =
  | "start"
  | "finish"
  | "minigame"
  | "trivia"
  | "vote"
  | "judge"
  | "dare"
  | "fate"
  | "groom"
  | "reaction"
  | "estimate";

export interface TileLayout {
  /** coordenadas visuales de casillero; x/y son plano de tablero, z es altura opcional */
  x: number;
  y: number;
  z?: number;
  /** orientación visual opcional, en grados alrededor del eje vertical */
  rot?: number;
}

export interface Tile {
  id: number;
  type: TileType;
  /** id dentro del catálogo de minijuegos (para minigame/trivia/vote/judge/groom) */
  minigameId?: string;
  /** id dentro del catálogo de dares */
  dareId?: string;
  /** id dentro del catálogo de fates */
  fateId?: string;
  /** contrato visual: no afecta la mecánica del server */
  layout?: TileLayout;
  label?: string;
  /** reservado para eventos futuros que no entren en los catálogos actuales */
  eventKind?: "none" | "minigame" | "dare" | "fate" | "custom";
  eventId?: string;
  /** candidatos de eventos para este casillero; se elige el mejor para el jugador que cae */
  eventIds?: string[];
  /** ajustes narrativos/temáticos editables desde el map builder */
  storyParams?: Record<string, string>;
}

export type MapTerrain =
  | "stone"
  | "grass"
  | "sand"
  | "water"
  | "asphalt"
  | "magic";

export interface MapGridPoint {
  x: number;
  y: number;
}

export interface MapBorderEdge {
  id: string;
  from: MapGridPoint;
  to: MapGridPoint;
  terrain?: MapTerrain;
  label?: string;
}

export interface MapBoardShape {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  blockedCells?: MapGridPoint[];
  borderEdges?: MapBorderEdge[];
}

export type MapTerraceSurface = "grass" | "sand" | "water" | "stone" | "plaza";

/** Meseta de terreno: región rectangular elevada que forma el relieve del mapa. */
export interface MapTerrace {
  id: string;
  /** región en coordenadas de grilla (mismas unidades que TileLayout.x/y), bordes inclusive */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** altura del piso en unidades de mundo 3D (0 = nivel base); los casilleros la heredan según su x/y */
  elevation: number;
  surface?: MapTerraceSurface;
  /** pisa el color derivado de surface (ej. lomas rosas de la meta) */
  color?: string;
  label?: string;
}

export interface MapRoute {
  id: string;
  from: number;
  to: number;
  terrain: MapTerrain;
  /** texto mostrado al elegir una rama, ej. "Izquierda" */
  choiceLabel?: string;
  /** puntos intermedios para dibujar curvas/quiebres de la ruta */
  points?: TileLayout[];
  label?: string;
  bidirectional?: boolean;
}

export type MapArtifactKind =
  | "tree"
  | "house"
  | "court"
  | "vehicle"
  | "mountain"
  | "water"
  | "sign"
  | "plaza"
  | "decor"
  | "custom";

export type MapAssetFootprintShape = "rect" | "circle" | "ellipse" | "triangle";

export interface MapAssetFootprint {
  width: number;
  height: number;
  shape: MapAssetFootprintShape;
}

export interface MapAssetProjectionPoint {
  /** Three.js local +X axis, in model/world units before board grid spacing is applied. */
  x: number;
  /** Three.js local +Z axis, in model/world units before board grid spacing is applied. */
  z: number;
}

export interface MapAssetProjectionBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface MapAssetProjection {
  points?: MapAssetProjectionPoint[];
  bounds?: MapAssetProjectionBounds;
  shape?: MapAssetFootprintShape;
}

export interface MapAssetDef {
  id: string;
  name: string;
  kind: MapArtifactKind;
  defaultScale?: number;
  footprint?: MapAssetFootprint;
  projection?: MapAssetProjection;
  color?: string;
  tags?: string[];
}

export interface MapArtifact {
  id: string;
  assetId: string;
  label?: string;
  position: TileLayout;
  scale?: number;
  visible?: boolean;
  tint?: string;
  data?: Record<string, unknown>;
}

export interface MapTheme {
  base?: string;
  path?: string;
  accent?: string;
  sky?: string;
}

export interface MapDefinition {
  id: string;
  name: string;
  description?: string;
  board: Tile[];
  routes: MapRoute[];
  artifacts: MapArtifact[];
  /** relieve: mesetas con elevación; sin terrazas el mapa es plano (nivel 0) */
  terraces?: MapTerrace[];
  boardShape?: MapBoardShape;
  theme?: MapTheme;
}

export interface RiggedConfig {
  /** jamás pueden salir primeros (van al fondo del ranking) */
  losers?: string[];
  /** siempre salen arriba */
  winners?: string[];
}

/** UI/resolution unit that an event can run. */
export type EventActivityType =
  | "prompt"
  | "hostPick"
  | "selfTap"
  | "vote"
  | "buzzer"
  | "judge"
  | "timing"
  | "reaction"
  | "estimate"
  | "whack"
  | "maze"
  | "flappy"
  | "snake"
  | "horserace"
  | "redlight";

/** Legacy name kept for existing minigame definitions and engines. */
export type MinigameType =
  | EventActivityType
  | "masher"
  | "memory"
  | "order"
  | "clicker";

export interface MinigameDef {
  type: MinigameType;
  /** variante visual / temática: "bostezo" | "lujan" | "default" | ... */
  skin?: string;
  /** preguntas, persona, prompts, etc. (forma depende del motor) */
  content: unknown;
  rigged?: RiggedConfig;
}

export interface DareDef {
  text: string;
}

export interface FateDef {
  text: string;
  /** casilleros a avanzar (+) o retroceder (-) */
  delta?: number;
  /** monedas a sumar (+) o restar (-) */
  coins?: number;
}

export type EventKind = "story" | "activity";
/** @deprecated Legacy prompt resolver; normalized into first-class activity types. */
export type EventResolutionMode = "none" | "hostPick" | "selfTap" | "vote";
export type EventParticipantMode = "everyone" | "landing" | "host";
export type EventConfirmationMode = "self" | "rest" | "everyone" | "host";

export type EventTriggerScope =
  | { type: "anyPlayer" }
  | { type: "player"; playerId: string };

export interface EventStory {
  title?: string;
  setup?: string;
  prompt?: string;
  reward?: string;
  reveal?: string;
}

export interface EventActivity {
  type: EventActivityType;
  skin?: string;
  content?: unknown;
  /** @deprecated Use activity.type: "hostPick" | "selfTap" | "vote" instead. */
  resolutionMode?: EventResolutionMode;
  participants?: EventParticipantMode;
  /** Optional subject set to rank independently from the players who submit input. */
  subjects?: EventParticipantMode;
  /** Confirmation rules for prompt/offline activities. Defaults to the rest of the group. */
  confirmation?: {
    mode?: EventConfirmationMode;
    playerIds?: string[];
  };
  rigged?: RiggedConfig;
}

export type EventActionTarget =
  | "landing"
  | "winner"
  | "loser"
  | "everyone"
  | { playerId: string }
  | { rank: number }
  | { rankFrom: number; rankTo: number };

export type EventAction =
  | { type: "text"; text: string; target?: EventActionTarget }
  | { type: "coins"; value: number; target?: EventActionTarget; text?: string }
  | { type: "move"; delta: number; target?: EventActionTarget; text?: string }
  | { type: "moveTo"; tileId: number; target?: EventActionTarget; text?: string }
  | { type: "skipTurn"; target?: EventActionTarget; text?: string }
  | { type: "extraTurn"; target?: EventActionTarget; text?: string };

export interface EventOutcomeBranch {
  id?: string;
  label?: string;
  when: EventActionTarget;
  actions: EventAction[];
}

export interface GameEventDef {
  name: string;
  kind?: EventKind;
  tags?: string[];
  /** qué jugador puede disparar este evento; por defecto cualquiera */
  trigger?: EventTriggerScope;
  story?: EventStory;
  activity?: EventActivity;
  /** immediate actions for story-only events */
  actions?: EventAction[];
  /** actions applied after an activity resolves to a ranking */
  outcomes?: EventOutcomeBranch[];
}

export interface PlayerEventOverride {
  eventId?: string;
  tags?: string[];
  kind?: EventKind;
  activityType?: EventActivityType;
  story?: EventStory;
  activity?: Partial<EventActivity>;
  actions?: EventAction[];
  outcomes?: EventOutcomeBranch[];
}

export interface PlayerStoryBank {
  overrides: PlayerEventOverride[];
}

export type CharacterMovementStyle = "walk" | "hop";
export type CharacterCosmeticSlot = "hat" | "mustache" | "nipplePiercing" | "tattoo";

export interface CharacterBaseConfig {
  color: string;
  /** escala vertical simple para el token 3D */
  height: number;
  /** escala horizontal simple para el token 3D */
  weight: number;
  movement: CharacterMovementStyle;
  limbs: {
    arms: boolean;
    legs: boolean;
  };
}

export interface CharacterCosmeticDef {
  id: string;
  name: string;
  slot: CharacterCosmeticSlot;
  cost: number;
  defaultUnlocked?: boolean;
  color?: string;
  description?: string;
}

export interface PlayerCharacter {
  base: CharacterBaseConfig;
  /** ids del catálogo que ya puede equipar este jugador */
  unlockedCosmeticIds?: string[];
  /** slot -> cosmetic id; null/undefined significa nada equipado */
  equippedCosmeticIds?: Partial<Record<CharacterCosmeticSlot, string | null>>;
}

export interface PlayerDef {
  id: string;
  name: string;
  /** marca al novio para casilleros `groom` y guiños */
  groom?: boolean;
  color?: string;
  character?: PlayerCharacter;
}

export interface GameContent {
  board: Tile[];
  activeMapId?: string;
  maps?: MapDefinition[];
  assetCatalog?: MapAssetDef[];
  events?: Record<string, GameEventDef>;
  playerStories?: Record<string, PlayerStoryBank>;
  minigames: Record<string, MinigameDef>;
  dares: Record<string, DareDef>;
  fates: Record<string, FateDef>;
  players: PlayerDef[];
  characterCosmetics?: CharacterCosmeticDef[];
  /** monedas por puesto del ranking, de 1ro a último (se reparte por defecto) */
  coinPayout?: number[];
}

// ---------------------------------------------------------------------------
// Estado de juego (autoritativo en server, espejado en clientes)
// ---------------------------------------------------------------------------

export interface Player {
  id: string;
  name: string;
  socketId: string | null; // null = desconectado
  connected: boolean;
  position: number;
  coins: number;
  isHost: boolean;
  groom: boolean;
  color: string;
  character: PlayerCharacter;
}

export type Phase =
  | "lobby"
  | "turn" // esperando que el jugador activo tire
  | "moving" // animación de movimiento
  | "event" // resolviendo un casillero no-minijuego (dare/fate)
  | "minigame" // minijuego en curso (clientes jugando local)
  | "reveal" // mostrando resultados
  | "finished";

export interface ActiveMinigame {
  /** event id or legacy minigame id */
  id: string;
  eventId?: string;
  protagonistId?: string;
  type: EventActivityType;
  skin?: string;
  content: unknown;
  story?: EventStory;
  /** jugadores que deben submittear resultado (ids) */
  participants: string[];
  /** jugadores que se rankean para outcomes; por defecto coincide con participants */
  subjects?: string[];
  /** ids que ya enviaron resultado */
  submitted: string[];
  judge?: {
    phase: "writing" | "voting";
    submissions?: { id: string; text: string }[];
  };
}

export interface ActiveEvent {
  id?: string;
  kind: EventKind | "dare" | "fate";
  title?: string;
  text: string;
  story?: EventStory;
  playerId: string;
  actions?: AppliedEventAction[];
}

export interface GameState {
  code: string;
  /** nombre legible de la sala, elegido por el host al crearla */
  roomName: string;
  phase: Phase;
  mapId?: string;
  /** layout del tablero (tipos/labels); el contenido sensible no viaja */
  board: Tile[];
  routes?: MapRoute[];
  artifacts?: MapArtifact[];
  assetCatalog?: MapAssetDef[];
  boardShape?: MapBoardShape;
  terraces?: MapTerrace[];
  players: Player[];
  /** orden de turnos por id */
  turnOrder: string[];
  /** índice dentro de turnOrder del jugador activo */
  activeIndex: number;
  round: number;
  boardLength: number;
  lastRoll: number | null;
  activeMinigame: ActiveMinigame | null;
  activeEvent: ActiveEvent | null;
  reveal: RevealPayload | null;
  winnerId: string | null;
}

// ---------------------------------------------------------------------------
// Resultados de minijuego
// ---------------------------------------------------------------------------

export interface MinigameResult {
  playerId: string;
  score: number;
  outcome?: "win" | "loss";
  /** "qué hizo": mensaje, tiempo, secuencia, aciertos, etc. */
  payload: unknown;
}

export interface AppliedEventAction {
  type: EventAction["type"];
  targetPlayerIds: string[];
  text: string;
  value?: number;
  tileId?: number;
}

export interface RevealEntry {
  playerId: string;
  name: string;
  rank: number; // 1 = primero
  score: number;
  coins: number;
  payload: unknown;
  /** Primary standardized result shown beside the player name. */
  resultLabel?: string;
  /** Secondary standardized detail derived from payload/content. */
  detailLabel?: string;
  /** texto extra para la pantalla de reveal (ej. respuesta de Luján) */
  flavor?: string;
}

export interface RevealPayload {
  minigameId: string;
  eventId?: string;
  type: EventActivityType;
  skin?: string;
  title: string;
  story?: EventStory;
  ranking: string[]; // ids de 1ro a último (rig ya aplicado)
  entries: RevealEntry[];
  coins: Record<string, number>;
  actions?: AppliedEventAction[];
}

// ---------------------------------------------------------------------------
// Listado público de salas (para la pantalla de "unirme")
// ---------------------------------------------------------------------------

export interface RoomSummary {
  code: string;
  name: string;
  phase: Phase;
  /** cantidad de jugadores conectados ahora */
  players: number;
  /** cupo máximo definido por el contenido (content.players.length) */
  maxPlayers: number;
  /** nombre del host (o primer jugador) */
  host: string | null;
}

// ---------------------------------------------------------------------------
// Contrato de eventos Socket.io
// ---------------------------------------------------------------------------

export interface ClientToServerEvents {
  "room:join": (
    payload: { code: string; name: string },
    ack: (res: { ok: true; playerId: string; code: string } | { ok: false; error: string }) => void
  ) => void;
  "room:create": (
    payload: { name: string; roomName: string },
    ack: (res: { ok: true; playerId: string; code: string } | { ok: false; error: string }) => void
  ) => void;
  /** El jugador abandona la sala voluntariamente. */
  "room:leave": () => void;
  "game:start": () => void;
  "turn:roll": () => void;
  "turn:next": () => void;
  "minigame:action": (payload: unknown) => void;
  "minigame:result": (payload: { score: number; payload: unknown; outcome?: "win" | "loss" }) => void;
  /** host fuerza el cierre del minijuego si alguien se colgó */
  "minigame:force": () => void;
  "reveal:next": () => void;
}

export interface ServerToClientEvents {
  state: (state: GameState) => void;
  "minigame:start": (payload: {
    id: string;
    type: EventActivityType;
    skin?: string;
    content: unknown;
    participants: string[];
  }) => void;
  "minigame:action": (payload: { playerId: string; data: unknown }) => void;
  "minigame:reveal": (payload: RevealPayload) => void;
  error: (payload: { message: string }) => void;
}
